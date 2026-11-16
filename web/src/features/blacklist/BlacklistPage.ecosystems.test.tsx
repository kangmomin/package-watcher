// 여러 종류(ecosystem) 지원: 종류 select, 문법·이름 예시, 종류별 검증 오류, 수정 Dialog 의 종류 고정.
import {
  blacklistCreateSchema,
  ECOSYSTEM_RULES,
  SUPPORTED_ECOSYSTEMS,
  type ApiError,
  type BlacklistEntry,
} from "@pw/shared";
import {
  blacklistEntries,
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
import { reply, setupFetchMock, type FetchMock } from "@/test/fetchMock";
import { ecosystemLabel } from "@/lib/format";
import { renderWithProviders } from "@/test/render";
import { chooseOption, containing, expectFieldError, findRowWith, findToast, getRowWith } from "@/test/ui";

const BLACKLIST = "/api/blacklist";
const UI = {
  add: "항목 추가",
  edit: "수정",
  save: "저장",
  nameField: /^이름/,
  rangeField: /^버전 범위/,
  reasonField: /^사유/,
  ecosystemField: /^종류/,
} as const;
const TEXT = {
  added: "항목을 추가했습니다",
  updated: "항목을 수정했습니다",
  immutable: "종류는 바꿀 수 없습니다. 새 항목으로 등록하십시오",
  normalize: "저장할 때 이름을 소문자 표준 형태로 바꿉니다",
  patternHint: "로 패턴을 쓸 수 있습니다",
} as const;

const goEntry: BlacklistEntry = {
  ...blacklistEntryPattern,
  id: 31,
  ecosystem: "go",
  name: "github.com/evil/mod",
  versionRange: "<v0.4.30",
  reason: "go 항목",
};
const allEntries: BlacklistEntry[] = [...blacklistEntries, ...blacklistEntryVariants, goEntry];
const created: BlacklistEntry = { ...blacklistEntryPattern, id: 41, name: "x-created" };

function setupServer(): FetchMock {
  return setupFetchMock()
    .on("GET", BLACKLIST, reply.json({ items: allEntries }))
    .on("GET", "/api/findings", reply.json(emptyFindingsPage))
    .on("GET", "/api/summary", reply.json(summaryDefault))
    .on("GET", "/api/settings", reply.json(settingsDefault));
}

async function renderBlacklist() {
  const result = renderWithProviders(<BlacklistPage />, { route: "/blacklist" });
  await findRowWith("lodash");
  return result;
}

function dialogFields(dialog: HTMLElement) {
  return {
    dialog,
    name: within(dialog).getByRole("textbox", { name: UI.nameField }),
    range: within(dialog).getByRole("textbox", { name: UI.rangeField }),
    reason: within(dialog).getByRole("textbox", { name: UI.reasonField }),
    ecosystem: within(dialog).getByRole("combobox", { name: UI.ecosystemField }),
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

/** user-event 는 `[` 와 `{` 를 키 이름의 시작으로 읽는다. 문자 그대로 입력한다. */
async function typeLiteral(user: UserEvent, element: HTMLElement, text: string) {
  await user.type(element, text.replace(/[[{]/g, "$&$&"));
}

async function fillAndSave(
  user: UserEvent,
  dialog: ReturnType<typeof dialogFields>,
  values: { name: string; range?: string },
) {
  await typeLiteral(user, dialog.name, values.name);
  if (values.range) await typeLiteral(user, dialog.range, values.range);
  await user.type(dialog.reason, "테스트 사유");
  await user.click(dialog.save);
}

/** 그 종류·입력에 대해 shared 스키마가 내는 오류 문구. */
function schemaMessage(ecosystem: string, field: "name" | "versionRange", name: string, versionRange: string) {
  const result = blacklistCreateSchema.safeParse({ ecosystem, name, versionRange, reason: "r" });
  if (result.success) throw new Error("검증이 실패해야 하는 입력입니다");
  const issue = result.error.issues.find((item) => item.path[0] === field);
  if (!issue) throw new Error(`${field} 오류가 없습니다`);
  return issue.message;
}

describe("블랙리스트 종류 — 종류 select", () => {
  it("[ME-20] 추가 Dialog 의 종류 select 는 활성이고 옵션은 SUPPORTED_ECOSYSTEMS 순서의 12개이며 기본값은 npm 이다", async () => {
    setupServer();
    const { user } = await renderBlacklist();

    const dialog = await openAddDialog(user);
    expect(SUPPORTED_ECOSYSTEMS).toHaveLength(12);
    expect(dialog.ecosystem).toBeEnabled();
    expect(dialog.ecosystem).toHaveTextContent("npm");
    await user.click(dialog.ecosystem);
    const options = within(await screen.findByRole("listbox")).getAllByRole("option");
    expect(options.map((option) => option.textContent?.trim())).toEqual(SUPPORTED_ECOSYSTEMS.map(ecosystemLabel));
  });

  it("[ME-20][v2-AC-10] go 를 골라 저장하면 요청 본문에 ecosystem 과 입력한 이름·범위가 들어간다", async () => {
    const server = setupServer().on("POST", BLACKLIST, reply.json(created, 201));
    const { user } = await renderBlacklist();

    const dialog = await openAddDialog(user);
    await chooseOption(user, dialog.ecosystem, "go");
    await fillAndSave(user, dialog, { name: "github.com/evil/mod", range: "<v0.4.30" });

    await findToast(TEXT.added);
    expect(server.last("POST", BLACKLIST)?.body).toMatchObject({
      ecosystem: "go",
      name: "github.com/evil/mod",
      versionRange: "<v0.4.30",
    });
  });

  it("[ME-20][v2-AC-10] pypi 는 이름을 정규화한 값(Foo_Bar → foo-bar)을 본문에 보낸다", async () => {
    const server = setupServer().on("POST", BLACKLIST, reply.json(created, 201));
    const { user } = await renderBlacklist();

    const dialog = await openAddDialog(user);
    await chooseOption(user, dialog.ecosystem, "pypi");
    await fillAndSave(user, dialog, { name: "Foo_Bar", range: "<1.0" });

    await findToast(TEXT.added);
    expect(server.last("POST", BLACKLIST)?.body).toMatchObject({ ecosystem: "pypi", name: "foo-bar" });
  });

  it("[ME-20][v2-AC-10] maven 은 com.evil:lib 과 [1.0,2.0) 으로 저장한다", async () => {
    const server = setupServer().on("POST", BLACKLIST, reply.json(created, 201));
    const { user } = await renderBlacklist();

    const dialog = await openAddDialog(user);
    await chooseOption(user, dialog.ecosystem, "maven");
    await fillAndSave(user, dialog, { name: "com.evil:lib", range: "[1.0,2.0)" });

    await findToast(TEXT.added);
    expect(server.last("POST", BLACKLIST)?.body).toMatchObject({
      ecosystem: "maven",
      name: "com.evil:lib",
      versionRange: "[1.0,2.0)",
    });
  });
});

describe("블랙리스트 종류 — 문법·이름 예시", () => {
  it("[ME-21] 버전 범위 아래에 선택한 종류의 rangeExample 을 보이고 입력에 연결하며, 종류를 바꾸면 바뀐다", async () => {
    setupServer();
    const { user } = await renderBlacklist();

    const dialog = await openAddDialog(user);
    expect(dialog.range).toHaveAttribute("placeholder", "비우면 모든 버전");
    expect(dialog.range).toHaveAccessibleDescription(`예: ${ECOSYSTEM_RULES.npm.rangeExample}`);

    for (const ecosystem of ["go", "pypi", "nuget", "cargo", "pub", "maven"] as const) {
      await chooseOption(user, dialog.ecosystem, ecosystem);
      await waitFor(() =>
        expect(dialog.range).toHaveAccessibleDescription(`예: ${ECOSYSTEM_RULES[ecosystem].rangeExample}`),
      );
    }
  });

  it("[ME-21] 이름 아래에 패턴 안내와 선택한 종류의 nameExample 을 보이고 종류를 바꾸면 바뀐다", async () => {
    setupServer();
    const { user } = await renderBlacklist();

    const dialog = await openAddDialog(user);
    expect(within(dialog.dialog).getByText(containing(TEXT.patternHint))).toBeInTheDocument();
    expect(dialog.name).toHaveAccessibleDescription(containing(`예: ${ECOSYSTEM_RULES.npm.nameExample}`));

    await chooseOption(user, dialog.ecosystem, "go");
    await waitFor(() =>
      expect(dialog.name).toHaveAccessibleDescription(containing(`예: ${ECOSYSTEM_RULES.go.nameExample}`)),
    );
    expect(dialog.name).toHaveAccessibleDescription(containing(TEXT.patternHint));
  });

  it("[ME-21] pypi 와 nuget 에서만 이름 정규화 안내를 보인다", async () => {
    setupServer();
    const { user } = await renderBlacklist();

    const dialog = await openAddDialog(user);
    expect(within(dialog.dialog).queryByText(TEXT.normalize)).not.toBeInTheDocument();

    await chooseOption(user, dialog.ecosystem, "pypi");
    expect(await within(dialog.dialog).findByText(TEXT.normalize)).toBeInTheDocument();
    expect(dialog.name).toHaveAccessibleDescription(containing(TEXT.normalize));

    await chooseOption(user, dialog.ecosystem, "nuget");
    expect(within(dialog.dialog).getByText(TEXT.normalize)).toBeInTheDocument();

    await chooseOption(user, dialog.ecosystem, "cargo");
    await waitFor(() => expect(within(dialog.dialog).queryByText(TEXT.normalize)).not.toBeInTheDocument());
  });
});

describe("블랙리스트 종류 — 종류별 검증 오류", () => {
  it("[ME-22][v2-EC-02] pypi 에 [1.0,2.0) 범위를 넣으면 제출하지 않고 범위 아래에 오류를 보인다", async () => {
    const server = setupServer();
    const { user } = await renderBlacklist();

    const dialog = await openAddDialog(user);
    await chooseOption(user, dialog.ecosystem, "pypi");
    await fillAndSave(user, dialog, { name: "requests", range: "[1.0,2.0)" });

    await expectFieldError(dialog.range, schemaMessage("pypi", "versionRange", "requests", "[1.0,2.0)"));
    expect(server.count("POST", BLACKLIST)).toBe(0);
  });

  it("[ME-22][v2-EC-02] nuget 에 1.2.3 범위를 넣으면 범위 아래에 오류를 보인다", async () => {
    const server = setupServer();
    const { user } = await renderBlacklist();

    const dialog = await openAddDialog(user);
    await chooseOption(user, dialog.ecosystem, "nuget");
    await fillAndSave(user, dialog, { name: "Newtonsoft.Json", range: "1.2.3" });

    await expectFieldError(dialog.range, schemaMessage("nuget", "versionRange", "Newtonsoft.Json", "1.2.3"));
    expect(server.count("POST", BLACKLIST)).toBe(0);
  });

  it("[ME-22][v2-EC-02] go 에 npm 스코프 이름 @evil/a 를 넣으면 이름 아래에 오류를 보인다", async () => {
    const server = setupServer();
    const { user } = await renderBlacklist();

    const dialog = await openAddDialog(user);
    await chooseOption(user, dialog.ecosystem, "go");
    await fillAndSave(user, dialog, { name: "@evil/a" });

    await expectFieldError(dialog.name, schemaMessage("go", "name", "@evil/a", ""));
    expect(server.count("POST", BLACKLIST)).toBe(0);
  });

  it("[ME-22][v2-EC-02] npm 에서 유효한 <1.0.0 은 종류를 go 로 바꾼 뒤 제출하면 범위 아래에 오류를 보인다", async () => {
    const server = setupServer();
    const { user } = await renderBlacklist();

    const dialog = await openAddDialog(user);
    await chooseOption(user, dialog.ecosystem, "go");
    await fillAndSave(user, dialog, { name: "github.com/evil/mod", range: "<1.0.0" });

    await expectFieldError(dialog.range, schemaMessage("go", "versionRange", "github.com/evil/mod", "<1.0.0"));
    expect(server.count("POST", BLACKLIST)).toBe(0);
  });

  it("[ME-22] 오류가 표시된 상태에서 종류를 바꾸면 새 종류의 규칙으로 즉시 다시 검증한다", async () => {
    setupServer();
    const { user } = await renderBlacklist();

    const dialog = await openAddDialog(user);
    await chooseOption(user, dialog.ecosystem, "pypi");
    await fillAndSave(user, dialog, { name: "requests", range: "[1.0,2.0)" });
    await expectFieldError(dialog.range, schemaMessage("pypi", "versionRange", "requests", "[1.0,2.0)"));

    // 다른 문구로 바뀐다
    await chooseOption(user, dialog.ecosystem, "go");
    await expectFieldError(dialog.range, schemaMessage("go", "versionRange", "requests", "[1.0,2.0)"));

    // 새 종류에서 유효하면 사라진다
    await chooseOption(user, dialog.ecosystem, "nuget");
    await waitFor(() => expect(dialog.range).not.toHaveAttribute("aria-invalid"));
  });

  it("[ME-22] 이름 오류도 종류를 바꾸면 다시 검증한다", async () => {
    setupServer();
    const { user } = await renderBlacklist();

    const dialog = await openAddDialog(user);
    await chooseOption(user, dialog.ecosystem, "go");
    await fillAndSave(user, dialog, { name: "@evil/a" });
    await expectFieldError(dialog.name, schemaMessage("go", "name", "@evil/a", ""));

    await chooseOption(user, dialog.ecosystem, "npm");
    await waitFor(() => expect(dialog.name).not.toHaveAttribute("aria-invalid"));
  });
});

describe("블랙리스트 종류 — 수정 Dialog", () => {
  it("[ME-23] 수정 Dialog 의 종류 select 는 비활성이고 저장된 종류와 안내 문구를 보인다", async () => {
    setupServer();
    const { user } = await renderBlacklist();

    const dialog = await openEditDialog(user, goEntry.name);
    expect(dialog.ecosystem).toBeDisabled();
    expect(dialog.ecosystem).toHaveTextContent("go");
    expect(within(dialog.dialog).getByText(TEXT.immutable)).toBeInTheDocument();
    expect(dialog.ecosystem).toHaveAccessibleDescription(containing(TEXT.immutable));
    // 저장된 종류의 예시를 보인다
    expect(dialog.range).toHaveAccessibleDescription(`예: ${ECOSYSTEM_RULES.go.rangeExample}`);
  });

  it("[ME-20] 추가 Dialog 에는 종류 고정 안내가 없다", async () => {
    setupServer();
    const { user } = await renderBlacklist();

    const dialog = await openAddDialog(user);
    expect(within(dialog.dialog).queryByText(TEXT.immutable)).not.toBeInTheDocument();
  });

  it("[ME-23] 수정 요청(PUT)의 본문에 저장된 ecosystem 이 들어간다", async () => {
    const server = setupServer().on("PUT", `${BLACKLIST}/${goEntry.id}`, reply.json({ ...goEntry, reason: "새 사유" }));
    const { user } = await renderBlacklist();

    const dialog = await openEditDialog(user, goEntry.name);
    await user.clear(dialog.reason);
    await user.type(dialog.reason, "새 사유");
    await user.click(dialog.save);

    await findToast(TEXT.updated);
    expect(server.last("PUT", `${BLACKLIST}/${goEntry.id}`)?.body).toMatchObject({
      ecosystem: "go",
      name: goEntry.name,
      versionRange: goEntry.versionRange,
    });
  });

  it("[ME-23] 서버의 400 details.ecosystem 을 종류 필드 아래에 표시한다", async () => {
    const error: ApiError = {
      error: {
        code: "VALIDATION_ERROR",
        message: "입력값을 확인하십시오",
        details: { ecosystem: "종류는 바꿀 수 없습니다. 새 항목으로 등록하십시오" },
      },
    };
    setupServer().on("PUT", `${BLACKLIST}/${goEntry.id}`, reply.error(error));
    const { user } = await renderBlacklist();

    const dialog = await openEditDialog(user, goEntry.name);
    await user.click(dialog.save);

    await waitFor(() => expect(dialog.ecosystem).toHaveAttribute("aria-invalid", "true"));
    expect(dialog.ecosystem).toHaveAccessibleDescription(containing(error.error.details?.ecosystem ?? ""));
  });
});
