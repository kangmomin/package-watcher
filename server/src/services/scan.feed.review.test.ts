import { afterEach, describe, expect, it } from "vitest";
import { fakeNode, FakeFeedClient } from "../test/feed.ts";
import { npmLockV3, pkgJson } from "../test/repoFixtures.ts";
import { allFindings, cleanupTestApps, createTestApp, putSettings, runScan, type TestApp } from "../test/testApp.ts";
import { addEntry, listEntries } from "../test/v2.ts";

afterEach(cleanupTestApps);

async function setup(nodes: unknown[], files: Record<string, string>): Promise<TestApp> {
  const t = createTestApp({ feedClient: new FakeFeedClient(nodes) });
  await putSettings(t);
  t.github.setRepos([{ name: "svc", files }]);
  t.instance.services.feed.startSync();
  await t.instance.services.feed.waitForIdle();
  return t;
}

const feedNode = (name: string, range = ">= 0") =>
  fakeNode({ ghsa: `GHSA-${name.replace(/\W/g, "").slice(0, 4).padEnd(4, "x")}-aaaa-0001`, name, range });

describe("M4: 같은 뜻의 범위는 같은 키", () => {
  it("[SE-132] 사용자가 같은 뜻의 범위로 만든(꺼진) 항목이 있으면 feed 항목은 쓰지 않는다 (공백이 달라도)", async () => {
    const t = await setup([feedNode("lodash", ">= 1.0.0, < 2.0.0")], {
      "package.json": pkgJson({ dependencies: { lodash: "^1.5.0" } }),
      "package-lock.json": npmLockV3({ lodash: "1.5.0" }, { lodash: "^1.5.0" }),
    });
    await addEntry(t, { name: "lodash", versionRange: ">= 1.0.0   < 2.0.0", reason: "수동", enabled: false });

    const scan = await runScan(t);

    expect(scan.newFindingCount).toBe(0);
    expect((await listEntries(t)).map((e) => e.source)).toEqual(["manual"]);
  });

  it("[SE-133] 사용자가 `*` 로 만든 항목과 feed 의 '모든 버전'(null)은 같은 키다", async () => {
    const t = await setup([feedNode("evil")], {
      "package.json": pkgJson({ dependencies: { evil: "^1" } }),
      "package-lock.json": npmLockV3({ evil: "1.0.0" }, { evil: "^1" }),
    });
    await addEntry(t, { name: "evil", versionRange: "*", reason: "수동", enabled: false });

    const scan = await runScan(t);

    expect(scan.newFindingCount).toBe(0);
    expect((await listEntries(t)).map((e) => e.source)).toEqual(["manual"]);
  });

  it("[SE-134] 스캔 중에 같은 뜻의 수동 항목이 생겨도 새 항목을 만들지 않는다 (켜져 있으면 그 항목으로)", async () => {
    const t = await setup([feedNode("evil", "< 2.0.0")], {
      "package.json": pkgJson({ dependencies: { evil: "^1" } }),
      "package-lock.json": npmLockV3({ evil: "1.0.0" }, { evil: "^1" }),
    });
    const gate = t.github.pause("getTree", "svc");
    const started = await t.request("POST", "/api/scans");
    expect(started.status).toBe(202);
    await gate.waitReached();
    const manual = await addEntry(t, { name: "evil", versionRange: "<2.0.0", reason: "수동" });
    gate.release();
    await t.instance.services.scans.waitForIdle();

    expect((await listEntries(t)).map((e) => e.source)).toEqual(["manual"]);
    expect((await allFindings(t)).map((f) => f.blacklistEntryId)).toEqual([manual.id]);
  });
});

describe("M1: 내부 패키지와 registry 밖의 spec", () => {
  const files = (deps: Record<string, string>) => ({
    "package.json": pkgJson({ name: "root", dependencies: deps }),
    "packages/shared/package.json": pkgJson({ name: "@acme/shared" }),
  });

  it("[SE-135] 같은 repo 의 package.json 의 name 과 같은 의존성은 feed 항목과 일치하지 않는다", async () => {
    const t = await setup([feedNode("@acme/shared")], files({ "@acme/shared": "^1.0.0" }));

    const scan = await runScan(t);

    expect(scan.newFindingCount).toBe(0);
    expect(await listEntries(t)).toHaveLength(0);
  });

  it("[SE-136] workspace:·link:·file:·portal: spec 은 feed 항목과 일치하지 않는다. 일반 spec 은 일치한다", async () => {
    for (const spec of ["workspace:*", "link:../x", "file:../x", "portal:../x"]) {
      const t = await setup([feedNode("evil")], { "package.json": pkgJson({ dependencies: { evil: spec } }) });
      expect((await runScan(t)).newFindingCount, spec).toBe(0);
      await t.close();
    }
    const t = await setup([feedNode("evil")], { "package.json": pkgJson({ dependencies: { evil: "^1.0.0" } }) });
    expect((await runScan(t)).newFindingCount).toBe(1);
  });

  it("[SE-137] 이미 만들어진 source=feed 항목에도 적용된다. 수동 항목은 그대로 일치한다", async () => {
    const t = await setup([feedNode("evil")], { "package.json": pkgJson({ dependencies: { evil: "^1.0.0" } }) });
    await runScan(t);
    expect((await listEntries(t)).map((e) => e.source)).toEqual(["feed"]);

    t.github.setFiles("svc", { "package.json": pkgJson({ dependencies: { evil: "workspace:*", mine: "workspace:*" } }) });
    await runScan(t);
    expect((await allFindings(t)).map((f) => f.status)).toEqual(["resolved"]);

    await addEntry(t, { name: "mine", versionRange: null, reason: "수동", severity: "high" });
    const third = await runScan(t);
    expect(third.newFindingCount).toBe(1);
  });
});

describe("m2: 켜면 동기화를 시작한다", () => {
  it("[SE-138] feedEnabled 가 false → true 로 바뀌면 백그라운드 동기화를 시작한다", async () => {
    const client = new FakeFeedClient([feedNode("evil")]);
    const t = createTestApp({ feedClient: client });
    const put = (feedEnabled: boolean) =>
      t.request("PUT", "/api/settings", { org: "my-org", scanIntervalHours: 24, digestTime: "09:00", recipients: [], feedEnabled });

    await put(false);
    expect(client.calls).toHaveLength(0);
    await put(true);
    await t.instance.services.feed.waitForIdle();

    expect(client.calls).toEqual([null]);
    expect(t.instance.services.feed.getStatus().entryCount).toBe(1);
  });
});
