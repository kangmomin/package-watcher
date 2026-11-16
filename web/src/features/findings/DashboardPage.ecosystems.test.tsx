// 여러 종류(ecosystem) 지원: 대시보드의 종류 필터 옵션이 7개가 된다.
import { SUPPORTED_ECOSYSTEMS } from "@pw/shared";
import { findingsPage, pageOf, summaryDefault } from "@pw/shared/fixtures";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardPage } from "@/features/findings/DashboardPage";
import { reply, setupFetchMock } from "@/test/fetchMock";
import { ecosystemLabel } from "@/lib/format";
import { renderWithProviders } from "@/test/render";
import { chooseOption, findRowWith } from "@/test/ui";

const FINDINGS = "/api/findings";

describe("대시보드 종류 — 필터", () => {
  it("[ME-24] 종류 필터의 옵션은 전체 + 9개 종류이고, go 를 고르면 ecosystem=go 와 page=1 로 요청한다", async () => {
    const server = setupFetchMock()
      .on("GET", "/api/summary", reply.json(summaryDefault))
      .on("GET", FINDINGS, reply.json(pageOf(findingsPage.items, { total: 1, page: 1, limit: 50 })));
    const { user } = renderWithProviders(<DashboardPage />);
    await findRowWith("api");

    const filter = screen.getByRole("combobox", { name: "종류" });
    await user.click(filter);
    const options = within(await screen.findByRole("listbox")).getAllByRole("option");
    const texts = options.map((option) => option.textContent?.trim() ?? "");
    expect(texts).toContain("전체");
    expect(texts.filter((text) => text !== "전체")).toEqual(SUPPORTED_ECOSYSTEMS.map(ecosystemLabel));
    expect(SUPPORTED_ECOSYSTEMS).toHaveLength(9);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());

    await chooseOption(user, filter, "go");
    await waitFor(() =>
      expect(server.requests("GET", FINDINGS).at(-1)?.query).toEqual({
        status: "open",
        ecosystem: "go",
        page: "1",
        limit: "50",
      }),
    );
  });
});
