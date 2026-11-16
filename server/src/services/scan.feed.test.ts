import { afterEach, describe, expect, it } from "vitest";
import { fakeNode, FakeFeedClient } from "../test/feed.ts";
import { npmLockV3, pkgJson } from "../test/repoFixtures.ts";
import {
  allFindings,
  cleanupTestApps,
  createTestApp,
  putSettings,
  runScan,
  type TestApp,
} from "../test/testApp.ts";
import { addEntry, listEntries, putEntry, startPausedScan } from "../test/v2.ts";

afterEach(cleanupTestApps);

const WF = ".github/workflows/ci.yml";
const workflow = (...uses: string[]) =>
  `jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n${uses.map((use) => `      - uses: ${use}\n`).join("")}`;

/** feed 에 노드를 넣고 전체 동기화까지 끝낸 앱 */
async function setup(
  nodes: unknown[],
  files: Record<string, string> = { "package.json": pkgJson({ dependencies: { evil: "^1.0.0" } }), "package-lock.json": npmLockV3({ evil: "1.5.0" }, { evil: "^1.0.0" }) },
): Promise<{ t: TestApp; client: FakeFeedClient }> {
  const client = new FakeFeedClient(nodes);
  const t = createTestApp({ feedClient: client });
  await putSettings(t);
  t.github.setRepos([{ name: "svc", files }]);
  t.instance.services.feed.startSync();
  await t.instance.services.feed.waitForIdle();
  return { t, client };
}

const evil = (range = ">= 0", extra: Partial<Parameters<typeof fakeNode>[0]> = {}) =>
  fakeNode({ ghsa: "GHSA-evil-evil-0001", name: "evil", range, summary: "Malware in evil", ...extra });

