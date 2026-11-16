import { settingsInputSchema, type ApiError, type Settings } from "@pw/shared";
import {
  apiErrorOf,
  emptyFindingsPage,
  settingsDefault,
  settingsUnconfigured,
  summaryDefault,
  testEmailResult,
} from "@pw/shared/fixtures";
import { act, screen, waitFor } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DashboardPage } from "@/features/findings/DashboardPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { queryKeys } from "@/lib/queryKeys";
import { deferredReply, reply, setupFetchMock, type FetchMock, type ReplyFactory } from "@/test/fetchMock";
import { createTestQueryClient, renderWithProviders } from "@/test/render";
import {
  containing,
  expectFieldError,
  expectNoToast,
  findToast,
  queryAllSkeletons,
  schemaErrors,
  settle,
} from "@/test/ui";

// ---- 테스트가 정한 UI 이름 (계약에 없음 — 구현은 이 접근 가능한 이름을 그대로 쓴다)
const UI = {
  /** org 입력 label (레이아웃 "GitHub org") */
  org: "GitHub org",
  /** interval 입력 label (레이아웃 "스캔 interval(시간)") — "interval" 을 포함하면 된다 */
  interval: /interval/,
  /** 요약 시각 입력 label (레이아웃 "일일 요약 시각") — "요약 시각" 을 포함하면 된다 */
  digestTime: /요약 시각/,
  /** 새 수신자 주소 입력 label (레이아웃 "이메일 수신자") */
  newRecipient: "이메일 수신자",
  /** 새 수신자 추가 버튼 (레이아웃 "[+ 추가]") */
  addRecipient: "추가",
  /** 수신자 chip 의 제거 아이콘 버튼 aria-label */
  removeRecipient: (email: string) => `${email} 제거`,
} as const;

// ---- 계약 문구 (레이아웃 / UI State Contract / 성공 toast)
const TEXT = {
  save: "저장",
  testEmail: "테스트 메일",
  orgHint: "org를 바꾸면 현재 검출이 모두 resolved로 바뀝니다",
  saveFirst: "저장 후 테스트할 수 있습니다",
  timezone: "Asia/Seoul",
  tokenEnv: "env",
  tokenGh: "gh CLI",
  none: "없음",
  smtpConfigured: "설정됨",
  retry: "다시 시도",
  saved: "설정을 저장했습니다",
  testSent: "테스트 메일을 보냈습니다",
  /** S-20: [추가] 하지 않은 주소가 남은 채 저장할 때의 필드 오류 */
  pendingRecipient: "[추가]를 눌러 수신자에 넣거나 입력란을 비우십시오",
} as const;

const SETTINGS = "/api/settings";
const TEST_EMAIL = "/api/settings/test-email";
const SUMMARY = "/api/summary";
const FINDINGS = "/api/findings";

/** 저장한 값을 다음 GET 에서 돌려주는 설정 서버. PUT 본문은 shared 입력 스키마로 읽는다. */
function settingsStore(initial: Settings): { get: ReplyFactory; put: ReplyFactory } {
  let current = initial;
  return {
    get: (request) => reply.json(current)(request),
    put: (request) => {
      const parsed = settingsInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.error(apiErrorOf("VALIDATION_ERROR", "입력값을 확인하십시오"))(request);
      }
      current = { ...current, ...parsed.data };
      return reply.json(current)(request);
    },
  };
}

function setupServer(settings: Settings = settingsDefault): FetchMock {
  const store = settingsStore(settings);
  return setupFetchMock()
    .on("GET", SETTINGS, store.get)
    .on("PUT", SETTINGS, store.put)
    .on("GET", SUMMARY, reply.json(summaryDefault))
    .on("GET", FINDINGS, reply.json(emptyFindingsPage));
}

/**
 * withDashboard: summary·findings 를 구독하는 대시보드를 함께 렌더해서
 * 저장 뒤의 summary·findings 무효화를 실제 재요청으로 관찰한다.
 */
function renderSettings({ withDashboard = false } = {}) {
  return renderWithProviders(
    <>
      <SettingsPage />
      {withDashboard && <DashboardPage />}
    </>,
    { route: "/settings" },
  );
}

function orgInput(): HTMLElement {
  return screen.getByRole("textbox", { name: UI.org });
}

function intervalInput(): HTMLElement {
  return screen.getByLabelText(UI.interval);
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: TEXT.save });
}

function testEmailButton(): HTMLElement {
  return screen.getByRole("button", { name: TEXT.testEmail });
}

