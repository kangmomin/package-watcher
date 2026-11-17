import { scanReposPageSchema, type Finding, type Page, type ScanRepo } from "@pw/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RateLimitedError } from "../github/client.ts";
import { npmLockV3, pkgJson } from "../test/repoFixtures.ts";
import {
  allFindings,
  cleanupTestApps,
  createTestApp,
  putSettings,
  runScan,
  type TestApp,
} from "../test/testApp.ts";
import { addEntry } from "../test/v2.ts";
import { renderFindings } from "./notifier.ts";

let t: TestApp;

// 가짜 시계의 시작은 2026-11-12. 기본 기간은 7일이라 11-05 이후가 최근이다.
const RECENT_PUSH = "2026-11-11T00:00:00.000Z";
const RECENT_COMMIT = "2026-11-10T00:00:00.000Z";
const OLD = "2026-10-01T00:00:00.000Z";

const BASE = { "package.json": pkgJson(), "package-lock.json": npmLockV3({ "ok-pkg": "1.0.0" }) };
const EVIL_LOCK = npmLockV3({ "ok-pkg": "1.0.0", "evil-pkg": "1.0.0" });

beforeEach(async () => {
  t = createTestApp();
  await putSettings(t);
  await addEntry(t, { ecosystem: "npm", name: "evil-pkg", versionRange: null, reason: "악성" });
});

afterEach(cleanupTestApps);

function setup(files: Record<string, string> = BASE, pushedAt: string | null = RECENT_PUSH): void {
  t.github.setRepos([{ name: "svc", files, pushedAt }]);
}

const head = (files: Record<string, string>, committedAt = RECENT_COMMIT) => ({ committedAt, files });

async function repoRow(scanId: number, repo = "svc"): Promise<ScanRepo> {
  const res = await t.request("GET", `/api/scans/${scanId}/repos?limit=200`);
  expect(res.status, res.text).toBe(200);
  const page: Page<ScanRepo> = scanReposPageSchema.parse(res.json);
  const found = page.items.find((item) => item.repo === repo);
  if (!found) throw new Error(`repo 행이 없습니다: ${repo}`);
  return found;
}

const refsOf = (findings: Finding[]): string[] => findings.map((f) => `${f.ref}|${f.filePath}`).sort();
const active = async (): Promise<Finding[]> => (await allFindings(t)).filter((f) => f.status !== "resolved");

