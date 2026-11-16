// 묶음 G: 커밋·PR 검출의 표시와 새 내장 검사의 위험한 설정 탭.
import { POLICY_CHECKS, type BlacklistEntry, type Finding } from "@pw/shared";
import { blacklistEntryPattern, findingOpenDirect, pageOf, summaryDefault } from "@pw/shared/fixtures";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardPage } from "@/features/findings/DashboardPage";
import { findingFileLabel } from "@/lib/format";
import { reply, setupFetchMock, type ReplyFactory } from "@/test/fetchMock";
import { renderWithProviders } from "@/test/render";
import { findRowWith } from "@/test/ui";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const COMMIT_URL = `https://github.com/my-org/api/commit/${SHA}`;
const PR_URL = "https://github.com/my-org/web/pull/42";

const commitFinding: Finding = {
  ...findingOpenDirect,
  id: 801,
  repo: "api",
  ecosystem: "commit",
  filePath: `commit/${SHA}`,
  packageName: "evil-marker",
  version: "",
  htmlUrl: COMMIT_URL,
};
const prFinding: Finding = {
  ...findingOpenDirect,
  id: 802,
  repo: "web",
  ecosystem: "pr",
  filePath: "pull/42",
  packageName: "evil-title",
  version: "",
  htmlUrl: PR_URL,
};
const plainFinding: Finding = {
  ...findingOpenDirect,
  id: 803,
  repo: "plain",
  filePath: "package.json",
  packageName: "left-pad",
  version: "1.0.0",
};

const changedCheck = POLICY_CHECKS.find((c) => c.id === "workflow-changed");
const committerCheck = POLICY_CHECKS.find((c) => c.id === "new-committer");
if (!changedCheck || !committerCheck) throw new Error("내장 검사 없음");
const entryOf = (id: number, name: string): BlacklistEntry => ({
  ...blacklistEntryPattern,
  id,
  ecosystem: "policy",
  name,
  versionRange: null,
});
const policyChanged: Finding = {
  ...findingOpenDirect,
  id: 811,
  repo: "infra",
  ecosystem: "policy",
  filePath: `commit/${SHA}`,
  packageName: ".github/workflows/deploy.yml",
  version: "0123456",
  blacklistEntryId: 91,
  htmlUrl: COMMIT_URL,
};
const policyCommitter: Finding = {
  ...policyChanged,
  id: 812,
  repo: "tools",
  packageName: "new-person",
  blacklistEntryId: 92,
};

const byCategory: ReplyFactory = (request) =>
  reply.json(
    request.query.category === "policy"
      ? pageOf([policyChanged, policyCommitter], { total: 2, page: 1, limit: 50 })
      : pageOf([commitFinding, prFinding, plainFinding], { total: 3, page: 1, limit: 50 }),
  )(request);

function setupServer() {
  return setupFetchMock()
    .on("GET", "/api/summary", reply.json({ ...summaryDefault, policyOpenCount: 2 }))
    .on("GET", "/api/findings", byCategory)
    .on(
      "GET",
      "/api/blacklist",
      reply.json({ items: [entryOf(91, "workflow-changed"), entryOf(92, "new-committer")] }),
    );
}

describe("findingFileLabel", () => {
  it("[SG-70] commit/<40자 sha> → 커밋 앞 7자, pull/<번호> → PR #번호, 그 외는 그대로", () => {
    expect(findingFileLabel(`commit/${SHA}`)).toBe("커밋 0123456");
    expect(findingFileLabel("pull/42")).toBe("PR #42");
    expect(findingFileLabel("package.json")).toBe("package.json");
    expect(findingFileLabel("commit/abc")).toBe("commit/abc");
    expect(findingFileLabel("pull/x")).toBe("pull/x");
    expect(findingFileLabel("src/pull/42")).toBe("src/pull/42");
  });
});

describe("대시보드 — 커밋·PR 검출", () => {
  it("[SG-71] 검출 표: 파일 칸은 커밋·PR로 보이고 전체 값은 title, 종류는 새 라벨이다", async () => {
    setupServer();
    renderWithProviders(<DashboardPage />);
    const commitRow = await findRowWith("커밋 0123456");
    expect(within(commitRow).getByText("커밋 0123456")).toBeInTheDocument();
    expect(within(commitRow).getByTitle(`commit/${SHA}`)).toBeInTheDocument();
    expect(within(commitRow).getByText("커밋 메시지")).toBeInTheDocument();
    const prRow = await findRowWith("PR #42");
    expect(within(prRow).getByText("PR #42")).toBeInTheDocument();
    expect(within(prRow).getByTitle("pull/42")).toBeInTheDocument();
    expect(within(prRow).getByText("PR 제목")).toBeInTheDocument();
    expect(within(await findRowWith("package.json")).getByText("package.json")).toBeInTheDocument();
  });

  it("[SG-72] 행 메뉴의 GitHub에서 보기는 htmlUrl(커밋·PR의 주소)로 간다", async () => {
    setupServer();
    const { user } = renderWithProviders(<DashboardPage />);
    await user.click(within(await findRowWith("커밋 0123456")).getByRole("button", { name: "행 메뉴" }));
    expect(await screen.findByRole("menuitem", { name: /GitHub에서 보기/ })).toHaveAttribute("href", COMMIT_URL);
  });

  it("[SG-73] 위험한 설정 탭: 새 검사의 title과 커밋 링크 표시, 대상은 packageName@version", async () => {
    setupServer();
    renderWithProviders(<DashboardPage />, { route: "/?tab=policy" });
    const row = await findRowWith("infra");
    expect(await within(row).findByText(changedCheck.title)).toBeInTheDocument();
    expect(within(row).getByText("커밋 0123456")).toBeInTheDocument();
    expect(within(row).getByTitle(`commit/${SHA}`)).toBeInTheDocument();
    expect(within(row).getByText(".github/workflows/deploy.yml@0123456")).toBeInTheDocument();
    const other = await findRowWith("tools");
    expect(await within(other).findByText(committerCheck.title)).toBeInTheDocument();
    expect(within(other).getByText("new-person@0123456")).toBeInTheDocument();
  });
});
