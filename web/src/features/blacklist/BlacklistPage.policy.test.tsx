// 묶음 D: 위험한 설정(policy) 항목 — 종류 select, 표, 수정 Dialog, 일괄 작업, 무효화.
import { POLICY_CHECKS, type BlacklistEntry } from "@pw/shared";
import {
  apiErrorOf,
  blacklistEntries,
  blacklistEntryPattern,
  emptyFindingsPage,
  settingsDefault,
  summaryDefault,
} from "@pw/shared/fixtures";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BlacklistPage } from "@/features/blacklist/BlacklistPage";
import { DashboardPage } from "@/features/findings/DashboardPage";
import { reply, setupFetchMock, type FetchMock } from "@/test/fetchMock";
import { renderWithProviders } from "@/test/render";
import { containing, findRowWith, findToast } from "@/test/ui";

const BLACKLIST = "/api/blacklist";
const BULK = "/api/blacklist/bulk";
const FINDINGS = "/api/findings";
const SUMMARY = "/api/summary";
const NO_DELETE = "내장 검사는 삭제할 수 없습니다";
const BULK_NO_DELETE = "내장 검사가 선택돼 있어서 삭제할 수 없습니다";

const unpinned = POLICY_CHECKS[0];
const policyEntry: BlacklistEntry = {
  ...blacklistEntryPattern,
  id: 91,
  ecosystem: "policy",
  name: unpinned.id,
  versionRange: null,
  severity: "medium",
  reason: unpinned.description,
};

function setupServer(): FetchMock {
  return setupFetchMock()
    .on("GET", BLACKLIST, reply.json({ items: [...blacklistEntries, policyEntry] }))
    .on("GET", FINDINGS, reply.json(emptyFindingsPage))
    .on("GET", SUMMARY, reply.json(summaryDefault))
    .on("GET", "/api/settings", reply.json(settingsDefault));
}

