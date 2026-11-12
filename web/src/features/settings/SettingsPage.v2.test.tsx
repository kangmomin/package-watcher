// v2(묶음 1/3) 설정 화면: "즉시 알림 최소 심각도" select 와 경고 문구.
// 근거: Integration Contract v2.2 의 UI State Contract, CT-20 의 FE 부분.
import { settingsInputSchema, SEVERITIES, type BlacklistEntry, type Settings } from "@pw/shared";
import {
  apiErrorOf,
  blacklistEntries,
  blacklistEntryDisabled,
  blacklistEntryDisabledExpired,
  blacklistEntryExpired,
  blacklistEntryPattern,
  emptyFindingsPage,
  settingsDefault,
  summaryDefault,
} from "@pw/shared/fixtures";
import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { deferredReply, reply, setupFetchMock, type FetchMock, type ReplyFactory } from "@/test/fetchMock";
import { renderWithProviders } from "@/test/render";
import { chooseOption, containing, findToast, queryAllSkeletons, settle } from "@/test/ui";

// ---- 테스트가 정한 UI 이름 (Plan 의 필드 이름을 label 로 쓴다. 필수 표시(*)는 뒤에 붙어도 된다)
const UI = {
  org: "GitHub org",
  interval: /interval/,
  notifyMinSeverity: /^즉시 알림 최소 심각도/,
} as const;

// ---- 계약 문구 (UI State Contract v2.2)
const TEXT = {
  save: "저장",
  testEmail: "테스트 메일",
  saved: "설정을 저장했습니다",
  saveFirst: "저장 후 테스트할 수 있습니다",
  severityHint: "이보다 낮은 검출은 일일 요약에만 포함합니다",
  warning: (count: number) => `켜진 항목 ${count}개는 이 기준보다 낮아 즉시 알림을 받지 않습니다`,
  warningAny: "이 기준보다 낮아 즉시 알림을 받지 않습니다",
  loadError: "데이터를 불러오지 못했습니다",
} as const;

const SETTINGS = "/api/settings";
const BLACKLIST = "/api/blacklist";

/**
 * 활성 medium 2개(lodash, evil-pkg) + 세지 않아야 하는 항목들:
 * 꺼진 low, 만료된 medium, 꺼짐 + 만료 low, 활성 critical(기준보다 낮지 않음).
 */
const mixedEntries: BlacklistEntry[] = [
  ...blacklistEntries,
  blacklistEntryDisabled,
  { ...blacklistEntryExpired, severity: "medium" },
  { ...blacklistEntryDisabledExpired, severity: "low" },
  blacklistEntryPattern,
];

/** 저장한 값을 다음 GET 에서 돌려주는 설정 서버. */
function settingsStore(initial: Settings): { get: ReplyFactory; put: ReplyFactory } {
  let current = initial;
  return {
    get: (request) => reply.json(current)(request),
    put: (request) => {
      const parsed = settingsInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.error(apiErrorOf("VALIDATION_ERROR", "입력값을 확인하십시오"))(request);
      }
      // 생략한 notifyMinSeverity 는 저장된 값을 유지한다 (undefined 로 덮어쓰지 않는다)
      const { notifyMinSeverity, ...rest } = parsed.data;
      current = { ...current, ...rest, ...(notifyMinSeverity ? { notifyMinSeverity } : {}) };
      return reply.json(current)(request);
    },
  };
}

function setupServer({
  settings = settingsDefault,
  blacklist = reply.json({ items: mixedEntries }),
}: { settings?: Settings; blacklist?: ReplyFactory } = {}): FetchMock {
  const store = settingsStore(settings);
  return setupFetchMock()
    .on("GET", SETTINGS, store.get)
    .on("PUT", SETTINGS, store.put)
    .on("GET", "/api/summary", reply.json(summaryDefault))
    .on("GET", "/api/findings", reply.json(emptyFindingsPage))
    .on("GET", BLACKLIST, blacklist);
}

async function renderSettings() {
  const result = renderWithProviders(<SettingsPage />, { route: "/settings" });
  await screen.findByRole("textbox", { name: UI.org });
  return result;
}

function severitySelect(): HTMLElement {
  return screen.getByRole("combobox", { name: UI.notifyMinSeverity });
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: TEXT.save });
}

function testEmailButton(): HTMLElement {
  return screen.getByRole("button", { name: TEXT.testEmail });
}

function queryWarning(): HTMLElement | null {
  return screen.queryByText(containing(TEXT.warningAny));
}

