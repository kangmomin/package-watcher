import type { Finding, Page, Summary } from "@pw/shared";
import {
  apiErrorOf,
  emptyFindingsPage,
  findingIgnored,
  findingOpenDirect,
  findingsPage,
  pageOf,
  summaryDefault,
  summaryEmpty,
  summaryRunning,
} from "@pw/shared/fixtures";
import { act, screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DashboardPage } from "@/features/findings/DashboardPage";
import { deferredReply, reply, setupFetchMock, type FetchMock, type ReplyFactory } from "@/test/fetchMock";
import { renderWithProviders } from "@/test/render";
import {
  advance,
  chooseOption,
  expectNoToast,
  findRowWith,
  findToast,
  getRowWith,
  queryAllSkeletons,
  settle,
} from "@/test/ui";

// ---- 테스트가 정한 UI 이름 (계약에 없음 — 구현은 이 접근 가능한 이름을 그대로 쓴다)
const UI = {
  /** 상태 필터 select(combobox)의 label */
  statusFilter: "상태",
  /** repo 검색 입력의 label */
  repoFilter: "repo",
  /** 패키지 검색 입력의 label */
  packageFilter: "패키지",
  /** 각 행의 ⋮ 메뉴 버튼 aria-label */
  rowMenu: "행 메뉴",
} as const;

// ---- 계약 문구 (UI State Contract / Error Contract / 성공 toast)
const TEXT = {
  empty: "검출이 없습니다",
  loadError: "데이터를 불러오지 못했습니다",
  retry: "다시 시도",
  prev: "이전",
  next: "다음",
  allStatuses: "전체",
  ignore: "무시",
  reopen: "다시 열기",
  viewOnGitHub: "GitHub에서 보기",
  noLastScan: "스캔 이력 없음",
  noNextScan: "예정 없음",
  direct: "직접",
  transitive: "전이",
  statusChanged: "상태를 변경했습니다",
  serverError: "서버 오류가 발생했습니다",
  networkError: "서버에 연결할 수 없습니다",
} as const;

const FINDINGS = "/api/findings";
const SUMMARY = "/api/summary";

function makeFindings(count: number, firstId: number): Finding[] {
  return Array.from({ length: count }, (_, index) => {
    const id = firstId + index;
    return {
      ...findingOpenDirect,
      id,
      repo: `repo-${id}`,
      htmlUrl: `https://github.com/my-org/repo-${id}/blob/HEAD/package-lock.json`,
    };
  });
}

/** total 120, limit 50 의 3페이지 목록 */
const threePages: ReplyFactory = (request) => {
  const page = Number(request.query.page ?? "1");
  const items = makeFindings(page < 3 ? 50 : 20, (page - 1) * 50 + 1);
  return reply.json(pageOf(items, { total: 120, page, limit: 50 }))(request);
};

function setupServer({
  summary = summaryDefault,
  findings = findingsPage,
}: { summary?: Summary; findings?: Page<Finding> } = {}): FetchMock {
  return setupFetchMock().on("GET", SUMMARY, reply.json(summary)).on("GET", FINDINGS, reply.json(findings));
}

function findingsQueries(server: FetchMock): Record<string, string>[] {
  return server.requests("GET", FINDINGS).map((request) => request.query);
}

function rowMenuButton(repo: string): HTMLElement {
  return within(getRowWith(repo)).getByRole("button", { name: UI.rowMenu });
}

async function openRowMenu(user: UserEvent, repo: string): Promise<HTMLElement> {
  await findRowWith(repo);
  await user.click(rowMenuButton(repo));
  return screen.findByRole("menu");
}

async function closeMenu(user: UserEvent): Promise<void> {
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
}

/** 첫 로드(카드 + 표)가 끝날 때까지 기다린다. */
async function renderDashboard() {
  const result = renderWithProviders(<DashboardPage />);
  await findRowWith("api");
  await screen.findByText(String(summaryDefault.openCount));
  return result;
}

function counts(server: FetchMock) {
  return { findings: server.count("GET", FINDINGS), summary: server.count("GET", SUMMARY) };
}