describe("브랜치 스캔 — 선정과 요청 수", () => {
  it("[SF-10] 달라진 파일만 받고 브랜치의 검출은 ref·링크·transitive 로 남는다", async () => {
    setup();
    t.github.setHead("svc", "feature/x", head({ ...BASE, "package-lock.json": EVIL_LOCK }));

    const scan = await runScan(t);

    expect(scan.status).toBe("success");
    const found = await allFindings(t);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      ref: "feature/x",
      filePath: "package-lock.json",
      packageName: "evil-pkg",
      dependencyType: "transitive",
      htmlUrl: "https://github.com/my-org/svc/blob/feature/x/package-lock.json",
    });
    // 기본 브랜치 lock(1) + package.json(1) + 브랜치에서 달라진 lock(1) — package.json 은 다시 받지 않는다
    expect(t.github.callsOf("getFile")).toHaveLength(3);
    expect(t.github.callsOf("listRecentBranches")).toHaveLength(1);
    expect(t.github.callsOf("getTree")).toHaveLength(2);
    const row = await repoRow(scan.id);
    expect(row).toMatchObject({ branchCount: 1, fileCount: 3, status: "issue", openFindingCount: 1 });
  });

  it("[SF-11] branchScanDays = 0 이면 브랜치 관련 요청이 전혀 없다", async () => {
    await putSettings(t, { branchScanDays: 0 });
    setup();
    t.github.setHead("svc", "feature/x", head({ ...BASE, "package-lock.json": EVIL_LOCK }));

    const scan = await runScan(t);

    expect(t.github.callsOf("listRecentBranches")).toHaveLength(0);
    expect(t.github.callsOf("getTree")).toHaveLength(1);
    expect(await allFindings(t)).toHaveLength(0);
    expect((await repoRow(scan.id)).branchCount).toBe(0);
  });

  it("[SF-12] 최근 push 가 없거나 알 수 없는 repo 는 브랜치를 조회하지 않는다", async () => {
    t.github.setRepos([
      { name: "old", files: BASE, pushedAt: "2026-11-01T00:00:00.000Z" },
      { name: "unknown", files: BASE, pushedAt: null },
      { name: "fresh", files: BASE, pushedAt: RECENT_PUSH },
    ]);

    await runScan(t);

    expect(t.github.callsOf("listRecentBranches").map((call) => call.repo)).toEqual(["fresh"]);
    // since 는 now - N일
    expect(t.github.callsOf("listRecentBranches")[0]?.arg).toBe("2026-11-05T00:00:00.000Z");
  });

  it("[SF-13] branchScanDays 가 기간을 정한다 (3일이면 11-09 이후)", async () => {
    await putSettings(t, { branchScanDays: 3 });
    t.github.setRepos([
      { name: "a", files: BASE, pushedAt: "2026-11-10T00:00:00.000Z" },
      { name: "b", files: BASE, pushedAt: "2026-11-08T00:00:00.000Z" },
    ]);

    await runScan(t);

    expect(t.github.callsOf("listRecentBranches").map((call) => call.repo)).toEqual(["a"]);
    expect(t.github.callsOf("listRecentBranches")[0]?.arg).toBe("2026-11-09T00:00:00.000Z");
  });

  it("[SF-14] 달라진 파일이 0개인 브랜치는 평가한 것이지만 수에는 넣지 않고 파일 요청은 없다", async () => {
    setup();
    t.github.setHead("svc", "same", head(BASE));

    const scan = await runScan(t);

    expect(t.github.callsOf("getFile")).toHaveLength(2);
    expect(t.github.callsOf("getTree")).toHaveLength(2);
    const row = await repoRow(scan.id);
    expect(row).toMatchObject({ branchCount: 0, fileCount: 2, status: "passed" });
  });

  it("[SF-15] 같은 변경을 가진 두 브랜치는 검출이 각각 생기고 같은 blob 은 1번만 받는다", async () => {
    setup();
    t.github.setHead("svc", "a", head({ ...BASE, "package-lock.json": EVIL_LOCK }));
    t.github.setHead("svc", "b", head({ ...BASE, "package-lock.json": EVIL_LOCK }, "2026-11-09T00:00:00.000Z"));

    const scan = await runScan(t);

    expect(refsOf(await allFindings(t))).toEqual(["a|package-lock.json", "b|package-lock.json"]);
    expect(t.github.callsOf("getFile")).toHaveLength(3);
    expect((await repoRow(scan.id)).branchCount).toBe(2);
  });

  it("[SF-16] 기본 브랜치와 같은 파일은 브랜치의 검출이 되지 않는다 (기본 브랜치의 검출만 남는다)", async () => {
    setup({ ...BASE, "package-lock.json": EVIL_LOCK });
    t.github.setHead("svc", "feature/x", head({ ...BASE, "package-lock.json": EVIL_LOCK, "README.md": "x" }));

    await runScan(t);

    expect(refsOf(await allFindings(t))).toEqual(["|package-lock.json"]);
  });

  it("[SF-17] 최대 20개만 평가한다 (최근 순)", async () => {
    setup();
    for (let i = 0; i < 22; i += 1) {
      t.github.setHead("svc", `b${i}`, head({ ...BASE, "package.json": pkgJson({ name: `p${i}` }) }, `2026-11-10T00:${String(i).padStart(2, "0")}:00.000Z`));
    }

    const scan = await runScan(t);

    expect((await repoRow(scan.id)).branchCount).toBe(20);
    expect(t.github.callsOf("getTree")).toHaveLength(21);
  });
});

