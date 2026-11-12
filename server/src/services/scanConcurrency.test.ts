import { scanSchema } from "@pw/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { npmLockV3, pkgJson } from "../test/repoFixtures.ts";
import {
  addBlacklist,
  allFindings,
  cleanupTestApps,
  createTestApp,
  EVIL,
  findOne,
  getScan,
  LODASH,
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

/** POST /api/scans 로 시작하고 `getTree(repo)` 에서 멈춘 상태를 만든다. */
async function startPausedScan(repo: string) {
  const gate = t.github.pause("getTree", repo);
  const res = await t.request("POST", "/api/scans");
  expect(res.status, res.text).toBe(202);
  const running = scanSchema.parse(res.json);
  await gate.waitReached();
  return {
    running,
    async finish() {
      gate.release();
      await waitForScans(t);
      return getScan(t, running.id);
    },
  };
}

describe("스캔 중 변경 (A-11)", () => {
  it("[EC-09] 스캔 중 삭제된 블랙리스트 항목의 결과는 버린다 (삭제로 resolved, 새 검출 없음)", async () => {
    const entry = await addBlacklist(t, EVIL);
    t.github.setRepos([{ name: "alpha-svc", files: { "package.json": withEvil() } }]);
    await runScan(t);

    t.github.upsertRepo({ name: "bravo-svc", files: { "package.json": withEvil() } });
    t.clock.advance(60_000);
    const paused = await startPausedScan("alpha-svc");
    const del = await t.request("DELETE", `/api/blacklist/${entry.id}`);
    expect(del.status).toBe(204);
    const scan = await paused.finish();

    expect(scan.status).toBe("success");
    expect(scan.newFindingCount).toBe(0);
    const items = await allFindings(t);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ repo: "alpha-svc", status: "resolved" });
  });

  it("[CT-13] 스캔 중 PUT 된 항목은 신규 생성도 resolve 도 하지 않고, 활성 검출의 reason 은 PUT 값이다", async () => {
    const evil = await addBlacklist(t, EVIL);
    await addBlacklist(t, LODASH);
    t.github.setRepos([{ name: "alpha-svc", files: { "package.json": withEvil() } }]);
    await runScan(t);

    t.github.setFiles("alpha-svc", { "package.json": clean() });
    t.github.upsertRepo({
      name: "bravo-svc",
      files: { "package.json": pkgJson({ dependencies: { "evil-pkg": "^1.0.0", lodash: "^4.17.0" } }) },
    });
    t.clock.advance(60_000);
    const paused = await startPausedScan("alpha-svc");
    t.clock.advance(60_000);
    const put = await t.request("PUT", `/api/blacklist/${evil.id}`, {
      name: "evil-pkg",
      versionRange: null,
      reason: "새 사유",
    });
    expect(put.status, put.text).toBe(200);
    await paused.finish();

    const items = await allFindings(t);
    expect(findOne(items, { repo: "alpha-svc", packageName: "evil-pkg" })).toMatchObject({
      status: "open",
      reason: "새 사유",
    });
    expect(items.some((item) => item.repo === "bravo-svc" && item.packageName === "evil-pkg")).toBe(
      false,
    );
    expect(findOne(items, { repo: "bravo-svc", packageName: "lodash" }).status).toBe("open");
  });

  it("[AC-08] 스캔은 기존 행의 ignored 를 바꾸지 않고 ignored 검출은 신규 메일에 넣지 않는다", async () => {
    await addBlacklist(t, EVIL);
    t.github.setRepos([{ name: "alpha-svc", files: { "package.json": withEvil() } }]);
    t.mailer.failWith = new Error("SMTP down");
    await runScan(t);
    const alpha = findOne(await allFindings(t), { repo: "alpha-svc" });
    expect(alpha.notifiedAt).toBeNull();

    t.mailer.failWith = null;
    t.mailer.clear();
    t.github.upsertRepo({ name: "bravo-svc", files: { "package.json": withEvil() } });
    t.clock.advance(60_000);
    const paused = await startPausedScan("alpha-svc");
    const patch = await t.request("PATCH", `/api/findings/${alpha.id}`, { status: "ignored" });
    expect(patch.status, patch.text).toBe(200);
    await paused.finish();

    const items = await allFindings(t);
    expect(findOne(items, { repo: "alpha-svc" })).toMatchObject({
      id: alpha.id,
      status: "ignored",
      notifiedAt: null,
    });
    const text = t.mailer.sentText();
    expect(text).toContain("bravo-svc");
    expect(text).not.toContain("alpha-svc");
  });

  it("[CT-08] 스캔 중 org 가 바뀌면 그 스캔은 아무것도 쓰지 않고 failed (repoCount·newFindingCount 0, failedRepos []), 메일도 없다", async () => {
    await addBlacklist(t, EVIL);
    t.github.setRepos([{ name: "alpha-svc", files: { "package.json": withEvil() } }]);
    await runScan(t);

    t.github.upsertRepo({ name: "bravo-svc", files: { "package.json": withEvil() } });
    t.mailer.clear();
    t.clock.advance(60_000);
    const paused = await startPausedScan("alpha-svc");
    const put = await t.request("PUT", "/api/settings", {
      org: "other-org",
      scanIntervalHours: 24,
      digestTime: "09:00",
      recipients: ["a@example.com"],
    });
    expect(put.status, put.text).toBe(200);
    const scan = await paused.finish();

    expect(scan).toMatchObject({
      status: "failed",
      repoCount: 0,
      newFindingCount: 0,
      failedRepos: [],
    });
    expect(scan.error).not.toBeNull();
    const items = await allFindings(t);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ repo: "alpha-svc", status: "resolved" });
    expect(t.mailer.attempts).toHaveLength(0);
  });
});