describe("외부 목록(feed)의 대조", () => {
  it("[SE-50] feed 만 일치해도 source=feed 항목이 생기고 검출이 만들어진다 (사유 = 요약 + 권고 id + 링크)", async () => {
    const { t } = await setup([evil("= 1.5.0")]);
    expect(await listEntries(t)).toHaveLength(0);

    const scan = await runScan(t);

    expect(scan.status).toBe("success");
    expect(scan.newFindingCount).toBe(1);
    const entries = await listEntries(t);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      source: "feed",
      externalId: "GHSA-evil-evil-0001",
      ecosystem: "npm",
      name: "evil",
      versionRange: "1.5.0",
      severity: "critical",
      enabled: true,
      expiresAt: null,
      reason: "Malware in evil (GHSA-evil-evil-0001) 출처: https://github.com/advisories/GHSA-evil-evil-0001",
    });
    const findings = await allFindings(t);
    expect(findings.map((f) => [f.packageName, f.version, f.filePath, f.status, f.blacklistEntryId])).toEqual([
      ["evil", "1.5.0", "package-lock.json", "open", entries[0]?.id],
    ]);
  });

  it("[SE-51] 범위가 맞지 않으면 일치하지 않는다 (항목도 만들지 않는다)", async () => {
    const { t } = await setup([evil("< 1.0.0")]);

    const scan = await runScan(t);

    expect(scan.newFindingCount).toBe(0);
    expect(await listEntries(t)).toHaveLength(0);
    expect(await allFindings(t)).toHaveLength(0);
  });

  it("[SE-52] 다음 스캔부터는 일반 항목으로 대조된다: 새 항목도 새 검출도 만들지 않는다", async () => {
    const { t } = await setup([evil()]);
    await runScan(t);
    const [first] = await allFindings(t);

    const second = await runScan(t);

    expect(second.newFindingCount).toBe(0);
    expect(await listEntries(t)).toHaveLength(1);
    const findings = await allFindings(t);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.id).toBe(first?.id);
  });

  it("[SE-53] 사용자가 그 항목을 끄면 resolve 되고, 다음 스캔에서 다시 살아나지 않는다", async () => {
    const { t } = await setup([evil()]);
    await runScan(t);
    const [entry] = await listEntries(t);
    expect(entry).toBeDefined();
    if (!entry) return;

    await putEntry(t, entry.id, { name: entry.name, versionRange: entry.versionRange, reason: entry.reason, enabled: false });
    expect((await allFindings(t))[0]?.status).toBe("resolved");
    const scan = await runScan(t);

    expect(scan.newFindingCount).toBe(0);
    expect(await listEntries(t)).toHaveLength(1);
    expect((await allFindings(t)).map((f) => f.status)).toEqual(["resolved"]);
  });

  it("[SE-54] 같은 키의 수동 항목이 있으면(꺼져 있어도) feed 항목은 대조에 쓰지 않는다", async () => {
    const { t } = await setup([evil()]);
    await addEntry(t, { name: "evil", versionRange: null, reason: "수동", enabled: false });

    const scan = await runScan(t);

    expect(scan.newFindingCount).toBe(0);
    const entries = await listEntries(t);
    expect(entries.map((e) => e.source)).toEqual(["manual"]);
    expect(await allFindings(t)).toHaveLength(0);
  });

  it("[SE-55] 같은 키의 수동 항목이 켜져 있으면 그 항목으로 검출한다 (feed 항목을 따로 만들지 않는다)", async () => {
    const { t } = await setup([evil()]);
    const manual = await addEntry(t, { name: "evil", versionRange: null, reason: "수동" });

    await runScan(t);

    expect((await listEntries(t)).map((e) => e.source)).toEqual(["manual"]);
    expect((await allFindings(t)).map((f) => f.blacklistEntryId)).toEqual([manual.id]);
  });

  it("[SE-56] 범위가 다른 수동 항목은 feed 항목을 막지 않는다 (키가 다르다)", async () => {
    const { t } = await setup([evil()]);
    await addEntry(t, { name: "evil", versionRange: "<1.0.0", reason: "수동" });

    const scan = await runScan(t);

    expect(scan.newFindingCount).toBe(1);
    expect((await listEntries(t)).map((e) => e.source).sort()).toEqual(["feed", "manual"]);
  });

  it("[SE-57] feed 를 끄면 대조하지 않고, 저장된 항목은 지우지 않는다. 다시 켜면 대조한다", async () => {
    const { t } = await setup([evil()]);
    const put = (feedEnabled: boolean) =>
      t.request("PUT", "/api/settings", { org: "my-org", scanIntervalHours: 24, digestTime: "09:00", recipients: [], feedEnabled });
    expect((await put(false)).status).toBe(200);

    const off = await runScan(t);
    expect(off.newFindingCount).toBe(0);
    expect(t.instance.services.feed.getStatus().entryCount).toBe(1);

    expect((await put(true)).status).toBe(200);
    const on = await runScan(t);
    expect(on.newFindingCount).toBe(1);
  });

  it("[SE-58] package.json 만 있는 repo 는 범위의 겹침으로 판정한다", async () => {
    const { t } = await setup([evil("< 2.0.0")], {
      "package.json": pkgJson({ dependencies: { evil: "^1.2.0", fine: "^1.0.0" } }),
    });

    await runScan(t);
    expect((await allFindings(t)).map((f) => [f.packageName, f.version, f.filePath])).toEqual([["evil", "^1.2.0", "package.json"]]);

    t.github.setFiles("svc", { "package.json": pkgJson({ dependencies: { evil: "^3.0.0" } }) });
    await runScan(t);
    expect((await allFindings(t)).map((f) => f.status)).toEqual(["resolved"]);
  });

  it("[SE-59] 다른 종류: pypi(requirements)와 GitHub Action(workflow)도 대조하고 그 종류의 파일을 받는다", async () => {
    const { t } = await setup(
      [
        fakeNode({ ghsa: "GHSA-pypi-pypi-0001", ecosystem: "PIP", name: "Evil_Py", range: "= 1.0.0" }),
        fakeNode({ ghsa: "GHSA-acts-acts-0001", ecosystem: "ACTIONS", name: "Evil/Action", range: ">= 0" }),
      ],
      {
        "package.json": pkgJson({}),
        "requirements.txt": "evil-py==1.0.0\nother==2.0.0\n",
        [WF]: workflow("evil/action@v1", "actions/checkout@v4"),
      },
    );

    await runScan(t);

    const findings = await allFindings(t);
    expect(findings.map((f) => `${f.ecosystem}:${f.packageName}:${f.version}`).sort()).toEqual([
      "actions:evil/action:v1",
      "pypi:evil-py:1.0.0",
    ]);
    expect((await listEntries(t)).map((e) => `${e.source}:${e.ecosystem}:${e.name}`).sort()).toEqual([
      "feed:actions:evil/action",
      "feed:pypi:evil-py",
    ]);
  });

  it("[SE-60] feed 에 항목이 있는 종류만 파일을 받는다: 항목이 없는 종류의 파일은 받지 않는다", async () => {
    const { t } = await setup([evil()], { "package.json": pkgJson({}), "requirements.txt": "x==1\n", "go.mod": "module a\n" });

    await runScan(t);

    const fetched = t.github.callsOf("getFile").length;
    // package.json 1개만 받는다 (pypi·go 의 항목이 feed 에 없다)
    expect(fetched).toBe(1);
  });

  it("[SE-61] 이메일 대상이 되는 신규 검출로 처리된다 (일반 항목의 검출과 같다)", async () => {
    const { t } = await setup([evil()]);

    await runScan(t);

    expect(t.mailer.sentText()).toContain("evil");
  });
});

