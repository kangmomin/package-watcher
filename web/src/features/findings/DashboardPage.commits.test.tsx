// 묶음 G: 커밋·PR 검출의 표시와 새 내장 검사의 위험한 설정 탭.
import { POLICY_CHECKS, type BlacklistEntry, type Finding } from "@pw/shared";
import { blacklistEntryPattern, findingOpenDirect, pageOf, summaryDefault } from "@pw/shared/fixtures";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardPage } from "@/features/findings/DashboardPage";
import { findingFileLabel } from "@/lib/format";
import { reply, setupFetchMock, type ReplyFactory } from "@/test/fetchMock";
import { renderWithProviders } from "@/test/render";
import { chooseOption, findRowWith } from "@/test/ui";

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
  const label = (ecosystem: Finding["ecosystem"], filePath: string) => findingFileLabel({ ecosystem, filePath });

  it("[SG-70] commit·policy 의 commit/<40자 sha> → 커밋 앞 7자, pr 의 pull/<번호> → PR #번호", () => {
    expect(label("commit", `commit/${SHA}`)).toBe("커밋 0123456");
    expect(label("policy", `commit/${SHA}`)).toBe("커밋 0123456");
    expect(label("pr", "pull/42")).toBe("PR #42");
    expect(label("npm", "package.json")).toBe("package.json");
  });

  it("[SG-80] 종류가 다르면 모양이 같아도 그대로다: path 의 실제 파일 commit/<40hex>, pull/123", () => {
    expect(label("path", `commit/${SHA}`)).toBe(`commit/${SHA}`);
    expect(label("path", "pull/123")).toBe("pull/123");
    expect(label("commit", "pull/123")).toBe("pull/123");
    expect(label("pr", `commit/${SHA}`)).toBe(`commit/${SHA}`);
    expect(label("policy", "pull/123")).toBe("pull/123");
  });

  it("[SG-81] 모양이 다르면 그대로다: README.md, .txt, 39자·41자, 대문자 sha", () => {
    expect(label("commit", "commit/README.md")).toBe("commit/README.md");
    expect(label("pr", "pull/123.txt")).toBe("pull/123.txt");
    expect(label("commit", `commit/${SHA.slice(1)}`)).toBe(`commit/${SHA.slice(1)}`);
    expect(label("commit", `commit/${SHA}a`)).toBe(`commit/${SHA}a`);
    expect(label("commit", `commit/${SHA.toUpperCase()}`)).toBe(`commit/${SHA.toUpperCase()}`);
    expect(label("pr", "src/pull/42")).toBe("src/pull/42");
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
    expect(within(prRow).getByText("PR #42", { selector: "[aria-hidden=true]" })).toBeInTheDocument();
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

describe("대시보드 — 커밋·PR 표시 보강", () => {
  it("[SG-82] 변환해 보이는 값은 스크린 리더에 전체 sha·PR 번호를 읽게 하고 보이는 글자는 숨긴다", async () => {
    setupServer();
    renderWithProviders(<DashboardPage />);
    const row = await findRowWith("커밋 0123456");
    const visible = within(row).getByText("커밋 0123456");
    expect(visible).toHaveAttribute("aria-hidden", "true");
    expect(within(row).getByText(`커밋 ${SHA}`)).toHaveClass("sr-only");
    const prRow = await findRowWith("PR #42");
    expect(within(prRow).getByText("PR #42", { selector: "[aria-hidden=true]" })).toBeInTheDocument();
    expect(within(prRow).getByText("PR #42", { selector: ".sr-only" })).toBeInTheDocument();
  });

  it("[SG-83] 브랜치 배지가 있는 path 검출과 commit 검출이 한 표에 있어도 각자 표시한다", async () => {
    const pathFinding: Finding = {
      ...findingOpenDirect,
      id: 804,
      repo: "pathrepo",
      ecosystem: "path",
      ref: "release",
      filePath: `commit/${SHA}`,
      packageName: "x",
      version: "",
    };
    setupFetchMock()
      .on("GET", "/api/summary", reply.json(summaryDefault))
      .on("GET", "/api/findings", reply.json(pageOf([pathFinding, commitFinding], { total: 2, page: 1, limit: 50 })));
    renderWithProviders(<DashboardPage />);
    const pathRow = await findRowWith("pathrepo");
    expect(within(pathRow).getByText(`commit/${SHA}`)).toBeInTheDocument();
    expect(within(pathRow).getByTitle("브랜치 release")).toBeInTheDocument();
    const commitRow = await findRowWith("커밋 0123456");
    expect(within(commitRow).queryByTitle(/^브랜치 /)).toBeNull();
  });

  it("[SG-84] 검출 필터에서 커밋 메시지를 고르면 ecosystem=commit 으로 요청한다", async () => {
    const server = setupServer();
    const { user } = renderWithProviders(<DashboardPage />);
    await findRowWith("커밋 0123456");
    await chooseOption(user, screen.getByRole("combobox", { name: "종류" }), "커밋 메시지");
    await waitFor(() => expect(server.last("GET", "/api/findings")?.query).toMatchObject({ ecosystem: "commit" }));
  });
});
