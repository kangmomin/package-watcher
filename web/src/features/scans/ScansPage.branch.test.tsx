// 묶음 F: 스캔의 repo 진행 상황에 "브랜치 n개".
import type { ScanRepo } from "@pw/shared";
import {
  pageOf,
  scanPartialWithStats,
  scanRepoPassed,
  scanRunningWithStats,
  summaryDefault,
} from "@pw/shared/fixtures";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScansPage } from "@/features/scans/ScansPage";
import { reply, setupFetchMock } from "@/test/fetchMock";
import { renderWithProviders } from "@/test/render";
import { findRowWith } from "@/test/ui";

const withBranches: ScanRepo = {
  ...scanRepoPassed,
  repo: "with-branches",
  branchCount: 3,
  fileCount: 9,
};
const failedWithBranches: ScanRepo = {
  ...scanRepoPassed,
  repo: "failed-repo",
  status: "failed",
  branchCount: 2,
  fileCount: 0,
  error: "x",
};
const without: ScanRepo = { ...scanRepoPassed, repo: "no-branches", branchCount: 0, fileCount: 4 };

async function openRepoTable() {
  setupFetchMock()
    .on("GET", "/api/summary", reply.json(summaryDefault))
    .on(
      "GET",
      "/api/scans",
      reply.json(pageOf([scanRunningWithStats, scanPartialWithStats], { limit: 20 })),
    )
    .on("GET", /^\/api\/scans\/\d+\/repos$/, reply.json(pageOf([withBranches, without, failedWithBranches])));
  const { user } = renderWithProviders(<ScansPage />, { route: "/scans" });
  const row = await findRowWith("11-11 09:00");
  await user.click(within(row).getByRole("button", { name: "상세 보기" }));
  return screen.findByRole("table", { name: "repo별 진행 상황" });
}

const rowOf = (table: HTMLElement, repo: string) =>
  within(table).getByRole("rowheader", { name: repo }).closest("tr") as HTMLElement;

describe("스캔 — repo별 브랜치 수", () => {
  it("[SF-60] branchCount > 0 이면 파일 수 옆에 '브랜치 n개' 를 보인다", async () => {
    const table = await openRepoTable();
    await within(table).findByText("with-branches");
    expect(within(rowOf(table, "with-branches")).getByText("브랜치 3개")).toBeInTheDocument();
  });

  it("[SF-61] branchCount 가 0 이면 표시가 없다", async () => {
    const table = await openRepoTable();
    await within(table).findByText("no-branches");
    expect(within(rowOf(table, "no-branches")).queryByText(/브랜치/)).not.toBeInTheDocument();
  });

  it("[SF-83] 파일 수를 표시하지 않는 상태(실패 등)의 행은 branchCount 가 있어도 브랜치 수를 숨긴다", async () => {
    const table = await openRepoTable();
    await within(table).findByText("failed-repo");
    expect(within(rowOf(table, "failed-repo")).queryByText(/브랜치/)).not.toBeInTheDocument();
  });
});
