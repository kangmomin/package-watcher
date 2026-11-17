// 외부 목록 검색: 열이 쪽의 내용이 아니라 분류 필터를 따른다.
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FeedPage } from "@/features/feed/FeedPage";
import { reply, setupFetchMock } from "@/test/fetchMock";
import { feedEntryRanged, feedPage } from "@/test/feedFixtures";
import { renderWithProviders } from "@/test/render";
import { chooseOption, findRowWith } from "@/test/ui";

describe("외부 목록 검색 — 열의 일관성", () => {
  it("[SI-100] 분류가 악성 패키지가 아니면 악성 패키지뿐인 쪽에서도 점수·고쳐진 버전 열을 보이고, 악성 패키지 필터에서는 숨긴다", async () => {
    setupFetchMock().on("GET", "/api/feed/entries", reply.json(feedPage([feedEntryRanged])));
    const { user } = renderWithProviders(<FeedPage />, { route: "/feed" });
    await findRowWith("evil-npm-pkg");
    expect(screen.getByRole("columnheader", { name: "점수" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "고쳐진 버전" })).toBeInTheDocument();

    await chooseOption(user, screen.getByRole("combobox", { name: "분류" }), "취약점");
    await waitFor(() => expect(screen.getByRole("columnheader", { name: "점수" })).toBeInTheDocument());

    await chooseOption(user, screen.getByRole("combobox", { name: "분류" }), "악성 패키지");
    await waitFor(() => expect(screen.queryByRole("columnheader", { name: "점수" })).not.toBeInTheDocument());
    expect(screen.queryByRole("columnheader", { name: "고쳐진 버전" })).not.toBeInTheDocument();
  });
});
