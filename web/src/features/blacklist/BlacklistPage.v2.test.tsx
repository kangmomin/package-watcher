// v2(묶음 1/3) 블랙리스트 화면: 표의 새 열 4개, Dialog 의 새 필드 4개, 안내 문구, PUT 무효화.
// 근거: Integration Contract v2.2 의 UI State Contract, CT-16·CT-19 의 FE 부분.
import {
  blacklistCreateSchema,
  kstDateOf,
  SEVERITIES,
  SUPPORTED_ECOSYSTEMS,
  type ApiError,
  type BlacklistEntry,
  type Settings,
} from "@pw/shared";
import {
  apiErrorOf,
  blacklistEntries,
  blacklistEntryAllVersions,
  blacklistEntryDisabled,
  blacklistEntryDisabledExpired,
  blacklistEntryExpired,
  blacklistEntryPattern,
  blacklistEntryVariants,
  emptyFindingsPage,
  settingsDefault,
  summaryDefault,
} from "@pw/shared/fixtures";
import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BlacklistPage } from "@/features/blacklist/BlacklistPage";
import { DashboardPage } from "@/features/findings/DashboardPage";
import { reply, setupFetchMock, type FetchMock, type ReplyFactory } from "@/test/fetchMock";
import { renderWithProviders } from "@/test/render";
import {
  chooseOption,
  containing,
  expectFieldError,
  expectNoToast,
  findRowWith,
  findToast,
  getRowWith,
  settle,
} from "@/test/ui";

// ---- 테스트가 정한 UI 이름 (Plan 의 필드 이름을 label 로 쓴다. 필수 표시(*)는 뒤에 붙어도 된다)
const UI = {
  add: "항목 추가",
  edit: "수정",
  save: "저장",
  nameField: /^이름/,
  rangeField: /^버전 범위/,
  reasonField: /^사유/,
  ecosystemField: /^종류/,
  severityField: /^심각도/,
  expiresAtField: /^만료일/,
  enabledField: /^켜기/,
} as const;

// ---- 계약 문구 (UI State Contract v2.2)
const TEXT = {
  added: "항목을 추가했습니다",
  updated: "항목을 수정했습니다",
  serverError: "서버 오류가 발생했습니다",
  statusActive: "켬",
  statusDisabled: "끔",
  statusExpired: "만료",
  noExpiry: "-",
  /** 이름 아래 안내. `*` 는 code 요소로 감쌀 수 있으므로 뒷부분으로 찾는다 */
  patternHint: "로 패턴을 쓸 수 있습니다",
  enabledHint: "끄면 이 항목의 검출(무시 포함)이 resolved로 바뀌고, 다시 켜면 다음 스캔에서 새로 검출됩니다",
  expiredHint: "만료되어 검사에서 제외됩니다. 만료일을 바꾸거나 비우면 다음 스캔부터 다시 검사합니다",
  duplicateKey: "종류·이름·버전 범위",
  severityHint: (threshold: string) => `현재 즉시 알림 기준(${threshold})보다 낮아 일일 요약에만 포함됩니다`,
  severityHintAny: "보다 낮아 일일 요약에만 포함됩니다",
} as const;

const BLACKLIST = "/api/blacklist";
const FINDINGS = "/api/findings";
const SUMMARY = "/api/summary";
const SETTINGS = "/api/settings";

/** 열 순서: 종류 | 이름 | 버전 범위 | 심각도 | 상태 | 만료일 | 사유 | 수정 | 삭제 */
const COLUMN = { ecosystem: 0, name: 1, range: 2, severity: 3, status: 4, expiresAt: 5, reason: 6 } as const;

const allEntries: BlacklistEntry[] = [...blacklistEntries, ...blacklistEntryVariants];
const settingsHigh: Settings = { ...settingsDefault, notifyMinSeverity: "high" };
const newEntry: BlacklistEntry = { ...blacklistEntryPattern, id: 21, name: "left-pad", reason: "테스트 사유" };

/** v1 setupServer 와 같은 요청 + 설정 조회(Dialog 의 심각도 안내가 쓴다). */
function setupServer({
  items = allEntries,
  settings = reply.json(settingsDefault),
}: { items?: BlacklistEntry[]; settings?: ReplyFactory } = {}): FetchMock {
  return setupFetchMock()
    .on("GET", BLACKLIST, reply.json({ items }))
    .on("GET", FINDINGS, reply.json(emptyFindingsPage))
    .on("GET", SUMMARY, reply.json(summaryDefault))
    .on("GET", SETTINGS, settings);
}

