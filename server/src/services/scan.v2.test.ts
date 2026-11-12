import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MINUTE } from "../test/clock.ts";
import { npmLockV3, pkgJson } from "../test/repoFixtures.ts";
import {
  allFindings,
  cleanupTestApps,
  createTestApp,
  EVIL,
  findOne,
  getSummary,
  listFindings,
  patchFinding,
  putSettings,
  runScan,
  type TestApp,
} from "../test/testApp.ts";
import { addEntry, getEntry, putEntry, startPausedScan } from "../test/v2.ts";

const withEvil = () => pkgJson({ dependencies: { "evil-pkg": "^1.0.0" } });

let t: TestApp;

beforeEach(async () => {
  t = createTestApp();
  await putSettings(t);
});

afterEach(cleanupTestApps);

describe("패턴 항목 매칭 (v2-AC-02)", () => {
  it("[v2-AC-02] 항목 `@evil/*`(범위 null) + lockfile 의 `@evil/a`, `@evil/b` → open 검출 2건, packageName 은 실제 패키지 이름이다", async () => {
    const entry = await addEntry(t, { name: "@evil/*", versionRange: null, reason: "악성 스코프" });
    t.github.setRepos([
      {
        name: "api",
        files: {
          "package.json": pkgJson({ dependencies: { "@evil/a": "^1.0.0", "safe-lib": "^2.0.0" } }),
          "package-lock.json": npmLockV3(
            { "@evil/a": "1.0.0", "@evil/b": "2.3.4", "@evilx/c": "1.0.0", "safe-lib": "2.0.0" },
            { "@evil/a": "^1.0.0", "safe-lib": "^2.0.0" },
          ),
        },
      },
    ]);

    const scan = await runScan(t);

    expect(scan).toMatchObject({ status: "success", newFindingCount: 2, failedRepos: [] });
    const items = (await allFindings(t)).sort((a, b) => a.packageName.localeCompare(b.packageName));
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      repo: "api",
      filePath: "package-lock.json",
      packageName: "@evil/a",
      version: "1.0.0",
      dependencyType: "direct",
      status: "open",
      blacklistEntryId: entry.id,
      reason: "악성 스코프",
    });
    expect(items[1]).toMatchObject({
      filePath: "package-lock.json",
      packageName: "@evil/b",
      version: "2.3.4",
      dependencyType: "transitive",
      status: "open",
      blacklistEntryId: entry.id,
    });
  });

  it("[v2-AC-02] lockfile 이 없는 repo 에서도 패턴은 이름 전체와 비교하고 버전 범위를 함께 적용한다 (`*` 는 `/` 를 넘는다)", async () => {
    const leftPad = await addEntry(t, { name: "left-pad*", versionRange: "<2", reason: "오래된 버전" });
    const malware = await addEntry(t, { name: "*-malware", reason: "이름 규칙" });
    t.github.setRepos([
      {
        name: "tools",
        files: {
          "package.json": pkgJson({
            dependencies: {
              "left-pad": "^1.3.0",
              "left-pad-utils": "^3.0.0",
              "my-left-pad": "^1.0.0",
              "@scope/x-malware": "^0.1.0",
              "x-malware-kit": "^0.1.0",
              "Left-Pad": "^1.0.0",
            },
          }),
        },
      },
    ]);

    const scan = await runScan(t);

    expect(scan.newFindingCount).toBe(2);
    const items = await allFindings(t);
    expect(items.map((item) => [item.packageName, item.version, item.blacklistEntryId]).sort()).toEqual(
      [
        ["@scope/x-malware", "^0.1.0", malware.id],
        ["left-pad", "^1.3.0", leftPad.id],
      ].sort(),
    );
  });

  it("[v2-AC-02] 한 패키지가 항목 여러 개(정확한 이름 + 패턴)와 일치하면 항목마다 검출 1건이다", async () => {
    const exact = await addEntry(t, { name: "@evil/a", reason: "정확한 이름" });
    const pattern = await addEntry(t, { name: "@evil/*", reason: "패턴" });
    t.github.setRepos([
      { name: "api", files: { "package.json": pkgJson({ dependencies: { "@evil/a": "^1.0.0" } }) } },
    ]);

    const scan = await runScan(t);

    expect(scan.newFindingCount).toBe(2);
    const items = await allFindings(t);
    expect(items.map((item) => item.packageName)).toEqual(["@evil/a", "@evil/a"]);
    expect(items.map((item) => item.blacklistEntryId).sort()).toEqual([exact.id, pattern.id].sort());
    expect(items.map((item) => item.reason).sort()).toEqual(["정확한 이름", "패턴"].sort());
  });

  it("[v2-AC-02] lockfile 이 없는 경로에서 패턴 항목은 같은 repo 의 내부 workspace 패키지를 잡지 않는다 (정확한 이름 항목과 외부 패키지는 검출)", async () => {
    const pattern = await addEntry(t, { name: "*-utils", reason: "패턴" });
    const exact = await addEntry(t, { name: "@acme/core-utils", reason: "정확한 이름" });
    t.github.setRepos([
      {
        name: "monorepo",
        files: {
          "package.json": pkgJson({ name: "root", workspaces: ["packages/*"] }),
          // lockfile 파서는 workspace 패키지를 빼므로 `@acme/core-utils` 는 range 폴백 경로로 온다.
          "package-lock.json": npmLockV3({ "safe-lib": "2.0.0" }),
          "packages/a/package.json": pkgJson({
            name: "@acme/a",
            dependencies: { "@acme/core-utils": "*", "lodash-utils": "^1.0.0" },
          }),
          "packages/core-utils/package.json": pkgJson({ name: "@acme/core-utils" }),
        },
      },
    ]);

    await runScan(t);

    const items = await allFindings(t);
    expect(items.map((item) => [item.filePath, item.packageName, item.blacklistEntryId]).sort()).toEqual(
      [
        ["packages/a/package.json", "@acme/core-utils", exact.id],
        ["packages/a/package.json", "lodash-utils", pattern.id],
      ].sort(),
    );
  });
});

