import { blacklistCreateSchema, blacklistUpdateSchema, type BlacklistEntry } from "@pw/shared";
import {
  apiErrorOf,
  apiErrorValidation,
  blacklistEntries,
  blacklistEntryAllVersions,
  emptyFindingsPage,
  summaryDefault,
} from "@pw/shared/fixtures";
import { act, screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BlacklistPage } from "@/features/blacklist/BlacklistPage";
import { DashboardPage } from "@/features/findings/DashboardPage";
import { deferredReply, reply, setupFetchMock, type FetchMock } from "@/test/fetchMock";
import { renderWithProviders } from "@/test/render";
import {
  expectFieldError,
  expectNoToast,
  findRowWith,
  findToast,
  getRowWith,
  queryAllSkeletons,
  schemaErrors,
} from "@/test/ui";

// ---- 테스트가 정한 UI 이름 (계약에 없음 — 구현은 이 접근 가능한 이름을 그대로 쓴다)
const UI = {
  /** 표 위 추가 버튼 (레이아웃 "[+ 항목 추가]") */
  add: "항목 추가",
  /** 행의 수정 아이콘 버튼 aria-label */
  edit: "수정",
  /** 행의 삭제 아이콘 버튼 aria-label, 삭제 확인 Dialog 의 확인 버튼 */
  remove: "삭제",
  /** Dialog 버튼 (레이아웃 "[취소][저장]") */
  save: "저장",
  cancel: "취소",
  /** Dialog 필드 label. 필수 표시(*)는 이름 뒤에 붙어도 된다 */
  nameField: /^이름/,
  rangeField: /^버전 범위/,
  reasonField: /^사유/,
} as const;

// ---- 계약 문구 (UI State Contract / Error Contract / 성공 toast)
const TEXT = {
  empty: "블랙리스트가 비어 있습니다",
  allVersions: "(모든 버전)",
  rangePlaceholder: "비우면 모든 버전",
  loadError: "데이터를 불러오지 못했습니다",
  retry: "다시 시도",
  added: "항목을 추가했습니다",
  updated: "항목을 수정했습니다",
  deleted: "항목을 삭제했습니다",
  serverError: "서버 오류가 발생했습니다",
  networkError: "서버에 연결할 수 없습니다",
} as const;

const BLACKLIST = "/api/blacklist";
const FINDINGS = "/api/findings";
const SUMMARY = "/api/summary";

const newEntry: BlacklistEntry = { ...blacklistEntryAllVersions, id: 3, name: "left-pad", reason: "테스트 사유" };

function setupServer(items: BlacklistEntry[] = blacklistEntries): FetchMock {
  return setupFetchMock()
    .on("GET", BLACKLIST, reply.json({ items }))
    .on("GET", FINDINGS, reply.json(emptyFindingsPage))
    .on("GET", SUMMARY, reply.json(summaryDefault));
}

/**
 * withDashboard: findings·summary 를 구독하는 대시보드를 함께 렌더해서
 * 블랙리스트 변경 뒤의 findings·summary 무효화를 실제 재요청으로 관찰한다.
 */
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

function counts(server: FetchMock) {
  return {
    blacklist: server.count("GET", BLACKLIST),
    findings: server.count("GET", FINDINGS),
    summary: server.count("GET", SUMMARY),
  };
}

function dialogFields(dialog: HTMLElement) {
  return {
    name: within(dialog).getByRole("textbox", { name: UI.nameField }),
    range: within(dialog).getByRole("textbox", { name: UI.rangeField }),
    reason: within(dialog).getByRole("textbox", { name: UI.reasonField }),
    save: within(dialog).getByRole("button", { name: UI.save }),
  };
}

async function openAddDialog(user: UserEvent) {
  await user.click(screen.getByRole("button", { name: UI.add }));
  const dialog = await screen.findByRole("dialog");
  return { dialog, ...dialogFields(dialog) };
}

async function openEditDialog(user: UserEvent, name: string) {
  await user.click(within(getRowWith(name)).getByRole("button", { name: UI.edit }));
  const dialog = await screen.findByRole("dialog");
  return { dialog, ...dialogFields(dialog) };
}

