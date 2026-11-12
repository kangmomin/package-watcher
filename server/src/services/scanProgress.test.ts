import { scanReposPageSchema, scanSchema, type Page, type ScanRepo } from "@pw/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pkgJson } from "../test/repoFixtures.ts";
import {
  addBlacklist,
  allFindings,
  cleanupTestApps,
  createTestApp,
  EVIL,
  expectApiError,
  getScan,
  listScans,
  patchFinding,
  putSettings,
  runScan,
  waitForScans,
  type TestApp,
} from "../test/testApp.ts";

const withEvil = () => pkgJson({ dependencies: { "evil-pkg": "^1.0.0" } });
const clean = () => pkgJson({ dependencies: { "safe-lib": "^2.0.0" } });

let t: TestApp;

beforeEach(async () => {
  t = createTestApp();
  await putSettings(t);
});

afterEach(cleanupTestApps);

async function getRepos(
  scanId: number,
  query: Record<string, string> = {},
  app: TestApp = t,
): Promise<Page<ScanRepo>> {
  const qs = new URLSearchParams({ limit: "200", ...query }).toString();
  const res = await app.request("GET", `/api/scans/${scanId}/repos?${qs}`);
  expect(res.status, res.text).toBe(200);
  return scanReposPageSchema.parse(res.json);
}

const byName = (page: Page<ScanRepo>, repo: string): ScanRepo => {
  const found = page.items.find((item) => item.repo === repo);
  if (!found) throw new Error(`repo 행이 없습니다: ${repo}`);
  return found;
};

async function startScan(): Promise<number> {
  const res = await t.request("POST", "/api/scans");
  expect(res.status, res.text).toBe(202);
  return scanSchema.parse(res.json).id;
}

/** 이름 r1..r7 의 repo 7개를 만들고 앞의 5개(동시 처리 수)에서 멈춘 스캔을 시작한다. 나머지 2개는 pending 이다. */
async function startBlockedScan() {
  const names = ["r1", "r2", "r3", "r4", "r5", "r6", "r7"];
  t.github.setRepos(names.map((name) => ({ name, files: { "package.json": clean() } })));
  const gates = names.slice(0, 5).map((name) => t.github.pause("getTree", name));
  const scanId = await startScan();
  await Promise.all(gates.map((gate) => gate.waitReached()));
  return {
    scanId,
    async release() {
      for (const gate of gates) gate.release();
      await waitForScans(t);
    },
  };
}

describe("파싱 실패 2건의 수정", () => {
  it("[SP-02] 주석·끝 쉼표가 있는 package.json 은 repo 를 실패시키지 않고, 같은 repo 의 다른 package.json 의 검출이 생긴다", async () => {
    await addBlacklist(t, EVIL);
    const sencha = `{
  /**
   * Sencha Cmd 가 만든 파일
   */
  // 테마 설정
  "name": "mathsecr-theme",
  "version": "1.0.0",
  "dependencies": { "safe-lib": "^2.0.0", },
}
`;
    t.github.setRepos([
      {
        name: "PostSencha",
        files: { "package.json": withEvil(), "local/mathsecr-theme/package.json": sencha },
      },
    ]);

    const scan = await runScan(t);

    expect(scan).toMatchObject({ status: "success", failedRepos: [], newFindingCount: 1 });
    expect((await allFindings(t)).map((item) => item.repo)).toEqual(["PostSencha"]);
  });

  it("[SP-02] 주석이 있는 package.json 의 직접 의존성도 검사한다", async () => {
    await addBlacklist(t, EVIL);
    const commented = `{\n  // 주석\n  "name": "x",\n  "dependencies": { "evil-pkg": "^1.0.0", }\n}\n`;
    t.github.setRepos([{ name: "api", files: { "package.json": commented } }]);

    const scan = await runScan(t);

    expect(scan).toMatchObject({ status: "success", newFindingCount: 1 });
  });

  it("[SP-02] 완전히 깨진 JSON 은 지금처럼 repo 실패다", async () => {
    t.github.setRepos([{ name: "broken", files: { "package.json": '{ "name": ' } }]);

    const scan = await runScan(t);

    expect(scan.status).toBe("partial");
    expect(scan.failedRepos).toHaveLength(1);
    expect(scan.failedRepos[0]).toMatchObject({ repo: "broken" });
    expect(scan.failedRepos[0]?.error).toContain("package.json 을 JSON 으로 읽을 수 없습니다");
  });

  it("[SP-01] pnpm 다중 문서 lockfile 의 두 번째 문서 패키지도 검출한다", async () => {
    await addBlacklist(t, EVIL);
    const lock = `---
lockfileVersion: '9.0'

packages:

  pnpm@11.7.0:
    resolution: {integrity: sha512-pnpm}

---
lockfileVersion: '9.0'

packages:

  evil-pkg@1.0.0:
    resolution: {integrity: sha512-evil}
`;
    t.github.setRepos([{ name: "FE.OnlineClass", files: { "package.json": clean(), "pnpm-lock.yaml": lock } }]);

    const scan = await runScan(t);

    expect(scan).toMatchObject({ status: "success", failedRepos: [], newFindingCount: 1 });
  });

  it("[SP-01] 해석할 수 없는 lockfile 의 오류 문구는 '을 해석할 수 없습니다' 가 한 번만 나온다", async () => {
    t.github.setRepos([
      {
        name: "web",
        files: { "package.json": clean(), "pnpm-lock.yaml": "lockfileVersion: '9.0'\npackages: [unclosed\n" },
      },
    ]);

    const scan = await runScan(t);

    const message = scan.failedRepos[0]?.error ?? "";
    expect(message).toContain("pnpm-lock.yaml");
    expect(message.split("을 해석할 수 없습니다")).toHaveLength(2);
  });
});

