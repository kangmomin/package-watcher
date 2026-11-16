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

let t: TestApp;

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
  const page: Page<ScanRepo> = scanReposPageSchema.parse(res.json);
  const found = page.items.find((item) => item.repo === repo);
  if (!found) throw new Error(`repo 행이 없습니다: ${repo}`);
  return found;
}

const refsOf = (findings: Finding[]): string[] => findings.map((f) => `${f.ref}|${f.filePath}`).sort();
const active = async (): Promise<Finding[]> => (await allFindings(t)).filter((f) => f.status !== "resolved");

describe("브랜치 스캔 — 리뷰 반영", () => {
  it("[SF-100] 20개 상한에서 밀려난 후보 브랜치의 검출은 resolve 되지 않는다", async () => {
    setup();
    t.github.setHead("svc", "old-one", head({ ...BASE, "package-lock.json": EVIL_LOCK }, "2026-11-06T00:00:00.000Z"));
    await runScan(t);
    expect(refsOf(await active())).toEqual(["old-one|package-lock.json"]);
    for (let i = 0; i < 20; i += 1) {
      t.github.setHead("svc", `new${i}`, head({ ...BASE, "package.json": pkgJson({ name: `p${i}` }) }, `2026-11-10T00:${String(i).padStart(2, "0")}:00.000Z`));
    }

    const scan = await runScan(t);

    expect(refsOf(await active())).toEqual(["old-one|package-lock.json"]);
    expect((await repoRow(scan.id)).branchCount).toBe(20);
    // 후보에서 사라지면(브랜치 삭제) resolve 한다
    t.github.removeHead("svc", "old-one");
    await runScan(t);
    expect(await active()).toEqual([]);
  });

  it("[SF-101] package.json 만 바뀌면 기본 브랜치에서 lock 이 가려 주던 의존성은 브랜치에서도 검출하지 않는다", async () => {
    await addEntry(t, { ecosystem: "npm", name: "axios", versionRange: "1.14.1", reason: "악성" });
    const lock = npmLockV3({ axios: "1.6.0" }, { axios: "^1.6.0" });
    setup({ "package.json": pkgJson({ dependencies: { axios: "^1.6.0" } }), "package-lock.json": lock });
    t.github.setHead("svc", "dep", head({
      "package.json": pkgJson({ name: "renamed", dependencies: { axios: "^1.6.0" } }),
      "package-lock.json": lock,
    }));

    const scan = await runScan(t);

    expect(await allFindings(t)).toEqual([]);
    // lock 은 기본 브랜치에서 받은 것을 쓰므로 새 요청은 package.json 1개뿐이다
    expect(t.github.callsOf("getFile")).toHaveLength(3);
    expect((await repoRow(scan.id)).branchCount).toBe(1);
  });

  it("[SF-102] lock 만 바뀌어 악성 버전이 들어오면 package.json 의 직접 의존성으로 direct 로 검출한다", async () => {
    await addEntry(t, { ecosystem: "npm", name: "axios", versionRange: "1.14.1", reason: "악성" });
    const pkg = pkgJson({ dependencies: { axios: "^1.6.0" } });
    setup({ "package.json": pkg, "package-lock.json": npmLockV3({ axios: "1.6.0" }, { axios: "^1.6.0" }) });
    t.github.setHead("svc", "bump", head({ "package.json": pkg, "package-lock.json": npmLockV3({ axios: "1.14.1" }, { axios: "^1.6.0" }) }));

    await runScan(t);

    const found = await allFindings(t);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ ref: "bump", filePath: "package-lock.json", packageName: "axios", dependencyType: "direct" });
  });

  it("[SF-103] 달라지지 않은 파일의 검출은 브랜치에 보고하지 않는다 (기본 브랜치의 것이다)", async () => {
    setup({ ...BASE, "package-lock.json": EVIL_LOCK });
    t.github.setHead("svc", "dep", head({ "package.json": pkgJson({ name: "x" }), "package-lock.json": EVIL_LOCK }));

    await runScan(t);

    expect(refsOf(await allFindings(t))).toEqual(["|package-lock.json"]);
  });

  it("[SF-104] 의존성 파일이 없는 repo 는 최근 브랜치가 있어도 skipped 이고 branchCount 는 0 이다", async () => {
    setup({ "README.md": "x" });
    t.github.setHead("svc", "docs", head({ "README.md": "y" }));

    const scan = await runScan(t);

    expect(await repoRow(scan.id)).toMatchObject({ status: "skipped", branchCount: 0, fileCount: 0 });
  });

  it("[SF-105] 기본 브랜치에는 의존성 파일이 없어도 브랜치가 검출을 내면 issue 다", async () => {
    setup({ "README.md": "x" });
    t.github.setHead("svc", "dep", head({ "README.md": "x", "package.json": pkgJson({ dependencies: { "evil-pkg": "^1.0.0" } }) }));

    const scan = await runScan(t);

    expect(await repoRow(scan.id)).toMatchObject({ status: "issue", branchCount: 1, openFindingCount: 1 });
  });

  it("[SF-106] 오래된 커밋을 새로 push 한 브랜치도 평가한다 (events 의 push 시각, 이름으로 tree 조회)", async () => {
    setup();
    t.github.setHead("svc", "forced", head({ ...BASE, "package-lock.json": EVIL_LOCK }, OLD));
    t.github.setPush("svc", "forced", "2026-11-11T12:00:00.000Z");

    const scan = await runScan(t);

    expect(refsOf(await allFindings(t))).toEqual(["forced|package-lock.json"]);
    expect(t.github.callsOf("getTree").map((call) => call.arg)).toContain("forced");
    expect((await repoRow(scan.id)).branchCount).toBe(1);
  });

  it("[SF-107] push 기록만 남고 지워진 브랜치는 건너뛰고(404) 그 브랜치의 검출은 resolve 한다", async () => {
    setup();
    t.github.setHead("svc", "gone", head({ ...BASE, "package-lock.json": EVIL_LOCK }));
    await runScan(t);
    t.github.removeHead("svc", "gone");
    t.github.setPush("svc", "gone", "2026-11-11T12:00:00.000Z");

    const scan = await runScan(t);

    expect(scan.status).toBe("success");
    expect(await active()).toEqual([]);
  });

  it("[SF-108] push 목록 조회가 실패하면 평가하지 못한 브랜치의 검출은 그대로 둔다", async () => {
    setup();
    t.github.setHead("svc", "feature/x", head({ ...BASE, "package-lock.json": EVIL_LOCK }));
    await runScan(t);
    t.github.setHead("svc", "feature/x", head({ ...BASE, "package-lock.json": EVIL_LOCK }, OLD));
    t.github.failRecentPushes("svc", new Error("GitHub API 오류 (502): bad"));

    const scan = await runScan(t);

    expect(scan.status).toBe("success");
    expect(refsOf(await active())).toEqual(["feature/x|package-lock.json"]);
  });

  it("[SF-109] push 목록은 최근 push 가 있는 repo 에서만, repo 당 1회 조회한다", async () => {
    t.github.setRepos([
      { name: "fresh", files: BASE, pushedAt: RECENT_PUSH },
      { name: "old", files: BASE, pushedAt: "2026-11-01T00:00:00.000Z" },
    ]);
    await runScan(t);
    expect(t.github.callsOf("listRecentPushes").map((call) => call.repo)).toEqual(["fresh"]);

    await putSettings(t, { branchScanDays: 0 });
    await runScan(t);
    expect(t.github.callsOf("listRecentPushes")).toHaveLength(1);
  });

  it("[SF-111] 브랜치 단계의 rate limit 은 기본 브랜치의 결과를 버리지 않는다", async () => {
    setup({ ...BASE, "package-lock.json": EVIL_LOCK });
    t.github.failRecentBranches("svc", new RateLimitedError());

    const scan = await runScan(t);

    expect(scan.status).toBe("success");
    expect(refsOf(await allFindings(t))).toEqual(["|package-lock.json"]);
  });

  it("[SF-112] 같은 변경이 여러 번 나와도 평가한 브랜치만 센다 (달라진 파일이 없는 브랜치는 세지 않는다)", async () => {
    setup();
    t.github.setHead("svc", "same", head(BASE));

    const scan = await runScan(t);

    expect((await repoRow(scan.id)).branchCount).toBe(0);
  });
});
