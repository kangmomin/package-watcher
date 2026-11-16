import { createHash } from "node:crypto";
import type { BlacklistEntry, Finding, PolicyCheckId } from "@pw/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RateLimitedError, type CommitInfo, type PullInfo } from "../github/client.ts";
import { DAY } from "../test/clock.ts";
import { FakeLogger } from "../test/logger.ts";
import { npmLockV3, pkgJson } from "../test/repoFixtures.ts";
import {
  allFindings,
  cleanupTestApps,
  createTestApp,
  listFindings,
  putSettings,
  runScan,
  type TestApp,
} from "../test/testApp.ts";
import { addEntry, listEntries } from "../test/v2.ts";
import { renderFindings } from "./notifier.ts";
import { createIndicatorRules } from "./scanIndicators.ts";

// 가짜 시계의 시작은 2026-11-12. 기본 기간은 7일이라 11-05 이후가 최근이다.
const RECENT_PUSH = "2026-11-11T00:00:00.000Z";
const OLD_PUSH = "2026-10-01T00:00:00.000Z";
const BASE = { "package.json": pkgJson(), "package-lock.json": npmLockV3({ "ok-pkg": "1.0.0" }) };
const WORKFLOW = { ".github/workflows/ci.yml": "name: ci\non: push\n" };

const sha = (n: number): string => n.toString(16).padStart(40, "0");
const sha7 = (n: number): string => sha(n).slice(0, 7);
const hash12 = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 12);

const commit = (n: number, over: Partial<CommitInfo> = {}): CommitInfo => ({
  sha: sha(n),
  message: `chore: change ${n}`,
  authorLogin: "alice",
  authorEmail: null,
  committedAt: "2026-11-10T00:00:00.000Z",
  url: `https://github.com/my-org/svc/commit/${sha(n)}`,
  ...over,
});

const pull = (n: number, title: string, over: Partial<PullInfo> = {}): PullInfo => ({
  number: n,
  title,
  state: "open",
  updatedAt: "2026-11-10T00:00:00.000Z",
  authorLogin: "bob",
  url: `https://github.com/my-org/svc/pull/${n}`,
  ...over,
});

let t: TestApp;

beforeEach(async () => {
  t = createTestApp();
  await putSettings(t);
});

afterEach(cleanupTestApps);

const trace = (ecosystem: "commit" | "pr", name: string) =>
  addEntry(t, { ecosystem, name, versionRange: null, reason: "의심스러운 문구", severity: "high" });

function setup(files: Record<string, string> = BASE, pushedAt: string | null = RECENT_PUSH): void {
  t.github.setRepos([{ name: "svc", files, pushedAt }]);
}

const active = async (app: TestApp = t): Promise<Finding[]> =>
  (await allFindings(app)).filter((f) => f.status !== "resolved");
const callCount = (): Record<string, number> => ({
  commits: t.github.callsOf("listRecentCommits").length,
  workflow: t.github.callsOf("listWorkflowCommits").length,
  pulls: t.github.callsOf("listRecentPulls").length,
});