describe("repo 별 기록과 집계", () => {
  it("[SP-03] 종료 후 repoStats(합 = total)와 /repos 의 상태·수·오류", async () => {
    await addBlacklist(t, EVIL);
    t.github.setRepos([
      { name: "ok", files: { "package.json": clean() } },
      { name: "bad", files: { "package.json": withEvil(), "web/package.json": clean() } },
      { name: "docs", files: { "README.md": "x" } },
      { name: "boom", files: { "package.json": clean() } },
    ]);
    t.github.failTree("boom", new Error("트리 조회 실패"));

    const scan = await runScan(t);

    expect(scan.status).toBe("partial");
    expect(scan.repoStats).toEqual({
      total: 4,
      pending: 0,
      running: 0,
      passed: 1,
      issue: 1,
      failed: 1,
      skipped: 1,
    });
    expect(await getScan(t, scan.id)).toEqual(scan);
    const repos = await getRepos(scan.id);
    expect(repos.total).toBe(4);
    expect(byName(repos, "ok")).toMatchObject({
      status: "passed",
      openFindingCount: 0,
      newFindingCount: 0,
      fileCount: 1,
      error: null,
    });
    expect(byName(repos, "bad")).toMatchObject({
      status: "issue",
      openFindingCount: 1,
      newFindingCount: 1,
      fileCount: 2,
      error: null,
    });
    expect(byName(repos, "docs")).toMatchObject({ status: "skipped", fileCount: 0, error: null });
    expect(byName(repos, "boom")).toMatchObject({ status: "failed", error: "트리 조회 실패" });
    for (const item of repos.items) {
      expect(item.startedAt).not.toBeNull();
      expect(item.finishedAt).not.toBeNull();
    }
    // 목록도 같은 집계를 낸다.
    expect((await listScans(t)).items[0]?.repoStats).toEqual(scan.repoStats);
  });

  it("[SP-03] rate limit 으로 검사하지 못한 repo 는 failed(RATE_LIMITED)", async () => {
    t.github.setRepos([
      { name: "a-first", files: { "package.json": clean() } },
      { name: "b-limited", files: { "package.json": clean() } },
    ]);
    t.github.rateLimitFrom = "b-limited";

    const scan = await runScan(t);

    // 소진된 뒤의 호출은 모두 RATE_LIMITED 라서 동시에 진행하던 repo 도 실패할 수 있다.
    expect(scan.repoStats).toMatchObject({ total: 2, pending: 0, running: 0 });
    expect(scan.repoStats?.failed).toBeGreaterThanOrEqual(1);
    expect(byName(await getRepos(scan.id), "b-limited")).toMatchObject({
      status: "failed",
      error: "RATE_LIMITED",
    });
  });

  it("[SP-03] repo 목록 조회에 실패한 스캔은 repoStats 가 null 이고 /repos 는 빈 목록", async () => {
    t.github.listError = new Error("boom");

    const scan = await runScan(t);

    expect(scan.status).toBe("failed");
    expect(scan.repoStats).toBeNull();
    expect((await getRepos(scan.id)).items).toEqual([]);
  });

  it("[SP-04] 진행 중: pending·running 수와 끝난 repo 의 임시 상태", async () => {
    await addBlacklist(t, EVIL);
    t.github.setRepos([
      { name: "slow", files: { "package.json": clean() } },
      { name: "done-clean", files: { "package.json": clean() } },
      { name: "done-evil", files: { "package.json": withEvil() } },
      { name: "done-empty", files: { "README.md": "x" } },
    ]);
    const gate = t.github.pause("getTree", "slow");

    const scanId = await startScan();
    await gate.waitReached();
    await vi.waitFor(async () => {
      expect((await getScan(t, scanId)).repoStats).toMatchObject({ passed: 1, issue: 1, skipped: 1 });
    });

    const running = await getScan(t, scanId);
    expect(running.status).toBe("running");
    expect(running.repoStats).toEqual({
      total: 4,
      pending: 0,
      running: 1,
      passed: 1,
      issue: 1,
      failed: 0,
      skipped: 1,
    });
    const repos = await getRepos(scanId);
    expect(byName(repos, "slow")).toMatchObject({ status: "running", finishedAt: null });
    expect(byName(repos, "slow").startedAt).not.toBeNull();
    expect(byName(repos, "done-evil")).toMatchObject({ status: "issue", fileCount: 1 });

    gate.release();
    await waitForScans(t);
    expect((await getScan(t, scanId)).repoStats).toMatchObject({ running: 0, passed: 2, issue: 1, skipped: 1 });
  });

  it("[SP-04] 동시 처리 수(5)보다 repo 가 많으면 남은 repo 는 pending", async () => {
    const blocked = await startBlockedScan();

    expect((await getScan(t, blocked.scanId)).repoStats).toEqual({
      total: 7,
      pending: 2,
      running: 5,
      passed: 0,
      issue: 0,
      failed: 0,
      skipped: 0,
    });
    await blocked.release();
    expect((await getScan(t, blocked.scanId)).repoStats).toMatchObject({
      total: 7,
      passed: 7,
      pending: 0,
      running: 0,
    });
  });

  it("[SP-06] ignored 검출만 있는 repo 는 passed, 기존 open 검출이 있는 repo 는 신규 0건이어도 issue", async () => {
    await addBlacklist(t, EVIL);
    t.github.setRepos([
      { name: "api", files: { "package.json": withEvil() } },
      { name: "web", files: { "package.json": withEvil() } },
    ]);
    const first = await runScan(t);
    expect(first.repoStats).toMatchObject({ issue: 2 });
    const webFinding = (await allFindings(t)).find((item) => item.repo === "web");
    if (!webFinding) throw new Error("web 검출이 없습니다");
    await patchFinding(t, webFinding.id, "ignored");

    t.clock.advance(60_000);
    const second = await runScan(t);

    expect(second.newFindingCount).toBe(0);
    expect(second.repoStats).toMatchObject({ passed: 1, issue: 1 });
    const repos = await getRepos(second.id);
    expect(byName(repos, "api")).toMatchObject({ status: "issue", openFindingCount: 1, newFindingCount: 0 });
    expect(byName(repos, "web")).toMatchObject({ status: "passed", openFindingCount: 0, newFindingCount: 0 });
  });

  it("[SP-07] org 변경으로 결과를 버린 스캔에는 pending·running 이 남지 않는다 (합 = total)", async () => {
    const blocked = await startBlockedScan();
    const put = await t.request("PUT", "/api/settings", {
      org: "other-org",
      scanIntervalHours: 24,
      digestTime: "09:00",
      recipients: ["a@example.com"],
    });
    expect(put.status, put.text).toBe(200);
    await blocked.release();

    const scan = await getScan(t, blocked.scanId);
    expect(scan.status).toBe("failed");
    const stats = scan.repoStats;
    if (!stats) throw new Error("repoStats 가 없습니다");
    expect(stats).toMatchObject({ total: 7, pending: 0, running: 0 });
    expect(stats.passed + stats.issue + stats.failed + stats.skipped).toBe(7);
  });

  it("[SP-07] 서버 재시작으로 끊긴 스캔의 확정되지 않은 행(pending·running·임시 passed)은 failed(오류 = 서버 재시작)", async () => {
    t.github.setRepos([{ name: "a", files: { "package.json": clean() } }]);
    const first = await runScan(t);
    // 실행 중에 프로세스가 죽은 상태를 만든다: running 스캔 + pending·running·완료 행
    const db = t.instance.db;
    const crashed = Number(
      db
        .prepare(`INSERT INTO scans ("trigger", status, started_at) VALUES ('manual', 'running', ?)`)
        .run(t.clock.iso()).lastInsertRowid,
    );
    const insert = db.prepare("INSERT INTO scan_repos (scan_id, repo, status) VALUES (?, ?, ?)");
    insert.run(crashed, "p", "pending");
    insert.run(crashed, "r", "running");
    insert.run(crashed, "d", "passed");
    await t.close();

    const second = createTestApp({ dbPath: t.dbPath, github: t.github });

    const scan = await getScan(second, crashed);
    expect(scan).toMatchObject({ status: "failed", error: "서버 재시작" });
    expect(scan.repoStats).toEqual({
      total: 3,
      pending: 0,
      running: 0,
      passed: 0,
      issue: 0,
      failed: 3,
      skipped: 0,
    });
    const repos = await getRepos(crashed, {}, second);
    expect(byName(repos, "p")).toMatchObject({ status: "failed", error: "서버 재시작" });
    expect(byName(repos, "r")).toMatchObject({ status: "failed", error: "서버 재시작" });
    // 임시 passed 도 실패다: 종료 트랜잭션이 없었으므로 그 repo 의 검출은 반영되지 않았다.
    expect(byName(repos, "d")).toMatchObject({ status: "failed", error: "서버 재시작" });
    // 정상 종료한 이전 스캔은 그대로다.
    expect((await getScan(second, first.id)).repoStats).toEqual(first.repoStats);
  });

  it("[SP-03] 진행 기록의 쓰기가 실패해도 스캔은 계속한다 (insert 실패)", async () => {
    await addBlacklist(t, EVIL);
    t.github.setRepos([{ name: "api", files: { "package.json": withEvil() } }]);
    t.instance.db.exec(
      "CREATE TRIGGER pw_fail_ins BEFORE INSERT ON scan_repos BEGIN SELECT RAISE(ABORT, 'injected'); END;",
    );

    const scan = await runScan(t);

    expect(scan).toMatchObject({ status: "success", newFindingCount: 1, repoStats: null });
    expect(await allFindings(t)).toHaveLength(1);
  });

  it("[SP-03] 진행 기록의 쓰기가 실패해도 스캔은 계속한다 (update 실패)", async () => {
    await addBlacklist(t, EVIL);
    t.github.setRepos([{ name: "api", files: { "package.json": withEvil() } }]);
    t.instance.db.exec(
      "CREATE TRIGGER pw_fail_upd BEFORE UPDATE ON scan_repos BEGIN SELECT RAISE(ABORT, 'injected'); END;",
    );

    const scan = await runScan(t);

    expect(scan).toMatchObject({ status: "success", newFindingCount: 1 });
    expect(await allFindings(t)).toHaveLength(1);
  });

  it("[SP-09] 31번째 스캔이 시작되면 가장 오래된 스캔의 repo 행이 지워지고 집계는 남는다", async () => {
    t.github.setRepos([
      { name: "a", files: { "package.json": clean() } },
      { name: "b", files: { "README.md": "x" } },
    ]);
    const scans = [];
    for (let i = 0; i < 31; i += 1) {
      t.clock.advance(60_000);
      scans.push(await runScan(t));
    }

    const [oldest, second, latest] = [scans[0], scans[1], scans[30]];
    if (!oldest || !second || !latest) throw new Error("unreachable");
    const gone = await getRepos(oldest.id);
    expect(gone.items).toEqual([]);
    expect(gone.total).toBe(0);
    expect((await getScan(t, oldest.id)).repoStats).toEqual(oldest.repoStats);
    expect(oldest.repoStats).toMatchObject({ total: 2, passed: 1, skipped: 1 });
    expect((await getRepos(second.id)).total).toBe(2);
    expect((await getRepos(latest.id)).total).toBe(2);
  });
});

