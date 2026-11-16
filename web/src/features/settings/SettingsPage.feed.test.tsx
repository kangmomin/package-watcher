// 묶음 E: 설정 화면의 "외부 목록" 구역.
import { settingsInputSchema, type FeedStatus } from "@pw/shared";
import { apiErrorOf, emptyFindingsPage, settingsDefault, summaryDefault } from "@pw/shared/fixtures";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { reply, setupFetchMock, type FetchMock } from "@/test/fetchMock";
import { feedStatusDefault } from "@/test/feedFixtures";
import { renderWithProviders } from "@/test/render";
import { advance, findToast, settle } from "@/test/ui";

const SETTINGS = "/api/settings";
const FEED = "/api/feed";
const SYNC = "/api/feed/sync";

function setupServer(status: FeedStatus = feedStatusDefault, settings = settingsDefault): FetchMock {
  let current = settings;
  return setupFetchMock()
    .on("GET", SETTINGS, (request) => reply.json(current)(request))
    .on("PUT", SETTINGS, (request) => {
      current = { ...current, ...settingsInputSchema.parse(request.body) };
      return reply.json(current)(request);
    })
    .on("GET", FEED, reply.json(status))
    .on("GET", "/api/summary", reply.json(summaryDefault))
    .on("GET", "/api/findings", reply.json(emptyFindingsPage))
    .on("GET", "/api/blacklist", reply.json({ items: [] }));
}

async function renderSettings() {
  const result = renderWithProviders(<SettingsPage />, { route: "/settings" });
  await screen.findByRole("button", { name: "저장" });
  return result;
}

const feedRegion = () => screen.getByRole("region", { name: "외부 목록" });
const syncButton = () => screen.getByRole("button", { name: "지금 동기화" });