async function fillAndSave(
  user: UserEvent,
  fields: ReturnType<typeof dialogFields>,
  values: { name?: string; range?: string; reason?: string },
) {
  if (values.name) await user.type(fields.name, values.name);
  if (values.range) await user.type(fields.range, values.range);
  if (values.reason) await user.type(fields.reason, values.reason);
  await user.click(fields.save);
}

async function waitForDialogClosed(role: "dialog" | "alertdialog" = "dialog") {
  await waitFor(() => expect(screen.queryByRole(role)).not.toBeInTheDocument());
}

describe("블랙리스트 — 표", () => {
  it("[CT-05] 표에 이름·버전 범위·사유와 수정·삭제 버튼을 표시하고 null 범위는 '(모든 버전)' 으로 표시한다", async () => {
    setupServer();
    renderWithProviders(<BlacklistPage />, { route: "/blacklist" });

    const ranged = await findRowWith("lodash");
    expect(within(ranged).getByText("<4.17.21")).toBeInTheDocument();
    expect(within(ranged).getByText("취약점")).toBeInTheDocument();
    expect(within(ranged).getByRole("button", { name: UI.edit })).toBeInTheDocument();
    expect(within(ranged).getByRole("button", { name: UI.remove })).toBeInTheDocument();

    const allVersions = getRowWith("evil-pkg");
    expect(within(allVersions).getByText(TEXT.allVersions)).toBeInTheDocument();
    expect(within(allVersions).getByText("악성 코드")).toBeInTheDocument();
  });

  it("[CT-05] 항목이 0개면 '블랙리스트가 비어 있습니다' 를 표시한다", async () => {
    setupServer([]);
    renderWithProviders(<BlacklistPage />, { route: "/blacklist" });

    expect(await screen.findByText(TEXT.empty)).toBeInTheDocument();
  });

  it("[CT-05] 첫 로드 중에는 Skeleton 을 표시한다", async () => {
    const pending = deferredReply();
    setupFetchMock().on("GET", BLACKLIST, pending.reply);
    renderWithProviders(<BlacklistPage />, { route: "/blacklist" });

    await waitFor(() => expect(queryAllSkeletons().length).toBeGreaterThan(0));
    expect(screen.queryByText(TEXT.empty)).not.toBeInTheDocument();

    await act(async () => pending.resolve(reply.json({ items: blacklistEntries })));
    await findRowWith("lodash");
    expect(queryAllSkeletons()).toHaveLength(0);
  });

  it("[CT-05] 첫 로드 실패 시 '데이터를 불러오지 못했습니다' + [다시 시도] 를 표시하고 toast 는 띄우지 않는다", async () => {
    let fail = true;
    setupFetchMock().on("GET", BLACKLIST, (request) =>
      (fail ? reply.networkError() : reply.json({ items: blacklistEntries }))(request),
    );
    const { user } = renderWithProviders(<BlacklistPage />, { route: "/blacklist" });

    expect(await screen.findByText(TEXT.loadError)).toBeInTheDocument();
    await expectNoToast();

    fail = false;
    await user.click(screen.getByRole("button", { name: TEXT.retry }));
    await findRowWith("lodash");
  });
});