async function waitForForm(): Promise<void> {
  await screen.findByRole("textbox", { name: UI.org });
}

async function replaceValue(user: UserEvent, field: HTMLElement, value: string) {
  await user.clear(field);
  await user.type(field, value);
}

describe("설정 — 폼 표시", () => {
  it("[CT-08] 첫 로드 값으로 폼을 채운다: org, interval, 요약 시각 + Asia/Seoul, 수신자 chip", async () => {
    setupServer();
    renderSettings();

    await waitForForm();
    expect(orgInput()).toHaveValue("my-org");
    expect(intervalInput()).toHaveDisplayValue("24");
    expect(screen.getByLabelText(UI.digestTime)).toHaveDisplayValue("09:00");
    expect(screen.getByText(containing(TEXT.timezone))).toBeInTheDocument();
    for (const email of settingsDefault.recipients) {
      expect(screen.getByText(email)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: UI.removeRecipient(email) })).toBeInTheDocument();
    }
  });

  it("[CT-08] org 가 null 이면 빈 입력이다", async () => {
    setupServer(settingsUnconfigured);
    renderSettings();

    await waitForForm();
    expect(orgInput()).toHaveValue("");
  });

  it("[CT-08] org 입력 아래에 'org를 바꾸면 현재 검출이 모두 resolved로 바뀝니다' 안내를 표시한다", async () => {
    setupServer();
    renderSettings();

    await waitForForm();
    expect(screen.getByText(TEXT.orgHint)).toBeInTheDocument();
  });

  it("[CT-08] 연결 상태: GitHub 토큰 env, SMTP 설정됨", async () => {
    setupServer(settingsDefault);
    renderSettings();

    await waitForForm();
    expect(screen.getByText(TEXT.tokenEnv)).toBeInTheDocument();
    expect(screen.getByText(TEXT.smtpConfigured)).toBeInTheDocument();
  });

  it("[CT-08] 연결 상태: GitHub 토큰 gh CLI", async () => {
    setupServer({ ...settingsDefault, githubTokenSource: "gh" });
    renderSettings();

    await waitForForm();
    expect(screen.getByText(TEXT.tokenGh)).toBeInTheDocument();
  });

  it("[CT-08] 연결 상태: GitHub 토큰 없음, SMTP 없음", async () => {
    setupServer(settingsUnconfigured);
    renderSettings();

    await waitForForm();
    expect(screen.getAllByText(TEXT.none)).toHaveLength(2);
    expect(screen.queryByText(TEXT.smtpConfigured)).not.toBeInTheDocument();
  });

  it("[CT-08] 첫 로드 중에는 폼 Skeleton 을 표시한다", async () => {
    const pending = deferredReply();
    setupFetchMock().on("GET", SETTINGS, pending.reply);
    renderSettings();

    await waitFor(() => expect(queryAllSkeletons().length).toBeGreaterThan(0));

    await act(async () => pending.resolve(reply.json(settingsDefault)));
    await waitForForm();
    expect(queryAllSkeletons()).toHaveLength(0);
  });

  it("[CT-08] 첫 로드 실패 시 폼 자리에 오류 문장 + [다시 시도] 를 표시하고 [저장]·[테스트 메일] 을 숨긴다", async () => {
    let fail = true;
    setupFetchMock().on("GET", SETTINGS, (request) =>
      (fail ? reply.networkError() : reply.json(settingsDefault))(request),
    );
    const { user } = renderSettings();

    const retry = await screen.findByRole("button", { name: TEXT.retry });
    expect(screen.queryByRole("button", { name: TEXT.save })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: TEXT.testEmail })).not.toBeInTheDocument();
    await expectNoToast();

    fail = false;
    await user.click(retry);
    await waitForForm();
    expect(saveButton()).toBeInTheDocument();
  });
});