describe("스캔 도중의 변경", () => {
  it("[SE-65] 스캔 중에 feed 행이 지워지면(철회) 그 일치는 버린다 (항목을 만들지 않는다)", async () => {
    const { t } = await setup([evil()]);
    const paused = await startPausedScan(t, "svc");

    t.instance.db.prepare("DELETE FROM feed_entries").run();
    const scan = await paused.finish();

    expect(scan.status).toBe("success");
    expect(await listEntries(t)).toHaveLength(0);
    expect(await allFindings(t)).toHaveLength(0);
  });

  it("[SE-66] 스캔 중에 같은 키의 수동 항목이 생기면 그 항목이 켜져 있을 때만 그 id 로 검출한다", async () => {
    const active = await setup([evil()]);
    const pausedActive = await startPausedScan(active.t, "svc");
    const manual = await addEntry(active.t, { name: "evil", versionRange: null, reason: "수동" });
    await pausedActive.finish();
    expect((await allFindings(active.t)).map((f) => f.blacklistEntryId)).toEqual([manual.id]);
    expect((await listEntries(active.t)).map((e) => e.source)).toEqual(["manual"]);
    await active.t.close();

    const off = await setup([evil()]);
    const pausedOff = await startPausedScan(off.t, "svc");
    await addEntry(off.t, { name: "evil", versionRange: null, reason: "수동", enabled: false });
    await pausedOff.finish();
    expect(await allFindings(off.t)).toHaveLength(0);
    expect((await listEntries(off.t)).map((e) => e.source)).toEqual(["manual"]);
  });

  it("[SE-67] 스캔은 시작할 때의 목록으로 대조한다: 도중의 동기화가 항목을 더해도 이번 스캔은 보지 못하고 다음 스캔이 본다", async () => {
    const { t, client } = await setup([evil()], {
      "package.json": pkgJson({ dependencies: { evil: "^1.0.0", evil2: "^1.0.0" } }),
      "package-lock.json": npmLockV3({ evil: "1.5.0", evil2: "1.0.0" }, { evil: "^1.0.0", evil2: "^1.0.0" }),
    });
    const paused = await startPausedScan(t, "svc");

    t.clock.advance(60_000);
    client.setNodes([evil(">= 0", { updatedAt: "2026-11-12T00:00:30Z" }), fakeNode({ ghsa: "GHSA-evil-evil-0002", name: "evil2", updatedAt: "2026-11-12T00:00:40Z" })]);
    t.instance.services.feed.startSync();
    await t.instance.services.feed.waitForIdle();
    expect(t.instance.services.feed.getStatus().entryCount).toBe(2);
    await paused.finish();

    expect((await allFindings(t)).map((f) => f.packageName)).toEqual(["evil"]);
    await runScan(t);
    expect((await allFindings(t)).map((f) => f.packageName).sort()).toEqual(["evil", "evil2"]);
  });
});

describe("index 캐시", () => {
  it("[SE-68] feed 의 내용이 바뀌지 않으면 index 를 다시 만들지 않고, 동기화가 행을 바꾸면 다시 만든다", async () => {
    const { t, client } = await setup([evil()]);
    const feed = t.instance.services.feed;
    const first = feed.getIndex();

    await runScan(t);
    expect(feed.getIndex()).toBe(first);

    t.clock.advance(60_000);
    client.setNodes([evil(), fakeNode({ ghsa: "GHSA-evil-evil-0002", name: "evil2", updatedAt: "2026-11-12T00:00:30Z" })]);
    feed.startSync();
    await feed.waitForIdle();

    const second = feed.getIndex();
    expect(second).not.toBe(first);
    expect(second?.size).toBe(2);
  });

  it("[SE-69] 항목이 0건이거나 feed 가 꺼져 있으면 index 가 없다(null)", async () => {
    const t = createTestApp({ feedClient: new FakeFeedClient([]) });
    expect(t.instance.services.feed.getIndex()).toBeNull();
  });
});