async function renderBlacklist({ withDashboard = false } = {}) {
  const result = renderWithProviders(
    <>
      <BlacklistPage />
      {withDashboard && <DashboardPage />}
    </>,
    { route: "/blacklist" },
  );
  await findRowWith("lodash");
  return result;
}

/** 행의 셀(행 헤더 포함)을 열 순서대로. */
function cellsOf(row: HTMLElement): HTMLElement[] {
  return Array.from(row.querySelectorAll<HTMLElement>("th, td"));
}

function cellOf(name: string, column: number): HTMLElement {
  const cell = cellsOf(getRowWith(name))[column];
  if (!cell) throw new Error(`"${name}" 행에 ${column}번 셀이 없습니다`);
  return cell;
}

/** 배지(shadcn Badge, `data-slot="badge"`)가 그 텍스트를 가진다 = 색 + 텍스트. */
function expectBadge(cell: HTMLElement, text: string) {
  expect(within(cell).getByText(text).closest('[data-slot="badge"]')).not.toBeNull();
}

function dialogFields(dialog: HTMLElement) {
  return {
    dialog,
    name: within(dialog).getByRole("textbox", { name: UI.nameField }),
    range: within(dialog).getByRole("textbox", { name: UI.rangeField }),
    reason: within(dialog).getByRole("textbox", { name: UI.reasonField }),
    ecosystem: within(dialog).getByRole("combobox", { name: UI.ecosystemField }),
    severity: within(dialog).getByRole("combobox", { name: UI.severityField }),
    expiresAt: within(dialog).getByLabelText(UI.expiresAtField),
    enabled: within(dialog).getByRole("checkbox", { name: UI.enabledField }),
    save: within(dialog).getByRole("button", { name: UI.save }),
  };
}

async function openAddDialog(user: UserEvent) {
  await user.click(screen.getByRole("button", { name: UI.add }));
  return dialogFields(await screen.findByRole("dialog"));
}

async function openEditDialog(user: UserEvent, name: string) {
  await user.click(within(getRowWith(name)).getByRole("button", { name: UI.edit }));
  return dialogFields(await screen.findByRole("dialog"));
}

