// SP-10: 스캔 표의 진행 열, 요약 문장, 행 펼침, repo별 진행 상황 표.
import type { Page, Scan, ScanRepo } from "@pw/shared";
import {
  apiErrorOf,
  pageOf,
  scanFailed,
  scanPartial,
  scanPartialWithStats,
  scanRepoFailed,
  scanRepoIssue,
  scanRepoPassed,
  scanRepoPending,
  scanRepoRunning,
  scanRepoSkipped,
  scanRepos,
  scanRunning,
  scanRunningWithStats,
  scanSuccess,
  summaryDefault,
  summaryRunning,
} from "@pw/shared/fixtures";
import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ScansPage } from "@/features/scans/ScansPage";
import { SCAN_POLL_INTERVAL_MS } from "@/features/summary/useSummary";
import { setupFetchMock, reply, type FetchMock, type ReplyFactory } from "@/test/fetchMock";
import { renderWithProviders } from "@/test/render";
import { advance, chooseOption, findRowWith, getRowWith, settle } from "@/test/ui";

const SUMMARY = "/api/summary";
const SCANS = "/api/scans";
const REPOS = /^\/api\/scans\/\d+\/repos$/;
const REPOS_OF_PARTIAL = `/api/scans/${scanPartialWithStats.id}/repos`;

const RUNNING_TIME = "11-13 09:00";
const PARTIAL_TIME = "11-11 09:00";
const REPO_TABLE = "repo별 진행 상황";

const withStatsPage: Page<Scan> = pageOf([scanRunningWithStats, scanPartialWithStats], { limit: 20 });

function setupServer({
  summary = summaryDefault,
  scans = withStatsPage,
  repos = pageOf(scanRepos),
}: { summary?: typeof summaryDefault; scans?: Page<Scan>; repos?: Page<ScanRepo> | ReplyFactory } = {}): FetchMock {
  return setupFetchMock()
    .on("GET", SUMMARY, reply.json(summary))
    .on("GET", SCANS, reply.json(scans))
    .on("GET", REPOS, typeof repos === "function" ? repos : reply.json(repos));
}

function renderScans() {
  return renderWithProviders(<ScansPage />, { route: "/scans" });
}

/** 행의 일반 셀 텍스트. 맨 앞(펼치기)부터, 행 헤더(시작 시각)는 제외한다. */
function cellTexts(row: HTMLElement): string[] {
  return within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent?.trim() ?? "");
}

async function expandRow(user: UserEvent, startedAt: string): Promise<void> {
  const row = await findRowWith(startedAt);
  await user.click(within(row).getByRole("button", { name: "상세 보기" }));
}

async function findRepoTable(): Promise<HTMLElement> {
  return screen.findByRole("table", { name: REPO_TABLE });
}

function reposRequests(server: FetchMock, path: string = REPOS_OF_PARTIAL) {
  return server.requests("GET", path);
}

