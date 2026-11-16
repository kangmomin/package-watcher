import { feedStatusSchema, type FeedStatus } from "@pw/shared";
import { afterEach, describe, expect, it } from "vitest";
import { RateLimitedError } from "../github/client.ts";
import { DAY, HOUR } from "../test/clock.ts";
import { fakeNode, FakeFeedClient } from "../test/feed.ts";
import { npmLockV3, pkgJson } from "../test/repoFixtures.ts";
import { cleanupTestApps, createTestApp, putSettings, runScan, type TestApp } from "../test/testApp.ts";
import { addEntry, listEntries } from "../test/v2.ts";
import { comparableRange } from "./comparable.ts";
import { convertAdvisory } from "./ranges.ts";

afterEach(cleanupTestApps);

async function sync(t: TestApp): Promise<FeedStatus> {
  t.instance.services.feed.startSync();
  await t.instance.services.feed.waitForIdle();
  return feedStatusSchema.parse((await t.request("GET", "/api/feed")).json);
}

const names = (t: TestApp): string[] =>
  t.instance.db
    .prepare<[], { name: string }>("SELECT name FROM feed_entries ORDER BY name")
    .all()
    .map((row) => row.name);

const node = (ghsa: string, name: string, range = ">= 0", updatedAt = "2026-11-01T00:00:00Z") =>
  fakeNode({ ghsa, name, range, updatedAt });

describe("R1: > 0 은 모든 버전", () => {
  it("[SE-120] `> 0`·`> 0.0.0`·`>= 0.0.0` 만 있으면 모든 버전(null)이고, 다른 비교식과 오면 하한을 뺀다", () => {
    for (const [ghsa, name] of [["GO", "github.com/x/y"], ["MAVEN", "com.x:y"], ["NUGET", "pkg"], ["NPM", "pkg"], ["PIP", "pkg"]] as const) {
      for (const raw of ["> 0", "> 0.0.0", ">= 0", ">= 0.0.0"]) {
        expect(convertAdvisory(ghsa, name, raw), `${ghsa} ${raw}`).toEqual(expect.objectContaining({ versionRange: null }));
      }
    }
    expect(convertAdvisory("GO", "github.com/x/y", "> 0, < 2.0.0")?.versionRange).toBe("<v2.0.0");
    expect(convertAdvisory("MAVEN", "com.x:y", "> 0, < 2.0")?.versionRange).toBe("(,2.0)");
  });
});

describe("M4: 같은 뜻의 범위", () => {
  it("[SE-121] comparableRange: 모든 버전의 표기는 '' 이고, 공백·순서가 다른 같은 범위는 같다", () => {
    for (const eco of ["npm", "pub", "cargo", "go"]) {
      for (const all of [null, "", "*", "x", ">=0", ">= 0.0.0", ">0"]) expect(comparableRange(eco, all), `${eco} ${all}`).toBe("");
    }
    expect(comparableRange("pypi", ">=0")).toBe("");
    expect(comparableRange("nuget", "[0,)")).toBe("");
    expect(comparableRange("maven", "(,)")).toBe("");
    expect(comparableRange("npm", ">= 1.0.0 < 2.0.0")).toBe(comparableRange("npm", ">=1.0.0 <2.0.0"));
    expect(comparableRange("npm", "<1.0.0")).not.toBe(comparableRange("npm", "<1.0.1"));
    expect(comparableRange("pypi", ">=1.0, <2.0")).toBe(comparableRange("pypi", ">=1.0,<2.0"));
    expect(comparableRange("nuget", "[1.0, 2.0)")).toBe(comparableRange("nuget", "[1.0,2.0)"));
    expect(comparableRange("npm", "not a range ((")).toBe("not a range ((");
  });
});