describe("대시보드 — 검출 표·필터·페이저", () => {
  it("[CT-02][AC-07] 첫 요청은 GET /api/findings?status=open&page=1&limit=50 이다", async () => {
    const server = setupServer();
    renderWithProviders(<DashboardPage />);

    await findRowWith("api");
    expect(findingsQueries(server)[0]).toEqual({ status: "open", page: "1", limit: "50" });
  });

  it("[CT-02] 행에 종류 라벨(직접/전이)과 상태 배지(영문 값 그대로)를 표시한다", async () => {
    setupServer();
    renderWithProviders(<DashboardPage />);

    const directRow = await findRowWith("api");
    expect(within(directRow).getByText(new RegExp(TEXT.direct))).toBeInTheDocument();
    expect(within(directRow).getByText("open")).toBeInTheDocument();

    const transitiveRow = getRowWith("web-app");
    expect(within(transitiveRow).getByText(new RegExp(TEXT.transitive))).toBeInTheDocument();
    expect(within(transitiveRow).queryByText(new RegExp(TEXT.direct))).not.toBeInTheDocument();

    expect(within(getRowWith("legacy")).getByText("ignored")).toBeInTheDocument();
    expect(within(getRowWith("tools")).getByText("resolved")).toBeInTheDocument();
  });

  it("[CT-02] 상태 필터를 바꾸면 그 status 와 page=1 로 다시 요청하고, '전체' 는 status 를 생략한다", async () => {
    const server = setupFetchMock().on("GET", SUMMARY, reply.json(summaryDefault)).on("GET", FINDINGS, threePages);
    const { user } = renderWithProviders(<DashboardPage />);

    await screen.findByText("1–50 / 120");
    await user.click(screen.getByRole("button", { name: TEXT.next }));
    await screen.findByText("51–100 / 120");
    expect(findingsQueries(server).at(-1)).toMatchObject({ page: "2" });

    await chooseOption(user, screen.getByRole("combobox", { name: UI.statusFilter }), "ignored");
    await waitFor(() =>
      expect(findingsQueries(server).at(-1)).toEqual({ status: "ignored", page: "1", limit: "50" }),
    );

    await chooseOption(user, screen.getByRole("combobox", { name: UI.statusFilter }), "resolved");
    await waitFor(() =>
      expect(findingsQueries(server).at(-1)).toEqual({ status: "resolved", page: "1", limit: "50" }),
    );

    await chooseOption(user, screen.getByRole("combobox", { name: UI.statusFilter }), TEXT.allStatuses);
    await waitFor(() => expect(findingsQueries(server).at(-1)).toEqual({ page: "1", limit: "50" }));
  });

  it("[CT-02] repo·패키지 입력은 trim 후 300ms debounce 로 한 번만 요청하고, 비우면 파라미터를 생략한다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = setupServer();
    const { user } = renderWithProviders(<DashboardPage />);
    await findRowWith("api");
    const withRepo = () => findingsQueries(server).filter((query) => "repo" in query);

    await user.type(screen.getByRole("textbox", { name: UI.repoFilter }), "  api  ");
    // 입력 직후에는 아직 요청하지 않는다
    expect(withRepo()).toHaveLength(0);
    await advance(300);
    await waitFor(() => expect(withRepo()).toHaveLength(1));
    expect(withRepo()[0]).toEqual({ status: "open", repo: "api", page: "1", limit: "50" });

    await user.type(screen.getByRole("textbox", { name: UI.packageFilter }), "lodash");
    await advance(300);
    await waitFor(() =>
      expect(findingsQueries(server).at(-1)).toEqual({
        status: "open",
        repo: "api",
        package: "lodash",
        page: "1",
        limit: "50",
      }),
    );
    // 입력 도중의 값(l, lo, lod …)으로는 요청하지 않는다
    expect(findingsQueries(server).filter((query) => "package" in query && query.package !== "lodash")).toEqual([]);

    await user.clear(screen.getByRole("textbox", { name: UI.repoFilter }));
    await advance(300);
    await waitFor(() =>
      expect(findingsQueries(server).at(-1)).toEqual({ status: "open", package: "lodash", page: "1", limit: "50" }),
    );
  });

  it("[CT-02] 표 아래 페이저: [이전]/[다음] 으로 page 를 옮기고 N–M / total 을 표시한다 (A-8)", async () => {
    const server = setupFetchMock().on("GET", SUMMARY, reply.json(summaryDefault)).on("GET", FINDINGS, threePages);
    const { user } = renderWithProviders(<DashboardPage />);

    await screen.findByText("1–50 / 120");
    expect(screen.getByRole("button", { name: TEXT.prev })).toBeDisabled();
    expect(screen.getByRole("button", { name: TEXT.next })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: TEXT.next }));
    await screen.findByText("51–100 / 120");
    expect(findingsQueries(server).at(-1)).toEqual({ status: "open", page: "2", limit: "50" });

    await user.click(screen.getByRole("button", { name: TEXT.next }));
    await screen.findByText("101–120 / 120");
    expect(findingsQueries(server).at(-1)).toEqual({ status: "open", page: "3", limit: "50" });
    expect(screen.getByRole("button", { name: TEXT.next })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: TEXT.prev }));
    await screen.findByText("51–100 / 120");
    expect(findingsQueries(server).at(-1)).toMatchObject({ page: "2" });
  });

  it("[CT-02] total 이 0 이면 '검출이 없습니다' 를 표시하고 페이저를 숨긴다", async () => {
    setupServer({ findings: emptyFindingsPage });
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText(TEXT.empty)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: TEXT.prev })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: TEXT.next })).not.toBeInTheDocument();
  });

  it("[CT-02] 빈 페이지(items 0, total > 0, page > 1)를 받으면 page = ceil(total/limit) 로 이동하고 empty 문구는 쓰지 않는다", async () => {
    // 3페이지로 가는 사이에 검출이 줄어서 total 이 60 이 된 상황
    let shrunk = false;
    const server = setupFetchMock()
      .on("GET", SUMMARY, reply.json(summaryDefault))
      .on("GET", FINDINGS, (request) => {
        const page = Number(request.query.page ?? "1");
        if (page === 3) {
          shrunk = true;
          return reply.json(pageOf<Finding>([], { total: 60, page: 3, limit: 50 }))(request);
        }
        if (shrunk) {
          const items = makeFindings(page === 1 ? 50 : 10, (page - 1) * 50 + 1);
          return reply.json(pageOf(items, { total: 60, page, limit: 50 }))(request);
        }
        return threePages(request);
      });
    const { user } = renderWithProviders(<DashboardPage />);

    await screen.findByText("1–50 / 120");
    await user.click(screen.getByRole("button", { name: TEXT.next }));
    await screen.findByText("51–100 / 120");
    await user.click(screen.getByRole("button", { name: TEXT.next }));

    // ceil(60 / 50) = 2
    await screen.findByText("51–60 / 60");
    const pages = findingsQueries(server).map((query) => query.page);
    expect(pages).toContain("3");
    expect(pages.at(-1)).toBe("2");
    expect(screen.queryByText(TEXT.empty)).not.toBeInTheDocument();
  });

  it("[CT-02] 캐시에 남은 빈 페이지로 [다음] 을 누르면 그 페이지를 다시 조회하고, 응답에 행이 있으면 그 페이지에 머문다 (S-17)", async () => {
    // open 51건. total 이 바뀌면 각 페이지의 응답도 바뀐다.
    let total = 51;
    const server = setupFetchMock()
      .on("GET", SUMMARY, reply.json(summaryDefault))
      .on("GET", FINDINGS, (request) => {
        const page = Number(request.query.page ?? "1");
        const count = Math.max(0, Math.min(50, total - (page - 1) * 50));
        return reply.json(pageOf(makeFindings(count, (page - 1) * 50 + 1), { total, page, limit: 50 }))(request);
      })
      .on("PATCH", "/api/findings/51", (request) => {
        total = 50;
        return reply.json({ ...findingOpenDirect, id: 51, status: "ignored" })(request);
      });
    const page2Requests = () => findingsQueries(server).filter((query) => query.page === "2").length;
    const { user, queryClient } = renderWithProviders(<DashboardPage />);

    await screen.findByText("1–50 / 51");
    await user.click(screen.getByRole("button", { name: TEXT.next }));
    await screen.findByText("51–51 / 51");

    // 2페이지의 1건을 무시 → 2페이지가 비어 1페이지로 이동 (2페이지 캐시 = items [] / total 50)
    const menu = await openRowMenu(user, "repo-51");
    await user.click(within(menu).getByRole("menuitem", { name: TEXT.ignore }));
    await screen.findByText("1–50 / 50");

    // 그 건을 다시 열어 51건이 됨
    total = 51;
    await act(() => queryClient.invalidateQueries({ queryKey: ["findings"] }));
    await screen.findByText("1–50 / 51");
    const before = page2Requests();

    await user.click(screen.getByRole("button", { name: TEXT.next }));

    // 캐시의 빈 2페이지로 판정해서 1페이지로 되돌아가지 않고, 2페이지를 다시 조회한다
    await findRowWith("repo-51");
    expect(page2Requests()).toBeGreaterThan(before);
    await settle();
    expect(screen.getByText("51–51 / 51")).toBeInTheDocument();
    expect(findingsQueries(server).at(-1)).toMatchObject({ page: "2" });
  });

  it("[CT-02] 필터를 바꾼 직후 이전 데이터를 보여 주는 동안 [이전]/[다음] 은 비활성이고 표는 aria-busy 다 (S-17)", async () => {
    const pending = deferredReply();
    setupFetchMock()
      .on("GET", SUMMARY, reply.json(summaryDefault))
      .on("GET", FINDINGS, (request) =>
        request.query.status === "ignored" ? pending.reply(request) : threePages(request),
      );
    const { user } = renderWithProviders(<DashboardPage />);
    const busyTableArea = () => screen.getByRole("table", { name: "검출 목록" }).closest('[aria-busy="true"]');

    await screen.findByText("1–50 / 120");
    await user.click(screen.getByRole("button", { name: TEXT.next }));
    await screen.findByText("51–100 / 120");
    expect(busyTableArea()).toBeNull();

    await chooseOption(user, screen.getByRole("combobox", { name: UI.statusFilter }), "ignored");

    // 응답 전: 2페이지(이전 응답)를 보여 주는 중 → 이전 응답 기준의 [이전]/[다음] 을 막는다
    await waitFor(() => expect(screen.getByRole("button", { name: TEXT.next })).toBeDisabled());
    expect(screen.getByRole("button", { name: TEXT.prev })).toBeDisabled();
    expect(screen.getByText("51–100 / 120")).toBeInTheDocument();
    expect(busyTableArea()).not.toBeNull();

    // 응답 후: 새 응답(1페이지, total 70) 기준으로 다시 계산한다
    await act(async () =>
      pending.resolve(reply.json(pageOf(makeFindings(50, 1), { total: 70, page: 1, limit: 50 }))),
    );
    await screen.findByText("1–50 / 70");
    expect(screen.getByRole("button", { name: TEXT.prev })).toBeDisabled();
    expect(screen.getByRole("button", { name: TEXT.next })).toBeEnabled();
    expect(busyTableArea()).toBeNull();
  });

  it("[CT-02] 표 첫 로드 중에는 Skeleton 을 표시한다 (카드와 독립)", async () => {
    const pending = deferredReply();
    setupFetchMock().on("GET", SUMMARY, reply.json(summaryDefault)).on("GET", FINDINGS, pending.reply);
    renderWithProviders(<DashboardPage />);

    // 카드는 표와 상관없이 먼저 표시된다
    await screen.findByText(String(summaryDefault.openCount));
    expect(queryAllSkeletons().length).toBeGreaterThan(0);
    expect(screen.queryByText(TEXT.empty)).not.toBeInTheDocument();

    await act(async () => pending.resolve(reply.json(findingsPage)));
    await findRowWith("api");
    expect(queryAllSkeletons()).toHaveLength(0);
  });

  it("[CT-02] 표 첫 로드 실패 시 '데이터를 불러오지 못했습니다' + [다시 시도] 를 표시하고 toast 는 띄우지 않는다", async () => {
    let fail = true;
    setupFetchMock()
      .on("GET", SUMMARY, reply.json(summaryDefault))
      .on("GET", FINDINGS, (request) =>
        (fail ? reply.error(apiErrorOf("INTERNAL_ERROR", "내부 오류")) : reply.json(findingsPage))(request),
      );
    const { user } = renderWithProviders(<DashboardPage />);

    expect(await screen.findByText(TEXT.loadError)).toBeInTheDocument();
    await expectNoToast();

    fail = false;
    await user.click(screen.getByRole("button", { name: TEXT.retry }));
    await findRowWith("api");
    expect(screen.queryByText(TEXT.loadError)).not.toBeInTheDocument();
  });
});