describe("커밋·PR 의 흔적", () => {
  it("[SG-102] commit: 메시지에 문자열이 있으면(대소문자 무시) 커밋의 검출이 된다", async () => {
    await trace("commit", "Add CI Helper");
    setup();
    t.github.setCommits("svc", [
      commit(2, { message: "chore: add ci helper\n\nbody" }),
      commit(1, { message: "fix: other" }),
    ]);

    const scan = await runScan(t);

    expect(scan.status).toBe("success");
    const found = await allFindings(t);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      repo: "svc",
      ref: "",
      ecosystem: "commit",
      filePath: `commit/${sha(2)}`,
      packageName: "Add CI Helper",
      version: "",
      dependencyType: "direct",
      severity: "high",
      htmlUrl: `https://github.com/my-org/svc/commit/${sha(2)}`,
    });
    expect(callCount()).toEqual({ commits: 1, workflow: 0, pulls: 0 });
    expect(t.github.callsOf("listRecentCommits")[0]?.arg).toBe("main|2026-11-05T00:00:00.000Z");
  });

  it("[SG-103] pr: 제목에 문자열이 있으면 PR 의 검출이 된다 (커밋은 조회하지 않는다)", async () => {
    await trace("pr", "dependency audit");
    setup();
    t.github.setPulls("svc", [pull(7, "docs: Dependency Audit notes"), pull(8, "fix: typo")]);

    await runScan(t);

    const found = await allFindings(t);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      ref: "",
      ecosystem: "pr",
      filePath: "pull/7",
      packageName: "dependency audit",
      version: "",
      htmlUrl: "https://github.com/my-org/svc/pull/7",
    });
    expect(callCount()).toEqual({ commits: 0, workflow: 0, pulls: 1 });
  });

  it("[SG-104] 조건에 맞지 않으면 조회가 0회다 (항목 없음, 기간 0, 오래된·알 수 없는 push)", async () => {
    // 항목 없음
    setup();
    await runScan(t);
    expect(callCount()).toEqual({ commits: 0, workflow: 0, pulls: 0 });

    await trace("commit", "needle-text");
    await trace("pr", "needle-text");
    t.github.setRepos([
      { name: "old", files: BASE, pushedAt: OLD_PUSH },
      { name: "unknown", files: BASE, pushedAt: null },
    ]);
    await runScan(t);
    expect(callCount()).toEqual({ commits: 0, workflow: 0, pulls: 0 });

    await putSettings(t, { branchScanDays: 0 });
    setup();
    await runScan(t);
    expect(callCount()).toEqual({ commits: 0, workflow: 0, pulls: 0 });
  });

  it("[SG-105] 최근에 push 된 repo 만: 기간은 branchScanDays 를 따른다", async () => {
    await trace("commit", "needle-text");
    await putSettings(t, { branchScanDays: 3 });
    t.github.setRepos([
      { name: "a", files: BASE, pushedAt: "2026-11-10T00:00:00.000Z" },
      { name: "b", files: BASE, pushedAt: "2026-11-08T00:00:00.000Z" },
    ]);

    await runScan(t);

    expect(t.github.callsOf("listRecentCommits").map((call) => call.repo)).toEqual(["a"]);
    expect(t.github.callsOf("listRecentCommits")[0]?.arg).toBe("main|2026-11-09T00:00:00.000Z");
  });

  it("[SG-106] 의존성 파일이 없는 repo 도 평가한 것이다 (skipped 가 아니다)", async () => {
    await trace("commit", "needle-text");
    setup({ "README.md": "hi" });
    t.github.setCommits("svc", [commit(1, { message: "feat: needle-text here" })]);

    const scan = await runScan(t);

    const res = await t.request("GET", `/api/scans/${scan.id}/repos?limit=50`);
    const row = (res.json as { items: { repo: string; status: string; openFindingCount: number }[] }).items[0];
    expect(row).toMatchObject({ repo: "svc", status: "issue", openFindingCount: 1 });
  });

  it("[SG-107] 기본 브랜치의 이름으로 조회하고 같은 파일 경로 commit/x 의 path 검출은 파일 링크로 남는다", async () => {
    await addEntry(t, { ecosystem: "path", name: "commit/x", versionRange: null, reason: "r" });
    t.github.setRepos([{ name: "svc", files: { "commit/x": "1" }, pushedAt: RECENT_PUSH, defaultBranch: "trunk" }]);
    await trace("commit", "needle-text");
    t.github.setCommits("svc", [commit(1, { message: "needle-text" })]);

    await runScan(t);

    const found = await allFindings(t);
    expect(found.find((f) => f.ecosystem === "path")?.htmlUrl).toBe("https://github.com/my-org/svc/blob/HEAD/commit/x");
    expect(found.find((f) => f.ecosystem === "commit")?.htmlUrl).toBe(`https://github.com/my-org/svc/commit/${sha(1)}`);
    expect(t.github.callsOf("listRecentCommits")[0]?.arg).toMatch(/^trunk\|/);
  });
});

