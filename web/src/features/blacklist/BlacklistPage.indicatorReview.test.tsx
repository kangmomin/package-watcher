// 묶음 C 리뷰 보강: 수정 Dialog, 오류 정리, 삭제 문구, 긴 값, 접근성 텍스트.
import type { BlacklistEntry, Finding } from "@pw/shared";
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
import { describe, expect, it, vi } from "vitest";
import { BlacklistPage } from "@/features/blacklist/BlacklistPage";
import { DashboardPage } from "@/features/findings/DashboardPage";
import { reply, setupFetchMock, type FetchMock } from "@/test/fetchMock";
import { renderWithProviders } from "@/test/render";
import { advance, chooseOption, findRowWith, findToast } from "@/test/ui";

const BLACKLIST = "/api/blacklist";
const FINDINGS = "/api/findings";
const LONG = "abcdefghij".repeat(20);

const pathEntry: BlacklistEntry = {
  ...blacklistEntryPattern,
  id: 71,
  ecosystem: "path",
  name: ".ci-*.sh",
  versionRange: null,
  reason: "path 항목",
};

function setupServer(items: BlacklistEntry[] = [...blacklistEntries, pathEntry]): FetchMock {
  return setupFetchMock()
    .on("GET", BLACKLIST, reply.json({ items }))
    .on("GET", FINDINGS, reply.json(emptyFindingsPage))
    .on("GET", "/api/summary", reply.json(summaryDefault))
    .on("GET", "/api/settings", reply.json(settingsDefault));
}

async function renderBlacklist(waitFor_ = "lodash") {
  const result = renderWithProviders(<BlacklistPage />, { route: "/blacklist" });
  await findRowWith(waitFor_);
  return result;
}

async function openEdit(user: UserEvent, text: string) {
  const row = await findRowWith(text);
  await user.click(within(row).getByRole("button", { name: "수정" }));
  return screen.findByRole("dialog");
}

function renderFindings(finding: Finding) {
  setupFetchMock()
    .on("GET", "/api/summary", reply.json(summaryDefault))
    .on("GET", FINDINGS, reply.json(pageOf([finding], { total: 1, page: 1, limit: 50 })));
  return renderWithProviders(<DashboardPage />);
}

