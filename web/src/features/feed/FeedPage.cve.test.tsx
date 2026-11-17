// 외부 목록 검색 화면의 분류 필터와 취약점 열(점수, 고쳐진 버전).
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FeedPage } from "@/features/feed/FeedPage";
import { reply, setupFetchMock } from "@/test/fetchMock";
import { feedEntryCve, feedEntryRanged, feedPage } from "@/test/feedFixtures";
import { renderWithProviders } from "@/test/render";
import { chooseOption, findRowWith } from "@/test/ui";

const ENTRIES = "/api/feed/entries";

describe("외부 목록 검색 — 분류", () => {
  it("[SI-79] 분류 select: 전체 / 악성 패키지 / 취약점. 고르면 kind 로 요청하고 '전체' 는 생략한다", async () => {
    const server = setupFetchMock().on("GET", ENTRIES, reply.json(feedPage([feedEntryRanged])));
    const { user } = renderWithProviders(<FeedPage />, { route: "/feed" });
    await findRowWith("evil-npm-pkg");
    expect(server.last("GET", ENTRIES)?.query).toEqual({ page: "1", limit: "50" });

    await user.click(screen.getByRole("combobox", { name: "분류" }));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option").map((o) => o.textContent)).toEqual(["전체", "악성 패키지", "취약점"]);
    await user.click(within(listbox).getByRole("option", { name: "취약점" }));
    await waitFor(() => expect(server.last("GET", ENTRIES)?.query).toEqual({ kind: "cve", page: "1", limit: "50" }));

    await chooseOption(user, screen.getByRole("combobox", { name: "분류" }), "악성 패키지");
    await waitFor(() => expect(server.last("GET", ENTRIES)?.query).toEqual({ kind: "malware", page: "1", limit: "50" }));
    await chooseOption(user, screen.getByRole("combobox", { name: "분류" }), "전체");
    await waitFor(() => expect(server.last("GET", ENTRIES)?.query).toEqual({ page: "1", limit: "50" }));
  });

  it("[SI-80] 취약점 항목이 보이면 분류·점수·고쳐진 버전 열을 더하고, 악성 패키지 행은 점수가 '—' 이다", async () => {
    setupFetchMock().on("GET", ENTRIES, reply.json(feedPage([feedEntryCve, feedEntryRanged])));
    renderWithProviders(<FeedPage />, { route: "/feed" });
    const cveRow = await findRowWith("lodash");
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent?.trim())).toEqual([
      "분류",
      "종류",
      "이름",
      "범위",
      "심각도",
      "점수",
      "고쳐진 버전",
      "요약",
      "갱신 시각",
      "권고",
    ]);
    expect(within(cveRow).getByText("취약점")).toBeInTheDocument();
    expect(within(cveRow).getByText("9.8")).toBeInTheDocument();
    expect(within(cveRow).getByText("4.17.21")).toBeInTheDocument();
    const malwareRow = await findRowWith("evil-npm-pkg");
    expect(within(malwareRow).getByText("악성 패키지")).toBeInTheDocument();
    expect(within(malwareRow).getAllByText("—")).toHaveLength(2);
  });

  it("[SI-81] 분류 필터가 취약점이면 결과가 비어도 조건 안내를 보인다", async () => {
    setupFetchMock().on("GET", ENTRIES, (request) =>
      reply.json(feedPage(request.query.kind ? [] : [feedEntryRanged]))(request),
    );
    const { user } = renderWithProviders(<FeedPage />, { route: "/feed" });
    await findRowWith("evil-npm-pkg");
    await chooseOption(user, screen.getByRole("combobox", { name: "분류" }), "취약점");
    expect(await screen.findByText("조건에 맞는 항목이 없습니다")).toBeInTheDocument();
  });
});
