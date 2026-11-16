import { SUPPORTED_ECOSYSTEMS } from "@pw/shared";
import { ecosystemLabel } from "@/lib/format";
import { blacklistEntryVariants } from "@pw/shared/fixtures";
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { advance, chooseOption, findRowWith, getRowWith } from "@/test/ui";
import { reply, setupFetchMock } from "@/test/fetchMock";
import { renderWithProviders } from "@/test/render";
import { BlacklistPage } from "@/features/blacklist/BlacklistPage";
import {
  BLACKLIST,
  counts,
  renderBlacklist,
  setupServer,
} from "@/features/blacklist/bulkTestUtils";

const ecosystemSelect = () => screen.getByRole("combobox", { name: "종류" });
const statusSelect = () => screen.getByRole("combobox", { name: "상태" });
const nameSearch = () => screen.getByRole("textbox", { name: "이름" });

describe("블랙리스트 — 필터", () => {
  it("[BK-20] 필터가 모두 '전체'이면 query 없는 /api/blacklist 를 1번 요청한다", async () => {
    const server = setupServer();
    await renderBlacklist();

    expect(server.last("GET", BLACKLIST)?.url.search).toBe("");
    expect(server.count("GET", BLACKLIST)).toBe(1);
    expect(ecosystemSelect()).toHaveTextContent("전체");
    expect(statusSelect()).toHaveTextContent("전체");
  });

  it("[BK-20] 종류 select 는 전체 + 지원하는 종류 전부를 보여 주고, 고르면 ecosystem 으로 요청한다", async () => {
    const server = setupServer();
    const { user } = await renderBlacklist();

    await user.click(ecosystemSelect());
    const options = within(await screen.findByRole("listbox")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(
      expect.arrayContaining(["전체", ...SUPPORTED_ECOSYSTEMS.map(ecosystemLabel)]),
    );
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "go" }));

    await vi.waitFor(() =>
      expect(server.last("GET", BLACKLIST)?.query).toEqual({ ecosystem: "go" }),
    );
  });

  it("[BK-20] 상태 select 의 켬·끔·만료는 status=active|disabled|expired 로 요청한다", async () => {
    const server = setupServer();
    const { user } = await renderBlacklist();

    for (const [label, value] of [
      ["켬", "active"],
      ["끔", "disabled"],
      ["만료", "expired"],
    ] as const) {
      await chooseOption(user, statusSelect(), label);
      await vi.waitFor(() =>
        expect(server.last("GET", BLACKLIST)?.query).toEqual({ status: value }),
      );
    }
  });

  it("[BK-20] 필터를 다시 '전체'로 돌리면 query 없는 요청으로 돌아간다", async () => {
    const server = setupServer();
    const { user } = await renderBlacklist();

    await chooseOption(user, statusSelect(), "켬");
    await vi.waitFor(() =>
      expect(server.last("GET", BLACKLIST)?.query).toEqual({ status: "active" }),
    );
    await chooseOption(user, statusSelect(), "전체");
    await vi.waitFor(() => expect(server.last("GET", BLACKLIST)?.url.search).toBe(""));
  });

  it("[BK-20] 이름 검색은 300ms debounce 뒤 trim 한 값으로 q 를 1번 요청하고, 공백만 있으면 q 를 생략한다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = setupServer();
    const { user } = await renderBlacklist();
    const before = counts(server).blacklist;

    await user.click(nameSearch());
    await user.paste("  lo ");
    // 입력 직후에는 아직 요청하지 않는다
    expect(counts(server).blacklist).toBe(before);
    await advance(300);
    await vi.waitFor(() => expect(server.last("GET", BLACKLIST)?.query).toEqual({ q: "lo" }));
    expect(counts(server).blacklist).toBe(before + 1);

    await user.clear(nameSearch());
    await user.click(nameSearch());
    await user.paste("   ");
    await advance(400);
    await vi.waitFor(() => expect(server.last("GET", BLACKLIST)?.url.search).toBe(""));
  });

  it("[BK-20] 필터가 있고 0건이면 '조건에 맞는 항목이 없습니다' 를 표시한다", async () => {
    const server = setupFetchMock().on("GET", BLACKLIST, (request) =>
      reply.json({ items: request.query.q ? [] : blacklistEntryVariants })(request),
    );
    const { user } = renderWithProviders(<BlacklistPage />, { route: "/blacklist" });
    await findRowWith("paused-pkg");

    await user.type(nameSearch(), "zzz");
    expect(await screen.findByText("조건에 맞는 항목이 없습니다")).toBeInTheDocument();
    expect(screen.queryByText("블랙리스트가 비어 있습니다")).not.toBeInTheDocument();
    expect(server.last("GET", BLACKLIST)?.query).toEqual({ q: "zzz" });
  });

  it("[BK-20] 필터 없이 0건이면 v1 의 문구를 표시한다", async () => {
    setupServer([]);
    renderWithProviders(<BlacklistPage />, { route: "/blacklist" });
    expect(await screen.findByText("블랙리스트가 비어 있습니다")).toBeInTheDocument();
  });

  it("[BK-20] 필터를 바꾸는 동안 이전 목록이 남아 있다(깜박이지 않는다)", async () => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    setupFetchMock().on("GET", BLACKLIST, async (request) => {
      if (request.query.status) await released;
      return reply.json({ items: blacklistEntryVariants })(request);
    });
    const { user } = renderWithProviders(<BlacklistPage />, { route: "/blacklist" });
    await findRowWith("paused-pkg");

    await chooseOption(user, statusSelect(), "끔");
    expect(getRowWith("paused-pkg")).toBeInTheDocument();
    release();
  });
});
