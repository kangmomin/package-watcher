// 묶음 G: 새 종류(패키지 3, CI 3, 흔적 2) — 종류 select, 이름 라벨·안내, 범위 입력, 필터·외부 목록.
import { ECOSYSTEM_RULES, ECOSYSTEMS, POLICY_CHECKS, categoryOf, type BlacklistEntry } from "@pw/shared";
import {
  blacklistEntries,
  blacklistEntryPattern,
  emptyFindingsPage,
  settingsDefault,
  summaryDefault,
} from "@pw/shared/fixtures";
import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BlacklistPage } from "@/features/blacklist/BlacklistPage";
import { FeedPage } from "@/features/feed/FeedPage";
import { ecosystemLabel, policyCheckTitle } from "@/lib/format";
import { reply, setupFetchMock, type FetchMock } from "@/test/fetchMock";
import { renderWithProviders } from "@/test/render";
import { chooseOption, containing, findRowWith } from "@/test/ui";

const BLACKLIST = "/api/blacklist";
const PACKAGE_LABELS = ["npm", "go", "pypi", "nuget", "cargo", "pub", "maven", "RubyGems", "Composer", "CocoaPods"];
const CI_LABELS = ["GitHub Actions", "Docker 이미지", "VS Code 확장", "Helm chart", "Terraform module"];
const INDICATOR_LABELS = ["파일 경로", "파일 내용", "브랜치 이름", "커밋 메시지", "PR 제목"];
const RANGE_NOTE = "범위가 아니라 정확한 값을 쉼표로 나눠 적습니다";
const COMMIT_HINT =
  "글자 그대로 찾습니다(대소문자 무시). 최근에 push된 repo의 기본 브랜치의 최근 커밋에서만 찾습니다.";
const PR_HINT =
  "글자 그대로 찾습니다(대소문자 무시). 최근에 push된 repo의 최근 PR 50개의 제목에서만 찾습니다.";

const commitEntry: BlacklistEntry = {
  ...blacklistEntryPattern,
  id: 71,
  ecosystem: "commit",
  name: "malicious-marker",
  versionRange: null,
  reason: "commit 항목",
};

function setupServer(): FetchMock {
  return setupFetchMock()
    .on("GET", BLACKLIST, reply.json({ items: [...blacklistEntries, commitEntry] }))
    .on("GET", "/api/findings", reply.json(emptyFindingsPage))
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
  return { dialog, ecosystem: within(dialog).getByRole("combobox", { name: /^종류/ }) };
}

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

describe("새 종류 — 라벨과 종류 select", () => {
  it("[SG-50] 모든 종류에 라벨이 있고 새 8개의 표기는 정해진 대로다", () => {
    for (const ecosystem of ECOSYSTEMS) expect(ecosystemLabel(ecosystem)).toBeTruthy();
    expect(ecosystemLabel("rubygems")).toBe("RubyGems");
    expect(ecosystemLabel("composer")).toBe("Composer");
    expect(ecosystemLabel("cocoapods")).toBe("CocoaPods");
    expect(ecosystemLabel("vscode")).toBe("VS Code 확장");
    expect(ecosystemLabel("helm")).toBe("Helm chart");
    expect(ecosystemLabel("terraform")).toBe("Terraform module");
    expect(ecosystemLabel("commit")).toBe("커밋 메시지");
    expect(ecosystemLabel("pr")).toBe("PR 제목");
  });

  it("[SG-51] 추가 Dialog의 종류 select: 3개 그룹, 새 종류가 분류 순서대로 나온다", async () => {
    setupServer();
    const { user } = await renderBlacklist();
    const d = await openAddDialog(user);
    await user.click(d.ecosystem);
    expect(groupsOf(await screen.findByRole("listbox"))).toEqual([
      { label: "패키지", options: PACKAGE_LABELS },
      { label: "CI·이미지", options: CI_LABELS },
      { label: "침해의 흔적", options: INDICATOR_LABELS },
    ]);
  });

  it("[SG-52] 블랙리스트 필터의 종류 select에도 새 종류가 나오고 commit을 고르면 ecosystem=commit으로 요청한다", async () => {
    const server = setupServer();
    const { user } = await renderBlacklist();
    const filter = screen.getByRole("combobox", { name: "종류" });
    await user.click(filter);
    const listbox = await screen.findByRole("listbox");
    expect(groupsOf(listbox).slice(0, 3)).toEqual([
      { label: "패키지", options: PACKAGE_LABELS },
      { label: "CI·이미지", options: CI_LABELS },
      { label: "침해의 흔적", options: INDICATOR_LABELS },
    ]);
    await user.click(within(listbox).getByRole("option", { name: "커밋 메시지" }));
    await waitFor(() => expect(server.last("GET", BLACKLIST)?.query).toMatchObject({ ecosystem: "commit" }));
  });

  it("[SG-53] 외부 목록 검색의 종류 select: 패키지·CI 그룹에 새 종류가 나오고 흔적은 없다", async () => {
    setupFetchMock().on("GET", "/api/feed", reply.json({ items: [], total: 0, page: 1, limit: 50 }));
    const { user } = renderWithProviders(<FeedPage />, { route: "/feed" });
    const filter = await screen.findByRole("combobox", { name: "종류" });
    await user.click(filter);
    expect(groupsOf(await screen.findByRole("listbox"))).toEqual([
      { label: "패키지", options: PACKAGE_LABELS },
      { label: "CI·이미지", options: CI_LABELS },
    ]);
  });

  it("[SG-54] 표의 종류 열이 commit 라벨을 쓴다", async () => {
    setupServer();
    await renderBlacklist();
    expect(within(await findRowWith("malicious-marker")).getByText("커밋 메시지")).toBeInTheDocument();
  });
});