describe("설정 — 저장", () => {
  it("[CT-08][AC-11] [저장] → PUT /api/settings (shared 입력 스키마), 성공 toast, 응답 값으로 폼 reset", async () => {
    const server = setupServer();
    const { user } = renderSettings();
    await waitForForm();

    await replaceValue(user, orgInput(), "New-Org");
    await replaceValue(user, intervalInput(), "6");
    await user.click(saveButton());

    await findToast(TEXT.saved);
    const body = server.last("PUT", SETTINGS)?.body;
    expect(settingsInputSchema.parse(body)).toEqual({
      org: "new-org",
      scanIntervalHours: 6,
      digestTime: "09:00",
      recipients: settingsDefault.recipients,
      notifyMinSeverity: "low",
      feedEnabled: true,
      branchScanDays: 7,
    });
    // 응답 값(소문자로 정규화된 org)으로 reset 한다
    await waitFor(() => expect(orgInput()).toHaveValue("new-org"));
    expect(intervalInput()).toHaveDisplayValue("6");
    // reset 뒤에는 dirty 가 아니다
    expect(testEmailButton()).toBeEnabled();
    expect(screen.queryByText(TEXT.saveFirst)).not.toBeInTheDocument();
  });

  it("[CT-08] 저장에 성공하면 settings·summary·findings 를 무효화한다", async () => {
    const server = setupServer();
    const { user } = renderSettings({ withDashboard: true });
    await waitForForm();
    await waitFor(() => {
      expect(server.count("GET", SUMMARY)).toBeGreaterThan(0);
      expect(server.count("GET", FINDINGS)).toBeGreaterThan(0);
    });
    const before = {
      settings: server.count("GET", SETTINGS),
      summary: server.count("GET", SUMMARY),
      findings: server.count("GET", FINDINGS),
    };

    await replaceValue(user, intervalInput(), "6");
    await user.click(saveButton());

    await findToast(TEXT.saved);
    await waitFor(() => {
      expect(server.count("GET", SETTINGS)).toBeGreaterThan(before.settings);
      expect(server.count("GET", SUMMARY)).toBeGreaterThan(before.summary);
      expect(server.count("GET", FINDINGS)).toBeGreaterThan(before.findings);
    });
  });

  it("[CT-08] 저장 중에는 [저장] 이 비활성이다", async () => {
    const pending = deferredReply();
    setupServer().on("PUT", SETTINGS, pending.reply);
    const { user } = renderSettings();
    await waitForForm();

    await replaceValue(user, intervalInput(), "6");
    await user.click(saveButton());

    await waitFor(() => expect(saveButton()).toBeDisabled());
    await act(async () => pending.resolve(reply.json({ ...settingsDefault, scanIntervalHours: 6 })));
    await findToast(TEXT.saved);
  });

  it("[CT-08][EC-11] 제출 전 shared 스키마로 검증: interval 이 0 이면 필드 아래 오류를 표시하고 요청하지 않는다", async () => {
    const server = setupServer();
    const { user } = renderSettings();
    await waitForForm();

    await replaceValue(user, intervalInput(), "0");
    await user.click(saveButton());

    const expected = schemaErrors(settingsInputSchema, {
      org: "my-org",
      scanIntervalHours: 0,
      digestTime: "09:00",
      recipients: settingsDefault.recipients,
    });
    await expectFieldError(intervalInput(), expected.scanIntervalHours ?? "");
    expect(server.count("PUT", SETTINGS)).toBe(0);
  });

  it("[CT-08][EC-11] 잘못된 이메일 수신자는 오류를 표시하고 그 값으로 저장 요청을 보내지 않는다", async () => {
    const server = setupServer();
    const { user } = renderSettings();
    await waitForForm();

    await user.type(screen.getByRole("textbox", { name: UI.newRecipient }), "not-an-email");
    await user.click(screen.getByRole("button", { name: UI.addRecipient }));
    await user.click(saveButton());

    const expected = schemaErrors(settingsInputSchema, {
      org: "my-org",
      scanIntervalHours: 24,
      digestTime: "09:00",
      recipients: [...settingsDefault.recipients, "not-an-email"],
    });
    expect(await screen.findByText(containing(expected.recipients ?? ""))).toBeInTheDocument();
    const sentInvalid = server
      .requests("PUT", SETTINGS)
      .some((request) => JSON.stringify(request.body).includes("not-an-email"));
    expect(sentInvalid).toBe(false);
  });

  it("[CT-08] 수신자 chip 을 추가·제거하면 저장 요청의 recipients 에 반영된다", async () => {
    const server = setupServer();
    const { user } = renderSettings();
    await waitForForm();

    await user.click(screen.getByRole("button", { name: UI.removeRecipient("a@example.com") }));
    expect(screen.queryByText("a@example.com")).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: UI.newRecipient }), "c@example.com");
    await user.click(screen.getByRole("button", { name: UI.addRecipient }));
    expect(screen.getByText("c@example.com")).toBeInTheDocument();
    await user.click(saveButton());

    await findToast(TEXT.saved);
    expect(settingsInputSchema.parse(server.last("PUT", SETTINGS)?.body).recipients).toEqual([
      "b@example.com",
      "c@example.com",
    ]);
  });

  it("[CT-08] 서버 400 VALIDATION_ERROR 의 details 키가 폼 필드면 그 필드 아래에 표시한다", async () => {
    const error: ApiError = {
      error: {
        code: "VALIDATION_ERROR",
        message: "입력값을 확인하십시오",
        details: { scanIntervalHours: "서버가 거부한 interval 입니다" },
      },
    };
    setupServer().on("PUT", SETTINGS, reply.error(error));
    const { user } = renderSettings();
    await waitForForm();

    await replaceValue(user, intervalInput(), "12");
    await user.click(saveButton());

    await expectFieldError(intervalInput(), "서버가 거부한 interval 입니다");
    expect(intervalInput()).toHaveDisplayValue("12");
    await expectNoToast();
  });

  it("[CT-08] VALIDATION_ERROR 에 폼 필드 details 가 없으면 message 를 toast 로 표시한다", async () => {
    const error = apiErrorOf("VALIDATION_ERROR", "요청 본문을 확인하십시오");
    setupServer().on("PUT", SETTINGS, reply.error(error));
    const { user } = renderSettings();
    await waitForForm();

    await replaceValue(user, intervalInput(), "12");
    await user.click(saveButton());

    await findToast(error.error.message);
    expect(intervalInput()).toHaveDisplayValue("12");
  });

  it("[CT-08] dirty 상태에서 settings 를 다시 조회해도 폼을 덮어쓰지 않는다", async () => {
    let current: Settings = settingsDefault;
    const server = setupFetchMock().on("GET", SETTINGS, (request) => reply.json(current)(request));
    const { user, queryClient } = renderSettings();
    await waitForForm();

    await replaceValue(user, orgInput(), "draft-org");
    current = { ...settingsDefault, org: "server-org" };
    const before = server.count("GET", SETTINGS);
    await act(() => queryClient.invalidateQueries());
    await waitFor(() => expect(server.count("GET", SETTINGS)).toBeGreaterThan(before));
    await settle();

    expect(orgInput()).toHaveValue("draft-org");
  });

  it("[CT-08] [추가] 하지 않은 주소가 입력란에 남아 있으면 저장하지 않고 그 필드에 오류를 표시한다 (S-20)", async () => {
    const server = setupServer();
    const { user } = renderSettings();
    await waitForForm();
    const newRecipient = screen.getByRole("textbox", { name: UI.newRecipient });

    await user.type(newRecipient, "c@example.com");
    await user.click(saveButton());

    await expectFieldError(newRecipient, TEXT.pendingRecipient);
    expect(newRecipient).toHaveAttribute("aria-invalid", "true");
    expect(server.count("PUT", SETTINGS)).toBe(0);

    // [추가] 로 넣으면 오류가 사라지고 그 주소를 포함해 저장한다
    await user.click(screen.getByRole("button", { name: UI.addRecipient }));
    expect(newRecipient).not.toHaveAccessibleDescription(containing(TEXT.pendingRecipient));
    await user.click(saveButton());

    await findToast(TEXT.saved);
    expect(settingsInputSchema.parse(server.last("PUT", SETTINGS)?.body).recipients).toEqual([
      ...settingsDefault.recipients,
      "c@example.com",
    ]);
  });

  it("[CT-08] 남은 주소를 지우면 오류가 사라지고, 공백만 남은 입력란은 저장을 막지 않는다 (S-20)", async () => {
    const server = setupServer();
    const { user } = renderSettings();
    await waitForForm();
    const newRecipient = screen.getByRole("textbox", { name: UI.newRecipient });

    await user.type(newRecipient, "c@example.com");
    await user.click(saveButton());
    await expectFieldError(newRecipient, TEXT.pendingRecipient);

    await user.clear(newRecipient);
    await user.type(newRecipient, "   ");
    expect(newRecipient).not.toHaveAccessibleDescription(containing(TEXT.pendingRecipient));
    await user.click(saveButton());

    await findToast(TEXT.saved);
    expect(settingsInputSchema.parse(server.last("PUT", SETTINGS)?.body).recipients).toEqual(
      settingsDefault.recipients,
    );
  });
});