describe("브랜치 스캔 — 평가하는 것과 하지 않는 것", () => {
  it("[SF-20] package.json 만 바뀐 브랜치는 lock 이 없는 것으로 range 를 검사한다 (direct)", async () => {
    setup();
    t.github.setHead("svc", "dep", head({ ...BASE, "package.json": pkgJson({ dependencies: { "evil-pkg": "^1.0.0" } }) }));

    await runScan(t);

    const found = await allFindings(t);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ ref: "dep", filePath: "package.json", dependencyType: "direct" });
  });

  it("[SF-21] CI 파일(workflow 의 npx)도 브랜치에서 평가한다", async () => {
    await addEntry(t, { ecosystem: "npm", name: "evil-cli", versionRange: null, reason: "악성" });
    setup();
    t.github.setHead("svc", "ci", head({
      ...BASE,
      ".github/workflows/ci.yml": "on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n      - run: npx evil-cli@1.0.0\n",
    }));

    await runScan(t);

    const found = await allFindings(t);
    expect(found.map((f) => `${f.ref}|${f.filePath}|${f.packageName}`)).toEqual(["ci|.github/workflows/ci.yml|evil-cli"]);
  });

  it("[SF-22] 흔적 path 는 달라진 파일의 경로만, content 는 달라진 파일 중 받은 것만 본다", async () => {
    await addEntry(t, { ecosystem: "path", name: "router_init.js", versionRange: null, reason: "흔적" });
    await addEntry(t, { ecosystem: "content", name: "needle-xyz", versionRange: null, reason: "흔적" });
    setup({ ...BASE, "old/router_init.js": "a" });
    t.github.setHead("svc", "trace", head({
      ...BASE,
      "old/router_init.js": "a", // 기본 브랜치와 같다 — 브랜치의 검출이 아니다
      "new/router_init.js": "b",
      "package.json": pkgJson({ dependencies: { "needle-xyz": "1.0.0" } }),
    }));

    await runScan(t);

    const found = await allFindings(t);
    expect(found.map((f) => `${f.ref}|${f.ecosystem}|${f.filePath}`).sort()).toEqual(
      ["|path|old/router_init.js", "trace|content|package.json", "trace|path|new/router_init.js"].sort(),
    );
  });

  it("[SF-23] policy(위험한 설정)와 흔적 branch 는 브랜치에서 평가하지 않는다", async () => {
    await cleanupTestApps();
    t = createTestApp({ seedPolicy: true });
    await putSettings(t);
    await addEntry(t, { ecosystem: "branch", name: "wfx-*", versionRange: null, reason: "흔적" });
    setup({ "README.md": "x" });
    t.github.setBranches("svc", ["wfx-docs"]);
    t.github.setHead("svc", "wfx-docs", head({
      "README.md": "x",
      "a/package.json": pkgJson({ dependencies: { left: "git+https://x.example/y.git" } }),
      ".github/workflows/ci.yml": "on: push\njobs:\n  a:\n    steps:\n      - uses: foo/bar@v1\n",
    }));

    await runScan(t);

    const found = await allFindings(t);
    // 기본 브랜치 스캔이 브랜치 이름을 이미 본다(ref = ""). 브랜치 안에서의 policy·branch 검출은 없다.
    expect(found.filter((f) => f.ref !== "")).toEqual([]);
    expect(found.filter((f) => f.ecosystem === "branch").map((f) => f.ref)).toEqual([""]);
    expect(t.github.callsOf("listBranches")).toHaveLength(1);
  });

  it("[SF-24] blob 캐시는 repo 단위다 (다른 repo 의 같은 변경도 각각 평가한다)", async () => {
    t.github.setRepos([
      { name: "a", files: BASE, pushedAt: RECENT_PUSH },
      { name: "b", files: BASE, pushedAt: RECENT_PUSH },
    ]);
    t.github.setHead("a", "x", head({ ...BASE, "package-lock.json": EVIL_LOCK }));
    t.github.setHead("b", "x", head({ ...BASE, "package-lock.json": EVIL_LOCK }));

    await runScan(t);

    expect((await allFindings(t)).map((f) => `${f.repo}|${f.ref}`).sort()).toEqual(["a|x", "b|x"]);
  });
});