describe("예외 경로", () => {
  it("[EC-05] 종료 트랜잭션에서 예외가 나면 스캔은 failed + error, 검출은 그대로이고 lock 이 풀려 다음 POST /api/scans 는 202", async () => {
    await addBlacklist(t, EVIL);
    t.github.setRepos([{ name: "api", files: { "package.json": withEvil() } }]);
    t.instance.db.exec(
      "CREATE TRIGGER pw_test_fail BEFORE INSERT ON findings BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
    );

    const scan = await runScan(t);

    expect(scan.status).toBe("failed");
    expect(scan.error).not.toBeNull();
    expect(await allFindings(t)).toEqual([]);

    t.instance.db.exec("DROP TRIGGER pw_test_fail");
    const res = await t.request("POST", "/api/scans");
    expect(res.status, res.text).toBe(202);
    await waitForScans(t);
  });

  it("[EC-01] k번째 repo 에서 primary rate limit 이 나면 남은 repo 는 RATE_LIMITED 로 실패, 그 repo 들의 검출과 ② 대상은 그대로, lock 은 풀린다", async () => {
    await addBlacklist(t, EVIL);
    const names = Array.from({ length: 10 }, (_, index) => `svc-${String(index + 1).padStart(2, "0")}`);
    t.github.setRepos([
      ...names.map((name) => ({ name, files: { "package.json": withEvil() } })),
      { name: "gone", files: { "package.json": withEvil() } },
    ]);
    await runScan(t);
    expect(await allFindings(t)).toHaveLength(11);

    for (const name of names) t.github.setFiles(name, { "package.json": clean() });
    t.github.removeRepo("gone");
    t.github.rateLimitFrom = "svc-03";
    t.clock.advance(60_000);
    const scan = await runScan(t);

    expect(scan.status).toBe("partial");
    const failed = new Map(scan.failedRepos.map((entry) => [entry.repo, entry.error]));
    expect(failed.get("svc-03")).toContain("RATE_LIMITED");
    expect(failed.get("svc-10")).toContain("RATE_LIMITED");
    const items = await allFindings(t);
    for (const name of names) {
      const finding = findOne(items, { repo: name });
      expect(finding.status).toBe(failed.has(name) ? "open" : "resolved");
    }
    expect(findOne(items, { repo: "gone" }).status).toBe("open");

    const res = await t.request("POST", "/api/scans");
    expect(res.status, res.text).toBe(202);
    await waitForScans(t);
  });
});

describe("결과 중복 제거 (검출 키당 1행)", () => {
  it("[AC-03] 한 lockfile 에 같은 패키지@버전이 중첩 경로로 2번 있어도 행 1개, direct 우선, newFindingCount 1", async () => {
    await addBlacklist(t, LODASH);
    const lock = JSON.parse(npmLockV3({ lodash: "4.17.20", "some-lib": "1.0.0" })) as {
      packages: Record<string, unknown>;
    };
    lock.packages["node_modules/some-lib/node_modules/lodash"] = { version: "4.17.20" };
    t.github.setRepos([
      {
        name: "api",
        files: {
          "package.json": pkgJson({ dependencies: { lodash: "^4.17.0", "some-lib": "^1.0.0" } }),
          "package-lock.json": JSON.stringify(lock, null, 2),
        },
      },
    ]);

    const scan = await runScan(t);

    expect(scan.newFindingCount).toBe(1);
    const items = await allFindings(t);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ version: "4.17.20", dependencyType: "direct" });
  });

  it("[AC-03] pnpm 의 peer suffix 만 다른 같은 패키지@버전은 행 1개", async () => {
    await addBlacklist(t, { name: "styled-thing", versionRange: null, reason: "사용 금지" });
    const lock = [
      "lockfileVersion: '6.0'",
      "",
      "packages:",
      "",
      "  /styled-thing@1.0.0(react@17.0.2):",
      "    resolution: {integrity: sha512-a}",
      "    dev: false",
      "",
      "  /styled-thing@1.0.0(react@18.2.0):",
      "    resolution: {integrity: sha512-a}",
      "    dev: false",
      "",
    ].join("\n");
    t.github.setRepos([
      {
        name: "web",
        files: { "package.json": pkgJson({ dependencies: { react: "^18.2.0" } }), "pnpm-lock.yaml": lock },
      },
    ]);

    const scan = await runScan(t);

    expect(scan.newFindingCount).toBe(1);
    const items = await allFindings(t);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ packageName: "styled-thing", version: "1.0.0" });
  });

  it("[AC-01] 목록에 같은 repo 가 2번 나와도 repo 1개로 센다 (행 1개, repoCount 1)", async () => {
    await addBlacklist(t, EVIL);
    t.github.setRepos([{ name: "api", files: { "package.json": withEvil() } }]);
    t.github.duplicateInList.add("api");

    const scan = await runScan(t);

    expect(scan).toMatchObject({ repoCount: 1, newFindingCount: 1 });
    expect(await allFindings(t)).toHaveLength(1);
  });
});
