// 묶음 E: 블랙리스트의 출처 표시·필터·수정 Dialog.
import type { BlacklistEntry } from "@pw/shared";
import { blacklistEntries, blacklistEntryRanged, emptyFindingsPage, settingsDefault, summaryDefault } from "@pw/shared/fixtures";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BlacklistPage } from "@/features/blacklist/BlacklistPage";
import { reply, setupFetchMock, type FetchMock } from "@/test/fetchMock";
import { renderWithProviders } from "@/test/render";
import { chooseOption, findRowWith } from "@/test/ui";

const BLACKLIST = "/api/blacklist";

const feedEntry: BlacklistEntry = {
  ...blacklistEntryRanged,
  id: 70,
  source: "feed",
  externalId: "GHSA-aaaa-bbbb-cccc",
  name: "evil-feed-pkg",
  versionRange: null,
  reason: "Malware in evil-feed-pkg https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
};

function setupServer(): FetchMock {
  return setupFetchMock()
    .on("GET", BLACKLIST, reply.json({ items: [...blacklistEntries, feedEntry] }))
    .on("GET", "/api/findings", reply.json(emptyFindingsPage))
    .on("GET", "/api/summary", reply.json(summaryDefault))
    .on("GET", "/api/settings", reply.json(settingsDefault))
    .on("PUT", /\/api\/blacklist\/\d+/, reply.json(feedEntry));
}

async function renderBlacklist() {
  const result = renderWithProviders(<BlacklistPage />, { route: "/blacklist" });
  await findRowWith("evil-feed-pkg");
  return result;
}

describe("블랙리스트 — 외부 목록의 출처", () => {
  it("[SE-80] feed 항목의 이름 칸에 '자동' 배지(설명 포함)와 권고 링크가 있다", async () => {
    setupServer();
    await renderBlacklist();
    const row = await findRowWith("evil-feed-pkg");
    const badge = within(row).getByText("자동");
    expect(badge).toHaveAttribute("aria-label", "외부 목록이 추가한 항목 (GHSA-aaaa-bbbb-cccc)");
    expect(badge).toHaveAttribute("title", "외부 목록이 추가한 항목 (GHSA-aaaa-bbbb-cccc)");
    const link = within(row).getByRole("link", { name: /GHSA-aaaa-bbbb-cccc/ });
    expect(link).toHaveAttribute("href", "https://github.com/advisories/GHSA-aaaa-bbbb-cccc");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });

  it("[SE-81] 직접 등록한 항목에는 배지와 링크가 없다", async () => {
    setupServer();
    await renderBlacklist();
    const row = await findRowWith("lodash");
    expect(within(row).queryByText("자동")).not.toBeInTheDocument();
    expect(within(row).queryByRole("link")).not.toBeInTheDocument();
  });

  it("[SE-82] 필터가 모두 기본이면 요청에 source 가 없다", async () => {
    const server = setupServer();
    await renderBlacklist();
    expect(server.last("GET", BLACKLIST)?.query).toEqual({});
  });

  it("[SE-83] 출처 select: 전체 / 직접 등록 / 자동, 고르면 source 로 요청하고 '전체' 로 되돌리면 생략한다", async () => {
    const server = setupServer();
    const { user } = await renderBlacklist();
    const select = screen.getByRole("combobox", { name: "출처" });
    await user.click(select);
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option").map((o) => o.textContent)).toEqual(["전체", "직접 등록", "자동"]);
    await user.click(within(listbox).getByRole("option", { name: "자동" }));
    await waitFor(() => expect(server.last("GET", BLACKLIST)?.query).toEqual({ source: "feed" }));
    await chooseOption(user, screen.getByRole("combobox", { name: "출처" }), "직접 등록");
    await waitFor(() => expect(server.last("GET", BLACKLIST)?.query).toEqual({ source: "manual" }));
    await chooseOption(user, screen.getByRole("combobox", { name: "출처" }), "전체");
    await waitFor(() => expect(server.last("GET", BLACKLIST)?.query).toEqual({}));
  });

  it("[SE-84] 내보내기 링크에 source 가 붙는다", async () => {
    setupServer();
    const { user } = await renderBlacklist();
    await chooseOption(user, screen.getByRole("combobox", { name: "출처" }), "자동");
    await user.click(screen.getByRole("button", { name: "내보내기" }));
    const json = await screen.findByRole("menuitem", { name: "JSON" });
    expect(new URL(json.getAttribute("href") ?? "", "http://localhost").searchParams.get("source")).toBe("feed");
  });

  it("[SE-85] feed 항목의 수정 Dialog 에 안내 1줄이 있고 일반 항목처럼 저장·삭제할 수 있다", async () => {
    const server = setupServer();
    const { user } = await renderBlacklist();
    const row = await findRowWith("evil-feed-pkg");
    expect(within(row).getByRole("button", { name: "삭제" })).toBeEnabled();
    await user.click(within(row).getByRole("button", { name: "수정" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("외부 목록이 추가한 항목입니다. 끄면 다시 추가되지 않습니다.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "저장" }));
    await waitFor(() => expect(server.count("PUT", /\/api\/blacklist\/70$/)).toBe(1));
  });

  it("[SE-86] 직접 등록한 항목의 수정 Dialog 에는 그 안내가 없다", async () => {
    setupServer();
    const { user } = await renderBlacklist();
    const row = await findRowWith("lodash");
    await user.click(within(row).getByRole("button", { name: "수정" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText(/외부 목록이 추가한 항목입니다/)).not.toBeInTheDocument();
  });

  it("[SE-87] 필터가 있는데 0건이면 '조건에 맞는 항목이 없습니다' (출처 필터도 필터다)", async () => {
    const server = setupServer();
    const { user } = await renderBlacklist();
    server.on("GET", BLACKLIST, reply.json({ items: [] }));
    await chooseOption(user, screen.getByRole("combobox", { name: "출처" }), "자동");
    expect(await screen.findByText("조건에 맞는 항목이 없습니다")).toBeInTheDocument();
  });

  it("[SE-103] 이름의 글자만 말줄임이고 '자동' 배지와 권고 링크는 그 밖에 있어 잘리지 않는다", async () => {
    setupServer();
    await renderBlacklist();
    const row = await findRowWith("evil-feed-pkg");
    const name = within(row).getByText("evil-feed-pkg");
    expect(name.className).toContain("truncate");
    const badge = within(row).getByText("자동");
    const link = within(row).getByRole("link", { name: /GHSA-aaaa-bbbb-cccc/ });
    expect(name.contains(badge)).toBe(false);
    expect(name.contains(link)).toBe(false);
    expect(badge.closest(".truncate")).toBeNull();
    expect(link.closest(".truncate")).toBeNull();
  });
});
