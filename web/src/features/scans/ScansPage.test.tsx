import type { Page, Scan, Summary } from "@pw/shared";
import {
  apiErrorOf,
  emptyScansPage,
  pageOf,
  scanFailed,
  scanPartial,
  scanRunning,
  scansPage,
  scanSuccess,
  summaryDefault,
  summaryRunning,
} from "@pw/shared/fixtures";
import { act, screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ScansPage } from "@/features/scans/ScansPage";
import { deferredReply, reply, setupFetchMock, type FetchMock, type ReplyFactory } from "@/test/fetchMock";
import { currentPath, renderWithProviders } from "@/test/render";
import {
  advance,
  containing,
  expectNoToast,
  findRowWith,
  findToast,
  getRowWith,
  queryAllSkeletons,
  settle,
} from "@/test/ui";

// ---- 테스트가 정한 UI 이름 (계약에 없음 — 구현은 이 접근 가능한 이름을 그대로 쓴다)
const UI = {
  /** 행 펼침 토글 버튼 aria-label. aria-expanded 로 펼침 상태를 알린다. 펼칠 수 없는 행에는 없거나 비활성 */
  expandRow: "상세 보기",
} as const;

// ---- 계약 문구 (레이아웃 / UI State Contract / Error Contract / 성공 toast)
const TEXT = {
  scanNow: "지금 스캔",
  empty: "스캔 이력이 없습니다",
  loadError: "데이터를 불러오지 못했습니다",
  retry: "다시 시도",
  prev: "이전",
  next: "다음",
  scheduled: "자동",
  manual: "수동",
  started: "스캔을 시작했습니다",
  goToSettings: "설정으로 이동",
  serverError: "서버 오류가 발생했습니다",
  networkError: "서버에 연결할 수 없습니다",
} as const;

const SCANS = "/api/scans";
const SUMMARY = "/api/summary";
const SCAN_DETAIL = /^\/api\/scans\/\d+$/;

/** running 행이 없는 목록 (summary 와 일치) */
const finishedScansPage: Page<Scan> = pageOf([scanSuccess, scanPartial, scanFailed], { limit: 20 });

const olderScan: Scan = {
  ...scanSuccess,
  id: 9,
  startedAt: "2026-11-01T00:00:00.000Z",
  finishedAt: "2026-11-01T00:05:00.000Z",
};

/** total 45, limit 20. page 2 에는 running 행이 없다 */
const twoPages: ReplyFactory = (request) => {
  const page = Number(request.query.page ?? "1");
  const items = page === 1 ? scansPage.items : [olderScan];
  return reply.json(pageOf(items, { total: 45, page, limit: 20 }))(request);
};

function setupServer({
  summary = summaryDefault,
  scans = scansPage,
}: { summary?: Summary; scans?: Page<Scan> | ReplyFactory } = {}): FetchMock {
  return setupFetchMock()
    .on("GET", SUMMARY, reply.json(summary))
    .on("GET", SCANS, typeof scans === "function" ? scans : reply.json(scans));
}

function renderScans() {
  return renderWithProviders(<ScansPage />, { route: "/scans" });
}

function scanNowButton(): HTMLElement {
  return screen.getByRole("button", { name: TEXT.scanNow });
}

function counts(server: FetchMock) {
  return { scans: server.count("GET", SCANS), summary: server.count("GET", SUMMARY) };
}

async function goToPage2(user: UserEvent) {
  await screen.findByText("1–20 / 45");
  await user.click(screen.getByRole("button", { name: TEXT.next }));
  await screen.findByText("21–40 / 45");
}

function page2Requests(server: FetchMock): number {
  return server.requests("GET", SCANS).filter((request) => request.query.page === "2").length;
}