describe("새 종류 — 등록 Dialog", () => {
  it("[SG-55] commit: 이름 라벨·안내가 흔적 UI이고 범위 입력이 없다", async () => {
    setupServer();
    const { user } = await renderBlacklist();
    const d = await openAddDialog(user);
    await chooseOption(user, d.ecosystem, "커밋 메시지");
    const name = await within(d.dialog).findByRole("textbox", { name: /^커밋 메시지에서 찾을 문자열/ });
    expect(name).toHaveAccessibleDescription(containing(COMMIT_HINT));
    expect(name).toHaveAccessibleDescription(containing(`예: ${ECOSYSTEM_RULES.commit.nameExample}`));
    expect(within(d.dialog).queryByRole("textbox", { name: /^버전 범위/ })).toBeNull();
  });

  it("[SG-56] pr: 이름 라벨·안내가 흔적 UI이고 범위 입력이 없다", async () => {
    setupServer();
    const { user } = await renderBlacklist();
    const d = await openAddDialog(user);
    await chooseOption(user, d.ecosystem, "PR 제목");
    const name = await within(d.dialog).findByRole("textbox", { name: /^PR 제목에서 찾을 문자열/ });
    expect(name).toHaveAccessibleDescription(containing(PR_HINT));
    expect(within(d.dialog).queryByRole("textbox", { name: /^버전 범위/ })).toBeNull();
  });

  it("[SG-57] commit으로 등록하면 versionRange: null, ecosystem: commit으로 보낸다", async () => {
    const server = setupServer().on("POST", BLACKLIST, reply.json({ ...commitEntry, id: 72 }, 201));
    const { user } = await renderBlacklist();
    const d = await openAddDialog(user);
    await chooseOption(user, d.ecosystem, "커밋 메시지");
    await user.type(await within(d.dialog).findByRole("textbox", { name: /^커밋 메시지에서/ }), "evil-marker");
    await user.type(within(d.dialog).getByRole("textbox", { name: /^사유/ }), "사유");
    await user.click(within(d.dialog).getByRole("button", { name: "저장" }));
    await waitFor(() => expect(server.count("POST", BLACKLIST)).toBe(1));
    expect(server.last("POST", BLACKLIST)?.body).toMatchObject({
      ecosystem: "commit",
      name: "evil-marker",
      versionRange: null,
    });
  });

  it.each([
    ["VS Code 확장", "vscode"],
    ["Helm chart", "helm"],
    ["Terraform module", "terraform"],
  ] as const)("[SG-58] %s: ci 분류의 정확한 값 안내와 범위 예시가 나온다", async (label, ecosystem) => {
    expect(categoryOf(ecosystem)).toBe("ci");
    setupServer();
    const { user } = await renderBlacklist();
    const d = await openAddDialog(user);
    await chooseOption(user, d.ecosystem, label);
    const range = await within(d.dialog).findByRole("textbox", { name: /^버전 범위/ });
    await waitFor(() => expect(range).toHaveAccessibleDescription(containing(RANGE_NOTE)));
    expect(range).toHaveAccessibleDescription(containing(`예: ${ECOSYSTEM_RULES[ecosystem].rangeExample}`));
  });

  it("[SG-59] 수정 Dialog: commit 항목은 종류가 비활성이고 흔적 UI를 따르며 범위 입력이 없다", async () => {
    setupServer();
    const { user } = await renderBlacklist();
    const row = await findRowWith("malicious-marker");
    await user.click(within(row).getByRole("button", { name: "수정" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: /^종류/ })).toHaveTextContent("커밋 메시지");
    expect(within(dialog).getByRole("textbox", { name: /^커밋 메시지에서/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox", { name: /^버전 범위/ })).toBeNull();
  });
});

describe("새 내장 검사", () => {
  it("[SG-60] 내장 검사 16개 모두 title이 표시 이름이 된다", () => {
    expect(POLICY_CHECKS).toHaveLength(16);
    for (const check of POLICY_CHECKS) expect(policyCheckTitle(check.id)).toBe(check.title);
    for (const id of [
      "workflow-changed",
      "new-committer",
      "install-script",
      "lock-external-source",
      "custom-registry",
      "npmrc-token",
      "external-submodule",
    ]) {
      expect(policyCheckTitle(id)).not.toBe(id);
    }
  });
});