describe("항목 끄기 (v2-AC-04, CT-19)", () => {
  it("[v2-AC-04][CT-19] 활성 검출(open·ignored)이 있는 항목을 PUT enabled:false → 그 검출이 resolved + resolvedAt, 다음 스캔은 검출을 만들지 않고, 다시 켜도 다음 스캔 전에는 검출이 없다", async () => {
    const entry = await addEntry(t, EVIL);
    t.github.setRepos([
      { name: "api", files: { "package.json": withEvil() } },
      { name: "web", files: { "package.json": withEvil() } },
    ]);
    await runScan(t);
    const ignored = findOne(await allFindings(t), { repo: "web" });
    await patchFinding(t, ignored.id, "ignored");

    t.clock.advance(MINUTE);
    const disabledAt = t.clock.iso();
    const disabled = await putEntry(t, entry.id, { ...EVIL, versionRange: null, enabled: false });

    expect(disabled).toMatchObject({ enabled: false, isExpired: false });
    const resolved = await allFindings(t);
    expect(resolved.map((item) => [item.status, item.resolvedAt])).toEqual([
      ["resolved", disabledAt],
      ["resolved", disabledAt],
    ]);
    expect(await getSummary(t)).toMatchObject({ openCount: 0, ignoredCount: 0 });

    t.clock.advance(MINUTE);
    const skipped = await runScan(t);
    expect(skipped).toMatchObject({ status: "success", newFindingCount: 0 });
    expect(await allFindings(t)).toHaveLength(2);

    // 다시 켜는 것은 검출을 만들지 않는다. 다음 스캔이 새 open 검출을 만든다(무시 결정은 사라진다).
    const enabled = await putEntry(t, entry.id, { ...EVIL, versionRange: null, enabled: true });
    expect(enabled.enabled).toBe(true);
    expect((await listFindings(t, { status: "open" })).total).toBe(0);
    t.clock.advance(MINUTE);
    const rescanned = await runScan(t);
    expect(rescanned.newFindingCount).toBe(2);
    expect(await getSummary(t)).toMatchObject({ openCount: 2, ignoredCount: 0 });
    expect(await allFindings(t)).toHaveLength(4);
  });

  it("[CT-19] 스캔은 활성 항목만 쓴다 (꺼진 채로 만든 항목은 검출을 만들지 않는다)", async () => {
    const off = await addEntry(t, { name: "off-pkg", reason: "꺼짐", enabled: false });
    const on = await addEntry(t, { name: "on-pkg", reason: "켬", severity: "high" });
    t.github.setRepos([
      {
        name: "api",
        files: { "package.json": pkgJson({ dependencies: { "off-pkg": "^1.0.0", "on-pkg": "^1.0.0" } }) },
      },
    ]);

    const scan = await runScan(t);

    expect(off.enabled).toBe(false);
    expect(scan.newFindingCount).toBe(1);
    const items = await allFindings(t);
    expect(items.map((item) => [item.packageName, item.blacklistEntryId, item.severity])).toEqual([
      ["on-pkg", on.id, "high"],
    ]);
  });

  it("[CT-19] PUT 은 그 항목의 활성 검출(open·ignored)의 severity 를 갱신하고 resolved 검출과 다른 항목의 검출은 그대로 둔다", async () => {
    const entry = await addEntry(t, { ...EVIL, severity: "low" });
    await addEntry(t, { name: "other-pkg", reason: "다른 항목", severity: "low" });
    const files = (...names: string[]) => ({
      "package.json": pkgJson({ dependencies: Object.fromEntries(names.map((name) => [name, "^1.0.0"])) }),
    });
    t.github.setRepos([
      { name: "api", files: files("evil-pkg", "other-pkg") },
      { name: "web", files: files("evil-pkg") },
      { name: "old", files: files("evil-pkg") },
    ]);
    await runScan(t);
    await patchFinding(t, findOne(await allFindings(t), { repo: "web" }).id, "ignored");
    // old 에서 의존성을 지워 resolved 검출 1건을 만든다.
    t.github.setFiles("old", files("safe-lib"));
    t.clock.advance(MINUTE);
    await runScan(t);
    expect((await allFindings(t)).map((item) => item.severity)).toEqual(["low", "low", "low", "low"]);

    const updated = await putEntry(t, entry.id, { ...EVIL, versionRange: null, severity: "critical" });

    expect(updated.severity).toBe("critical");
    const items = await allFindings(t);
    expect(findOne(items, { repo: "api", packageName: "evil-pkg" })).toMatchObject({ status: "open", severity: "critical" });
    expect(findOne(items, { repo: "web" })).toMatchObject({ status: "ignored", severity: "critical" });
    expect(findOne(items, { repo: "old" })).toMatchObject({ status: "resolved", severity: "low" });
    expect(findOne(items, { packageName: "other-pkg" })).toMatchObject({ status: "open", severity: "low" });
  });

  it("[CT-19] `{enabled: false, severity: \"high\"}` PUT 1건 → resolved 가 된 행의 severity 는 high, reason 도 마지막 값이다", async () => {
    const entry = await addEntry(t, EVIL);
    t.github.setRepos([{ name: "api", files: { "package.json": withEvil() } }]);
    await runScan(t);

    t.clock.advance(MINUTE);
    const at = t.clock.iso();
    await putEntry(t, entry.id, {
      name: "evil-pkg",
      versionRange: null,
      reason: "끄면서 고친 사유",
      enabled: false,
      severity: "high",
    });

    const items = await allFindings(t);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      status: "resolved",
      resolvedAt: at,
      severity: "high",
      reason: "끄면서 고친 사유",
    });
  });

  it("[CT-19] 스캔 중 꺼진 항목은 PUT 에서 바로 resolved 가 되고 그 스캔은 그 항목으로 검출을 만들지 않는다", async () => {
    const entry = await addEntry(t, EVIL);
    t.github.setRepos([{ name: "alpha-svc", files: { "package.json": withEvil() } }]);
    await runScan(t);

    t.github.upsertRepo({ name: "bravo-svc", files: { "package.json": withEvil() } });
    t.clock.advance(MINUTE);
    const paused = await startPausedScan(t, "alpha-svc");
    await putEntry(t, entry.id, { ...EVIL, versionRange: null, enabled: false });
    expect(findOne(await allFindings(t), { repo: "alpha-svc" }).status).toBe("resolved");
    const scan = await paused.finish();

    expect(scan).toMatchObject({ status: "success", newFindingCount: 0 });
    const items = await allFindings(t);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ repo: "alpha-svc", status: "resolved" });
  });
});