describe("스캔 이력 — 표", () => {
  it("[CT-07] 표에 시작 시각(MM-dd HH:mm)·종류(자동/수동)·상태 배지·repo 수·신규·실패 수를 표시한다", async () => {
    setupServer();
    renderScans();

    // scanSuccess: 2026-11-12T00:00Z → KST 11-12 09:00
    const success = await findRowWith("11-12 09:00");
    expect(within(success).getByText(TEXT.scheduled)).toBeInTheDocument();
    expect(within(success).getByText("success")).toBeInTheDocument();
    expect(within(success).getByText("42")).toBeInTheDocument();
    expect(within(success).getByText("2")).toBeInTheDocument();
    expect(within(success).getByText("0")).toBeInTheDocument();

    const partial = getRowWith("11-11 09:00");
    expect(within(partial).getByText("partial")).toBeInTheDocument();
    // 실패 = failedRepos.length
    expect(within(partial).getByText(String(scanPartial.failedRepos.length))).toBeInTheDocument();

    const failed = getRowWith("11-10 09:00");
    expect(within(failed).getByText(TEXT.manual)).toBeInTheDocument();
    expect(within(failed).getByText("failed")).toBeInTheDocument();
  });

  it("[CT-07] running 행은 repo 수·신규·실패를 '-' 로 표시한다", async () => {
    setupServer({ summary: summaryRunning });
    renderScans();

    const running = await findRowWith("11-13 09:00");
    expect(within(running).getByText(TEXT.manual)).toBeInTheDocument();
    expect(within(running).getByText("running")).toBeInTheDocument();
    expect(within(running).getAllByText("-")).toHaveLength(3);
    expect(within(running).queryByText("0")).not.toBeInTheDocument();
  });

  it("[CT-07] 행을 펼치면 목록 데이터의 failedRepos(repo + 오류)와 error 를 표시하고 GET /api/scans/:id 는 호출하지 않는다", async () => {
    const server = setupServer();
    const { user } = renderScans();

    const partialToggle = within(await findRowWith("11-11 09:00")).getByRole("button", { name: UI.expandRow });
    expect(partialToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(containing("big-monorepo"))).not.toBeInTheDocument();

    await user.click(partialToggle);
    expect(partialToggle).toHaveAttribute("aria-expanded", "true");
    for (const failedRepo of scanPartial.failedRepos) {
      expect(await screen.findByText(containing(failedRepo.repo))).toBeInTheDocument();
      expect(screen.getByText(containing(failedRepo.error))).toBeInTheDocument();
    }

    await user.click(within(getRowWith("11-10 09:00")).getByRole("button", { name: UI.expandRow }));
    expect(await screen.findByText(containing(String(scanFailed.error)))).toBeInTheDocument();

    expect(server.count("GET", SCAN_DETAIL)).toBe(0);
  });

  it("[CT-07] error 와 failedRepos 가 모두 비면 행을 펼칠 수 없다", async () => {
    setupServer();
    renderScans();

    // 펼칠 것이 있는 행에는 펼침 버튼이 있다
    expect(within(await findRowWith("11-11 09:00")).getByRole("button", { name: UI.expandRow })).toBeEnabled();

    for (const startedAt of ["11-12 09:00", "11-13 09:00"]) {
      const toggle = within(getRowWith(startedAt)).queryByRole("button", { name: UI.expandRow });
      // 버튼이 없거나 비활성이다
      expect(toggle === null || toggle.hasAttribute("disabled")).toBe(true);
    }
  });

  it("[CT-07] 스캔이 0건이면 '스캔 이력이 없습니다' 를 표시하고 페이저를 숨긴다", async () => {
    setupServer({ scans: emptyScansPage });
    renderScans();

    expect(await screen.findByText(TEXT.empty)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: TEXT.prev })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: TEXT.next })).not.toBeInTheDocument();
  });

  it("[CT-07] 첫 로드 중에는 Skeleton 을 표시한다", async () => {
    const pending = deferredReply();
    setupFetchMock().on("GET", SUMMARY, reply.json(summaryDefault)).on("GET", SCANS, pending.reply);
    renderScans();

    await waitFor(() => expect(queryAllSkeletons().length).toBeGreaterThan(0));
    expect(screen.queryByText(TEXT.empty)).not.toBeInTheDocument();

    await act(async () => pending.resolve(reply.json(finishedScansPage)));
    await findRowWith("11-12 09:00");
    expect(queryAllSkeletons()).toHaveLength(0);
  });

  it("[CT-07] 첫 로드 실패 시 '데이터를 불러오지 못했습니다' + [다시 시도] 를 표시하고 toast 는 띄우지 않는다", async () => {
    let fail = true;
    setupFetchMock()
      .on("GET", SUMMARY, reply.json(summaryDefault))
      .on("GET", SCANS, (request) =>
        (fail ? reply.error(apiErrorOf("INTERNAL_ERROR", "내부 오류")) : reply.json(finishedScansPage))(request),
      );
    const { user } = renderScans();

    expect(await screen.findByText(TEXT.loadError)).toBeInTheDocument();
    await expectNoToast();

    fail = false;
    await user.click(screen.getByRole("button", { name: TEXT.retry }));
    await findRowWith("11-12 09:00");
  });

  it("[CT-07] 페이저(limit 20): 첫 요청은 page 1·limit 20 이고 [다음] 은 page=2 로 요청한다 (A-8)", async () => {
    const server = setupServer({ scans: twoPages });
    const { user } = renderScans();

    await screen.findByText("1–20 / 45");
    const first = server.requests("GET", SCANS)[0]?.query ?? {};
    // limit·page 는 생략해도 서버 기본값(page 1, limit 20)과 같다
    expect(first.page ?? "1").toBe("1");
    expect(first.limit ?? "20").toBe("20");
    expect(screen.getByRole("button", { name: TEXT.prev })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: TEXT.next }));
    await screen.findByText("21–40 / 45");
    expect(server.last("GET", SCANS)?.query.page).toBe("2");
  });
});