describe("GET /api/scans/:id/repos", () => {
  async function seedScan(): Promise<number> {
    await addBlacklist(t, EVIL);
    t.github.setRepos([
      { name: "zeta", files: { "package.json": clean() } },
      { name: "alpha", files: { "package.json": clean() } },
      { name: "Beta", files: { "README.md": "x" } },
      { name: "gamma", files: { "package.json": withEvil() } },
      { name: "delta", files: { "package.json": clean() } },
    ]);
    t.github.failTree("delta", new Error("실패"));
    return (await runScan(t)).id;
  }

  it("[SP-05] 정렬: failed → issue → passed → skipped, 같으면 repo 이름", async () => {
    const id = await seedScan();

    const page = await getRepos(id);

    expect(page.items.map((item) => `${item.status}:${item.repo}`)).toEqual([
      "failed:delta",
      "issue:gamma",
      "passed:alpha",
      "passed:zeta",
      "skipped:Beta",
    ]);
    expect(page).toMatchObject({ total: 5, page: 1, limit: 200 });
  });

  it("[SP-05] 정렬: running 이 pending 보다 앞", async () => {
    const blocked = await startBlockedScan();

    const page = await getRepos(blocked.scanId);

    expect(page.items.map((item) => `${item.status}:${item.repo}`)).toEqual([
      "running:r1",
      "running:r2",
      "running:r3",
      "running:r4",
      "running:r5",
      "pending:r6",
      "pending:r7",
    ]);
    await blocked.release();
  });

  it("[SP-05] status 는 정확히 일치, q 는 대소문자 무시 부분 일치, 둘을 함께 쓰면 AND", async () => {
    const id = await seedScan();

    expect((await getRepos(id, { status: "passed" })).items.map((item) => item.repo)).toEqual(["alpha", "zeta"]);
    expect((await getRepos(id, { q: "TA" })).items.map((item) => item.repo)).toEqual(["delta", "zeta", "Beta"]);
    const both = await getRepos(id, { q: "ta", status: "skipped" });
    expect(both.items.map((item) => item.repo)).toEqual(["Beta"]);
    expect(both.total).toBe(1);
    expect((await getRepos(id, { q: "  " })).total).toBe(5);
    expect((await getRepos(id, { q: "없는-이름" })).items).toEqual([]);
  });

  it("[SP-05] q 의 % 와 _ 는 문자 그대로 찾는다", async () => {
    t.github.setRepos([
      { name: "a_b", files: { "package.json": clean() } },
      { name: "axb", files: { "package.json": clean() } },
    ]);
    const id = (await runScan(t)).id;

    expect((await getRepos(id, { q: "a_b" })).items.map((item) => item.repo)).toEqual(["a_b"]);
    expect((await getRepos(id, { q: "%" })).items).toEqual([]);
  });

  it("[SP-05] 페이지: limit 기본값 50, page 이동, 범위 밖 page 는 빈 items + total 유지", async () => {
    const id = await seedScan();

    const second = await getRepos(id, { limit: "2", page: "2" });
    expect(second.items.map((item) => item.repo)).toEqual(["alpha", "zeta"]);
    expect(second).toMatchObject({ total: 5, page: 2, limit: 2 });
    const beyond = await getRepos(id, { limit: "2", page: "9" });
    expect(beyond).toMatchObject({ items: [], total: 5, page: 9 });
    const res = await t.request("GET", `/api/scans/${id}/repos`);
    expect(scanReposPageSchema.parse(res.json).limit).toBe(50);
  });

  it("[SP-05] 없는 스캔은 404 NOT_FOUND (query 검증보다 먼저)", async () => {
    await seedScan();

    expectApiError(await t.request("GET", "/api/scans/9999/repos"), 404, "NOT_FOUND");
    expectApiError(await t.request("GET", "/api/scans/9999/repos?status=bogus"), 404, "NOT_FOUND");
  });

  it("[SP-05] 잘못된 query 는 400 VALIDATION_ERROR", async () => {
    const id = await seedScan();

    for (const query of ["status=bogus", "limit=201", "limit=0", "page=0", "page=abc"]) {
      expectApiError(await t.request("GET", `/api/scans/${id}/repos?${query}`), 400, "VALIDATION_ERROR");
    }
  });
});