describe("대시보드 — 카드", () => {
  it("[CT-04] 카드 4개: open 수, ignored 수, 마지막 스캔(yyyy-MM-dd HH:mm + 상태 배지), 다음 스캔", async () => {
    setupServer({ findings: emptyFindingsPage });
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText("12")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    // lastScan.startedAt = 2026-11-12T00:00:00.000Z → KST 09:00
    expect(screen.getByText("2026-11-12 09:00")).toBeInTheDocument();
    expect(screen.getByText("success")).toBeInTheDocument();
    // nextScanAt = 2026-11-13T00:00:00.000Z → KST 09:00
    expect(screen.getByText("2026-11-13 09:00")).toBeInTheDocument();
  });

  it("[CT-04] lastScan 이 null 이면 '스캔 이력 없음', nextScanAt 이 null 이면 '예정 없음' 을 표시한다", async () => {
    setupServer({ summary: summaryEmpty, findings: emptyFindingsPage });
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText(TEXT.noLastScan)).toBeInTheDocument();
    expect(screen.getByText(TEXT.noNextScan)).toBeInTheDocument();
  });

  it("[CT-04] 카드 첫 로드 중에는 카드 Skeleton 을 표시한다 (표와 독립)", async () => {
    const pending = deferredReply();
    setupFetchMock().on("GET", SUMMARY, pending.reply).on("GET", FINDINGS, reply.json(findingsPage));
    renderWithProviders(<DashboardPage />);

    // 표는 카드와 상관없이 먼저 표시된다
    await findRowWith("api");
    expect(queryAllSkeletons().length).toBeGreaterThan(0);

    await act(async () => pending.resolve(reply.json(summaryDefault)));
    await screen.findByText("12");
    expect(queryAllSkeletons()).toHaveLength(0);
  });

  it("[CT-04] summary 첫 로드 실패 시 카드 값은 '-' 이고 카드 영역에 [다시 시도] 1개를 표시한다 (표와 독립)", async () => {
    let fail = true;
    setupFetchMock()
      .on("GET", SUMMARY, (request) => (fail ? reply.networkError() : reply.json(summaryDefault))(request))
      .on("GET", FINDINGS, reply.json(findingsPage));
    const { user } = renderWithProviders(<DashboardPage />);

    await findRowWith("api");
    await waitFor(() => expect(screen.getAllByText("-")).toHaveLength(4));
    expect(screen.getAllByRole("button", { name: TEXT.retry })).toHaveLength(1);

    fail = false;
    await user.click(screen.getByRole("button", { name: TEXT.retry }));
    expect(await screen.findByText("12")).toBeInTheDocument();
    expect(screen.queryAllByText("-")).toHaveLength(0);
    // 표는 그대로 있다
    expect(getRowWith("api")).toBeInTheDocument();
  });
});