describe("브랜치 스캔 — resolve", () => {
  const withBranch = async (): Promise<void> => {
    setup();
    t.github.setHead("svc", "feature/x", head({ ...BASE, "package-lock.json": EVIL_LOCK }));
    await runScan(t);
    expect(refsOf(await active())).toEqual(["feature/x|package-lock.json"]);
  };

  it("[SF-30] 평가했는데 이번에 나오지 않으면 resolve 한다 (고쳐진 브랜치)", async () => {
    await withBranch();
    t.github.setHead("svc", "feature/x", head(BASE));

    await runScan(t);

    expect(await active()).toEqual([]);
  });

  it("[SF-31] 브랜치가 지워지면 resolve 한다", async () => {
    await withBranch();
    t.github.removeHead("svc", "feature/x");

    await runScan(t);

    expect(await active()).toEqual([]);
  });

  it("[SF-32] 기간이 지난 브랜치는 선정되지 않아 resolve 한다", async () => {
    await withBranch();
    t.github.setHead("svc", "feature/x", head({ ...BASE, "package-lock.json": EVIL_LOCK }, OLD));

    await runScan(t);

    expect(await active()).toEqual([]);
  });

  it("[SF-33] repo 에 최근 push 가 없으면 그 repo 의 브랜치 검출을 resolve 한다", async () => {
    await withBranch();
    t.github.setPushedAt("svc", "2026-11-01T00:00:00.000Z");

    await runScan(t);

    expect(await active()).toEqual([]);
  });

  it("[SF-34] branchScanDays = 0 으로 끄면 모든 브랜치 검출을 resolve 하고 기본 브랜치의 검출은 그대로다", async () => {
    setup({ ...BASE, "package-lock.json": EVIL_LOCK });
    t.github.setHead("svc", "feature/x", head({ ...BASE, "package-lock.json": EVIL_LOCK, "x.txt": "1" }));
    t.github.setHead("svc", "y", head({ ...BASE, "package-lock.json": npmLockV3({ "evil-pkg": "2.0.0" }) }));
    await runScan(t);
    expect(refsOf(await active())).toEqual(["y|package-lock.json", "|package-lock.json"].sort());
    await putSettings(t, { branchScanDays: 0 });

    await runScan(t);

    expect(refsOf(await active())).toEqual(["|package-lock.json"]);
  });

  it("[SF-35] 브랜치 목록 조회가 실패하면 브랜치의 검출을 그대로 두고 repo 는 실패가 아니다", async () => {
    await withBranch();
    t.github.failRecentBranches("svc", new Error("GitHub API 오류 (502): bad"));

    const scan = await runScan(t);

    expect(scan.status).toBe("success");
    expect(refsOf(await active())).toEqual(["feature/x|package-lock.json"]);
    expect(t.logger.texts("warn").some((text) => text.includes("브랜치"))).toBe(true);
  });

  it("[SF-36] 브랜치의 tree 가 truncated 이면 그 브랜치만 건너뛰고 검출을 그대로 둔다", async () => {
    await withBranch();
    t.github.truncateHead("svc", "feature/x");
    t.github.setHead("svc", "other", head({ ...BASE, "z.txt": "1" }, "2026-11-09T00:00:00.000Z"));

    const scan = await runScan(t);

    expect(scan.status).toBe("success");
    expect(refsOf(await active())).toEqual(["feature/x|package-lock.json"]);
    expect((await repoRow(scan.id)).branchCount).toBe(0); // z.txt 만 바뀐 브랜치는 평가할 파일이 없다
  });

  it("[SF-37] 브랜치의 tree 조회 실패와 파일 해석 실패는 그 브랜치만 건너뛴다 (repo 는 성공)", async () => {
    setup();
    t.github.setHead("svc", "tree-fail", head({ ...BASE, "a.txt": "1" }, "2026-11-10T03:00:00.000Z"));
    t.github.failHeadTree("svc", "tree-fail", new Error("GitHub API 오류 (500): x"));
    t.github.setHead("svc", "broken", head({ ...BASE, "package-lock.json": "{ not json" }, "2026-11-10T02:00:00.000Z"));
    t.github.setHead("svc", "good", head({ ...BASE, "package-lock.json": EVIL_LOCK }, "2026-11-10T01:00:00.000Z"));

    const scan = await runScan(t);

    expect(scan.status).toBe("success");
    expect(scan.failedRepos).toEqual([]);
    expect(refsOf(await allFindings(t))).toEqual(["good|package-lock.json"]);
    expect((await repoRow(scan.id)).branchCount).toBe(1);
    expect(t.logger.texts("warn").filter((text) => text.includes("브랜치")).length).toBeGreaterThanOrEqual(2);
  });

  it("[SF-38] 브랜치 단계의 rate limit 은 평가하지 못한 브랜치의 검출을 그대로 둔다", async () => {
    await withBranch();
    t.github.failRecentBranches("svc", new RateLimitedError());

    const scan = await runScan(t);

    expect(scan.status).toBe("success");
    expect(refsOf(await active())).toEqual(["feature/x|package-lock.json"]);
  });

  it("[SF-39] 기본 브랜치의 resolve 는 브랜치의 검출에 영향이 없다", async () => {
    setup({ ...BASE, "package-lock.json": EVIL_LOCK });
    t.github.setHead("svc", "feature/x", head({ ...BASE, "package-lock.json": npmLockV3({ "evil-pkg": "1.0.0" }) }));
    await runScan(t);
    expect(refsOf(await active())).toEqual(["feature/x|package-lock.json", "|package-lock.json"].sort());

    t.github.setFiles("svc", BASE); // 기본 브랜치만 고친다
    await runScan(t);

    expect(refsOf(await active())).toEqual(["feature/x|package-lock.json"]);
  });

  it("[SF-40] 기본 브랜치의 검출은 ref 가 빈 문자열이고 링크가 그대로다", async () => {
    setup({ ...BASE, "package-lock.json": EVIL_LOCK }, null);

    await runScan(t);

    const found = await allFindings(t);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ ref: "", htmlUrl: "https://github.com/my-org/svc/blob/HEAD/package-lock.json" });
  });
});

