// 묶음 B: 새 종류 actions·docker — 종류 select 그룹, 라벨, 안내 문구, 검증, 표시.
import { ECOSYSTEM_RULES, blacklistCreateSchema, type BlacklistEntry, type Finding } from "@pw/shared";
import {
  blacklistEntries,
  blacklistEntryPattern,
  emptyFindingsPage,
  findingsPage,
  pageOf,
  settingsDefault,
  summaryDefault,
} from "@pw/shared/fixtures";
import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BlacklistPage } from "@/features/blacklist/BlacklistPage";
import { DashboardPage } from "@/features/findings/DashboardPage";
import { reply, setupFetchMock, type FetchMock } from "@/test/fetchMock";
import { renderWithProviders } from "@/test/render";
import { chooseOption, containing, expectFieldError, findRowWith, findToast } from "@/test/ui";

const BLACKLIST = "/api/blacklist";
const FINDINGS = "/api/findings";
const PACKAGE_LABELS = ["npm", "go", "pypi", "nuget", "cargo", "pub", "maven"];
const CI_LABELS = ["GitHub Actions", "Docker 이미지"];
const INDICATOR_LABELS = ["파일 경로", "파일 내용", "브랜치 이름"];
const GROUPS = [
  { label: "패키지", options: PACKAGE_LABELS },
  { label: "CI·이미지", options: CI_LABELS },
  { label: "침해의 흔적", options: INDICATOR_LABELS },
];
const RANGE_NOTE = "범위가 아니라 정확한 값을 쉼표로 나눠 적습니다";

const actionsEntry: BlacklistEntry = {
  ...blacklistEntryPattern,
  id: 51,
  ecosystem: "actions",
  name: "aquasecurity/trivy-action",
  versionRange: "v0.34.0, v0.34.1",
  reason: "actions 항목",
};
const dockerEntry: BlacklistEntry = {
  ...blacklistEntryPattern,
  id: 52,
  ecosystem: "docker",
  name: "ghcr.io/berriai/litellm",
  versionRange: null,
  reason: "docker 항목",
};
const created: BlacklistEntry = { ...blacklistEntryPattern, id: 61, name: "x-created" };

function setupServer(): FetchMock {
  return setupFetchMock()
    .on("GET", BLACKLIST, reply.json({ items: [...blacklistEntries, actionsEntry, dockerEntry] }))
    .on("GET", FINDINGS, reply.json(emptyFindingsPage))
    .on("GET", "/api/summary", reply.json(summaryDefault))
    .on("GET", "/api/settings", reply.json(settingsDefault));
}

async function renderBlacklist() {
  const result = renderWithProviders(<BlacklistPage />, { route: "/blacklist" });
  await findRowWith("lodash");
  return result;
}

async function openAddDialog(user: UserEvent) {
  await user.click(screen.getByRole("button", { name: "항목 추가" }));
  const dialog = await screen.findByRole("dialog");
  return {
    dialog,
    ecosystem: within(dialog).getByRole("combobox", { name: /^종류/ }),
    name: within(dialog).getByRole("textbox", { name: /^이름/ }),
    range: within(dialog).getByRole("textbox", { name: /^버전 범위/ }),
    reason: within(dialog).getByRole("textbox", { name: /^사유/ }),
    save: within(dialog).getByRole("button", { name: "저장" }),
  };
}

async function fill(user: UserEvent, d: Awaited<ReturnType<typeof openAddDialog>>, name: string, range?: string) {
  await user.type(d.name, name);
  if (range) await user.type(d.range, range);
  await user.type(d.reason, "테스트 사유");
  await user.click(d.save);
}

function schemaMessage(ecosystem: string, field: "name" | "versionRange", name: string, versionRange: string) {
  const result = blacklistCreateSchema.safeParse({ ecosystem, name, versionRange, reason: "r" });
  if (result.success) throw new Error("검증이 실패해야 합니다");
  const issue = result.error.issues.find((item) => item.path[0] === field);
  if (!issue) throw new Error(`${field} 오류가 없습니다`);
  return issue.message;
}