describe("스캔 이력 — [지금 스캔]", () => {
  it("[CT-06] [지금 스캔] 은 summary 로딩 중에 비활성이고, 실행 중이 아니면 로딩 후 활성이다", async () => {
    const pending = deferredReply();
    setupFetchMock().on("GET", SUMMARY, pending.reply).on("GET", SCANS, reply.json(finishedScansPage));
    renderScans();

    await findRowWith("11-12 09:00");
    expect(scanNowButton()).toBeDisabled();

    await act(async () => pending.resolve(reply.json(summaryDefault)));
    await waitFor(() => expect(scanNowButton()).toBeEnabled());
  });

  it("[CT-06] 스캔 실행 중(summary.lastScan.status === 'running')이면 [지금 스캔] 이 비활성이다", async () => {
    const server = setupServer({ summary: summaryRunning });
    renderScans();

    await findRowWith("11-13 09:00");
    await waitFor(() => expect(server.count("GET", SUMMARY)).toBeGreaterThan(0));
    await settle();
    expect(scanNowButton()).toBeDisabled();
  });

  it("[CT-06] 실행 중 판정은 summary 만 쓴다: 목록에 running 행이 있어도 summary 가 running 이 아니면 활성이다", async () => {
    setupServer({ summary: summaryDefault, scans: scansPage });
    renderScans();

    await findRowWith("11-13 09:00");
    await waitFor(() => expect(scanNowButton()).toBeEnabled());
  });

  it("[CT-06] page 2 에서도 스캔 실행 중이면 [지금 스캔] 이 비활성이다", async () => {
    setupServer({ summary: summaryRunning, scans: twoPages });
    const { user } = renderScans();

    await goToPage2(user);
    // page 2 에는 running 행이 없지만 판정의 단일 소스는 summary 다
    expect(screen.queryByText("running")).not.toBeInTheDocument();
    expect(scanNowButton()).toBeDisabled();
  });

  it("[CT-06][AC-10] [지금 스캔] → POST /api/scans, 요청 중 비활성, 202 면 toast + scans·summary 재조회", async () => {
    const pending = deferredReply();
    const server = setupServer({ scans: finishedScansPage }).on("POST", SCANS, pending.reply);
    const { user } = renderScans();

    await findRowWith("11-12 09:00");
    await waitFor(() => expect(scanNowButton()).toBeEnabled());
    const before = counts(server);

    await user.click(scanNowButton());
    await waitFor(() => expect(scanNowButton()).toBeDisabled());
    expect(server.count("POST", SCANS)).toBe(1);

    await act(async () => pending.resolve(reply.json(scanRunning, 202)));
    await findToast(TEXT.started);
    await waitFor(() => {
      expect(server.count("GET", SCANS)).toBeGreaterThan(before.scans);
      expect(server.count("GET", SUMMARY)).toBeGreaterThan(before.summary);
    });
  });

  it("[CT-06][EC-05] 409 SCAN_RUNNING → toast(message) + scans·summary 재조회", async () => {
    const error = apiErrorOf("SCAN_RUNNING", "이미 스캔이 실행 중입니다");
    const server = setupServer({ scans: finishedScansPage }).on("POST", SCANS, reply.error(error));
    const { user } = renderScans();

    await findRowWith("11-12 09:00");
    await waitFor(() => expect(scanNowButton()).toBeEnabled());
    const before = counts(server);

    await user.click(scanNowButton());

    await findToast(error.error.message);
    await waitFor(() => {
      expect(server.count("GET", SCANS)).toBeGreaterThan(before.scans);
      expect(server.count("GET", SUMMARY)).toBeGreaterThan(before.summary);
    });
  });

  it.each([
    ["ORG_NOT_SET", "GitHub org 가 설정되지 않았습니다. 설정에서 org 를 저장하십시오"],
    ["TOKEN_MISSING", "GitHub 토큰이 없습니다. GITHUB_TOKEN env 를 설정한 뒤 서버를 다시 시작하십시오"],
  ] as const)(
    "[CT-06][EC-06] 400 %s → toast(message) + action '설정으로 이동' 을 누르면 /settings 로 이동한다",
    async (code, message) => {
      const error = apiErrorOf(code, message);
      setupServer({ scans: finishedScansPage }).on("POST", SCANS, reply.error(error));
      const { user } = renderScans();

      await findRowWith("11-12 09:00");
      await waitFor(() => expect(scanNowButton()).toBeEnabled());
      await user.click(scanNowButton());

      const toast = await findToast(message);
      expect(currentPath()).toBe("/scans");
      await user.click(within(toast).getByRole("button", { name: TEXT.goToSettings }));
      await waitFor(() => expect(currentPath()).toBe("/settings"));
    },
  );

  it.each([
    ["INTERNAL_ERROR", reply.error(apiErrorOf("INTERNAL_ERROR", "예상하지 못한 오류")), TEXT.serverError],
    ["NETWORK_ERROR", reply.networkError(), TEXT.networkError],
  ])(
    "[CT-06][CT-10] POST /api/scans 가 %s 로 끝나면 toast + 성공과 같은 키(scans·summary)를 무효화한다",
    async (_code, postReply, toastText) => {
      const server = setupServer({ scans: finishedScansPage }).on("POST", SCANS, postReply);
      const { user } = renderScans();

      await findRowWith("11-12 09:00");
      await waitFor(() => expect(scanNowButton()).toBeEnabled());
      const before = counts(server);

      await user.click(scanNowButton());

      await findToast(toastText);
      await waitFor(() => {
        expect(server.count("GET", SCANS)).toBeGreaterThan(before.scans);
        expect(server.count("GET", SUMMARY)).toBeGreaterThan(before.summary);
      });
    },
  );
});