describe("대시보드 — 행 메뉴와 상태 변경", () => {
  it("[CT-03] 행 메뉴: open = 무시·GitHub에서 보기 / ignored = 다시 열기·GitHub에서 보기 / resolved = GitHub에서 보기만", async () => {
    setupServer();
    const { user } = renderWithProviders(<DashboardPage />);

    const menuItems = async (repo: string) => {
      const menu = await openRowMenu(user, repo);
      const names = within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent?.trim());
      await closeMenu(user);
      return names;
    };

    expect(await menuItems("api")).toEqual([TEXT.ignore, TEXT.viewOnGitHub]);
    expect(await menuItems("legacy")).toEqual([TEXT.reopen, TEXT.viewOnGitHub]);
    expect(await menuItems("tools")).toEqual([TEXT.viewOnGitHub]);
  });

  it("[CT-03] 표 이름 '검출 목록', repo 셀은 행 헤더이고, 행 메뉴 버튼은 이름을 유지한 채 repo·패키지를 설명으로 읽는다", async () => {
    setupServer();
    const { user } = renderWithProviders(<DashboardPage />);

    const table = await screen.findByRole("table", { name: "검출 목록" });
    expect(within(table).getByRole("rowheader", { name: "api" })).toBeInTheDocument();
    expect(within(table).getAllByRole("columnheader").length).toBeGreaterThan(0);
    expect(rowMenuButton("api")).toHaveAccessibleName(UI.rowMenu);
    expect(rowMenuButton("api")).toHaveAccessibleDescription("api lodash@4.17.20");

    // "GitHub에서 보기" 는 이름을 바꾸지 않고 새 탭에서 열린다는 설명을 가진다
    const menu = await openRowMenu(user, "api");
    const viewOnGitHub = within(menu).getByRole("menuitem", { name: TEXT.viewOnGitHub });
    expect(viewOnGitHub).toHaveAttribute("target", "_blank");
    expect(viewOnGitHub).toHaveAccessibleDescription("새 탭에서 열림");
  });

  it("[CT-03][AC-08] [무시] → PATCH /api/findings/:id {status:'ignored'}, 성공 toast, findings·summary 재조회", async () => {
    const server = setupServer().on("PATCH", "/api/findings/1", reply.json({ ...findingOpenDirect, status: "ignored" }));
    const { user } = await renderDashboard();
    const before = counts(server);

    const menu = await openRowMenu(user, "api");
    await user.click(within(menu).getByRole("menuitem", { name: TEXT.ignore }));

    await findToast(TEXT.statusChanged);
    expect(server.requests("PATCH", "/api/findings/1").map((request) => request.body)).toEqual([
      { status: "ignored" },
    ]);
    await waitFor(() => {
      expect(server.count("GET", FINDINGS)).toBeGreaterThan(before.findings);
      expect(server.count("GET", SUMMARY)).toBeGreaterThan(before.summary);
    });
  });

  it("[CT-03] ignored 행의 [다시 열기] → PATCH /api/findings/:id {status:'open'}", async () => {
    const server = setupServer().on("PATCH", "/api/findings/3", reply.json({ ...findingIgnored, status: "open" }));
    const { user } = await renderDashboard();

    const menu = await openRowMenu(user, "legacy");
    await user.click(within(menu).getByRole("menuitem", { name: TEXT.reopen }));

    await findToast(TEXT.statusChanged);
    expect(server.last("PATCH", "/api/findings/3")?.body).toEqual({ status: "open" });
  });

  it("[CT-03] PATCH 중에는 그 행의 메뉴 버튼만 비활성이다", async () => {
    const pending = deferredReply();
    setupServer().on("PATCH", "/api/findings/1", pending.reply);
    const { user } = await renderDashboard();

    const menu = await openRowMenu(user, "api");
    await user.click(within(menu).getByRole("menuitem", { name: TEXT.ignore }));

    await waitFor(() => expect(rowMenuButton("api")).toBeDisabled());
    expect(rowMenuButton("web-app")).toBeEnabled();

    await act(async () => pending.resolve(reply.json({ ...findingOpenDirect, status: "ignored" })));
    await waitFor(() => expect(rowMenuButton("api")).toBeEnabled());
  });

  it("[CT-03] 409 INVALID_STATE → toast(message) + findings·summary 재조회", async () => {
    const error = apiErrorOf("INVALID_STATE", "이미 해결된 검출은 상태를 바꿀 수 없습니다");
    const server = setupServer().on("PATCH", "/api/findings/1", reply.error(error));
    const { user } = await renderDashboard();
    const before = counts(server);

    const menu = await openRowMenu(user, "api");
    await user.click(within(menu).getByRole("menuitem", { name: TEXT.ignore }));

    await findToast(error.error.message);
    await waitFor(() => {
      expect(server.count("GET", FINDINGS)).toBeGreaterThan(before.findings);
      expect(server.count("GET", SUMMARY)).toBeGreaterThan(before.summary);
    });
  });

  it("[CT-03] 404 NOT_FOUND → toast(message) + findings 재조회", async () => {
    const error = apiErrorOf("NOT_FOUND", "검출을 찾을 수 없습니다");
    const server = setupServer().on("PATCH", "/api/findings/1", reply.error(error));
    const { user } = await renderDashboard();
    const before = counts(server);

    const menu = await openRowMenu(user, "api");
    await user.click(within(menu).getByRole("menuitem", { name: TEXT.ignore }));

    await findToast(error.error.message);
    await waitFor(() => expect(server.count("GET", FINDINGS)).toBeGreaterThan(before.findings));
  });

  it.each([
    ["INTERNAL_ERROR(500)", reply.error(apiErrorOf("INTERNAL_ERROR", "예상하지 못한 오류")), TEXT.serverError],
    ["NETWORK_ERROR(fetch 실패)", reply.networkError(), TEXT.networkError],
    ["2xx 응답 parse 실패", reply.json({ id: 1, status: "ignored" }), TEXT.serverError],
  ])(
    "[CT-10][CT-03] PATCH 가 %s 로 끝나면 toast 를 띄우고 성공과 같은 키(findings·summary)를 무효화한다",
    async (_label, patchReply, toastText) => {
      const server = setupServer().on("PATCH", "/api/findings/1", patchReply);
      const { user } = await renderDashboard();
      const before = counts(server);

      const menu = await openRowMenu(user, "api");
      await user.click(within(menu).getByRole("menuitem", { name: TEXT.ignore }));

      await findToast(toastText);
      await waitFor(() => {
        expect(server.count("GET", FINDINGS)).toBeGreaterThan(before.findings);
        expect(server.count("GET", SUMMARY)).toBeGreaterThan(before.summary);
      });
    },
  );

  it("[CT-10] 데이터가 있는 상태의 재조회 실패는 마지막 데이터를 유지하고 toast 를 띄우지 않는다", async () => {
    let fail = false;
    const server = setupFetchMock()
      .on("GET", SUMMARY, (request) =>
        (fail ? reply.error(apiErrorOf("INTERNAL_ERROR", "내부 오류")) : reply.json(summaryDefault))(request),
      )
      .on("GET", FINDINGS, (request) => (fail ? reply.networkError() : reply.json(findingsPage))(request));
    const { queryClient } = await renderDashboard();
    const before = counts(server);

    fail = true;
    await act(() => queryClient.invalidateQueries());
    // 재시도 1회까지 끝날 때까지 기다린다
    await waitFor(() => {
      expect(server.count("GET", FINDINGS)).toBeGreaterThanOrEqual(before.findings + 2);
      expect(server.count("GET", SUMMARY)).toBeGreaterThanOrEqual(before.summary + 2);
    });
    await settle();

    expect(getRowWith("api")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.queryByText(TEXT.loadError)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: TEXT.retry })).not.toBeInTheDocument();
    await expectNoToast();
  });
});