describe("침해의 흔적 — 리뷰 보강", () => {
  it("[SC-61] 흔적 항목을 수정해 저장하면 PUT 본문의 versionRange 는 null", async () => {
    const server = setupServer().on("PUT", `${BLACKLIST}/71`, reply.json(pathEntry));
    const { user } = await renderBlacklist();
    const dialog = await openEdit(user, ".ci-*.sh");
    await user.click(within(dialog).getByRole("button", { name: "저장" }));
    await findToast("항목을 수정했습니다");
    expect(server.last("PUT", `${BLACKLIST}/71`)?.body).toMatchObject({
      ecosystem: "path",
      versionRange: null,
    });
  });

  it("[SC-62] 흔적 항목을 열었다 닫고 npm 항목을 열면 범위 입력이 그 항목의 값이다", async () => {
    setupServer();
    const { user } = await renderBlacklist();
    const first = await openEdit(user, ".ci-*.sh");
    await user.click(within(first).getByRole("button", { name: "취소" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const second = await openEdit(user, "lodash");
    expect(within(second).getByRole("textbox", { name: /^버전 범위/ })).toHaveValue("<4.17.21");
  });

  it("[SC-63] npm(범위 오류) → path → npm 왕복 뒤 범위 입력에 오류가 없다", async () => {
    setupServer();
    const { user } = await renderBlacklist();
    await user.click(screen.getByRole("button", { name: "항목 추가" }));
    const dialog = await screen.findByRole("dialog");
    const ecosystem = within(dialog).getByRole("combobox", { name: /^종류/ });
    await user.type(within(dialog).getByRole("textbox", { name: /^이름/ }), "lodash");
    await user.type(within(dialog).getByRole("textbox", { name: /^버전 범위/ }), ">>1");
    await user.type(within(dialog).getByRole("textbox", { name: /^사유/ }), "사유");
    await user.click(within(dialog).getByRole("button", { name: "저장" }));
    await waitFor(() =>
      expect(within(dialog).getByRole("textbox", { name: /^버전 범위/ })).toHaveAttribute(
        "aria-invalid",
        "true",
      ),
    );
    const alertTexts = within(dialog)
      .queryAllByText(/.+/, { selector: '[id$="range-error"]' })
      .map((el) => el.textContent ?? "");

    await chooseOption(user, ecosystem, "파일 경로");
    await waitFor(() =>
      expect(within(dialog).queryByRole("textbox", { name: /^버전 범위/ })).toBeNull(),
    );
    await chooseOption(user, ecosystem, "npm");
    const range = await within(dialog).findByRole("textbox", { name: /^버전 범위/ });
    expect(range).not.toHaveAttribute("aria-invalid", "true");
    expect(range).toHaveValue("");
    for (const text of alertTexts) expect(within(dialog).queryByText(text)).not.toBeInTheDocument();
    expect(dialog.querySelector('[id$="range-error"]')).toBeNull();
  });

  it("[SC-64] 수정 Dialog(흔적 항목): 이름 입력의 aria-describedby 가 범위 안내를 가리키지 않는다", async () => {
    setupServer();
    const { user } = await renderBlacklist();
    const dialog = await openEdit(user, ".ci-*.sh");
    const name = within(dialog).getByRole("textbox", { name: /^파일 경로 또는 패턴/ });
    const ids = (name.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id).not.toMatch(/range/);
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it("[SC-65] 검출 표: refs/heads 행의 링크 href 는 htmlUrl 그대로", async () => {
    const { user } = renderFindings({
      ...(findingsPage.items[0] as Finding),
      id: 903,
      ecosystem: "branch",
      packageName: "wfx-docs",
      version: "",
      filePath: "refs/heads/wfx-docs",
      htmlUrl: "https://github.com/o/r/tree/wfx-docs",
    });
    const row = await findRowWith("wfx-docs@");
    await user.click(within(row).getByRole("button", { name: "행 메뉴" }));
    expect(await screen.findByRole("menuitem", { name: /GitHub에서 보기/ })).toHaveAttribute(
      "href",
      "https://github.com/o/r/tree/wfx-docs",
    );
  });

  it("[SC-66] 삭제 확인 문구: 흔적 항목에는 (모든 버전)이 없고 npm 의 범위 없는 항목에는 있다", async () => {
    setupServer();
    const { user } = await renderBlacklist();
    const row = await findRowWith(".ci-*.sh");
    await user.click(within(row).getByRole("button", { name: "삭제" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(".ci-*.sh 항목을 삭제합니다");
    expect(dialog).not.toHaveTextContent("(모든 버전)");
    await user.click(within(dialog).getByRole("button", { name: "취소" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    const npmRow = await findRowWith("evil-pkg");
    await user.click(within(npmRow).getByRole("button", { name: "삭제" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("(모든 버전)");
  });

  it("[SC-67] 이름 검색으로 흔적 이름을 찾으면 q 를 그대로 요청한다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const server = setupServer();
      const { user } = await renderBlacklist();
      await user.click(screen.getByRole("textbox", { name: "이름" }));
      await user.paste(".ci-*.sh");
      await advance(300);
      await vi.waitFor(() =>
        expect(server.last("GET", BLACKLIST)?.query).toEqual({ q: ".ci-*.sh", excludeSource: "cve" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("[SC-68] 블랙리스트의 이름 열 머리글은 '이름', 검출 표의 머리글은 '대상@버전'이 아니라 '대상'", async () => {
    setupServer();
    const { unmount } = await renderBlacklist();
    expect(
      within(screen.getByRole("table")).getByRole("columnheader", { name: "이름" }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("table")).queryByRole("columnheader", { name: "패키지 이름" }),
    ).toBeNull();
    unmount();

    renderFindings({ ...(findingsPage.items[0] as Finding), id: 906 });
    await findRowWith("lodash@4.17.20");
    const headers = within(screen.getByRole("table")).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent?.trim())).toContain("대상");
    expect(headers.map((h) => h.textContent?.trim())).not.toContain("패키지@버전");
  });

  it("[SC-69] 표의 — 는 스크린 리더에 '해당 없음'(범위)·'버전 없음'(검출)으로 읽힌다", async () => {
    setupServer();
    const { unmount } = await renderBlacklist();
    const row = await findRowWith(".ci-*.sh");
    expect(within(row).getByText("—")).toHaveAttribute("aria-hidden", "true");
    expect(within(row).getByText("해당 없음")).toHaveClass("sr-only");
    unmount();

    renderFindings({
      ...(findingsPage.items[0] as Finding),
      id: 904,
      version: "",
      packageName: "zz-pkg",
    });
    const frow = await findRowWith("zz-pkg@");
    expect(within(frow).getByText("버전 없음")).toHaveClass("sr-only");
    expect(within(frow).getByText("—")).toHaveAttribute("aria-hidden", "true");
  });

  it("[SC-70] 200자 content 이름: 이름 칸이 잘리고 title 에 전체 값이 있다", async () => {
    setupServer([{ ...pathEntry, id: 72, ecosystem: "content", name: LONG, reason: LONG }]);
    renderWithProviders(<BlacklistPage />, { route: "/blacklist" });
    const row = await findRowWith(LONG);
    const cell = within(row).getByRole("rowheader");
    expect(cell).toHaveAttribute("title", LONG);
    expect(cell).toHaveClass("truncate");
    expect(cell.className).toMatch(/max-w-/);
  });

  it("[SC-71] 검출 표: 긴 대상@버전 칸도 잘리고 title 에 전체 값이 있다", async () => {
    renderFindings({
      ...(findingsPage.items[0] as Finding),
      id: 905,
      packageName: LONG,
      version: "1.0.0",
    });
    const row = await findRowWith(`${LONG}@1.0.0`);
    const cell = row.querySelector(`[title="${LONG}@1.0.0"]`);
    expect(cell).not.toBeNull();
    expect(cell).toHaveClass("truncate");
  });
});