describe("스캔 이력 — 실행 중 polling", () => {
  it("[CT-06] 스캔 실행 중이고 page 1 이면 summary 와 scans 를 5초마다 다시 조회한다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = setupServer({ summary: summaryRunning });
    renderScans();

    await findRowWith("11-13 09:00");
    await settle();
    const before = counts(server);

    await advance(5_000);
    await waitFor(() => {
      expect(server.count("GET", SUMMARY)).toBeGreaterThanOrEqual(before.summary + 1);
      expect(server.count("GET", SCANS)).toBeGreaterThanOrEqual(before.scans + 1);
    });

    await advance(5_000);
    await waitFor(() => {
      expect(server.count("GET", SUMMARY)).toBeGreaterThanOrEqual(before.summary + 2);
      expect(server.count("GET", SCANS)).toBeGreaterThanOrEqual(before.scans + 2);
    });
  });

  it("[CT-06] page 2 에서는 실행 중이어도 scans 를 polling 하지 않는다 (summary 는 계속 polling)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = setupServer({ summary: summaryRunning, scans: twoPages });
    const { user } = renderScans();

    await goToPage2(user);
    await settle();
    const before = { page2: page2Requests(server), summary: server.count("GET", SUMMARY) };

    await advance(5_000);
    await waitFor(() => expect(server.count("GET", SUMMARY)).toBeGreaterThan(before.summary));
    await advance(5_000);
    expect(page2Requests(server)).toBe(before.page2);
  });

  it("[CT-06] 스캔이 끝나면(running → 종료) scans 를 무효화해서 다시 조회한다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let running = true;
    const server = setupFetchMock()
      .on("GET", SUMMARY, (request) => reply.json(running ? summaryRunning : summaryDefault)(request))
      .on("GET", SCANS, twoPages);
    const { user } = renderScans();

    // page 2 는 polling 대상이 아니므로 재조회는 종료 전이의 무효화로만 일어난다
    await goToPage2(user);
    await settle();
    const before = page2Requests(server);

    running = false;
    await advance(5_000);
    await waitFor(() => expect(page2Requests(server)).toBeGreaterThan(before));
    await waitFor(() => expect(scanNowButton()).toBeEnabled());
  });
});