describe("설정 — 외부 목록 구역", () => {
  it("[SE-50] 설명과 켬·끔 스위치를 보인다 (feedEnabled 값 반영)", async () => {
    setupServer();
    await renderSettings();
    const region = feedRegion();
    expect(
      within(region).getByText(
        "GitHub Advisory의 악성 패키지 목록을 자동으로 가져와서 스캔에 씁니다. 일치한 패키지는 블랙리스트에 자동으로 추가됩니다.",
      ),
    ).toBeInTheDocument();
    expect(within(region).getByRole("switch", { name: "외부 목록 사용" })).toBeChecked();
  });

  it("[SE-51] 스위치를 끄고 [저장] 하면 PUT 본문에 feedEnabled=false 가 들어간다", async () => {
    const server = setupServer();
    const { user } = await renderSettings();
    await user.click(screen.getByRole("switch", { name: "외부 목록 사용" }));
    expect(screen.getByRole("switch", { name: "외부 목록 사용" })).not.toBeChecked();
    // 저장 전에는 요청하지 않는다
    expect(server.count("PUT", SETTINGS)).toBe(0);
    await user.click(screen.getByRole("button", { name: "저장" }));
    await findToast("설정을 저장했습니다");
    expect(settingsInputSchema.parse(server.last("PUT", SETTINGS)?.body).feedEnabled).toBe(false);
  });

  it("[SE-52] 항목 수는 천 단위 구분, 종류별 상위 3개와 '외 n종', 마지막 동기화 시각", async () => {
    setupServer();
    await renderSettings();
    const region = feedRegion();
    expect(await within(region).findByText("151,751건")).toBeInTheDocument();
    expect(within(region).getByText(/npm 125,762/)).toBeInTheDocument();
    expect(within(region).getByText(/pypi 17,529/)).toBeInTheDocument();
    expect(within(region).getByText(/nuget 4,555/)).toBeInTheDocument();
    expect(within(region).queryByText(/rubygems/)).not.toBeInTheDocument();
    expect(within(region).getByText(/외 5종/)).toBeInTheDocument();
    // 2026-11-16T03:30Z = KST 12:30
    expect(within(region).getByText("2026-11-16 12:30")).toBeInTheDocument();
  });

  it("[SE-53] 건너뛴 수는 0이면 숨기고, 있으면 보인다", async () => {
    setupServer();
    const { unmount } = await renderSettings();
    await within(feedRegion()).findByText("151,751건");
    expect(within(feedRegion()).queryByText("건너뜀")).not.toBeInTheDocument();
    unmount();
    setupServer({ ...feedStatusDefault, skippedCount: 1234 });
    await renderSettings();
    expect(await within(feedRegion()).findByText(/1,234건/)).toBeInTheDocument();
  });

  it("[SE-54] 첫 동기화가 끝나지 않았으면 안내하고, lastError 가 있으면 경고로 표시한다", async () => {
    setupServer({ ...feedStatusDefault, fullSyncDone: false, lastError: "GitHub rate limit" });
    await renderSettings();
    const region = feedRegion();
    expect(await within(region).findByText("첫 동기화가 끝나지 않았습니다 — 목록이 일부입니다")).toBeInTheDocument();
    expect(within(region).getByRole("alert")).toHaveTextContent("GitHub rate limit");
  });

  it("[SE-55] 동기화가 끝났고 오류가 없으면 안내·경고를 숨긴다", async () => {
    setupServer();
    await renderSettings();
    await within(feedRegion()).findByText("151,751건");
    expect(screen.queryByText(/첫 동기화가 끝나지/)).not.toBeInTheDocument();
    expect(within(feedRegion()).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("[SE-56] [지금 동기화] → POST /api/feed/sync, 응답이 진행 중이면 버튼 비활성 + 진행 문구", async () => {
    const server = setupServer();
    server.on("POST", SYNC, reply.json({ ...feedStatusDefault, syncing: true, syncedSoFar: 1200 }));
    const { user } = await renderSettings();
    await within(feedRegion()).findByText("151,751건");
    await user.click(syncButton());
    await waitFor(() => expect(server.count("POST", SYNC)).toBe(1));
    expect(await within(feedRegion()).findByText("동기화 중 — 1,200건 받음")).toBeInTheDocument();
    expect(syncButton()).toBeDisabled();
  });

  it("[SE-57] 진행 중일 때만 3초마다 상태를 다시 요청하고, 끝나면 멈춘다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = setupServer({ ...feedStatusDefault, syncing: true, syncedSoFar: 10 });
    await renderSettings();
    await within(feedRegion()).findByText("동기화 중 — 10건 받음");
    const n0 = server.count("GET", FEED);
    await advance(3100);
    expect(server.count("GET", FEED)).toBe(n0 + 1);
    // 끝난 응답
    server.on("GET", FEED, reply.json({ ...feedStatusDefault, syncing: false }));
    await advance(3100);
    await within(feedRegion()).findByText("151,751건");
    const n1 = server.count("GET", FEED);
    await advance(10_000);
    expect(server.count("GET", FEED)).toBe(n1);
    expect(screen.queryByText(/동기화 중 —/)).not.toBeInTheDocument();
  });

  it("[SE-58] 진행 문구는 aria-live=polite 영역에 있다", async () => {
    setupServer({ ...feedStatusDefault, syncing: true, syncedSoFar: 5 });
    await renderSettings();
    const text = await within(feedRegion()).findByText("동기화 중 — 5건 받음");
    expect(text.closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
  });

  it("[SE-59] 409 FEED_SYNC_RUNNING → toast '이미 동기화 중입니다'", async () => {
    const server = setupServer();
    server.on("POST", SYNC, reply.error(apiErrorOf("FEED_SYNC_RUNNING", "서버 문구")));
    const { user } = await renderSettings();
    await within(feedRegion()).findByText("151,751건");
    await user.click(syncButton());
    await findToast("이미 동기화 중입니다");
  });

  it("[SE-60] 400 TOKEN_MISSING → 서버의 메시지를 toast 로 보인다", async () => {
    const server = setupServer();
    server.on("POST", SYNC, reply.error(apiErrorOf("TOKEN_MISSING", "GitHub 토큰이 없습니다")));
    const { user } = await renderSettings();
    await within(feedRegion()).findByText("151,751건");
    await user.click(syncButton());
    await findToast("GitHub 토큰이 없습니다");
  });

  it("[SE-61] 외부 목록이 꺼져 있으면 버튼을 비활성으로 두고 이유를 보인다", async () => {
    setupServer({ ...feedStatusDefault, enabled: false });
    await renderSettings();
    await settle();
    expect(syncButton()).toBeDisabled();
    expect(within(feedRegion()).getByText("외부 목록이 꺼져 있어서 동기화할 수 없습니다")).toBeInTheDocument();
  });

  it("[SE-62] '목록 검색' 링크는 /feed 로 간다", async () => {
    setupServer();
    await renderSettings();
    expect(within(feedRegion()).getByRole("link", { name: "목록 검색" })).toHaveAttribute("href", "/feed");
  });

  it("[SE-63] 상태를 불러오지 못하면 구역 안에 오류와 [다시 시도] 를 보이고 폼은 그대로 쓴다", async () => {
    const server = setupServer();
    server.on("GET", FEED, reply.error(apiErrorOf("INTERNAL_ERROR", "x"), 500));
    await renderSettings();
    expect(await within(feedRegion()).findByRole("button", { name: "다시 시도" }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
  });
});