describe("설정 v2 — 즉시 알림 최소 심각도", () => {
  it("[CT-20] select 의 초기값은 저장된 notifyMinSeverity 이고(기본 low), 안내 문구를 표시한다", async () => {
    setupServer();
    await renderSettings();

    expect(severitySelect()).toHaveTextContent("low");
    expect(screen.getByText(containing(TEXT.severityHint))).toBeInTheDocument();
  });

  it("[CT-20][v2-AC-07] 저장된 값이 high 면 select 가 high 로 열리고, 옵션은 SEVERITIES 순서다", async () => {
    setupServer({ settings: { ...settingsDefault, notifyMinSeverity: "high" } });
    const { user } = await renderSettings();

    expect(severitySelect()).toHaveTextContent("high");
    await user.click(severitySelect());
    const options = within(await screen.findByRole("listbox")).getAllByRole("option");
    expect(options.map((option) => option.textContent?.trim())).toEqual([...SEVERITIES]);
  });

  it("[CT-20][v2-AC-07] 값을 바꿔 저장하면 본문에 notifyMinSeverity 가 들어가고, 저장 후 응답 값으로 reset 한다 (dirty 아님)", async () => {
    const server = setupServer();
    const { user } = await renderSettings();

    await chooseOption(user, severitySelect(), "high");
    // 값을 바꾸면 dirty 다 (v1 의 dirty 규칙 그대로)
    await waitFor(() => expect(testEmailButton()).toBeDisabled());
    expect(screen.getByText(TEXT.saveFirst)).toBeInTheDocument();

    await user.click(saveButton());

    await findToast(TEXT.saved);
    expect(server.last("PUT", SETTINGS)?.body).toMatchObject({
      org: "my-org",
      scanIntervalHours: 24,
      digestTime: "09:00",
      recipients: settingsDefault.recipients,
      notifyMinSeverity: "high",
    });
    await waitFor(() => expect(testEmailButton()).toBeEnabled());
    expect(screen.queryByText(TEXT.saveFirst)).not.toBeInTheDocument();
    expect(severitySelect()).toHaveTextContent("high");
  });

  it("[CT-20] 심각도를 건드리지 않고 저장해도 본문에 notifyMinSeverity(저장된 값)를 항상 넣는다", async () => {
    const server = setupServer({ settings: { ...settingsDefault, notifyMinSeverity: "critical" } });
    const { user } = await renderSettings();

    const interval = screen.getByLabelText(UI.interval);
    await user.clear(interval);
    await user.type(interval, "6");
    await user.click(saveButton());

    await findToast(TEXT.saved);
    // 스키마로 parse 하기 전의 본문이다
    expect(server.last("PUT", SETTINGS)?.body).toHaveProperty("notifyMinSeverity", "critical");
    await waitFor(() => expect(testEmailButton()).toBeEnabled());
    expect(severitySelect()).toHaveTextContent("critical");
  });
});

describe("설정 v2 — 임계값 경고", () => {
  it("[CT-20] medium 활성 항목 2개 + high 선택 → '켜진 항목 2개는 …' 경고. 꺼진·만료된 항목은 세지 않는다", async () => {
    const server = setupServer();
    const { user } = await renderSettings();
    await waitFor(() => expect(server.count("GET", BLACKLIST)).toBeGreaterThan(0));

    // 저장된 값 low: 이보다 낮은 항목이 없다
    await settle();
    expect(queryWarning()).not.toBeInTheDocument();

    // 저장하지 않아도 선택한 값으로 센다
    await chooseOption(user, severitySelect(), "high");
    expect(await screen.findByText(containing(TEXT.warning(2)))).toBeInTheDocument();
  });

  it("[CT-20] 기준을 medium 으로 고르면 활성 항목 중 그보다 낮은 것이 없어(N = 0) 경고를 표시하지 않는다", async () => {
    const server = setupServer({ settings: { ...settingsDefault, notifyMinSeverity: "high" } });
    const { user } = await renderSettings();
    await waitFor(() => expect(server.count("GET", BLACKLIST)).toBeGreaterThan(0));
    expect(await screen.findByText(containing(TEXT.warning(2)))).toBeInTheDocument();

    // medium 보다 낮은 것은 꺼진 low, 꺼짐 + 만료 low 뿐이다 → 0개
    await chooseOption(user, severitySelect(), "medium");
    await waitFor(() => expect(queryWarning()).not.toBeInTheDocument());
  });

  it("[CT-20] 블랙리스트 조회 중에는 경고도 Skeleton 도 그리지 않고, 응답이 오면 경고를 표시한다", async () => {
    const pending = deferredReply();
    const server = setupServer({
      settings: { ...settingsDefault, notifyMinSeverity: "high" },
      blacklist: pending.reply,
    });
    await renderSettings();
    await waitFor(() => expect(server.count("GET", BLACKLIST)).toBeGreaterThan(0));

    await settle();
    expect(queryWarning()).not.toBeInTheDocument();
    expect(queryAllSkeletons()).toHaveLength(0);
    expect(saveButton()).toBeInTheDocument();

    await act(async () => pending.resolve(reply.json({ items: mixedEntries })));
    expect(await screen.findByText(containing(TEXT.warning(2)))).toBeInTheDocument();
  });

  it("[CT-20] 블랙리스트 조회가 실패하면 경고도 오류 문구도 그리지 않는다 (설정 폼은 그대로)", async () => {
    const server = setupServer({
      settings: { ...settingsDefault, notifyMinSeverity: "high" },
      blacklist: reply.error(apiErrorOf("INTERNAL_ERROR", "예상하지 못한 오류")),
    });
    await renderSettings();
    // 재시도(1회)까지 끝난 뒤
    await waitFor(() => expect(server.count("GET", BLACKLIST)).toBeGreaterThan(1));
    await settle();

    expect(queryWarning()).not.toBeInTheDocument();
    expect(screen.queryByText(TEXT.loadError)).not.toBeInTheDocument();
    expect(queryAllSkeletons()).toHaveLength(0);
    expect(severitySelect()).toHaveTextContent("high");
    expect(saveButton()).toBeInTheDocument();
  });
});