describe("브랜치 스캔 — 안정성", () => {
  it("[SF-50] 받을 파일이 300개를 넘는 브랜치는 요청 없이 건너뛰고 검출을 그대로 둔다", async () => {
    setup();
    const files: Record<string, string> = { ...BASE };
    for (let i = 0; i < 301; i += 1) files[`pkg${i}/package.json`] = pkgJson({ name: `p${i}` });
    t.github.setHead("svc", "huge", head(files));

    const scan = await runScan(t);

    expect(scan.status).toBe("success");
    // 기본 브랜치의 2개만 받았다
    expect(t.github.callsOf("getFile")).toHaveLength(2);
    expect((await repoRow(scan.id)).branchCount).toBe(0);
    expect(t.logger.texts("warn").some((text) => text.includes("huge"))).toBe(true);
  });

  it("[SF-51] 300개 이하의 변경은 평가한다 (경계)", async () => {
    setup();
    const files: Record<string, string> = { ...BASE };
    for (let i = 0; i < 300; i += 1) files[`pkg${i}/package.json`] = pkgJson({ name: `p${i}` });
    t.github.setHead("svc", "edge", head(files));

    const scan = await runScan(t);

    expect((await repoRow(scan.id)).branchCount).toBe(1);
    expect(t.github.callsOf("getFile")).toHaveLength(302);
  });

  it("[SF-52] 브랜치 이름의 제어 문자는 로그에 그대로 남지 않는다", async () => {
    setup();
    t.github.setHead("svc", "bad\nname\u0007", head({ ...BASE, "a.txt": "1" }));
    t.github.truncateHead("svc", "bad\nname\u0007");

    await runScan(t);

    const warns = t.logger.texts("warn").filter((text) => text.includes("name"));
    expect(warns.length).toBeGreaterThan(0);
    for (const text of warns) {
      expect(text.includes("\n")).toBe(false);
      expect(text.includes("\u0007")).toBe(false);
    }
  });
});

describe("브랜치 스캔 — 메일", () => {
  const base = (overrides: Partial<Finding>): Finding => ({
    id: 1,
    repo: "svc",
    ref: "",
    filePath: "package-lock.json",
    ecosystem: "npm",
    packageName: "evil-pkg",
    version: "1.0.0",
    severity: "high",
    dependencyType: "transitive",
    status: "open",
    blacklistEntryId: 1,
    source: "manual",
    reason: "악성",
    htmlUrl: "https://github.com/my-org/svc/blob/HEAD/package-lock.json",
    firstSeenAt: "2026-11-16T00:00:00.000Z",
    resolvedAt: null,
    notifiedAt: null,
    ...overrides,
  });

  it("[SF-60] 브랜치의 검출은 repo@브랜치 로 표시하고 기본 브랜치의 줄은 그대로다", () => {
    const text = renderFindings([
      base({}),
      base({ id: 2, ref: "feature/x", htmlUrl: "https://github.com/my-org/svc/blob/feature/x/package-lock.json" }),
      base({ id: 3, ref: "bad\nref" }),
    ]);

    expect(text).toContain("[svc]\n- [high][npm] package-lock.json: evil-pkg@1.0.0");
    expect(text).toContain("[svc@feature/x]");
    expect(text).toContain("[svc@bad?ref]");
  });
});