describe("[SP-10] 스캔 표 — 진행 열", () => {
  it("[SP-10] 머리글과 순서: 펼치기 | 시작 시각 | 종류 | 상태 | 진행 | 통과 | 이슈 | 실패 | 건너뜀 | 신규", async () => {
    setupServer();
    renderScans();

    await findRowWith(PARTIAL_TIME);
    const scansTable = screen.getByRole("table", { name: "스캔 이력" });
    const headers = within(scansTable)
      .getAllByRole("columnheader")
      .map((header) => header.textContent?.trim());
    expect(headers).toEqual(["펼치기", "시작 시각", "종류", "상태", "진행", "통과", "이슈", "실패", "건너뜀", "신규"]);
  });

  it("[SP-10] repoStats 가 있는 끝난 스캔: 진행 = 278 / 278, 통과·이슈·실패·건너뜀 = repoStats 값", async () => {
    setupServer();
    renderScans();

    const row = await findRowWith(PARTIAL_TIME);
    // 펼치기, 종류, 상태, 진행, 통과, 이슈, 실패, 건너뜀, 신규
    expect(cellTexts(row)).toEqual(["", "자동", "partial", "278 / 278", "177", "3", "2", "96", "0"]);
  });

  it("[SP-10] repoStats 가 있는 running 스캔: 진행 = 끝난 수 / total, 각 수 표시, 신규 = -", async () => {
    setupServer({ summary: summaryRunning });
    renderScans();

    const row = await findRowWith(RUNNING_TIME);
    // 끝난 수 = 110 + 1 + 2 + 7 = 120
    expect(cellTexts(row)).toEqual(["", "수동", "running", "120 / 278", "110", "1", "2", "7", "-"]);
  });

  it("[SP-10] repoStats 가 null 인 스캔은 v1 표시: 진행 = repoCount(running 이면 -), 통과·이슈·건너뜀 = -, 실패 = failedRepos.length", async () => {
    setupServer({
      scans: pageOf([scanRunning, scanSuccess, scanPartial, scanFailed], { limit: 20 }),
      summary: summaryRunning,
    });
    renderScans();

    const partial = await findRowWith(PARTIAL_TIME);
    expect(cellTexts(partial)).toEqual(["", "자동", "partial", "42", "-", "-", "3", "-", "0"]);

    const running = getRowWith(RUNNING_TIME);
    expect(cellTexts(running)).toEqual(["", "수동", "running", "-", "-", "-", "-", "-", "-"]);
  });
});

describe("[SP-10] 스캔 표 — 행 펼침", () => {
  it("[SP-10] repoStats 가 있는 행은 오류·실패한 repo 가 없어도 펼칠 수 있고, null 인 행은 v1 조건을 따른다", async () => {
    const statsOnly: Scan = {
      ...scanPartialWithStats,
      id: 21,
      status: "success",
      failedRepos: [],
      repoStats: { total: 3, pending: 0, running: 0, passed: 2, issue: 0, failed: 0, skipped: 1 },
    };
    setupServer({ scans: pageOf([statsOnly, scanSuccess], { limit: 20 }) });
    renderScans();

    const statsRow = await findRowWith("11-11 09:00");
    expect(within(statsRow).getByRole("button", { name: "상세 보기" })).toBeInTheDocument();
    const v1Row = getRowWith("11-12 09:00");
    expect(within(v1Row).queryByRole("button", { name: "상세 보기" })).not.toBeInTheDocument();
  });

  it("[SP-10] 펼치면 요약 문장, v1 의 실패한 repo 목록, repo별 진행 상황 표가 나온다. 펼치기 전에는 /repos 를 호출하지 않는다", async () => {
    const server = setupServer();
    const { user } = renderScans();

    await findRowWith(PARTIAL_TIME);
    expect(reposRequests(server)).toHaveLength(0);
    expect(server.count("GET", REPOS)).toBe(0);

    await expandRow(user, PARTIAL_TIME);
    expect(await screen.findByText("278건 중 통과 177건 · 이슈 3건 · 실패 2건 · 건너뜀 96건")).toBeInTheDocument();
    expect(screen.getByText("실패한 repo (2)")).toBeInTheDocument();
    expect(screen.getByText("theme/package.json 을 JSON 으로 읽을 수 없습니다", { selector: "span" })).toBeInTheDocument();
    expect(await findRepoTable()).toBeInTheDocument();
    expect(screen.getByText(REPO_TABLE, { selector: "p" })).toBeInTheDocument();

    // 펼친 행만 조회한다. 첫 요청은 page=1, limit=50 이고 필터가 없다
    expect(server.count("GET", REPOS)).toBe(1);
    expect(reposRequests(server)).toHaveLength(1);
    expect(reposRequests(server)[0]?.query).toEqual({ page: "1", limit: "50" });
  });

  it("[SP-10] 진행 중인 스캔의 요약 문장은 뒤에 대기·진행 중 건수가 붙는다", async () => {
    setupServer({ summary: summaryRunning });
    const { user } = renderScans();

    await expandRow(user, RUNNING_TIME);
    expect(
      await screen.findByText("278건 중 통과 110건 · 이슈 1건 · 실패 2건 · 건너뜀 7건 · 대기 153건 · 진행 중 5건"),
    ).toBeInTheDocument();
  });
});

