// 묶음 E: 외부 목록 검색 화면 `/feed`.
import { SUPPORTED_ECOSYSTEMS } from "@pw/shared";
import { apiErrorOf } from "@pw/shared/fixtures";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FeedPage } from "@/features/feed/FeedPage";
import { reply, setupFetchMock, type FetchMock } from "@/test/fetchMock";
import { feedEntryAll, feedEntryRanged, feedPage } from "@/test/feedFixtures";
import { renderWithProviders } from "@/test/render";
import { advance, chooseOption, findRowWith, queryAllSkeletons } from "@/test/ui";

const ENTRIES = "/api/feed/entries";

function setupServer(page = feedPage([feedEntryRanged, feedEntryAll])): FetchMock {
  return setupFetchMock().on("GET", ENTRIES, reply.json(page));
}

async function renderFeed() {
  const result = renderWithProviders(<FeedPage />, { route: "/feed" });
  return result;
}

describe("외부 목록 검색", () => {
  it("[SE-70] 첫 요청은 page=1 이고 표에 종류·이름·범위·심각도·요약·갱신 시각·링크를 보인다", async () => {
    const server = setupServer();
    await renderFeed();
    const row = await findRowWith("evil-npm-pkg");
    expect(server.last("GET", ENTRIES)?.query).toEqual({ page: "1", limit: "50" });
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(headers).toEqual(["종류", "이름", "범위", "심각도", "요약", "갱신 시각", "권고"]);
    expect(within(row).getByText("npm")).toBeInTheDocument();
    expect(within(row).getByText(">=1.0.0 <2.0.0")).toBeInTheDocument();
    expect(within(row).getByText("critical")).toBeInTheDocument();
    expect(within(row).getByText("Malware in evil-npm-pkg")).toBeInTheDocument();
    // 2026-11-15T00:00Z = KST 09:00
    expect(within(row).getByText("2026-11-15 09:00")).toBeInTheDocument();
  });

  it("[SE-71] 범위가 없으면 '모든 버전', 권고 링크는 새 창 + rel=noreferrer", async () => {
    setupServer();
    await renderFeed();
    const row = await findRowWith("bad-py-pkg");
    expect(within(row).getByText("모든 버전")).toBeInTheDocument();
    const link = within(row).getByRole("link", { name: /GHSA-dddd-eeee-ffff/ });
    expect(link).toHaveAttribute("href", feedEntryAll.url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });

  it("[SE-72] 2쪽에 간 뒤 검색어를 바꾸면 300ms debounce 뒤 trim 해서 q 와 page=1 로 요청한다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = setupServer(feedPage([feedEntryRanged], { total: 120 }));
    const { user } = await renderFeed();
    await findRowWith("evil-npm-pkg");
    await user.click(screen.getByRole("button", { name: "다음" }));
    await waitFor(() => expect(server.last("GET", ENTRIES)?.query.page).toBe("2"));
    const before = server.count("GET", ENTRIES);
    await user.type(screen.getByRole("textbox", { name: "검색어" }), " GHSA-aaaa ");
    expect(server.count("GET", ENTRIES)).toBe(before);
    await advance(350);
    await waitFor(() => expect(server.last("GET", ENTRIES)?.query).toEqual({ q: "GHSA-aaaa", page: "1", limit: "50" }));
    expect(server.count("GET", ENTRIES)).toBe(before + 1);
  });

  it("[SE-73] 종류 select 는 패키지·CI 종류만 있고, 고르면 ecosystem 으로 요청한다", async () => {
    const server = setupServer();
    const { user } = await renderFeed();
    await findRowWith("evil-npm-pkg");
    await user.click(screen.getByRole("combobox", { name: "종류" }));
    const listbox = await screen.findByRole("listbox");
    const groups = within(listbox)
      .getAllByRole("group")
      .map((g) => document.getElementById(g.getAttribute("aria-labelledby") ?? "")?.textContent?.trim());
    expect(groups).toEqual(["패키지", "CI·이미지"]);
    expect(within(listbox).queryByRole("option", { name: "위험한 설정" })).toBeNull();
    expect(within(listbox).queryByRole("option", { name: "파일 경로" })).toBeNull();
    expect(SUPPORTED_ECOSYSTEMS.length).toBeGreaterThan(0);
    await user.click(within(listbox).getByRole("option", { name: "pypi" }));
    await waitFor(() => expect(server.last("GET", ENTRIES)?.query.ecosystem).toBe("pypi"));
  });

  it("[SE-74] 쪽 나눔: [다음] 은 page=2 로 요청한다", async () => {
    const server = setupServer(feedPage([feedEntryRanged], { total: 120 }));
    const { user } = await renderFeed();
    await findRowWith("evil-npm-pkg");
    expect(screen.getByText("1–50 / 120")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다음" }));
    await waitFor(() => expect(server.last("GET", ENTRIES)?.query.page).toBe("2"));
  });

  it("[SE-75] 항목이 0건이고 필터가 없으면 '아직 가져온 항목이 없습니다'", async () => {
    setupServer(feedPage([]));
    await renderFeed();
    expect(await screen.findByText("아직 가져온 항목이 없습니다")).toBeInTheDocument();
  });

  it("[SE-76] 필터가 있는데 0건이면 '조건에 맞는 항목이 없습니다'", async () => {
    const server = setupServer();
    const { user } = await renderFeed();
    await findRowWith("evil-npm-pkg");
    server.on("GET", ENTRIES, reply.json(feedPage([])));
    await chooseOption(user, screen.getByRole("combobox", { name: "종류" }), "pypi");
    expect(await screen.findByText("조건에 맞는 항목이 없습니다")).toBeInTheDocument();
  });

  it("[SE-77] 로딩 중에는 skeleton, 실패하면 오류와 [다시 시도]", async () => {
    const server = setupFetchMock().on("GET", ENTRIES, reply.error(apiErrorOf("INTERNAL_ERROR", "x"), 500));
    const { user } = await renderFeed();
    expect(queryAllSkeletons().length).toBeGreaterThan(0);
    const retry = await screen.findByRole("button", { name: "다시 시도" }, { timeout: 3000 });
    server.on("GET", ENTRIES, reply.json(feedPage([feedEntryRanged])));
    await user.click(retry);
    await findRowWith("evil-npm-pkg");
  });

  it("[SE-78] 상단에 설정으로 돌아가는 링크가 있고 표에 이름이 붙어 있다", async () => {
    setupServer();
    await renderFeed();
    await findRowWith("evil-npm-pkg");
    expect(screen.getByRole("link", { name: "설정으로" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("table", { name: "외부 목록" })).toBeInTheDocument();
  });

  it("[SE-99] 마지막 쪽(15만 건, 3,000쪽)은 범위를 표시하고 [다음] 이 비활성이다", async () => {
    setupServer(feedPage([feedEntryRanged], { total: 150000, page: 3000 }));
    await renderFeed();
    await findRowWith("evil-npm-pkg");
    expect(screen.getByText("149951–150000 / 150000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "이전" })).toBeEnabled();
  });

  it("[SE-100] 보던 쪽이 비면(항목이 줄어듦) 마지막 쪽으로 옮겨 요청한다", async () => {
    const server = setupFetchMock().on("GET", ENTRIES, (request) =>
      request.query.page === "1"
        ? reply.json(feedPage([feedEntryRanged], { total: 120 }))(request)
        : reply.json(feedPage([], { total: 50, page: Number(request.query.page) }))(request),
    );
    const { user } = await renderFeed();
    await findRowWith("evil-npm-pkg");
    await user.click(screen.getByRole("button", { name: "다음" }));
    await waitFor(() => expect(server.requests("GET", ENTRIES).map((r) => r.query.page)).toContain("2"));
    await waitFor(() => expect(server.last("GET", ENTRIES)?.query.page).toBe("1"));
  });

  it("[SE-101] url 이 javascript: 인 항목은 링크가 아니라 글자로만 보인다", async () => {
    setupServer(feedPage([{ ...feedEntryRanged, url: "javascript:alert(1)" }]));
    await renderFeed();
    const row = await findRowWith("evil-npm-pkg");
    expect(within(row).queryByRole("link")).toBeNull();
    expect(within(row).getByText("GHSA-aaaa-bbbb-cccc")).toBeInTheDocument();
  });

  it("[SE-102] 긴 요약은 잘리지 않고 줄바꿈된다", async () => {
    const summary = "Malicious ".repeat(80).trim();
    setupServer(feedPage([{ ...feedEntryRanged, summary }]));
    await renderFeed();
    const row = await findRowWith("evil-npm-pkg");
    const cell = within(row).getByText(summary);
    expect(cell.className).toContain("whitespace-normal");
    expect(cell.className).not.toContain("truncate");
  });
});
