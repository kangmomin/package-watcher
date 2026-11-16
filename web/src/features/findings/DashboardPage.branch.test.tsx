// 묶음 F: 검출 표의 브랜치 표시.
import type { Finding } from "@pw/shared";
import { findingOpenDirect, pageOf, summaryDefault } from "@pw/shared/fixtures";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardPage } from "@/features/findings/DashboardPage";
import { reply, setupFetchMock } from "@/test/fetchMock";
import { renderWithProviders } from "@/test/render";
import { findRowWith } from "@/test/ui";

const LONG_REF = `feature/${"very-long-branch-name-".repeat(6)}end`;
const onBranch: Finding = {
  ...findingOpenDirect,
  id: 701,
  repo: "branch-repo",
  ref: "feature/login",
  htmlUrl: "https://github.com/my-org/branch-repo/blob/feature/login/package-lock.json",
};
const onDefault: Finding = { ...findingOpenDirect, id: 702, repo: "default-repo", ref: "" };
const onLong: Finding = { ...onBranch, id: 703, repo: "long-repo", ref: LONG_REF };

function setup(items: Finding[] = [onBranch, onDefault, onLong]) {
  setupFetchMock()
    .on("GET", "/api/summary", reply.json(summaryDefault))
    .on("GET", "/api/findings", reply.json(pageOf(items)));
  return renderWithProviders(<DashboardPage />);
}

describe("대시보드 — 브랜치 표시", () => {
  it("[SF-50] ref 가 있는 행의 파일 칸에 브랜치 이름을 보이고, 스크린 리더 이름은 '브랜치 이름' 이다", async () => {
    setup();
    const row = await findRowWith("branch-repo");
    expect(within(row).getByText("feature/login")).toBeInTheDocument();
    expect(
      within(row).getByText("브랜치 feature/login", { selector: ".sr-only" }),
    ).toBeInTheDocument();
    expect(within(row).getByTitle("브랜치 feature/login")).toBeInTheDocument();
    expect(within(row).getByText(findingOpenDirect.filePath)).toBeInTheDocument();
  });

  it("[SF-51] 기본 브랜치(ref 빈 문자열)의 행에는 표시가 없다", async () => {
    setup();
    const row = await findRowWith("default-repo");
    expect(within(row).queryByText(/^브랜치 /)).not.toBeInTheDocument();
    expect(within(row).queryByTitle(/^브랜치 /)).not.toBeInTheDocument();
  });

  it("[SF-52] 긴 브랜치 이름은 말줄임(truncate)이고 title 에 전체 이름이 있다", async () => {
    setup();
    const row = await findRowWith("long-repo");
    const badge = within(row).getByTitle(`브랜치 ${LONG_REF}`);
    expect(badge.querySelector(".truncate")).not.toBeNull();
    expect(within(row).getByText(LONG_REF)).toBeInTheDocument();
  });

  it("[SF-53] 행 메뉴의 'GitHub에서 보기' 는 서버가 준 htmlUrl(브랜치의 파일)을 가리킨다", async () => {
    const { user } = setup();
    const row = await findRowWith("branch-repo");
    await user.click(within(row).getByRole("button", { name: "행 메뉴" }));
    const link = await within(document.body).findByRole("menuitem", { name: "GitHub에서 보기" });
    expect(link).toHaveAttribute("href", onBranch.htmlUrl);
  });

  it("[SF-80] 같은 repo·같은 파일에 ref 만 다른 두 행: 기본 브랜치 행에는 배지가 없고 브랜치 행에만 있다", async () => {
    const base: Finding = { ...findingOpenDirect, id: 801, repo: "same-repo", ref: "" };
    setup([base, { ...base, id: 802, ref: "feature/x" }]);
    const headers = await screen.findAllByRole("rowheader", { name: "same-repo" });
    const rows = headers.map((header) => header.closest("tr") as HTMLElement);
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).queryByTitle(/^브랜치 /)).not.toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByTitle("브랜치 feature/x")).toBeInTheDocument();
  });

  it("[SF-81] 이름에 / 와 한글이 든 브랜치도 그대로 표시하고 title 에 넣는다", async () => {
    setup([{ ...onBranch, repo: "kr-repo", ref: "기능/로그인-개선" }]);
    const row = await findRowWith("kr-repo");
    expect(within(row).getByText("기능/로그인-개선")).toBeInTheDocument();
    expect(within(row).getByTitle("브랜치 기능/로그인-개선")).toBeInTheDocument();
  });

  it("[SF-82] 브랜치 이름은 <bdi> 로 감싸 방향이 섞여도 순서가 유지된다", async () => {
    setup();
    const row = await findRowWith("branch-repo");
    expect(within(row).getByText("feature/login").tagName).toBe("BDI");
  });
});