async function waitForDialogClosed() {
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

function counts(server: FetchMock) {
  return {
    blacklist: server.count("GET", BLACKLIST),
    findings: server.count("GET", FINDINGS),
    summary: server.count("GET", SUMMARY),
  };
}

describe("블랙리스트 v2 — 표", () => {
  it("[CT-16] 표의 열 순서는 종류 | 이름 | 버전 범위 | 심각도 | 상태 | 만료일 | 사유 | 수정 | 삭제 다", async () => {
    setupServer();
    await renderBlacklist();

    const headers = within(screen.getByRole("table")).getAllByRole("columnheader");
    const texts = headers.map((header) => header.textContent?.trim() ?? "");
    expect(texts).toHaveLength(9);
    expect(texts[COLUMN.ecosystem]).toBe("종류");
    // v1 머리글은 "패키지 이름" 이다. "이름" 으로 끝나면 된다
    expect(texts[COLUMN.name]).toMatch(/이름$/);
    expect(texts.slice(2)).toEqual(["버전 범위", "심각도", "상태", "만료일", "사유", "수정", "삭제"]);
  });

  it("[CT-16][v2-AC-01] 행에 종류·심각도(배지, 영문 값 그대로)·만료일(YYYY-MM-DD 그대로, null = '-')을 표시한다", async () => {
    setupServer();
    await renderBlacklist();

    expect(cellOf("lodash", COLUMN.ecosystem)).toHaveTextContent(/^npm$/);
    expect(cellOf("lodash", COLUMN.severity)).toHaveTextContent(/^medium$/);
    expectBadge(cellOf("lodash", COLUMN.severity), "medium");
    expect(cellOf("lodash", COLUMN.expiresAt)).toHaveTextContent(new RegExp(`^${TEXT.noExpiry}$`));

    expectBadge(cellOf(blacklistEntryPattern.name, COLUMN.severity), "critical");
    expect(cellOf(blacklistEntryPattern.name, COLUMN.expiresAt)).toHaveTextContent(/^2027-12-31$/);
    expectBadge(cellOf(blacklistEntryExpired.name, COLUMN.severity), "high");
    expect(cellOf(blacklistEntryExpired.name, COLUMN.expiresAt)).toHaveTextContent(/^2026-11-01$/);
    expectBadge(cellOf(blacklistEntryDisabled.name, COLUMN.severity), "low");
  });

  it("[CT-19][v2-AC-04][v2-AC-05] 상태 열은 켬/끔/만료 배지이고, 꺼짐 + 만료는 '만료' 다", async () => {
    setupServer();
    await renderBlacklist();

    expectBadge(cellOf("lodash", COLUMN.status), TEXT.statusActive);
    expectBadge(cellOf(blacklistEntryPattern.name, COLUMN.status), TEXT.statusActive);
    expectBadge(cellOf(blacklistEntryDisabled.name, COLUMN.status), TEXT.statusDisabled);
    expectBadge(cellOf(blacklistEntryExpired.name, COLUMN.status), TEXT.statusExpired);

    // isExpired 가 true 면 enabled 와 관계없이 '만료'
    const staleStatus = cellOf(blacklistEntryDisabledExpired.name, COLUMN.status);
    expectBadge(staleStatus, TEXT.statusExpired);
    expect(within(staleStatus).queryByText(TEXT.statusDisabled)).not.toBeInTheDocument();
  });
});

describe("블랙리스트 v2 — 추가 Dialog", () => {
  it("[CT-16][v2-AC-01] 추가 Dialog 의 기본값: 종류 npm(활성, 옵션 7개), 심각도 medium, 켜기 체크, 만료일 빈 값", async () => {
    setupServer();
    const { user } = await renderBlacklist();

    const dialog = await openAddDialog(user);
    expect(dialog.ecosystem).toHaveTextContent("npm");
    expect(SUPPORTED_ECOSYSTEMS).toHaveLength(7);
    expect(dialog.ecosystem).toBeEnabled();
    expect(dialog.severity).toHaveTextContent("medium");
    expect(dialog.enabled).toBeChecked();
    expect(dialog.expiresAt).toHaveAttribute("type", "date");
    expect(dialog.expiresAt).toHaveValue("");
  });

  it("[CT-16] 심각도 select 의 옵션은 SEVERITIES 순서(critical → low)다", async () => {
    setupServer();
    const { user } = await renderBlacklist();

    const dialog = await openAddDialog(user);
    await user.click(dialog.severity);
    const options = within(await screen.findByRole("listbox")).getAllByRole("option");
    expect(options.map((option) => option.textContent?.trim())).toEqual([...SEVERITIES]);
  });

  it("[CT-16][v2-AC-01] 기본값 그대로 저장하면 요청의 원본 본문에 ecosystem·severity·enabled·expiresAt 키가 모두 있다", async () => {
    const server = setupServer().on("POST", BLACKLIST, reply.json(newEntry, 201));
    const { user } = await renderBlacklist();

    const dialog = await openAddDialog(user);
    // 종류를 고르지 않아도 기본값 npm 을 보낸다
    expect(dialog.ecosystem).toBeEnabled();
    await user.type(dialog.name, "left-pad");
    await user.type(dialog.reason, "테스트 사유");
    await user.click(dialog.save);

    await findToast(TEXT.added);
    // 스키마로 parse 하기 전의 본문이다 (스키마의 기본값에 기대지 않는다)
    const body = server.last("POST", BLACKLIST)?.body;
    expect(body).toHaveProperty("ecosystem", "npm");
    expect(body).toHaveProperty("severity", "medium");
    expect(body).toHaveProperty("enabled", true);
    expect(body).toHaveProperty("expiresAt");
    expect(blacklistCreateSchema.parse(body).expiresAt).toBeNull();
  });

  it("[CT-16][v2-AC-01] 심각도·켜기·만료일을 바꿔 저장하면 원본 본문에 그 값이 들어간다", async () => {
    const server = setupServer().on("POST", BLACKLIST, reply.json(newEntry, 201));
    const { user } = await renderBlacklist();

    const dialog = await openAddDialog(user);
    await user.type(dialog.name, "left-pad");
    await user.type(dialog.reason, "테스트 사유");
    await chooseOption(user, dialog.severity, "high");
    await user.click(dialog.enabled);
    expect(dialog.enabled).not.toBeChecked();
    await user.type(dialog.expiresAt, "2027-12-31");
    await user.click(dialog.save);

    await findToast(TEXT.added);
    await waitForDialogClosed();
    expect(server.last("POST", BLACKLIST)?.body).toMatchObject({
      name: "left-pad",
      reason: "테스트 사유",
      ecosystem: "npm",
      severity: "high",
      enabled: false,
      expiresAt: "2027-12-31",
    });
  });

  it("[CT-16][v2-AC-02] 패턴 이름(@evil/*)을 그대로 제출한다", async () => {
    const server = setupServer().on(
      "POST",
      BLACKLIST,
      reply.json({ ...newEntry, name: "@evil/*", reason: "악성 scope" }, 201),
    );
    const { user } = await renderBlacklist();

    await user.click(screen.getByRole("button", { name: UI.add }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: UI.nameField }), "@evil/*");
    await user.type(within(dialog).getByRole("textbox", { name: UI.reasonField }), "악성 scope");
    await user.click(within(dialog).getByRole("button", { name: UI.save }));

    await findToast(TEXT.added);
    expect(server.last("POST", BLACKLIST)?.body).toMatchObject({ name: "@evil/*", reason: "악성 scope" });
  });

  it("[CT-16][v2-EC-04][v2-EC-01] 서버 400 의 details.expiresAt·details.name 을 각 필드 아래에 표시하고 Dialog 를 유지한다", async () => {
    const error: ApiError = {
      error: {
        code: "VALIDATION_ERROR",
        message: "입력값을 확인하십시오",
        details: { expiresAt: "만료일은 오늘 이후여야 합니다", name: "패턴에는 영문자·숫자가 2자 이상 있어야 합니다" },
      },
    };
    const server = setupServer().on("POST", BLACKLIST, reply.error(error));
    const { user } = await renderBlacklist();

    const dialog = await openAddDialog(user);
    // 클라이언트 검증은 통과하는 값 → 오류 문구는 서버 details 에서 온다
    await user.type(dialog.name, "left-pad");
    await user.type(dialog.reason, "테스트 사유");
    await user.type(dialog.expiresAt, "2027-01-01");
    await user.click(dialog.save);

    await expectFieldError(dialog.expiresAt, error.error.details?.expiresAt ?? "");
    await expectFieldError(dialog.name, error.error.details?.name ?? "");
    expect(server.count("POST", BLACKLIST)).toBe(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(dialog.expiresAt).toHaveValue("2027-01-01");
    await expectNoToast();
  });

  it("[CT-16] 안내 문구: 이름 아래 패턴 안내, 켜기 아래 끄기 안내, Dialog 설명의 중복 기준은 '종류·이름·버전 범위' 다", async () => {
    setupServer();
    const { user } = await renderBlacklist();

    const { dialog } = await openAddDialog(user);
    expect(within(dialog).getByText(containing(TEXT.patternHint))).toBeInTheDocument();
    expect(within(dialog).getByText(containing(TEXT.enabledHint))).toBeInTheDocument();
    expect(within(dialog).getByText(containing(TEXT.duplicateKey))).toBeInTheDocument();
    // 만료된 항목을 수정할 때만 보이는 안내
    expect(within(dialog).queryByText(containing(TEXT.expiredHint))).not.toBeInTheDocument();
  });

  it("[CT-16] 만료일 입력의 min 은 KST 오늘이다 (힌트)", async () => {
    setupServer();
    const { user } = await renderBlacklist();

    const before = kstDateOf(new Date());
    const dialog = await openAddDialog(user);
    const after = kstDateOf(new Date());
    // 자정을 넘기는 순간에 실행돼도 둘 중 하나다
    expect([before, after]).toContain(dialog.expiresAt.getAttribute("min"));
  });
});

describe("블랙리스트 v2 — 심각도 안내 (즉시 알림 기준)", () => {
  it("[CT-16][v2-AC-06] 설정 notifyMinSeverity=high + 심각도 medium + 켜기 체크 → 안내 표시, critical 로 바꾸면 없음", async () => {
    setupServer({ settings: reply.json(settingsHigh) });
    const { user } = await renderBlacklist();

    const dialog = await openAddDialog(user);
    expect(dialog.severity).toHaveTextContent("medium");
    expect(await within(dialog.dialog).findByText(containing(TEXT.severityHint("high")))).toBeInTheDocument();

    await chooseOption(user, dialog.severity, "critical");
    await waitFor(() =>
      expect(within(dialog.dialog).queryByText(containing(TEXT.severityHintAny))).not.toBeInTheDocument(),
    );

    // 기준과 같은 값(high)도 낮지 않다
    await chooseOption(user, dialog.severity, "high");
    expect(within(dialog.dialog).queryByText(containing(TEXT.severityHintAny))).not.toBeInTheDocument();

    await chooseOption(user, dialog.severity, "low");
    expect(await within(dialog.dialog).findByText(containing(TEXT.severityHint("high")))).toBeInTheDocument();
  });

  it("[CT-16] 켜기를 해제하면 심각도 안내를 표시하지 않는다", async () => {
    setupServer({ settings: reply.json(settingsHigh) });
    const { user } = await renderBlacklist();

    const dialog = await openAddDialog(user);
    expect(await within(dialog.dialog).findByText(containing(TEXT.severityHint("high")))).toBeInTheDocument();

    await user.click(dialog.enabled);
    await waitFor(() =>
      expect(within(dialog.dialog).queryByText(containing(TEXT.severityHintAny))).not.toBeInTheDocument(),
    );
  });

  it("[CT-16] 설정 조회가 실패하면 심각도 안내를 표시하지 않는다", async () => {
    const server = setupServer({
      settings: reply.error(apiErrorOf("INTERNAL_ERROR", "예상하지 못한 오류")),
    });
    const { user } = await renderBlacklist();

    const dialog = await openAddDialog(user);
    expect(dialog.severity).toHaveTextContent("medium");
    expect(dialog.enabled).toBeChecked();
    // Dialog 가 설정을 조회했고(재시도 포함) 실패가 확정된 뒤에도 안내가 없다
    await waitFor(() => expect(server.count("GET", SETTINGS)).toBeGreaterThan(0));
    await settle();
    expect(within(dialog.dialog).queryByText(containing(TEXT.severityHintAny))).not.toBeInTheDocument();
    // 설정 조회 실패는 Dialog 의 오류가 아니다
    expect(within(dialog.dialog).queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("블랙리스트 v2 — 수정 Dialog", () => {
  it("[CT-16] 수정 Dialog 는 저장된 값으로 열린다 (종류·심각도·켜기·만료일)", async () => {
    setupServer();
    const { user } = await renderBlacklist();

    const pattern = await openEditDialog(user, blacklistEntryPattern.name);
    expect(pattern.name).toHaveValue("@typosquat/*");
    expect(pattern.ecosystem).toHaveTextContent("npm");
    expect(pattern.severity).toHaveTextContent("critical");
    expect(pattern.enabled).toBeChecked();
    expect(pattern.expiresAt).toHaveValue("2027-12-31");
    await user.keyboard("{Escape}");
    await waitForDialogClosed();

    const disabled = await openEditDialog(user, blacklistEntryDisabled.name);
    expect(disabled.severity).toHaveTextContent("low");
    expect(disabled.enabled).not.toBeChecked();
    expect(disabled.expiresAt).toHaveValue("");
  });

  it("[CT-16] 수정 요청(PUT)의 원본 본문에 새 키 4개가 저장된 값으로 들어간다", async () => {
    const path = `/api/blacklist/${blacklistEntryPattern.id}`;
    const server = setupServer().on("PUT", path, reply.json({ ...blacklistEntryPattern, reason: "새 사유" }));
    const { user } = await renderBlacklist();

    const dialog = await openEditDialog(user, blacklistEntryPattern.name);
    await user.clear(dialog.reason);
    await user.type(dialog.reason, "새 사유");
    await user.click(dialog.save);

    await findToast(TEXT.updated);
    const body = server.last("PUT", path)?.body;
    expect(body).toHaveProperty("versionRange");
    expect(body).toMatchObject({
      name: "@typosquat/*",
      reason: "새 사유",
      ecosystem: "npm",
      severity: "critical",
      enabled: true,
      expiresAt: "2027-12-31",
    });
  });

  it("[CT-19][v2-AC-04] 수정 Dialog 에서 켜기를 해제해 저장하면 PUT 본문이 enabled: false 다", async () => {
    const server = setupServer().on("PUT", "/api/blacklist/2", reply.json({ ...blacklistEntryAllVersions, enabled: false }));
    const { user } = await renderBlacklist();

    const dialog = await openEditDialog(user, "evil-pkg");
    await user.click(dialog.enabled);
    await user.click(dialog.save);

    await findToast(TEXT.updated);
    expect(server.last("PUT", "/api/blacklist/2")?.body).toMatchObject({ name: "evil-pkg", enabled: false });
  });

  it("[CT-16][v2-AC-05] 만료된 항목의 수정 Dialog 는 만료일 아래에 만료 안내를 표시하고 min 을 주지 않는다", async () => {
    setupServer();
    const { user } = await renderBlacklist();

    const expired = await openEditDialog(user, blacklistEntryExpired.name);
    expect(expired.expiresAt).toHaveValue("2026-11-01");
    expect(within(expired.dialog).getByText(containing(TEXT.expiredHint))).toBeInTheDocument();
    // 저장된 값이 이미 과거면 min 이 값을 무효로 만들지 않게 생략한다
    expect(expired.expiresAt).not.toHaveAttribute("min");
    await user.keyboard("{Escape}");
    await waitForDialogClosed();

    // 만료되지 않은 항목에는 안내가 없다
    const active = await openEditDialog(user, blacklistEntryPattern.name);
    expect(within(active.dialog).queryByText(containing(TEXT.expiredHint))).not.toBeInTheDocument();
  });

  it("[CT-19] PUT 성공 → blacklist·findings 에 더해 summary 도 재조회한다 (끄면 검출이 resolved 가 된다)", async () => {
    const server = setupServer().on("PUT", "/api/blacklist/2", reply.json({ ...blacklistEntryAllVersions, reason: "새 사유" }));
    const { user } = await renderBlacklist({ withDashboard: true });
    await waitFor(() => {
      expect(server.count("GET", FINDINGS)).toBeGreaterThan(0);
      expect(server.count("GET", SUMMARY)).toBeGreaterThan(0);
    });
    const before = counts(server);

    await user.click(within(getRowWith("evil-pkg")).getByRole("button", { name: UI.edit }));
    const dialog = await screen.findByRole("dialog");
    const reason = within(dialog).getByRole("textbox", { name: UI.reasonField });
    await user.clear(reason);
    await user.type(reason, "새 사유");
    await user.click(within(dialog).getByRole("button", { name: UI.save }));

    await findToast(TEXT.updated);
    await waitFor(() => {
      expect(server.count("GET", BLACKLIST)).toBeGreaterThan(before.blacklist);
      expect(server.count("GET", FINDINGS)).toBeGreaterThan(before.findings);
      expect(server.count("GET", SUMMARY)).toBeGreaterThan(before.summary);
    });
  });

  it("[CT-19] PUT 의 결과를 알 수 없는 오류(INTERNAL_ERROR)도 blacklist·findings·summary 를 무효화한다", async () => {
    const server = setupServer().on(
      "PUT",
      "/api/blacklist/2",
      reply.error(apiErrorOf("INTERNAL_ERROR", "예상하지 못한 오류")),
    );
    const { user } = await renderBlacklist({ withDashboard: true });
    await waitFor(() => {
      expect(server.count("GET", FINDINGS)).toBeGreaterThan(0);
      expect(server.count("GET", SUMMARY)).toBeGreaterThan(0);
    });
    const before = counts(server);

    await user.click(within(getRowWith("evil-pkg")).getByRole("button", { name: UI.edit }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: UI.reasonField }), " 추가");
    await user.click(within(dialog).getByRole("button", { name: UI.save }));

    await findToast(TEXT.serverError);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await waitFor(() => {
      expect(server.count("GET", BLACKLIST)).toBeGreaterThan(before.blacklist);
      expect(server.count("GET", FINDINGS)).toBeGreaterThan(before.findings);
      expect(server.count("GET", SUMMARY)).toBeGreaterThan(before.summary);
    });
  });
});