/** listbox 안의 그룹: 라벨(aria-labelledby) → 옵션 텍스트 */
function groupsOf(listbox: HTMLElement) {
  return within(listbox)
    .getAllByRole("group")
    .map((group) => ({
      label: document.getElementById(group.getAttribute("aria-labelledby") ?? "")?.textContent?.trim(),
      options: within(group)
        .getAllByRole("option")
        .map((option) => option.textContent?.trim()),
    }));
}

describe("새 종류 — 종류 select 그룹", () => {
  it("[SB-50] 추가 Dialog: 패키지 그룹(7개) → CI·이미지 그룹(GitHub Actions, Docker 이미지)", async () => {
    setupServer();
    const { user } = await renderBlacklist();
    const dialog = await openAddDialog(user);

    await user.click(dialog.ecosystem);
    expect(groupsOf(await screen.findByRole("listbox"))).toEqual(GROUPS);
  });

  it("[SB-51] 블랙리스트 필터: 전체는 그룹 밖 맨 위, 그 아래 두 그룹. Docker 이미지를 고르면 ecosystem=docker 로 요청한다", async () => {
    const server = setupServer();
    const { user } = await renderBlacklist();

    const filter = screen.getByRole("combobox", { name: "종류" });
    await user.click(filter);
    const listbox = await screen.findByRole("listbox");
    const all = within(listbox).getAllByRole("option");
    expect(all[0]).toHaveTextContent("전체");
    expect(all[0]?.closest('[role="group"]')).toBeNull();
    // 블랙리스트 필터에는 위험한 설정 그룹이 더 있다.
    expect(groupsOf(listbox)).toEqual([...GROUPS, { label: "위험한 설정", options: ["위험한 설정"] }]);
    await user.click(within(listbox).getByRole("option", { name: "Docker 이미지" }));
    await waitFor(() => expect(server.last("GET", BLACKLIST)?.query).toMatchObject({ ecosystem: "docker" }));
    expect(filter).toHaveTextContent("Docker 이미지");
  });

  it("[SB-52] 검출 필터: 전체 + 두 그룹. GitHub Actions 를 고르면 ecosystem=actions 로 요청한다", async () => {
    const server = setupFetchMock()
      .on("GET", "/api/summary", reply.json(summaryDefault))
      .on("GET", FINDINGS, reply.json(pageOf(findingsPage.items, { total: 1, page: 1, limit: 50 })));
    const { user } = renderWithProviders(<DashboardPage />);
    await findRowWith("api");

    const filter = screen.getByRole("combobox", { name: "종류" });
    await user.click(filter);
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option")[0]).toHaveTextContent("전체");
    expect(groupsOf(listbox)).toEqual(GROUPS);
    await user.click(within(listbox).getByRole("option", { name: "GitHub Actions" }));
    await waitFor(() => expect(server.last("GET", FINDINGS)?.query).toMatchObject({ ecosystem: "actions" }));
  });
});