describe("설정 — 다시 들어왔을 때(캐시가 있을 때)의 첫 로드", () => {
  /** 이전 방문에서 받은 값이 캐시에 남아 있는 QueryClient */
  function clientWithCachedSettings(settings: Settings) {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.settings(), settings);
    return queryClient;
  }

  it("[CT-08] 캐시 값으로 폼을 만들고, 처음 도착한 새 응답으로 (dirty 가 아니면) 폼을 reset 한다", async () => {
    const pending = deferredReply();
    setupFetchMock().on("GET", SETTINGS, pending.reply);
    renderWithProviders(<SettingsPage />, {
      route: "/settings",
      queryClient: clientWithCachedSettings({ ...settingsDefault, org: "old-org" }),
    });

    await waitForForm();
    expect(orgInput()).toHaveValue("old-org");

    // 다른 탭에서 org 를 바꾼 뒤의 새 응답
    await act(async () => pending.resolve(reply.json({ ...settingsDefault, org: "new-org", scanIntervalHours: 6 })));
    await waitFor(() => expect(orgInput()).toHaveValue("new-org"));
    expect(intervalInput()).toHaveDisplayValue("6");
    // reset 이므로 dirty 가 아니다
    expect(screen.queryByText(TEXT.saveFirst)).not.toBeInTheDocument();
  });

  it("[CT-08] 새 응답이 오기 전에 폼을 고쳤으면(dirty) 새 응답이 폼을 덮어쓰지 않는다", async () => {
    const pending = deferredReply();
    setupFetchMock().on("GET", SETTINGS, pending.reply);
    const { user } = renderWithProviders(<SettingsPage />, {
      route: "/settings",
      queryClient: clientWithCachedSettings({ ...settingsDefault, org: "old-org" }),
    });

    await waitForForm();
    await replaceValue(user, orgInput(), "draft-org");

    await act(async () => pending.resolve(reply.json({ ...settingsDefault, org: "new-org" })));
    await settle();
    expect(orgInput()).toHaveValue("draft-org");
  });
});