describe("M2: 범위의 유실 방지와 전체 동기화의 sweep", () => {
  it("[SE-122] 같은 권고의 범위가 프로세스 재시작을 사이에 두고 나뉘어 와도 모두 남는다 (prune 없음)", async () => {
    const list = [
      node("GHSA-same-same-0001", "multi", "= 1.0.0", "2026-11-01T00:00:09Z"),
      node("GHSA-aaaa-aaaa-0001", "other", ">= 0", "2026-11-01T00:00:05Z"),
      node("GHSA-same-same-0001", "multi", "= 2.0.0", "2026-11-01T00:00:01Z"),
    ];
    const first = new FakeFeedClient(list, 1);
    first.failures.set(2, new Error("끊김"));
    const t1 = createTestApp({ feedClient: first });
    await sync(t1);
    await t1.close();

    const t2 = createTestApp({ feedClient: new FakeFeedClient(list, 1), dbPath: t1.dbPath, clock: t1.clock });
    await sync(t2);

    const ranges = t2.instance.db.prepare("SELECT version_range FROM feed_entries WHERE name = 'multi'").all();
    expect(ranges).toHaveLength(2);
  });

  it("[SE-123] 증분 동기화는 지우지 않는다: 범위가 바뀐 권고의 옛 범위는 다음 전체 동기화의 sweep 이 지운다", async () => {
    const client = new FakeFeedClient([node("GHSA-edit-edit-0001", "pkg", "= 1.0.0"), node("GHSA-gone-gone-0001", "gone")]);
    const t = createTestApp({ feedClient: client });
    await sync(t);

    t.clock.advance(HOUR);
    client.setNodes([node("GHSA-edit-edit-0001", "pkg", "= 3.0.0", "2026-11-12T00:30:00Z")]);
    await sync(t);
    const incremental = t.instance.db.prepare("SELECT version_range FROM feed_entries ORDER BY id").all();
    expect(incremental).toHaveLength(3);

    t.clock.advance(8 * DAY);
    client.setNodes([node("GHSA-edit-edit-0001", "pkg", "= 3.0.0", "2026-11-12T00:30:00Z")]);
    await sync(t);
    expect(t.instance.db.prepare<[], { version_range: string }>("SELECT version_range FROM feed_entries").all()).toEqual([
      { version_range: "3.0.0" },
    ]);
  });

  it("[SE-124] 마지막 전체 동기화가 7일 안이면 증분이다 (sweep 하지 않는다)", async () => {
    const client = new FakeFeedClient([node("GHSA-aaaa-aaaa-0001", "a"), node("GHSA-bbbb-bbbb-0002", "b", ">= 0", "2026-10-01T00:00:00Z")], 1);
    const t = createTestApp({ feedClient: client });
    await sync(t);
    t.clock.advance(6 * DAY);
    client.calls.length = 0;
    client.setNodes([node("GHSA-aaaa-aaaa-0001", "a", ">= 0", "2026-11-18T00:00:00Z")]);

    await sync(t);

    expect(names(t)).toEqual(["a", "b"]);
    expect(client.calls).toEqual([null]);
  });

  it("[SE-125] 전체 동기화가 도는 동안에도 기존 행은 index 에 남고, 끝난 뒤의 sweep 만 지운다", async () => {
    const client = new FakeFeedClient([node("GHSA-aaaa-aaaa-0001", "a"), node("GHSA-bbbb-bbbb-0002", "b")]);
    const t = createTestApp({ feedClient: client });
    await sync(t);
    t.clock.advance(8 * DAY);
    client.setNodes([node("GHSA-aaaa-aaaa-0001", "a")]);
    const gate = client.pauseNext();

    t.instance.services.feed.startSync();
    await gate.reached;
    expect(t.instance.services.feed.getIndex()?.size).toBe(2);
    gate.release();
    await t.instance.services.feed.waitForIdle();

    expect(names(t)).toEqual(["a"]);
    expect(feedStatusSchema.parse((await t.request("GET", "/api/feed")).json)).toMatchObject({ fullSyncDone: true, entryCount: 1 });
  });

  it("[SE-126] 이어받던 cursor 를 GitHub 이 거부하면(오류) 처음부터 다시 받는다. rate limit 은 그렇지 않다", async () => {
    const list = Array.from({ length: 5 }, (_, i) => node(`GHSA-aaaa-aaaa-000${i}`, `p${i}`, ">= 0", `2026-11-01T00:00:0${9 - i}Z`));
    const client = new FakeFeedClient(list, 2);
    client.failures.set(2, new Error("끊김"));
    const t = createTestApp({ feedClient: client });
    await sync(t);
    client.calls.length = 0;
    client.failures.clear();
    client.failures.set(1, new Error("GraphQL: cursor is invalid"));

    const done = await sync(t);

    expect(client.calls).toEqual(["2", null, "2", "4"]);
    expect(done).toMatchObject({ entryCount: 5, fullSyncDone: true, lastError: null });

    const limited = new FakeFeedClient(list, 2);
    limited.failures.set(2, new Error("끊김"));
    const t2 = createTestApp({ feedClient: limited });
    await sync(t2);
    limited.calls.length = 0;
    limited.failures.clear();
    limited.failures.set(1, new RateLimitedError());
    await sync(t2);
    expect(limited.calls).toEqual(["2"]);
  });
});