describe("커밋·PR 검출의 resolve", () => {
  beforeEach(async () => {
    await trace("commit", "needle-text");
    await trace("pr", "needle-text");
    setup();
    t.github.setCommits("svc", [commit(1, { message: "needle-text" })]);
    t.github.setPulls("svc", [pull(5, "needle-text")]);
  });

  const states = async (): Promise<string[]> =>
    (await allFindings(t)).map((f) => `${f.filePath}:${f.status}`).sort();

  it("[SG-108] 조회에 성공했고 이번에 나오지 않으면 resolve 한다 (같은 것이 다시 나오면 유지)", async () => {
    await runScan(t);
    expect(await states()).toEqual([`commit/${sha(1)}:open`, "pull/5:open"]);
    const before = (await allFindings(t)).map((f) => f.id).sort();

    await runScan(t);
    expect((await allFindings(t)).map((f) => f.id).sort()).toEqual(before);

    t.github.setCommits("svc", []);
    t.github.setPulls("svc", []);
    await runScan(t);
    expect(await states()).toEqual([`commit/${sha(1)}:resolved`, "pull/5:resolved"]);
  });

  it("[SG-109] 조회가 실패하면 (오류, rate limit) 그대로 두고 repo 는 실패가 아니다", async () => {
    await runScan(t);

    t.github.failCommits("svc", new Error("GitHub API 오류 (500): boom"));
    t.github.failPulls("svc", new Error("GitHub API 오류 (502): boom"));
    t.github.setCommits("svc", []);
    t.github.setPulls("svc", []);
    const scan = await runScan(t);

    expect(scan.status).toBe("success");
    expect(await states()).toEqual([`commit/${sha(1)}:open`, "pull/5:open"]);
    expect(t.logger.texts("warn").join("\n")).toContain("svc");

    // 커밋 조회만 실패하면 PR 은 평가한다
    t.github.failCommits("svc", new Error("GitHub API 오류 (500): boom"));
    t.github.failPulls("svc", null);
    await runScan(t);
    expect(await states()).toEqual([`commit/${sha(1)}:open`, "pull/5:resolved"]);
  });

  it("[SG-110] rate limit 이면 기본 브랜치의 결과는 살리고 이어지는 조회를 멈춘다 (그 repo 의 검출은 그대로)", async () => {
    await runScan(t);
    t.github.failCommits("svc", new RateLimitedError());
    t.github.setPulls("svc", []);
    t.github.setCommits("svc", []);
    t.github.calls.length = 0;

    const scan = await runScan(t);

    expect(scan.status).toBe("success");
    expect(scan.failedRepos).toEqual([]);
    expect(t.github.callsOf("listRecentPulls", "svc")).toHaveLength(0);
    expect(await states()).toEqual([`commit/${sha(1)}:open`, "pull/5:open"]);
  });

  it("[SG-111] repo 에 최근 push 가 없어지거나 기간이 0 이 되거나 항목이 꺼지면 resolve 한다", async () => {
    await runScan(t);
    t.github.setPushedAt("svc", OLD_PUSH);
    await runScan(t);
    expect(await states()).toEqual([`commit/${sha(1)}:resolved`, "pull/5:resolved"]);

    t.github.setPushedAt("svc", RECENT_PUSH);
    await runScan(t);
    expect((await active()).length).toBe(2);
    await putSettings(t, { branchScanDays: 0 });
    await runScan(t);
    expect(await active()).toHaveLength(0);

    await putSettings(t, { branchScanDays: 7 });
    await runScan(t);
    expect((await active()).length).toBe(2);
    const commitEntry = (await listEntries(t, { ecosystem: "commit" }))[0] as BlacklistEntry;
    const off = await t.request("POST", "/api/blacklist/bulk", { action: "disable", ids: [commitEntry.id] });
    expect(off.status, off.text).toBe(200);
    await runScan(t);
    expect((await active()).map((f) => f.ecosystem)).toEqual(["pr"]);
  });

  it("[SG-112] 실패한 repo 의 검출은 그대로 둔다", async () => {
    await runScan(t);
    t.github.failTree("svc", new Error("GitHub API 오류 (500): tree"));

    const scan = await runScan(t);

    expect(scan.status).toBe("partial");
    expect((await active()).length).toBe(2);
  });
});