describe("설정 — 테스트 메일", () => {
  it("[CT-09] 저장된 수신자가 있고 SMTP 가 설정되었고 폼이 clean 이면 [테스트 메일] 이 활성이다", async () => {
    setupServer(settingsDefault);
    renderSettings();

    await waitForForm();
    expect(testEmailButton()).toBeEnabled();
    expect(screen.queryByText(TEXT.saveFirst)).not.toBeInTheDocument();
  });

  it.each([
    ["저장된 수신자가 0명", { ...settingsDefault, recipients: [] }],
    ["smtpConfigured=false", { ...settingsDefault, smtpConfigured: false }],
  ])("[CT-09] %s 이면 [테스트 메일] 이 비활성이다", async (_label, settings) => {
    setupServer(settings);
    renderSettings();

    await waitForForm();
    expect(testEmailButton()).toBeDisabled();
  });

  it("[CT-09] 폼이 dirty 이면 [테스트 메일] 이 비활성이고 '저장 후 테스트할 수 있습니다' 를 안내한다", async () => {
    setupServer(settingsDefault);
    const { user } = renderSettings();
    await waitForForm();

    await replaceValue(user, intervalInput(), "6");

    await waitFor(() => expect(testEmailButton()).toBeDisabled());
    expect(screen.getByText(TEXT.saveFirst)).toBeInTheDocument();
  });

  it("[CT-09][AC-12] [테스트 메일] → POST /api/settings/test-email, 요청 중 비활성, 성공 toast", async () => {
    const pending = deferredReply();
    const server = setupServer(settingsDefault).on("POST", TEST_EMAIL, pending.reply);
    const { user } = renderSettings();
    await waitForForm();

    await user.click(testEmailButton());
    await waitFor(() => expect(testEmailButton()).toBeDisabled());
    expect(server.count("POST", TEST_EMAIL)).toBe(1);

    await act(async () => pending.resolve(reply.json(testEmailResult)));
    await findToast(TEXT.testSent);
    await waitFor(() => expect(testEmailButton()).toBeEnabled());
  });

  it.each([
    ["NO_RECIPIENTS", "저장된 수신자가 없습니다"],
    ["SMTP_NOT_CONFIGURED", "SMTP 가 설정되지 않았습니다 (SMTP_HOST, SMTP_FROM)"],
    ["SMTP_FAILED", "SMTP 서버가 메일을 거부했습니다"],
  ] as const)("[CT-09] 테스트 메일 %s 는 message 를 toast 로 표시한다", async (code, message) => {
    setupServer(settingsDefault).on("POST", TEST_EMAIL, reply.error(apiErrorOf(code, message)));
    const { user } = renderSettings();
    await waitForForm();

    await user.click(testEmailButton());

    await findToast(message);
  });
});