describe("새 종류 — 등록 Dialog 안내와 검증", () => {
  it("[SB-53] actions 를 고르면 nameExample·rangeExample 과 정확한 값 안내를 보이고, 패키지 종류로 돌아가면 안내가 사라진다", async () => {
    setupServer();
    const { user } = await renderBlacklist();
    const d = await openAddDialog(user);

    expect(within(d.dialog).queryByText(RANGE_NOTE)).not.toBeInTheDocument();
    await chooseOption(user, d.ecosystem, "GitHub Actions");
    await waitFor(() =>
      expect(d.range).toHaveAccessibleDescription(containing(`예: ${ECOSYSTEM_RULES.actions.rangeExample}`)),
    );
    expect(d.range).toHaveAccessibleDescription(containing(RANGE_NOTE));
    expect(d.name).toHaveAccessibleDescription(containing(`예: ${ECOSYSTEM_RULES.actions.nameExample}`));

    await chooseOption(user, d.ecosystem, "Docker 이미지");
    await waitFor(() =>
      expect(d.name).toHaveAccessibleDescription(containing(`예: ${ECOSYSTEM_RULES.docker.nameExample}`)),
    );
    expect(d.range).toHaveAccessibleDescription(containing(RANGE_NOTE));

    await chooseOption(user, d.ecosystem, "npm");
    await waitFor(() => expect(within(d.dialog).queryByText(RANGE_NOTE)).not.toBeInTheDocument());
  });

  it("[SB-54] actions + 슬래시 없는 이름은 이름 오류, POST 하지 않는다", async () => {
    const server = setupServer();
    const { user } = await renderBlacklist();
    const d = await openAddDialog(user);

    await chooseOption(user, d.ecosystem, "GitHub Actions");
    await fill(user, d, "trivy-action");
    await expectFieldError(d.name, schemaMessage("actions", "name", "trivy-action", ""));
    expect(server.count("POST", BLACKLIST)).toBe(0);
  });

  it("[SB-55] docker + 태그가 붙은 이름(node:18)은 이름 오류", async () => {
    const server = setupServer();
    const { user } = await renderBlacklist();
    const d = await openAddDialog(user);

    await chooseOption(user, d.ecosystem, "Docker 이미지");
    await fill(user, d, "node:18");
    await expectFieldError(d.name, schemaMessage("docker", "name", "node:18", ""));
    expect(server.count("POST", BLACKLIST)).toBe(0);
  });

  it("[SB-56] actions + 범위 >=1.0 은 범위 오류", async () => {
    const server = setupServer();
    const { user } = await renderBlacklist();
    const d = await openAddDialog(user);

    await chooseOption(user, d.ecosystem, "GitHub Actions");
    await fill(user, d, "aquasecurity/trivy-action", ">=1.0");
    await expectFieldError(d.range, schemaMessage("actions", "versionRange", "aquasecurity/trivy-action", ">=1.0"));
    expect(server.count("POST", BLACKLIST)).toBe(0);
  });

  it("[SB-57] 올바른 actions 값은 본문에 ecosystem: actions 로 보낸다", async () => {
    const server = setupServer().on("POST", BLACKLIST, reply.json(created, 201));
    const { user } = await renderBlacklist();
    const d = await openAddDialog(user);

    await chooseOption(user, d.ecosystem, "GitHub Actions");
    await fill(user, d, "aquasecurity/trivy-action", "v0.34.0, v0.34.1");
    await findToast("항목을 추가했습니다");
    expect(server.last("POST", BLACKLIST)?.body).toMatchObject({
      ecosystem: "actions",
      name: "aquasecurity/trivy-action",
    });
  });

  it("[SB-58] 올바른 docker 값은 본문에 ecosystem: docker 로 보낸다", async () => {
    const server = setupServer().on("POST", BLACKLIST, reply.json(created, 201));
    const { user } = await renderBlacklist();
    const d = await openAddDialog(user);

    await chooseOption(user, d.ecosystem, "Docker 이미지");
    await fill(user, d, "ghcr.io/berriai/litellm", "1.82.7");
    await findToast("항목을 추가했습니다");
    expect(server.last("POST", BLACKLIST)?.body).toMatchObject({
      ecosystem: "docker",
      name: "ghcr.io/berriai/litellm",
    });
  });

  it("[SB-59] 수정 Dialog: 종류 select 는 비활성이고 새 라벨과 정확한 값 안내를 보인다", async () => {
    setupServer();
    const { user } = await renderBlacklist();
    const row = await findRowWith("aquasecurity/trivy-action");
    await user.click(within(row).getByRole("button", { name: "수정" }));
    const dialog = await screen.findByRole("dialog");
    const ecosystem = within(dialog).getByRole("combobox", { name: /^종류/ });
    expect(ecosystem).toBeDisabled();
    expect(ecosystem).toHaveTextContent("GitHub Actions");
    expect(within(dialog).getByRole("textbox", { name: /^버전 범위/ })).toHaveAccessibleDescription(
      containing(RANGE_NOTE),
    );
  });
});

describe("새 종류 — 표의 표시", () => {
  it("[SB-60] 블랙리스트 표의 종류 열이 새 라벨을 쓴다", async () => {
    setupServer();
    await renderBlacklist();
    expect(within(await findRowWith("aquasecurity/trivy-action")).getByText("GitHub Actions")).toBeInTheDocument();
    expect(within(await findRowWith("ghcr.io/berriai/litellm")).getByText("Docker 이미지")).toBeInTheDocument();
  });

  it("[SB-61] 검출 표의 종류 열이 새 라벨을 쓰고 이름은 그대로 표시한다", async () => {
    const finding: Finding = {
      ...findingsPage.items[0] as Finding,
      id: 901,
      ecosystem: "actions",
      packageName: "aquasecurity/trivy-action",
      version: "v0.34.1",
    };
    setupFetchMock()
      .on("GET", "/api/summary", reply.json(summaryDefault))
      .on("GET", FINDINGS, reply.json(pageOf([finding], { total: 1, page: 1, limit: 50 })));
    renderWithProviders(<DashboardPage />);
    const row = await findRowWith("aquasecurity/trivy-action@v0.34.1");
    expect(within(row).getByText("GitHub Actions")).toBeInTheDocument();
  });
});