async function renderBlacklist(withDashboard = false) {
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

function groupLabels(listbox: HTMLElement) {
  return within(listbox)
    .getAllByRole("group")
    .map((group) => document.getElementById(group.getAttribute("aria-labelledby") ?? "")?.textContent?.trim());
}

describe("위험한 설정 — 블랙리스트", () => {
  it("[SD-50] 등록 Dialog 의 종류 select 에는 위험한 설정이 없다", async () => {
    setupServer();
    const { user } = await renderBlacklist();
    await user.click(screen.getByRole("button", { name: "항목 추가" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: /^종류/ }));
    const listbox = await screen.findByRole("listbox");
    expect(groupLabels(listbox)).toEqual(["패키지", "CI·이미지", "침해의 흔적"]);
    expect(within(listbox).queryByRole("option", { name: "위험한 설정" })).toBeNull();
  });

  it("[SD-51] 필터의 종류 select 에는 위험한 설정 그룹이 있고, 고르면 ecosystem=policy 로 요청한다", async () => {
    const server = setupServer();
    const { user } = await renderBlacklist();
    await user.click(screen.getByRole("combobox", { name: "종류" }));
    const listbox = await screen.findByRole("listbox");
    expect(groupLabels(listbox)).toEqual(["패키지", "CI·이미지", "침해의 흔적", "위험한 설정"]);
    await user.click(within(listbox).getByRole("option", { name: "위험한 설정" }));
    await waitFor(() => expect(server.last("GET", BLACKLIST)?.query.ecosystem).toBe("policy"));
  });

  it("[SD-52] policy 행: 이름 칸에 title 과 id, 버전 범위는 —, 삭제 버튼은 비활성이고 이유가 읽힌다", async () => {
    setupServer();
    await renderBlacklist();
    const row = await findRowWith(unpinned.title);
    expect(within(row).getByText(unpinned.id)).toBeInTheDocument();
    expect(within(row).getByText("해당 없음")).toBeInTheDocument();
    const del = within(row).getByRole("button", { name: NO_DELETE });
    expect(del).toBeDisabled();
    const other = await findRowWith("lodash");
    expect(within(other).getByRole("button", { name: "삭제" })).toBeEnabled();
  });

  it("[SD-53] policy 수정 Dialog: 종류·이름은 읽기 전용(값 = id, title 표시), 범위 없음, 저장하면 name=id, versionRange=null", async () => {
    const server = setupServer().on("PUT", `${BLACKLIST}/91`, reply.json({ ...policyEntry, severity: "high" }));
    const { user } = await renderBlacklist();
    const row = await findRowWith(unpinned.title);
    await user.click(within(row).getByRole("button", { name: "수정" }));
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByRole("textbox", { name: /^이름/ });
    // disabled 가 아니라 readOnly: 포커스로 title 과 안내를 읽을 수 있다.
    expect(name).not.toBeDisabled();
    expect(name).toHaveAttribute("readonly");
    expect(name).toHaveAttribute("aria-readonly", "true");
    expect(name).not.toHaveAttribute("aria-required");
    expect(name).toHaveAccessibleDescription(containing(unpinned.title));
    expect(within(dialog).getByText("내장 검사입니다. 켬·끔, 심각도, 사유, 만료일만 바꿀 수 있습니다.")).toBeInTheDocument();
    expect(within(dialog).queryByText(/하나만 둘 수 있습니다/)).toBeNull();
    expect(name).toHaveValue(unpinned.id);
    expect(within(dialog).getByText(unpinned.title)).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: /^종류/ })).toBeDisabled();
    expect(within(dialog).queryByRole("textbox", { name: /^버전 범위/ })).toBeNull();

    await user.click(within(dialog).getByRole("combobox", { name: /^심각도/ }));
    await user.click(await screen.findByRole("option", { name: "high" }));
    await user.click(within(dialog).getByRole("button", { name: "저장" }));
    await findToast("항목을 수정했습니다");
    expect(server.last("PUT", `${BLACKLIST}/91`)?.body).toMatchObject({
      ecosystem: "policy",
      name: unpinned.id,
      versionRange: null,
      severity: "high",
      reason: policyEntry.reason,
      expiresAt: policyEntry.expiresAt,
    });
  });

  it("[SD-54] policy 항목이 선택돼 있으면 일괄 [삭제]는 비활성이고 안내가 있다. [끄기]는 동작한다", async () => {
    const server = setupServer().on("POST", BULK, reply.json({ action: "disable", count: 1 }));
    const { user } = await renderBlacklist();
    const row = await findRowWith(unpinned.title);
    await user.click(within(row).getByRole("checkbox"));
    const group = screen.getByRole("group", { name: "일괄 작업" });
    const del = within(group).getByRole("button", { name: "삭제" });
    expect(del).toBeDisabled();
    expect(del).toHaveAccessibleDescription(BULK_NO_DELETE);
    expect(within(group).getByText(BULK_NO_DELETE)).toBeInTheDocument();
    await user.click(within(group).getByRole("button", { name: "끄기" }));
    await findToast("1건을 껐습니다");
    expect(server.last("POST", BULK)?.body).toMatchObject({ action: "disable", ids: [91] });
  });

  it("[SD-55] policy 를 선택에서 빼면 [삭제]가 다시 활성이다", async () => {
    setupServer();
    const { user } = await renderBlacklist();
    const row = await findRowWith(unpinned.title);
    await user.click(within(row).getByRole("checkbox"));
    await user.click(within(await findRowWith("lodash")).getByRole("checkbox"));
    const group = screen.getByRole("group", { name: "일괄 작업" });
    expect(within(group).getByRole("button", { name: "삭제" })).toBeDisabled();
    await user.click(within(row).getByRole("checkbox"));
    expect(within(group).getByRole("button", { name: "삭제" })).toBeEnabled();
    expect(within(group).queryByText(BULK_NO_DELETE)).toBeNull();
  });

  it("[SD-56] 서버가 INVALID_STATE 를 주면 오류 toast 로 메시지를 보인다", async () => {
    setupServer().on(
      "POST",
      BULK,
      reply.error(apiErrorOf("INVALID_STATE", "위험한 설정의 검사는 삭제할 수 없습니다. 끄려면 비활성으로 바꾸십시오")),
    );
    const { user } = await renderBlacklist();
    const row = await findRowWith("lodash");
    await user.click(within(row).getByRole("checkbox"));
    const group = screen.getByRole("group", { name: "일괄 작업" });
    await user.click(within(group).getByRole("button", { name: "삭제" }));
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "삭제" }));
    await findToast("위험한 설정의 검사는 삭제할 수 없습니다");
  });

  it("[SD-57] policy 항목을 수정하면 findings 와 summary 를 다시 읽는다", async () => {
    const server = setupServer().on("PUT", `${BLACKLIST}/91`, reply.json({ ...policyEntry, enabled: false }));
    const { user } = await renderBlacklist(true);
    await waitFor(() => expect(server.count("GET", SUMMARY)).toBeGreaterThan(0));
    const before = { f: server.count("GET", FINDINGS), s: server.count("GET", SUMMARY) };
    const row = await findRowWith(unpinned.title);
    await user.click(within(row).getByRole("button", { name: "수정" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("checkbox", { name: "켜기" }));
    await user.click(within(dialog).getByRole("button", { name: "저장" }));
    await findToast("항목을 수정했습니다");
    await waitFor(() => {
      expect(server.count("GET", FINDINGS)).toBeGreaterThan(before.f);
      expect(server.count("GET", SUMMARY)).toBeGreaterThan(before.s);
    });
  });

  it("[SD-75] policy 행의 선택 체크박스와 수정 버튼은 id 가 아니라 검사의 title 을 쓴다", async () => {
    setupServer();
    await renderBlacklist();
    expect(screen.getByRole("checkbox", { name: `${unpinned.title} 선택` })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: `${unpinned.id} 선택` })).toBeNull();
    const row = await findRowWith(unpinned.title);
    expect(within(row).getByRole("button", { name: "수정" })).toHaveAttribute("title", `${unpinned.title} 수정`);
  });

  it("[SD-76] 모두 선택에 policy 가 섞이면 일괄 [삭제]는 비활성이다", async () => {
    setupServer();
    const { user } = await renderBlacklist();
    await user.click(screen.getByRole("checkbox", { name: "모두 선택" }));
    const group = screen.getByRole("group", { name: "일괄 작업" });
    expect(within(group).getByRole("button", { name: "삭제" })).toBeDisabled();
    expect(within(group).getByText(BULK_NO_DELETE)).toBeInTheDocument();
  });
});