describe("메일의 위치 표시", () => {
  it("[SG-113] commit·pr 은 `커밋 <앞 7자>`·`PR #<n>` 으로 나가고 다른 종류는 그대로다", async () => {
    await trace("commit", "needle-text");
    await trace("pr", "needle-text");
    await addEntry(t, { ecosystem: "path", name: "commit/real", versionRange: null, reason: "r" });
    t.github.setRepos([{ name: "svc", files: { ...BASE, "commit/real": "1" }, pushedAt: RECENT_PUSH }]);
    t.github.setCommits("svc", [commit(0xabc, { message: "needle-text" })]);
    t.github.setPulls("svc", [pull(12, "needle-text")]);

    await runScan(t);

    const text = renderFindings(await allFindings(t));
    expect(text).toContain(`[commit] 커밋 ${sha7(0xabc)}: needle-text@-`);
    expect(text).toContain("[pr] PR #12: needle-text@-");
    expect(text).toContain("[path] commit/real:");
    expect(t.mailer.sentText()).toContain(`커밋 ${sha7(0xabc)}`);
  });
});

describe("판정 규칙의 단위", () => {
  const entryFor = (ecosystem: "commit" | "pr", name: string, id = 1): BlacklistEntry => ({
    id,
    source: "manual",
    externalId: null,
    ecosystem,
    name,
    versionRange: null,
    reason: "r",
    severity: "low",
    enabled: true,
    expiresAt: null,
    isExpired: false,
    createdAt: "2026-11-16T00:00:00.000Z",
    updatedAt: "2026-11-16T00:00:00.000Z",
  });

  it("[SG-114] 항목마다 100건 상한이고 sha 순으로 남는다 (입력 순서와 무관)", async () => {
    const rules = createIndicatorRules([entryFor("commit", "needle-text")]);
    const commits = Array.from({ length: 150 }, (_, i) => ({ sha: sha(i), message: "NEEDLE-text" })).reverse();

    const matches = await rules.matchCommits("svc", "my-org/svc", commits, new FakeLogger());

    expect(matches).toHaveLength(100);
    expect(matches[0]?.filePath).toBe(`commit/${sha(0)}`);
    expect(matches[99]?.filePath).toBe(`commit/${sha(99)}`);
    expect(rules.hasCommit).toBe(true);
    expect(rules.hasPr).toBe(false);
  });

  it("[SG-115] PR 은 번호 순으로 남고, 글자 그대로 찾는다 (정규식·* 가 아니다)", async () => {
    const rules = createIndicatorRules([entryFor("pr", "a.c+d")]);

    const matches = await rules.matchPulls(
      "svc",
      "my-org/svc",
      [
        { number: 9, title: "xx A.C+D yy" },
        { number: 3, title: "abcd" },
        { number: 2, title: "a.c+d" },
      ],
      new FakeLogger(),
    );

    expect(matches.map((m) => m.filePath)).toEqual(["pull/2", "pull/9"]);
  });
});

// ---------------------------------------------------------------- 내장 검사

