// 블랙리스트의 취약점 출처: 배지, 출처 필터, 기본 보기(excludeSource=cve)와 안내.
import type { BlacklistEntry } from "@pw/shared";
import { blacklistEntryRanged, emptyFindingsPage, settingsDefault, summaryDefault } from "@pw/shared/fixtures";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BlacklistPage } from "@/features/blacklist/BlacklistPage";
import { reply, setupFetchMock, type FetchMock } from "@/test/fetchMock";
import { renderWithProviders } from "@/test/render";
import { chooseOption, findRowWith } from "@/test/ui";

const BLACKLIST = "/api/blacklist";

const cveEntry: BlacklistEntry = {
  ...blacklistEntryRanged,
  id: 71,
  source: "cve",
  externalId: "GHSA-gggg-hhhh-iiii",
  name: "lodash-cve-pkg",
  versionRange: "<4.17.21",
  reason: "Command injection https://github.com/advisories/GHSA-gggg-hhhh-iiii",
};
const manualEntry: BlacklistEntry = { ...blacklistEntryRanged, id: 72, source: "manual", name: "manual-pkg" };

function setupServer(): FetchMock {
  return setupFetchMock()
    .on("GET", BLACKLIST, (request) => {
      const { source, excludeSource } = request.query;
      const items = [cveEntry, manualEntry].filter((entry) =>
        source ? entry.source === source : excludeSource ? entry.source !== excludeSource : true,
      );
      return reply.json({ items })(request);
    })
    .on("GET", "/api/findings", reply.json(emptyFindingsPage))
    .on("GET", "/api/summary", reply.json(summaryDefault))
    .on("GET", "/api/settings", reply.json(settingsDefault));
}

const sourceSelect = () => screen.getByRole("combobox", { name: "출처" });
const lastQuery = (server: FetchMock) => server.last("GET", BLACKLIST)?.query;

describe("블랙리스트 — 취약점 출처", () => {
  it("[SI-82] 기본 보기는 excludeSource=cve 로 조회해서 취약점 항목이 없고, 숨긴다는 안내를 보인다", async () => {
    const server = setupServer();
    renderWithProviders(<BlacklistPage />, { route: "/blacklist" });
    await findRowWith("manual-pkg");
    expect(lastQuery(server)).toEqual({ excludeSource: "cve" });
    expect(screen.queryByText("lodash-cve-pkg")).not.toBeInTheDocument();
    expect(sourceSelect()).toHaveTextContent("기본");
    expect(screen.getByText(/기본 보기는 취약점 항목을 숨깁니다/)).toBeInTheDocument();
  });

  it("[SI-83] 출처에서 '취약점' 을 고르면 source=cve 로(excludeSource 없이), 취약점 배지와 권고 링크를 보인다", async () => {
    const server = setupServer();
    const { user } = renderWithProviders(<BlacklistPage />, { route: "/blacklist" });
    await findRowWith("manual-pkg");
    await chooseOption(user, sourceSelect(), "취약점");
    const row = await findRowWith("lodash-cve-pkg");
    expect(lastQuery(server)).toEqual({ source: "cve" });
    const badge = within(row).getByText("취약점");
    expect(badge).toHaveAttribute("aria-label", "외부 목록의 취약점이 추가한 항목 (GHSA-gggg-hhhh-iiii)");
    expect(within(row).getByRole("link", { name: /GHSA-gggg-hhhh-iiii/ })).toHaveAttribute(
      "href",
      "https://github.com/advisories/GHSA-gggg-hhhh-iiii",
    );
    expect(screen.queryByText(/기본 보기는 취약점 항목을 숨깁니다/)).not.toBeInTheDocument();
  });

  it("[SI-84] '전체' 는 필터 없이 조회해서 취약점 항목도 보이고, '기본' 으로 돌아가면 다시 뺀다", async () => {
    const server = setupServer();
    const { user } = renderWithProviders(<BlacklistPage />, { route: "/blacklist" });
    await findRowWith("manual-pkg");
    await chooseOption(user, sourceSelect(), "전체");
    await findRowWith("lodash-cve-pkg");
    expect(lastQuery(server)).toEqual({});
    await chooseOption(user, sourceSelect(), "기본");
    await waitFor(() => expect(lastQuery(server)).toEqual({ excludeSource: "cve" }));
    await waitFor(() => expect(screen.queryByText("lodash-cve-pkg")).not.toBeInTheDocument());
  });

  it("[SI-85] 다른 필터(종류·이름)를 바꿔도 기본 보기의 excludeSource 는 유지된다", async () => {
    const server = setupServer();
    const { user } = renderWithProviders(<BlacklistPage />, { route: "/blacklist" });
    await findRowWith("manual-pkg");
    await chooseOption(user, screen.getByRole("combobox", { name: "종류" }), "npm");
    await waitFor(() => expect(lastQuery(server)).toEqual({ ecosystem: "npm", excludeSource: "cve" }));
  });

  it("[SI-86] 출처 select 의 옵션 라벨은 기본 / 전체 / 직접 등록 / 자동 / 취약점이다", async () => {
    setupServer();
    const { user } = renderWithProviders(<BlacklistPage />, { route: "/blacklist" });
    await findRowWith("manual-pkg");
    await user.click(sourceSelect());
    const options = within(await screen.findByRole("listbox")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["기본", "전체", "직접 등록", "자동", "취약점"]);
  });

  it("[SI-87] 수정 Dialog 는 취약점 항목에 대조에서 빠진다는 안내를 보인다", async () => {
    setupServer();
    const { user } = renderWithProviders(<BlacklistPage />, { route: "/blacklist" });
    await findRowWith("manual-pkg");
    await chooseOption(user, sourceSelect(), "취약점");
    const row = await findRowWith("lodash-cve-pkg");
    await user.click(within(row).getByRole("button", { name: /수정/ }));
    expect(
      await screen.findByText("외부 목록의 취약점이 추가한 항목입니다. 끄면 org 전체에서 대조하지 않습니다."),
    ).toBeInTheDocument();
  });
});