describe("[SP-10] repo별 진행 상황 표", () => {
  it("[SP-10] 열 repo | 상태 | 검출 | 신규 | 파일 | 내용, 상태 라벨 6개, 실패·대기·진행 중 행의 수는 -", async () => {
    setupServer();
    const { user } = renderScans();
    await expandRow(user, PARTIAL_TIME);

    const table = await findRepoTable();
    await within(table).findByText("legacy-theme");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((header) => header.textContent?.trim());
    expect(headers).toEqual(["repo", "상태", "검출", "신규", "파일", "내용"]);

    // repo 열(행 헤더)을 뺀 나머지 셀
    const rowOf = (repo: string) => within(table).getByRole("rowheader", { name: repo }).closest("tr") as HTMLElement;
    expect(cellTexts(rowOf(scanRepoFailed.repo))).toEqual(["실패", "-", "-", "-", String(scanRepoFailed.error)]);
    expect(cellTexts(rowOf(scanRepoIssue.repo))).toEqual(["이슈", "3", "1", "12", ""]);
    expect(cellTexts(rowOf(scanRepoPassed.repo))).toEqual(["통과", "0", "0", "4", ""]);
    expect(cellTexts(rowOf(scanRepoSkipped.repo))).toEqual(["건너뜀", "0", "0", "0", ""]);
    expect(cellTexts(rowOf(scanRepoRunning.repo))).toEqual(["진행 중", "-", "-", "-", ""]);
    expect(cellTexts(rowOf(scanRepoPending.repo))).toEqual(["대기", "-", "-", "-", ""]);
  });

  it("[SP-10] 상태 필터(전체 + 6개): 고르면 status= 와 page=1 로 요청하고, 전체는 파라미터를 생략한다", async () => {
    const server = setupServer();
    const { user } = renderScans();
    await expandRow(user, PARTIAL_TIME);
    await findRepoTable();

    const select = screen.getByRole("combobox", { name: "상태" });
    await user.click(select);
    const options = within(await screen.findByRole("listbox")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(
      expect.arrayContaining(["전체", "대기", "진행 중", "통과", "이슈", "실패", "건너뜀"]),
    );
    expect(options).toHaveLength(7);
    await user.keyboard("{Escape}");

    await chooseOption(user, select, "이슈");
    await waitFor(() => expect(reposRequests(server).at(-1)?.query).toEqual({ status: "issue", page: "1", limit: "50" }));

    await chooseOption(user, select, "전체");
    await waitFor(() => expect(reposRequests(server).at(-1)?.query).toEqual({ page: "1", limit: "50" }));
  });

  it("[SP-10] repo 검색은 300ms debounce 후 trim 한 값을 q= 와 page=1 로 보내고, 빈 값은 생략한다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = setupServer();
    const { user } = renderScans();
    await expandRow(user, PARTIAL_TIME);
    await findRepoTable();
    await settle();
    const before = reposRequests(server).length;

    const input = screen.getByRole("textbox", { name: "repo" });
    await user.type(input, "  api ");
    await advance(200);
    expect(reposRequests(server)).toHaveLength(before);

    await advance(150);
    await waitFor(() => expect(reposRequests(server).at(-1)?.query).toEqual({ q: "api", page: "1", limit: "50" }));

    await user.clear(input);
    await advance(350);
    await waitFor(() => expect(reposRequests(server).at(-1)?.query).toEqual({ page: "1", limit: "50" }));
  });

  it("[SP-10] 페이저(50건씩): 다음을 누르면 page=2 로 요청한다", async () => {
    const server = setupServer({ repos: pageOf(scanRepos, { total: 120, limit: 50 }) });
    const { user } = renderScans();
    await expandRow(user, PARTIAL_TIME);

    await screen.findByText("1–50 / 120");
    // 스캔 이력의 페이저와 구분한다
    const nav = screen.getAllByRole("navigation", { name: "페이지" }).find((el) => within(el).queryByText("1–50 / 120"));
    await user.click(within(nav as HTMLElement).getByRole("button", { name: "다음" }));
    await waitFor(() => expect(reposRequests(server).at(-1)?.query).toEqual({ page: "2", limit: "50" }));
  });

  it("[SP-10] 스캔이 running 이면 repo별 표를 5초마다 다시 조회한다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = setupServer({ summary: summaryRunning });
    const { user } = renderScans();
    await expandRow(user, RUNNING_TIME);
    await findRepoTable();
    await settle();

    const path = `/api/scans/${scanRunningWithStats.id}/repos`;
    const before = reposRequests(server, path).length;
    await advance(SCAN_POLL_INTERVAL_MS);
    await waitFor(() => expect(reposRequests(server, path).length).toBeGreaterThanOrEqual(before + 1));
    await advance(SCAN_POLL_INTERVAL_MS);
    await waitFor(() => expect(reposRequests(server, path).length).toBeGreaterThanOrEqual(before + 2));
  });

  it("[SP-10] 끝난 스캔의 repo별 표는 다시 조회하지 않는다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = setupServer();
    const { user } = renderScans();
    await expandRow(user, PARTIAL_TIME);
    await findRepoTable();
    await settle();

    const before = reposRequests(server).length;
    await advance(SCAN_POLL_INTERVAL_MS * 3);
    await settle();
    expect(reposRequests(server)).toHaveLength(before);
  });

  it("[SP-10] 필터 결과가 0건이면 '조건에 맞는 repo가 없습니다'를 표시한다", async () => {
    const empty: ReplyFactory = (request) =>
      reply.json(request.query.status === undefined ? pageOf(scanRepos) : pageOf<ScanRepo>([]))(request);
    setupServer({ repos: empty });
    const { user } = renderScans();
    await expandRow(user, PARTIAL_TIME);
    await findRepoTable();

    await chooseOption(user, screen.getByRole("combobox", { name: "상태" }), "대기");
    expect(await screen.findByText("조건에 맞는 repo가 없습니다")).toBeInTheDocument();
    // 필터는 그대로 남아 있다
    expect(screen.getByRole("combobox", { name: "상태" })).toBeInTheDocument();
  });

  it("[SP-10] 필터 없이 0건이면(보관 기간이 지난 스캔) '최근 30회의 스캔만 보관합니다'를 표시한다", async () => {
    setupServer({ repos: pageOf<ScanRepo>([]) });
    const { user } = renderScans();
    await expandRow(user, PARTIAL_TIME);

    expect(await screen.findByText("repo별 기록은 최근 30회의 스캔만 보관합니다")).toBeInTheDocument();
    expect(screen.queryByText("조건에 맞는 repo가 없습니다")).not.toBeInTheDocument();
  });

  it("[SP-10] repo별 표의 조회가 실패하면 표 자리에 오류를 표시하고 스캔 표는 그대로다", async () => {
    setupServer({ repos: reply.error(apiErrorOf("INTERNAL_ERROR", "내부 오류")) });
    const { user } = renderScans();
    await expandRow(user, PARTIAL_TIME);

    expect(await screen.findByText("데이터를 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: REPO_TABLE })).not.toBeInTheDocument();
    // 스캔 표와 요약 문장은 남는다
    expect(screen.getByRole("table", { name: "스캔 이력" })).toBeInTheDocument();
    expect(screen.getByText("278건 중 통과 177건 · 이슈 3건 · 실패 2건 · 건너뜀 96건")).toBeInTheDocument();
    expect(cellTexts(getRowWith(PARTIAL_TIME))).toContain("278 / 278");
  });
});
