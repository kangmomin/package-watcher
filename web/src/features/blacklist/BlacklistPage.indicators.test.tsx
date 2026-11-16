// 묶음 C: 침해의 흔적 종류 path·content·branch — 그룹, 라벨, 버전 범위 숨김, 안내, 표시.
import { ECOSYSTEM_RULES, type BlacklistEntry, type Finding } from "@pw/shared";
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
import { chooseOption, containing, findRowWith, findToast } from "@/test/ui";

const BLACKLIST = "/api/blacklist";
const FINDINGS = "/api/findings";

const pathEntry: BlacklistEntry = {
  ...blacklistEntryPattern,
  id: 71,
  ecosystem: "path",
  name: ".ci-*.sh",
  versionRange: null,
  reason: "path 항목",
};
const created: BlacklistEntry = { ...blacklistEntryPattern, id: 81, name: "x-created" };

function setupServer(): FetchMock {
  return setupFetchMock()
    .on("GET", BLACKLIST, reply.json({ items: [...blacklistEntries, pathEntry] }))
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
    reason: within(dialog).getByRole("textbox", { name: /^사유/ }),
    save: within(dialog).getByRole("button", { name: "저장" }),
  };
}

type Dlg = Awaited<ReturnType<typeof openAddDialog>>;
const rangeOf = (d: Dlg) => within(d.dialog).queryByRole("textbox", { name: /^버전 범위/ });

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

describe("침해의 흔적 — 종류 select", () => {
  it("[SC-50] 추가 Dialog: 패키지 → CI·이미지 → 침해의 흔적 그룹 순서", async () => {
    setupServer();
    const { user } = await renderBlacklist();
    const d = await openAddDialog(user);
    await user.click(d.ecosystem);
    const groups = groupsOf(await screen.findByRole("listbox"));
    expect(groups.map((g) => g.label)).toEqual(["패키지", "CI·이미지", "침해의 흔적"]);
    expect(groups[2]?.options).toEqual(["파일 경로", "파일 내용", "브랜치 이름"]);
  });

  it("[SC-51] 검출 필터에도 침해의 흔적 그룹이 있다", async () => {
    setupFetchMock()
      .on("GET", "/api/summary", reply.json(summaryDefault))
      .on("GET", FINDINGS, reply.json(pageOf(findingsPage.items, { total: 1, page: 1, limit: 50 })));
    const { user } = renderWithProviders(<DashboardPage />);
    await findRowWith("api");
    await user.click(screen.getByRole("combobox", { name: "종류" }));
    expect(groupsOf(await screen.findByRole("listbox")).map((g) => g.label)).toEqual([
      "패키지",
      "CI·이미지",
      "침해의 흔적",
    ]);
  });
});