describe("블랙리스트 — 추가/수정 Dialog", () => {
  it("[CT-05][AC-09] [항목 추가] Dialog(이름*·버전 범위·사유*)로 POST /api/blacklist, 성공하면 닫고 toast + blacklist·findings 재조회", async () => {
    const server = setupServer().on("POST", BLACKLIST, reply.json(newEntry, 201));
    const { user } = await renderBlacklist({ withDashboard: true });
    await waitFor(() => expect(server.count("GET", FINDINGS)).toBeGreaterThan(0));
    const before = counts(server);

    const dialog = await openAddDialog(user);
    expect(dialog.range).toHaveAttribute("placeholder", TEXT.rangePlaceholder);
    await fillAndSave(user, dialog, { name: "left-pad", reason: "테스트 사유" });

    await findToast(TEXT.added);
    await waitForDialogClosed();
    // 서버가 같은 스키마로 읽었을 때의 값 (빈 버전 범위 = null = 모든 버전)
    expect(blacklistCreateSchema.parse(server.last("POST", BLACKLIST)?.body)).toEqual({
      name: "left-pad",
      versionRange: null,
      reason: "테스트 사유",
    });
    await waitFor(() => {
      expect(server.count("GET", BLACKLIST)).toBeGreaterThan(before.blacklist);
      expect(server.count("GET", FINDINGS)).toBeGreaterThan(before.findings);
    });
  });

  it("[CT-05] 저장에 성공하면 Dialog 를 reset 한다 (다시 열면 빈 입력)", async () => {
    setupServer().on("POST", BLACKLIST, reply.json(newEntry, 201));
    const { user } = await renderBlacklist();

    const first = await openAddDialog(user);
    await fillAndSave(user, first, { name: "left-pad", range: "^1.0.0", reason: "테스트 사유" });
    await findToast(TEXT.added);
    await waitForDialogClosed();

    const second = await openAddDialog(user);
    expect(second.name).toHaveValue("");
    expect(second.range).toHaveValue("");
    expect(second.reason).toHaveValue("");
  });

  it("[CT-05][EC-07] 제출 전 shared 스키마로 검증해서 각 필드 아래에 오류를 표시하고 요청하지 않는다", async () => {
    const server = setupServer();
    const { user } = await renderBlacklist();

    const dialog = await openAddDialog(user);
    await fillAndSave(user, dialog, { range: "not a range" });

    const expected = schemaErrors(blacklistCreateSchema, { name: "", versionRange: "not a range", reason: "" });
    await expectFieldError(dialog.name, expected.name ?? "");
    await expectFieldError(dialog.range, expected.versionRange ?? "");
    await expectFieldError(dialog.reason, expected.reason ?? "");
    expect(server.count("POST", BLACKLIST)).toBe(0);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("[CT-05][EC-07] 서버 400 VALIDATION_ERROR 의 details 키가 폼 필드면 그 필드 아래에 표시하고 Dialog·입력을 유지한다", async () => {
    const server = setupServer().on("POST", BLACKLIST, reply.error(apiErrorValidation));
    const { user } = await renderBlacklist();

    const dialog = await openAddDialog(user);
    // 클라이언트 검증은 통과하는 값 → 오류 문구는 서버 details 에서 온다
    await fillAndSave(user, dialog, { name: "lodash", range: "^1.0.0", reason: "취약점" });

    await expectFieldError(dialog.range, apiErrorValidation.error.details?.versionRange ?? "");
    expect(server.count("POST", BLACKLIST)).toBe(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(dialog.name).toHaveValue("lodash");
    expect(dialog.range).toHaveValue("^1.0.0");
    expect(dialog.reason).toHaveValue("취약점");
    await expectNoToast();
  });

  it("[CT-05] VALIDATION_ERROR 에 폼 필드 details 가 없으면 message 를 toast 로 표시하고 Dialog 를 유지한다", async () => {
    const error = apiErrorOf("VALIDATION_ERROR", "요청 본문을 확인하십시오");
    setupServer().on("POST", BLACKLIST, reply.error(error));
    const { user } = await renderBlacklist();

    const dialog = await openAddDialog(user);
    await fillAndSave(user, dialog, { name: "left-pad", reason: "테스트 사유" });

    await findToast(error.error.message);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(dialog.name).toHaveValue("left-pad");
  });

  it("[CT-05][EC-08] 409 DUPLICATE_ENTRY 는 Dialog 를 닫지 않고 이름 필드 아래에 message 를 표시한다 (toast 아님, A-9)", async () => {
    const error = apiErrorOf("DUPLICATE_ENTRY", "같은 이름과 버전 범위의 항목이 이미 있습니다");
    setupServer().on("POST", BLACKLIST, reply.error(error));
    const { user } = await renderBlacklist();

    const dialog = await openAddDialog(user);
    await fillAndSave(user, dialog, { name: "evil-pkg", reason: "중복" });

    await expectFieldError(dialog.name, error.error.message);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(dialog.name).toHaveValue("evil-pkg");
    expect(dialog.reason).toHaveValue("중복");
    await expectNoToast();
  });

  it("[CT-05] 추가 요청 중에는 [저장] 이 비활성이고 Dialog 를 닫을 수 없다", async () => {
    const pending = deferredReply();
    setupServer().on("POST", BLACKLIST, pending.reply);
    const { user } = await renderBlacklist();

    const dialog = await openAddDialog(user);
    await fillAndSave(user, dialog, { name: "left-pad", reason: "테스트 사유" });

    await waitFor(() => expect(dialog.save).toBeDisabled());
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // [취소] 가 있으면 눌러도 닫히지 않는다
    const cancel = within(dialog.dialog).queryByRole("button", { name: UI.cancel });
    if (cancel) await user.click(cancel);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await act(async () => pending.resolve(reply.json(newEntry, 201)));
    await waitForDialogClosed();
  });

  it("[CT-05] 수정 Dialog 는 기존 값으로 열리고(versionRange null → 빈 입력) PUT /api/blacklist/:id 로 versionRange 를 포함한 전체 값을 보낸다 (A-12)", async () => {
    const server = setupServer().on(
      "PUT",
      "/api/blacklist/2",
      reply.json({ ...blacklistEntryAllVersions, reason: "새 사유" }),
    );
    const { user } = await renderBlacklist({ withDashboard: true });
    await waitFor(() => expect(server.count("GET", FINDINGS)).toBeGreaterThan(0));

    const ranged = await openEditDialog(user, "lodash");
    expect(ranged.name).toHaveValue("lodash");
    expect(ranged.range).toHaveValue("<4.17.21");
    expect(ranged.reason).toHaveValue("취약점");
    await user.click(within(ranged.dialog).getByRole("button", { name: UI.cancel }));
    await waitForDialogClosed();

    const before = counts(server);
    const dialog = await openEditDialog(user, "evil-pkg");
    expect(dialog.name).toHaveValue("evil-pkg");
    expect(dialog.range).toHaveValue("");
    expect(dialog.reason).toHaveValue("악성 코드");

    await user.clear(dialog.reason);
    await user.type(dialog.reason, "새 사유");
    await user.click(dialog.save);

    await findToast(TEXT.updated);
    await waitForDialogClosed();
    const body = server.last("PUT", "/api/blacklist/2")?.body;
    expect(body).toHaveProperty("versionRange");
    expect(blacklistUpdateSchema.parse(body)).toEqual({ name: "evil-pkg", versionRange: null, reason: "새 사유" });
    await waitFor(() => {
      expect(server.count("GET", BLACKLIST)).toBeGreaterThan(before.blacklist);
      expect(server.count("GET", FINDINGS)).toBeGreaterThan(before.findings);
    });
  });

  it("[CT-05] 수정이 404 NOT_FOUND 면 Dialog 를 닫고 toast(message) + blacklist 재조회", async () => {
    const error = apiErrorOf("NOT_FOUND", "블랙리스트 항목을 찾을 수 없습니다");
    const server = setupServer().on("PUT", "/api/blacklist/2", reply.error(error));
    const { user } = await renderBlacklist();
    const before = counts(server);

    const dialog = await openEditDialog(user, "evil-pkg");
    await user.type(dialog.reason, " 추가");
    await user.click(dialog.save);

    await findToast(error.error.message);
    await waitForDialogClosed();
    await waitFor(() => expect(server.count("GET", BLACKLIST)).toBeGreaterThan(before.blacklist));
  });

  it.each([
    ["INTERNAL_ERROR", reply.error(apiErrorOf("INTERNAL_ERROR", "예상하지 못한 오류")), TEXT.serverError],
    ["NETWORK_ERROR", reply.networkError(), TEXT.networkError],
  ])(
    "[CT-05][CT-10] 추가 요청이 %s 로 끝나면 Dialog·입력을 유지하고 toast + 성공과 같은 키(blacklist·findings)를 무효화한다",
    async (_code, postReply, toastText) => {
      const server = setupServer().on("POST", BLACKLIST, postReply);
      const { user } = await renderBlacklist({ withDashboard: true });
      await waitFor(() => expect(server.count("GET", FINDINGS)).toBeGreaterThan(0));
      const before = counts(server);

      const dialog = await openAddDialog(user);
      await fillAndSave(user, dialog, { name: "left-pad", reason: "테스트 사유" });

      await findToast(toastText);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(dialog.name).toHaveValue("left-pad");
      expect(dialog.reason).toHaveValue("테스트 사유");
      await waitFor(() => {
        expect(server.count("GET", BLACKLIST)).toBeGreaterThan(before.blacklist);
        expect(server.count("GET", FINDINGS)).toBeGreaterThan(before.findings);
      });
    },
  );
});

describe("블랙리스트 — 삭제", () => {
  async function openDeleteConfirm(user: UserEvent, name: string) {
    await user.click(within(getRowWith(name)).getByRole("button", { name: UI.remove }));
    const confirm = await screen.findByRole("alertdialog");
    return { confirm, button: within(confirm).getByRole("button", { name: UI.remove }) };
  }

  it("[CT-13][EC-09] 삭제 확인 → DELETE /api/blacklist/:id, 성공하면 닫고 toast + blacklist·findings·summary 재조회", async () => {
    const server = setupServer().on("DELETE", "/api/blacklist/1", reply.noContent());
    const { user } = await renderBlacklist({ withDashboard: true });
    await waitFor(() => {
      expect(server.count("GET", FINDINGS)).toBeGreaterThan(0);
      expect(server.count("GET", SUMMARY)).toBeGreaterThan(0);
    });
    const before = counts(server);

    const { button } = await openDeleteConfirm(user, "lodash");
    await user.click(button);

    await findToast(TEXT.deleted);
    await waitForDialogClosed("alertdialog");
    expect(server.count("DELETE", "/api/blacklist/1")).toBe(1);
    await waitFor(() => {
      expect(server.count("GET", BLACKLIST)).toBeGreaterThan(before.blacklist);
      expect(server.count("GET", FINDINGS)).toBeGreaterThan(before.findings);
      expect(server.count("GET", SUMMARY)).toBeGreaterThan(before.summary);
    });
  });

  it("[CT-05] 삭제 요청 중에는 [삭제] 가 비활성이고 확인 Dialog 를 닫을 수 없다", async () => {
    const pending = deferredReply();
    setupServer().on("DELETE", "/api/blacklist/1", pending.reply);
    const { user } = await renderBlacklist();

    const { button } = await openDeleteConfirm(user, "lodash");
    await user.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    await user.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    await act(async () => pending.resolve(reply.noContent()));
    await waitForDialogClosed("alertdialog");
  });

  it("[CT-05] 삭제가 404 NOT_FOUND 면 확인 Dialog 를 닫고 toast(message) + blacklist 재조회", async () => {
    const error = apiErrorOf("NOT_FOUND", "블랙리스트 항목을 찾을 수 없습니다");
    const server = setupServer().on("DELETE", "/api/blacklist/1", reply.error(error));
    const { user } = await renderBlacklist();
    const before = counts(server);

    const { button } = await openDeleteConfirm(user, "lodash");
    await user.click(button);

    await findToast(error.error.message);
    await waitForDialogClosed("alertdialog");
    await waitFor(() => expect(server.count("GET", BLACKLIST)).toBeGreaterThan(before.blacklist));
  });

  it("[CT-05][CT-10] 삭제가 INTERNAL_ERROR 면 확인 Dialog 를 열어 두고 toast + 성공과 같은 키(blacklist·findings·summary)를 무효화한다", async () => {
    const server = setupServer().on(
      "DELETE",
      "/api/blacklist/1",
      reply.error(apiErrorOf("INTERNAL_ERROR", "예상하지 못한 오류")),
    );
    const { user } = await renderBlacklist({ withDashboard: true });
    await waitFor(() => {
      expect(server.count("GET", FINDINGS)).toBeGreaterThan(0);
      expect(server.count("GET", SUMMARY)).toBeGreaterThan(0);
    });
    const before = counts(server);

    const { button } = await openDeleteConfirm(user, "lodash");
    await user.click(button);

    await findToast(TEXT.serverError);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await waitFor(() => {
      expect(server.count("GET", BLACKLIST)).toBeGreaterThan(before.blacklist);
      expect(server.count("GET", FINDINGS)).toBeGreaterThan(before.findings);
      expect(server.count("GET", SUMMARY)).toBeGreaterThan(before.summary);
    });
  });
});