describe("workflow-changed 와 new-committer", () => {
  let p: TestApp;

  beforeEach(async () => {
    p = createTestApp({ seedPolicy: true });
    await putSettings(p);
  });

  async function only(...ids: PolicyCheckId[]): Promise<void> {
    const entries = await listEntries(p, { ecosystem: "policy" });
    const off = entries.filter((item) => !ids.includes(item.name as PolicyCheckId)).map((item) => item.id);
    const res = await p.request("POST", "/api/blacklist/bulk", { action: "disable", ids: off });
    expect(res.status, res.text).toBe(200);
  }

  const policyFindings = async (): Promise<Finding[]> => (await listFindings(p, { category: "policy" })).items;
  const rows = async (): Promise<string[]> =>
    (await policyFindings()).map((f) => `${f.packageName}|${f.filePath}|${f.version}|${f.status}`).sort();
  const authorsInDb = (): string[] =>
    (p.instance.db.prepare("SELECT author FROM repo_authors WHERE repo = 'svc' ORDER BY author").all() as { author: string }[]).map(
      (row) => row.author,
    );
  const calls = (method: "listRecentCommits" | "listWorkflowCommits" | "listRecentPulls"): number =>
    p.github.callsOf(method).length;

  it("[SG-116] workflow-changed: 커밋마다 1건 (파일 경로 commit/<sha>, 값 .github/workflows, 버전 sha 7자)", async () => {
    await only("workflow-changed");
    p.github.setRepos([{ name: "svc", files: { ...BASE, ...WORKFLOW }, pushedAt: RECENT_PUSH }]);
    p.github.setWorkflowCommits("svc", [
      { sha: sha(2), committedAt: "2026-11-10T00:00:00.000Z", url: "u", authorLogin: "alice" },
      { sha: sha(1), committedAt: "2026-11-09T00:00:00.000Z", url: "u", authorLogin: "bob" },
    ]);

    const scan = await runScan(p);

    expect(scan.status).toBe("success");
    expect(await rows()).toEqual([
      `.github/workflows|commit/${sha(1)}|${sha7(1)}|open`,
      `.github/workflows|commit/${sha(2)}|${sha7(2)}|open`,
    ]);
    expect((await policyFindings())[0]?.htmlUrl).toMatch(/^https:\/\/github\.com\/my-org\/svc\/commit\/0{39}[12]$/);
    expect(calls("listWorkflowCommits")).toBe(1);
    expect(calls("listRecentCommits")).toBe(0);
    expect(calls("listRecentPulls")).toBe(0);
    expect(p.github.callsOf("listWorkflowCommits")[0]?.arg).toBe("main|2026-11-05T00:00:00.000Z");
    // 위험한 설정이라 repo 의 검출 수에 넣지 않는다
    const res = await p.request("GET", `/api/scans/${scan.id}/repos?limit=50`);
    expect((res.json as { items: { openFindingCount: number; newFindingCount: number }[] }).items[0]).toMatchObject({
      openFindingCount: 0,
      newFindingCount: 0,
    });
  });

  it("[SG-117] workflow-changed: tree 에 .github/workflows/ 파일이 없으면 조회하지 않고, 기존 검출은 resolve 한다", async () => {
    await only("workflow-changed");
    p.github.setRepos([{ name: "svc", files: { ...BASE, ...WORKFLOW }, pushedAt: RECENT_PUSH }]);
    p.github.setWorkflowCommits("svc", [{ sha: sha(1), committedAt: "2026-11-10T00:00:00.000Z", url: "u", authorLogin: null }]);
    await runScan(p);
    expect((await rows()).length).toBe(1);

    p.github.setFiles("svc", BASE);
    await runScan(p);

    expect(calls("listWorkflowCommits")).toBe(1);
    expect(await rows()).toEqual([`.github/workflows|commit/${sha(1)}|${sha7(1)}|resolved`]);
  });

  it("[SG-118] workflow-changed: 기간이 지나면 resolve, 조회가 실패하면 그대로 둔다", async () => {
    await only("workflow-changed");
    p.github.setRepos([{ name: "svc", files: { ...BASE, ...WORKFLOW }, pushedAt: RECENT_PUSH }]);
    p.github.setWorkflowCommits("svc", [{ sha: sha(1), committedAt: "2026-11-10T00:00:00.000Z", url: "u", authorLogin: null }]);
    await runScan(p);

    p.github.failWorkflowCommits("svc", new Error("GitHub API 오류 (500): x"));
    expect((await runScan(p)).status).toBe("success");
    expect((await rows())[0]).toMatch(/\|open$/);

    p.github.failWorkflowCommits("svc", null);
    p.clock.advance(10 * DAY);
    p.github.setPushedAt("svc", "2026-11-21T00:00:00.000Z");
    await runScan(p);
    expect((await rows())[0]).toMatch(/\|resolved$/);
  });

  it("[SG-119] new-committer: 첫 평가는 기록만 하고 검출이 없다 (커밋이 없던 평가는 기준선이 아니다)", async () => {
    await only("new-committer");
    p.github.setRepos([{ name: "svc", files: BASE, pushedAt: RECENT_PUSH }]);
    await runScan(p);
    expect(authorsInDb()).toEqual([]);

    p.github.setCommits("svc", [commit(1), commit(2, { authorLogin: "Bob" })]);
    await runScan(p);

    expect(await rows()).toEqual([]);
    expect(authorsInDb()).toEqual(["alice", "bob"]);
    expect(calls("listRecentCommits")).toBe(2);
    expect(calls("listWorkflowCommits")).toBe(0);
  });

  it("[SG-120] new-committer: 이후 처음 보는 작성자는 그 작성자의 가장 오래된 커밋으로 1건, bot 은 무시", async () => {
    await only("new-committer");
    p.github.setRepos([{ name: "svc", files: BASE, pushedAt: RECENT_PUSH }]);
    p.github.setCommits("svc", [commit(1)]);
    await runScan(p);

    p.github.setCommits("svc", [
      commit(1),
      commit(3, { authorLogin: "Carol", committedAt: "2026-11-10T12:00:00.000Z" }),
      commit(4, { authorLogin: "carol", committedAt: "2026-11-10T06:00:00.000Z" }),
      commit(5, { authorLogin: "dependabot[bot]" }),
      commit(6, { authorLogin: "web-flow" }),
    ]);
    await runScan(p);

    expect(await rows()).toEqual([`carol|commit/${sha(4)}|${sha7(4)}|open`]);
    expect(authorsInDb()).toEqual(["alice", "carol"]);
    expect((await policyFindings())[0]?.htmlUrl).toBe(`https://github.com/my-org/svc/commit/${sha(4)}`);
  });

  it("[SG-121] new-committer: login 이 없으면 이메일의 해시로 구분하고 이메일 원문은 어디에도 남기지 않는다", async () => {
    await only("new-committer");
    p.github.setRepos([{ name: "svc", files: BASE, pushedAt: RECENT_PUSH }]);
    p.github.setCommits("svc", [commit(1)]);
    await runScan(p);

    const email = "Secret.Person@Example.com";
    p.github.setCommits("svc", [commit(1), commit(2, { authorLogin: null, authorEmail: email })]);
    await runScan(p);

    const key = `email:${hash12(email.toLowerCase())}`;
    expect(await rows()).toEqual([`${key}|commit/${sha(2)}|${sha7(2)}|open`]);
    const everything = [
      JSON.stringify(await listFindings(p)),
      JSON.stringify(p.instance.db.prepare("SELECT * FROM repo_authors").all()),
      JSON.stringify(p.logger.entries),
      p.mailer.sentText(),
    ].join("\n");
    expect(everything.toLowerCase()).not.toContain("secret.person");
    expect(everything).not.toContain("example.com");
  });

  it("[SG-122] new-committer: 같은 커밋이 보이는 동안 유지하고, 기간이 지나면 resolve 한다", async () => {
    await only("new-committer");
    p.github.setRepos([{ name: "svc", files: BASE, pushedAt: RECENT_PUSH }]);
    p.github.setCommits("svc", [commit(1)]);
    await runScan(p);
    p.github.setCommits("svc", [commit(1), commit(2, { authorLogin: "carol", committedAt: "2026-11-11T00:00:00.000Z" })]);
    await runScan(p);
    const first = await policyFindings();
    expect(first).toHaveLength(1);

    // 5일 뒤: 커밋은 기간(7일) 안, 작성자의 기록도 기간 안 → 아직 "새 작성자"
    p.clock.advance(5 * DAY);
    p.github.setPushedAt("svc", "2026-11-16T00:00:00.000Z");
    await runScan(p);
    const kept = await policyFindings();
    expect(kept.map((f) => [f.id, f.status])).toEqual([[first[0]?.id, "open"]]);

    // 같은 커밋이 보여도 작성자의 기록이 기간 밖이면 새 작성자가 아니다
    p.clock.advance(5 * DAY);
    p.github.setPushedAt("svc", "2026-11-21T00:00:00.000Z");
    p.github.setCommits("svc", [commit(2, { authorLogin: "carol", committedAt: "2026-11-16T00:00:00.000Z" })]);
    await runScan(p);
    expect((await policyFindings())[0]?.status).toBe("resolved");
  });

  it("[SG-123] new-committer: 커밋 목록을 받지 못하면 검출을 그대로 두고 기록도 하지 않는다", async () => {
    await only("new-committer");
    p.github.setRepos([{ name: "svc", files: BASE, pushedAt: RECENT_PUSH }]);
    p.github.setCommits("svc", [commit(1)]);
    await runScan(p);
    p.github.setCommits("svc", [commit(1), commit(2, { authorLogin: "carol" })]);
    await runScan(p);
    expect(await policyFindings()).toHaveLength(1);

    p.github.setCommits("svc", [commit(1)]);
    p.github.failCommits("svc", new Error("GitHub API 오류 (500): x"));
    await runScan(p);
    expect((await policyFindings())[0]?.status).toBe("open");

    p.github.failCommits("svc", null);
    p.github.setCommits("svc", [commit(1), commit(7, { authorLogin: "dave" })]);
    p.github.failCommits("svc", new Error("GitHub API 오류 (500): x"));
    await runScan(p);
    expect(authorsInDb()).toEqual(["alice", "carol"]);
  });

  it("[SG-124] new-committer: 스캔이 버려지면(org 변경) 작성자 기록도 남지 않는다", async () => {
    await only("new-committer");
    p.github.setRepos([{ name: "svc", files: BASE, pushedAt: RECENT_PUSH }]);
    p.github.setCommits("svc", [commit(1)]);
    const gate = p.github.pause("listRecentCommits", "svc");

    const running = runScan(p);
    await gate.waitReached();
    const res = await p.request("PUT", "/api/settings", {
      org: "other-org",
      scanIntervalHours: 24,
      digestTime: "09:00",
      recipients: [],
    });
    expect(res.status, res.text).toBe(200);
    gate.release();
    const scan = await running;

    expect(scan.status).toBe("failed");
    expect(authorsInDb()).toEqual([]);
  });

  it("[SG-125] 두 검사와 흔적이 함께 켜져 있어도 커밋 조회는 repo 당 1회, PR 1회, workflow 1회(최대 3회)다", async () => {
    await addEntry(p, { ecosystem: "commit", name: "needle-text", versionRange: null, reason: "r" });
    await addEntry(p, { ecosystem: "pr", name: "needle-text", versionRange: null, reason: "r" });
    p.github.setRepos([{ name: "svc", files: { ...BASE, ...WORKFLOW }, pushedAt: RECENT_PUSH }]);

    await runScan(p);

    expect(calls("listRecentCommits")).toBe(1);
    expect(calls("listWorkflowCommits")).toBe(1);
    expect(calls("listRecentPulls")).toBe(1);
  });

  it("[SG-126] 두 검사가 모두 꺼져 있고 항목도 없으면 조회가 0회다", async () => {
    await only();
    p.github.setRepos([{ name: "svc", files: { ...BASE, ...WORKFLOW }, pushedAt: RECENT_PUSH }]);

    await runScan(p);

    expect(calls("listRecentCommits") + calls("listWorkflowCommits") + calls("listRecentPulls")).toBe(0);
  });

  it("[SG-127] 내장 검사의 건수는 메일의 요약에만 나가고 즉시 메일은 없다", async () => {
    await only("workflow-changed");
    p.github.setRepos([{ name: "svc", files: { ...BASE, ...WORKFLOW }, pushedAt: RECENT_PUSH }]);
    p.github.setWorkflowCommits("svc", [{ sha: sha(1), committedAt: "2026-11-10T00:00:00.000Z", url: "u", authorLogin: "a" }]);

    await runScan(p);

    expect(p.mailer.sent).toHaveLength(0);
  });
});