describe("침해의 흔적 — 등록 Dialog", () => {
  it("[SC-52] path 를 고르면 버전 범위 입력이 DOM 에서 사라지고, npm 으로 돌아오면 빈 입력이 보인다", async () => {
    setupServer();
    const { user } = await renderBlacklist();
    const d = await openAddDialog(user);

    await user.type(rangeOf(d) as HTMLElement, "<1.0.0");
    await chooseOption(user, d.ecosystem, "파일 경로");
    await waitFor(() => expect(rangeOf(d)).toBeNull());
    expect(within(d.dialog).queryByText("버전 범위")).not.toBeInTheDocument();
    expect(d.dialog.querySelector('[aria-describedby*="range-hint"]')).toBeNull();

    await chooseOption(user, d.ecosystem, "npm");
    expect(await within(d.dialog).findByRole("textbox", { name: /^버전 범위/ })).toHaveValue("");
  });

  it("[SC-53] 종류별로 이름 라벨이 바뀐다", async () => {
    setupServer();
    const { user } = await renderBlacklist();
    const d = await openAddDialog(user);

    expect(within(d.dialog).getByRole("textbox", { name: /^이름/ })).toBeInTheDocument();
    for (const [label, name] of [
      ["파일 경로", "파일 경로 또는 패턴"],
      ["파일 내용", "찾을 문자열"],
      ["브랜치 이름", "브랜치 이름 또는 패턴"],
    ] as const) {
      await chooseOption(user, d.ecosystem, label);
      const input = await within(d.dialog).findByRole("textbox", { name: new RegExp(`^${name}`) });
      expect(input.id).not.toBe("");
    }
    await chooseOption(user, d.ecosystem, "npm");
    expect(await within(d.dialog).findByRole("textbox", { name: /^이름/ })).toBeInTheDocument();
  });

  it("[SC-54] 종류별 안내와 예시", async () => {
    setupServer();
    const { user } = await renderBlacklist();
    const d = await openAddDialog(user);

    const cases = [
      ["파일 경로", "path", "파일 경로 또는 패턴", "가 없으면 파일 이름과도 비교합니다"],
      ["파일 내용", "content", "찾을 문자열", "글자 그대로 찾습니다(대소문자 무시)"],
      ["브랜치 이름", "branch", "브랜치 이름 또는 패턴", "브랜치 목록을 받습니다"],
    ] as const;
    for (const [label, eco, field, note] of cases) {
      await chooseOption(user, d.ecosystem, label);
      const input = await within(d.dialog).findByRole("textbox", { name: new RegExp(`^${field}`) });
      await waitFor(() => expect(input).toHaveAccessibleDescription(containing(note)));
      expect(input).toHaveAccessibleDescription(containing(`예: ${ECOSYSTEM_RULES[eco].nameExample}`));
    }
    // 패키지 종류로 돌아가면 흔적 안내가 사라진다.
    await chooseOption(user, d.ecosystem, "npm");
    const npmName = await within(d.dialog).findByRole("textbox", { name: /^이름/ });
    await waitFor(() => expect(npmName).not.toHaveAccessibleDescription(containing("브랜치 목록")));
  });

  it("[SC-55] npm 에서 범위를 입력한 뒤 path 로 바꾸면 본문의 versionRange 는 null", async () => {
    const server = setupServer().on("POST", BLACKLIST, reply.json(created, 201));
    const { user } = await renderBlacklist();
    const d = await openAddDialog(user);

    await user.type(rangeOf(d) as HTMLElement, "<1.0.0");
    await chooseOption(user, d.ecosystem, "파일 경로");
    await user.type(await within(d.dialog).findByRole("textbox", { name: /^파일 경로 또는 패턴/ }), ".ci-*.sh");
    await user.type(d.reason, "사유");
    await user.click(d.save);
    await findToast("항목을 추가했습니다");
    expect(server.last("POST", BLACKLIST)?.body).toMatchObject({
      ecosystem: "path",
      name: ".ci-*.sh",
      versionRange: null,
    });
  });

  it("[SC-56] 범위 오류가 표시된 뒤 path 로 바꾸면 범위 오류가 남지 않고, 제출된다", async () => {
    const server = setupServer().on("POST", BLACKLIST, reply.json(created, 201));
    const { user } = await renderBlacklist();
    const d = await openAddDialog(user);

    await user.type(within(d.dialog).getByRole("textbox", { name: /^이름/ }), "lodash");
    await user.type(rangeOf(d) as HTMLElement, ">>1");
    await user.type(d.reason, "사유");
    await user.click(d.save);
    await waitFor(() => expect(rangeOf(d)).toHaveAttribute("aria-invalid", "true"));

    await chooseOption(user, d.ecosystem, "파일 경로");
    await waitFor(() => expect(rangeOf(d)).toBeNull());
    expect(within(d.dialog).queryByRole("alert")).toBeNull();
    await user.click(d.save);
    await findToast("항목을 추가했습니다");
    expect(server.last("POST", BLACKLIST)?.body).toMatchObject({ ecosystem: "path", versionRange: null });
  });

  it("[SC-57] content 의 6자 미만 문자열은 이름 오류, POST 하지 않는다", async () => {
    const server = setupServer();
    const { user } = await renderBlacklist();
    const d = await openAddDialog(user);

    await chooseOption(user, d.ecosystem, "파일 내용");
    await user.type(await within(d.dialog).findByRole("textbox", { name: /^찾을 문자열/ }), "abc");
    await user.type(d.reason, "사유");
    await user.click(d.save);
    await waitFor(() =>
      expect(within(d.dialog).getByRole("textbox", { name: /^찾을 문자열/ })).toHaveAttribute("aria-invalid", "true"),
    );
    expect(server.count("POST", BLACKLIST)).toBe(0);
  });
});

describe("침해의 흔적 — 수정 Dialog와 표", () => {
  it("[SC-58] path 항목의 수정 Dialog: 종류 고정, 범위 입력 없음, 경로 라벨", async () => {
    setupServer();
    const { user } = await renderBlacklist();
    const row = await findRowWith(".ci-*.sh");
    await user.click(within(row).getByRole("button", { name: "수정" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: /^종류/ })).toHaveTextContent("파일 경로");
    expect(within(dialog).queryByRole("textbox", { name: /^버전 범위/ })).toBeNull();
    expect(within(dialog).getByRole("textbox", { name: /^파일 경로 또는 패턴/ })).toHaveValue(".ci-*.sh");
  });

  it("[SC-59] 표: path 행의 버전 범위 칸은 — 이고 (모든 버전)이 아니다. 종류 열은 새 라벨", async () => {
    setupServer();
    await renderBlacklist();
    const row = await findRowWith(".ci-*.sh");
    expect(within(row).getByText("파일 경로")).toBeInTheDocument();
    expect(within(row).getByText("—")).toBeInTheDocument();
    expect(within(row).queryByText("(모든 버전)")).not.toBeInTheDocument();
  });

  it("[SC-60] 검출 표: version 이 빈 문자열이면 — 를 표시하고, refs/heads 경로도 그대로 표시한다", async () => {
    const finding: Finding = {
      ...(findingsPage.items[0] as Finding),
      id: 902,
      ecosystem: "branch",
      packageName: "wfx-docs",
      version: "",
      filePath: "refs/heads/wfx-docs",
    };
    setupFetchMock()
      .on("GET", "/api/summary", reply.json(summaryDefault))
      .on("GET", FINDINGS, reply.json(pageOf([finding], { total: 1, page: 1, limit: 50 })));
    renderWithProviders(<DashboardPage />);
    const row = await findRowWith("wfx-docs@");
    expect(within(row).getByText("브랜치 이름")).toBeInTheDocument();
    expect(within(row).getByText("refs/heads/wfx-docs")).toBeInTheDocument();
  });
});