describe("철회된 권고의 feed 항목", () => {
  async function appWithFeedEntry(): Promise<{ t: TestApp; client: FakeFeedClient }> {
    const client = new FakeFeedClient([node("GHSA-evil-evil-0001", "evil")]);
    const t = createTestApp({ feedClient: client });
    await putSettings(t);
    t.github.setRepos([
      { name: "svc", files: { "package.json": pkgJson({ dependencies: { evil: "^1" } }), "package-lock.json": npmLockV3({ evil: "1.0.0" }, { evil: "^1" }) } },
    ]);
    await sync(t);
    await runScan(t);
    return { t, client };
  }

  it("[SE-127] 전체 동기화의 sweep 뒤에 feed 에 없는 권고의 source=feed 항목은 꺼지고(사유에 표식) 검출은 resolved. 지우지 않는다", async () => {
    const { t, client } = await appWithFeedEntry();
    client.setNodes([node("GHSA-other-other-0001", "other")]);
    t.clock.advance(8 * DAY);

    await sync(t);

    const [entry] = await listEntries(t);
    expect(entry).toMatchObject({ source: "feed", enabled: false });
    expect(entry?.reason.endsWith(" (권고가 철회됨)")).toBe(true);
    expect(entry?.reason.length).toBeLessThanOrEqual(500);
    const findings = t.instance.db.prepare<[], { status: string }>("SELECT status FROM findings").all();
    expect(findings.map((f) => f.status)).toEqual(["resolved"]);
  });

  it("[SE-128] 자동 끄기는 1번만: 사용자가 다시 켜면 다음 sweep 이 끄지 않는다", async () => {
    const { t, client } = await appWithFeedEntry();
    client.setNodes([node("GHSA-other-other-0001", "other")]);
    t.clock.advance(8 * DAY);
    await sync(t);
    const [entry] = await listEntries(t);
    if (!entry) throw new Error("항목 없음");
    const put = await t.request("PUT", `/api/blacklist/${entry.id}`, {
      name: entry.name, versionRange: entry.versionRange, reason: entry.reason, enabled: true,
    });
    expect(put.status, put.text).toBe(200);

    t.clock.advance(8 * DAY);
    await sync(t);

    expect((await listEntries(t))[0]?.enabled).toBe(true);
  });

  it("[SE-129] 항목이 feed 에 남아 있으면 끄지 않는다. 수동 항목은 건드리지 않는다. 전체 동기화가 0건을 받으면 아무것도 끄지 않는다", async () => {
    const { t, client } = await appWithFeedEntry();
    await addEntry(t, { name: "manual-pkg", reason: "수동" });
    t.clock.advance(8 * DAY);
    await sync(t);
    expect((await listEntries(t)).every((e) => e.enabled)).toBe(true);

    client.setNodes([]);
    t.clock.advance(8 * DAY);
    await sync(t);
    expect((await listEntries(t)).every((e) => e.enabled)).toBe(true);
  });
});

describe("M3: 행 id", () => {
  it("[SE-130] feed_entries.id 는 AUTOINCREMENT 라서 지운 행의 id 가 다시 쓰이지 않는다", () => {
    const t = createTestApp();
    const { db } = t.instance;
    const insert = (name: string) =>
      Number(
        db
          .prepare(
            `INSERT INTO feed_entries (external_id, ecosystem, name, version_range, raw_range, severity, summary, url, updated_at)
             VALUES ('GHSA-x', 'npm', ?, '', '>= 0', 'high', 's', 'u', 't')`,
          )
          .run(name).lastInsertRowid,
      );
    const first = insert("a");
    db.prepare("DELETE FROM feed_entries").run();

    expect(insert("b")).toBeGreaterThan(first);
  });

  it("[SE-131] 스캔 중에 같은 id 의 행이 다른 (이름, 범위)로 바뀌었으면 그 일치는 버린다", async () => {
    const client = new FakeFeedClient([node("GHSA-evil-evil-0001", "evil")]);
    const t = createTestApp({ feedClient: client });
    await putSettings(t);
    t.github.setRepos([
      { name: "svc", files: { "package.json": pkgJson({ dependencies: { evil: "^1" } }), "package-lock.json": npmLockV3({ evil: "1.0.0" }, { evil: "^1" }) } },
    ]);
    await sync(t);
    const gate = t.github.pause("getTree", "svc");
    const started = await t.request("POST", "/api/scans");
    expect(started.status).toBe(202);
    await gate.waitReached();
    t.instance.db.prepare("UPDATE feed_entries SET name = 'renamed'").run();
    gate.release();
    await t.instance.services.scans.waitForIdle();

    expect(await listEntries(t)).toHaveLength(0);
    expect(t.instance.db.prepare("SELECT id FROM findings").all()).toHaveLength(0);
  });
});