describe("만료와 스캔 (CT-19)", () => {
  // FakeClock 기본 시각 2026-11-12T00:00:00.000Z = KST 2026-11-12 09:00
  const EXPIRES = "2026-11-12";

  it("[CT-19] 스캔 도중 KST 자정을 넘겨 항목이 만료되면 종료 트랜잭션이 기존 검출을 resolved 로 바꾸고 신규 검출을 만들지 않는다", async () => {
    const entry = await addEntry(t, { ...EVIL, expiresAt: EXPIRES });
    t.github.setRepos([{ name: "alpha-svc", files: { "package.json": withEvil() } }]);
    await runScan(t);
    expect(findOne(await allFindings(t), { repo: "alpha-svc" }).status).toBe("open");

    t.github.upsertRepo({ name: "bravo-svc", files: { "package.json": withEvil() } });
    t.clock.set("2026-11-12T14:59:00.000Z"); // KST 11-12 23:59 — 스냅샷 시점에는 활성
    const paused = await startPausedScan(t, "alpha-svc");
    t.clock.set("2026-11-12T15:00:30.000Z"); // KST 11-13 00:00:30 — 종료 시점에는 만료
    const scan = await paused.finish();

    expect(scan).toMatchObject({ status: "success", newFindingCount: 0 });
    const items = await allFindings(t);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      repo: "alpha-svc",
      status: "resolved",
      resolvedAt: "2026-11-12T15:00:30.000Z",
    });
    expect(await getEntry(t, entry.id)).toMatchObject({ enabled: true, isExpired: true });
  });

  it("[CT-19] 만료된 항목은 스캔에서 빠지고, 만료일을 미래로 바꾸거나 비우면 다음 스캔부터 다시 검출한다", async () => {
    const entry = await addEntry(t, { ...EVIL, expiresAt: EXPIRES });
    t.github.setRepos([{ name: "api", files: { "package.json": withEvil() } }]);
    t.clock.set("2026-11-12T15:00:00.000Z"); // KST 11-13 00:00 — 만료

    const expired = await runScan(t);
    expect(expired.newFindingCount).toBe(0);
    expect(await allFindings(t)).toEqual([]);

    const released = await putEntry(t, entry.id, { ...EVIL, versionRange: null, expiresAt: null });
    expect(released).toMatchObject({ expiresAt: null, isExpired: false });
    expect(await allFindings(t)).toEqual([]);
    t.clock.advance(MINUTE);
    const rescanned = await runScan(t);
    expect(rescanned.newFindingCount).toBe(1);
    expect((await allFindings(t)).map((item) => item.status)).toEqual(["open"]);
  });
});