describe("대시보드 — 스캔 실행 중 polling", () => {
  it("[CT-06] 스캔 실행 중이면 summary 를 5초마다 다시 조회하고, 종료되면 findings·summary 를 무효화한 뒤 polling 을 멈춘다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let summaryCalls = 0;
    const server = setupFetchMock()
      .on("GET", SUMMARY, (request) => {
        summaryCalls += 1;
        return reply.json(summaryCalls === 1 ? summaryRunning : summaryDefault)(request);
      })
      .on("GET", FINDINGS, reply.json(findingsPage));
    renderWithProviders(<DashboardPage />);

    await findRowWith("api");
    await screen.findByText("running");
    expect(server.count("GET", SUMMARY)).toBe(1);
    expect(server.count("GET", FINDINGS)).toBe(1);

    await advance(5_000);
    // polling 으로 종료(success)를 받고 → findings·summary 무효화
    await screen.findByText("success");
    await waitFor(() => {
      expect(server.count("GET", FINDINGS)).toBe(2);
      expect(server.count("GET", SUMMARY)).toBeGreaterThanOrEqual(3);
    });

    const afterFinish = server.count("GET", SUMMARY);
    await advance(10_000);
    expect(server.count("GET", SUMMARY)).toBe(afterFinish);
  });

  it("[CT-06] 스캔이 실행 중이 아니면 summary 를 polling 하지 않는다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = setupServer();
    renderWithProviders(<DashboardPage />);
    await findRowWith("api");
    await screen.findByText("12");

    await advance(15_000);
    expect(server.count("GET", SUMMARY)).toBe(1);
    expect(server.count("GET", FINDINGS)).toBe(1);
  });
});