describe("새 종류 — 종류 전환과 필터", () => {
  /** 그 종류의 스키마가 내는 오류 문구. 통과하면 undefined. */
  function messageOrNone(ecosystem: string, field: "name" | "versionRange", name: string, versionRange: string) {
    const result = blacklistCreateSchema.safeParse({ ecosystem, name, versionRange, reason: "r" });
    return result.success ? undefined : result.error.issues.find((item) => item.path[0] === field)?.message;
  }

  it("[SB-62] npm 의 범위 오류는 종류를 actions 로 바꾸면 actions 규칙에 맞는 결과로 바뀐다", async () => {
    setupServer();
    const { user } = await renderBlacklist();
    const d = await openAddDialog(user);

    const range = ">>1";
    const npmMessage = schemaMessage("npm", "versionRange", "lodash", range);
    await fill(user, d, "lodash", range);
    await expectFieldError(d.range, npmMessage);

    await chooseOption(user, d.ecosystem, "GitHub Actions");
    const after = messageOrNone("actions", "versionRange", "lodash", range);
    await waitFor(() => {
      if (after) expect(d.range).toHaveAccessibleDescription(containing(after));
      else expect(d.range).not.toHaveAccessibleDescription(containing(npmMessage));
    });
    expect(within(d.dialog).queryByText(npmMessage)).not.toBeInTheDocument();
  });

  it("[SB-62] docker 의 이름 오류(node:18)는 종류를 npm 으로 바꾸면 npm 규칙에 맞는 결과로 바뀐다", async () => {
    setupServer();
    const { user } = await renderBlacklist();
    const d = await openAddDialog(user);

    await chooseOption(user, d.ecosystem, "Docker 이미지");
    const dockerMessage = schemaMessage("docker", "name", "node:18", "");
    await fill(user, d, "node:18");
    await expectFieldError(d.name, dockerMessage);

    await chooseOption(user, d.ecosystem, "npm");
    const after = messageOrNone("npm", "name", "node:18", "");
    await waitFor(() => {
      if (after) expect(d.name).toHaveAccessibleDescription(containing(after));
      else expect(within(d.dialog).queryByText(dockerMessage)).not.toBeInTheDocument();
    });
    expect(within(d.dialog).queryByText(dockerMessage)).not.toBeInTheDocument();
  });

  it("[SB-63] 필터에서 docker 를 고르면 내보내기 링크(JSON·CSV)에 ecosystem=docker 가 붙는다", async () => {
    setupServer();
    const { user } = await renderBlacklist();

    await chooseOption(user, screen.getByRole("combobox", { name: "종류" }), "Docker 이미지");
    await user.click(await screen.findByRole("button", { name: /내보내기/ }));
    for (const format of ["JSON", "CSV"]) {
      const href = (await screen.findByRole("menuitem", { name: format })).getAttribute("href") ?? "";
      expect(new URL(href, "http://localhost").searchParams.get("ecosystem")).toBe("docker");
    }
  });

  it("[SB-64] 검출 필터에서 actions 를 고르면 select 트리거에 GitHub Actions 가 표시된다", async () => {
    setupFetchMock()
      .on("GET", "/api/summary", reply.json(summaryDefault))
      .on("GET", FINDINGS, reply.json(pageOf(findingsPage.items, { total: 1, page: 1, limit: 50 })));
    const { user } = renderWithProviders(<DashboardPage />);
    await findRowWith("api");

    const filter = screen.getByRole("combobox", { name: "종류" });
    await chooseOption(user, filter, "GitHub Actions");
    await waitFor(() => expect(filter).toHaveTextContent("GitHub Actions"));
  });
});
