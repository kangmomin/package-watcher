import { feedEntriesPageSchema, feedStatusSchema, type FeedStatus } from "@pw/shared";
import { afterEach, describe, expect, it } from "vitest";
import { RateLimitedError } from "../github/client.ts";
import { HOUR } from "../test/clock.ts";
import { fakeNode, FakeFeedClient } from "../test/feed.ts";
import { cleanupTestApps, createTestApp, expectApiError, type TestApp } from "../test/testApp.ts";

afterEach(cleanupTestApps);

function appWith(client: FakeFeedClient, options: Parameters<typeof createTestApp>[0] = {}): TestApp {
  return createTestApp({ feedClient: client, ...options });
}

/** 수동 동기화를 시작하고 끝나기를 기다린다 */
async function sync(t: TestApp): Promise<FeedStatus> {
  const started = await t.request("POST", "/api/feed/sync");
  expect(started.status, started.text).toBe(202);
  await t.instance.services.feed.waitForIdle();
  return status(t);
}

async function status(t: TestApp): Promise<FeedStatus> {
  const res = await t.request("GET", "/api/feed");
  expect(res.status, res.text).toBe(200);
  return feedStatusSchema.parse(res.json);
}

async function entries(t: TestApp, query = "limit=200") {
  const res = await t.request("GET", `/api/feed/entries?${query}`);
  expect(res.status, res.text).toBe(200);
  return feedEntriesPageSchema.parse(res.json);
}

const nodes = (count: number, ecosystem = "NPM", prefix = "pkg") =>
  Array.from({ length: count }, (_, index) =>
    fakeNode({
      ghsa: `GHSA-aaaa-bbbb-${String(index).padStart(4, "0")}`,
      ecosystem,
      name: `${prefix}-${index}`,
      updatedAt: new Date(Date.UTC(2026, 10, 1, 0, 0, 0) - index * 1000).toISOString(),
    }),
  );

describe("전체 동기화", () => {
  it("[SE-30] 모든 페이지를 받아 저장하고 fullSyncDone 이 된다. 종류별 수와 마지막 동기화 시각이 있다", async () => {
    const client = new FakeFeedClient(
      [...nodes(3), fakeNode({ ghsa: "GHSA-pppp-pppp-pppp", ecosystem: "PIP", name: "Evil_Py", range: "= 1.0.0" })],
      2,
    );
    const t = appWith(client);

    const before = await status(t);
    expect(before).toMatchObject({ enabled: true, entryCount: 0, fullSyncDone: false, syncing: false, lastSyncedAt: null });

    const after = await sync(t);

    expect(client.calls).toEqual([null, "2"]);
    expect(after).toMatchObject({
      enabled: true,
      entryCount: 4,
      byEcosystem: { npm: 3, pypi: 1 },
      fullSyncDone: true,
      syncing: false,
      syncedSoFar: 0,
      skippedCount: 0,
      lastError: null,
      lastSyncedAt: t.clock.iso(),
    });
    const { items } = await entries(t);
    expect(items.find((item) => item.ecosystem === "pypi")).toMatchObject({
      externalId: "GHSA-pppp-pppp-pppp",
      name: "evil-py",
      versionRange: "==1.0.0",
      rawRange: "= 1.0.0",
      severity: "critical",
      url: "https://github.com/advisories/GHSA-pppp-pppp-pppp",
    });
    // `>= 0` 은 모든 버전이다
    expect(items.find((item) => item.name === "pkg-0")?.versionRange).toBeNull();
  });

  it("[SE-31] 심각도의 대응(MODERATE → medium)과 건너뛴 항목의 수: 지원하지 않는 종류·읽을 수 없는 범위·깨진 노드", async () => {
    const client = new FakeFeedClient([
      fakeNode({ ghsa: "GHSA-aaaa-aaaa-0001", name: "ok-mod", severity: "MODERATE" }),
      fakeNode({ ghsa: "GHSA-aaaa-aaaa-0002", ecosystem: "RUBYGEMS", name: "gem" }),
      fakeNode({ ghsa: "GHSA-aaaa-aaaa-0003", name: "bad-range", range: "~> 1.0" }),
      fakeNode({ ghsa: "GHSA-aaaa-aaaa-0004", name: "bad-severity", severity: "WEIRD" }),
      { updatedAt: "2026-11-01T00:00:00Z" },
      null,
    ]);
    const t = appWith(client);

    const after = await sync(t);

    expect(after.entryCount).toBe(1);
    expect(after.skippedCount).toBe(5);
    expect((await entries(t)).items[0]).toMatchObject({ name: "ok-mod", severity: "medium" });
  });

  it("[SE-32] 외부 응답의 방어: 긴 이름은 건너뛰고 summary 는 300자로 자르며 https 가 아닌 링크는 기본 링크로 바꾼다", async () => {
    const client = new FakeFeedClient([
      fakeNode({ ghsa: "GHSA-aaaa-aaaa-0001", name: "x".repeat(256) }),
      { ...fakeNode({ ghsa: "GHSA-aaaa-aaaa-0002", name: "long-summary", summary: `줄\n바꿈${"가".repeat(400)}` }) },
      (() => {
        const node = fakeNode({ ghsa: "GHSA-aaaa-aaaa-0003", name: "bad-link" });
        (node.advisory as Record<string, unknown>).permalink = "javascript:alert(1)";
        return node;
      })(),
    ]);
    const t = appWith(client);

    const after = await sync(t);

    expect(after.entryCount).toBe(2);
    expect(after.skippedCount).toBe(1);
    const byName = Object.fromEntries((await entries(t)).items.map((item) => [item.name, item]));
    expect(byName["long-summary"]?.summary).toHaveLength(300);
    expect(byName["long-summary"]?.summary).not.toContain("\n");
    expect(byName["bad-link"]?.url).toBe("https://github.com/advisories/GHSA-aaaa-aaaa-0003");
  });

  it("[SE-33] 같은 권고의 범위가 여러 개이고 페이지에 나뉘어 와도 모두 남는다", async () => {
    const same = (range: string, second: number) =>
      fakeNode({ ghsa: "GHSA-same-same-same", name: "multi", range, updatedAt: `2026-11-01T00:00:0${second}Z` });
    const client = new FakeFeedClient(
      [same("= 1.0.0", 9), fakeNode({ ghsa: "GHSA-aaaa-aaaa-0001", name: "other", updatedAt: "2026-11-01T00:00:05Z" }), same("= 2.0.0", 1)],
      1,
    );
    const t = appWith(client);

    await sync(t);

    const multi = (await entries(t)).items.filter((item) => item.name === "multi");
    expect(multi.map((item) => item.versionRange).sort()).toEqual(["1.0.0", "2.0.0"]);
  });

  it("[SE-34] 도중에 실패하면 lastError 를 남기고 throw 하지 않는다. 다음 실행은 마지막 cursor 부터 이어받는다", async () => {
    const client = new FakeFeedClient(nodes(5), 2);
    client.failures.set(2, new Error("GitHub API 오류 (502): bad gateway"));
    const t = appWith(client);

    const failed = await sync(t);

    expect(failed).toMatchObject({ entryCount: 2, fullSyncDone: false, lastSyncedAt: null });
    expect(failed.lastError).toContain("502");
    expect(client.calls).toEqual([null, "2"]);

    client.calls.length = 0;
    client.failures.clear();
    const resumed = await sync(t);

    expect(client.calls).toEqual(["2", "4"]);
    expect(resumed).toMatchObject({ entryCount: 5, fullSyncDone: true, lastError: null });
  });

  it("[SE-35] rate limit 도 같은 방법으로 이어받는다", async () => {
    const client = new FakeFeedClient(nodes(4), 2);
    client.failures.set(2, new RateLimitedError());
    const t = appWith(client);

    const failed = await sync(t);

    expect(failed.fullSyncDone).toBe(false);
    expect(failed.lastError).toMatch(/한도/);
    client.calls.length = 0;
    client.failures.clear();

    expect((await sync(t)).entryCount).toBe(4);
    expect(client.calls).toEqual(["2"]);
  });

  it("[SE-36] 프로세스가 다시 시작해도 저장된 cursor 에서 이어받고, 건너뛴 수는 이어서 센다", async () => {
    const list = [...nodes(4), fakeNode({ ghsa: "GHSA-zzzz-zzzz-0001", ecosystem: "RUBYGEMS", name: "gem", updatedAt: "2026-10-01T00:00:00Z" })];
    const first = new FakeFeedClient(list, 2);
    first.failures.set(2, new Error("끊김"));
    const t1 = appWith(first);
    await sync(t1);
    const { dbPath } = t1;
    await t1.close();

    const second = new FakeFeedClient(list, 2);
    const t2 = appWith(second, { dbPath, clock: t1.clock });
    const after = await sync(t2);

    expect(second.calls).toEqual(["2", "4"]);
    expect(after).toMatchObject({ entryCount: 4, skippedCount: 1, fullSyncDone: true });
  });

  it("[SE-37] 동시에 1개만 실행한다: 실행 중에는 syncing·syncedSoFar 가 보이고 409 FEED_SYNC_RUNNING", async () => {
    const client = new FakeFeedClient(nodes(4), 2);
    const t = appWith(client);
    // 2번째 페이지에서 멈춘다
    const first = await t.request("POST", "/api/feed/sync");
    expect(first.status).toBe(202);
    await t.instance.services.feed.waitForIdle();
    client.calls.length = 0;
    const gate = client.pauseNext();

    const started = await t.request("POST", "/api/feed/sync");
    expect(started.status).toBe(202);
    await gate.reached;
    const during = await status(t);
    expect(during.syncing).toBe(true);
    expectApiError(await t.request("POST", "/api/feed/sync"), 409, "FEED_SYNC_RUNNING");

    gate.release();
    await t.instance.services.feed.waitForIdle();
    expect((await status(t)).syncing).toBe(false);
  });

  it("[SE-38] feed 가 꺼져 있으면 409 INVALID_STATE, 토큰이 없으면 400 TOKEN_MISSING. 어느 쪽도 동기화하지 않는다", async () => {
    const client = new FakeFeedClient(nodes(1));
    const t = appWith(client);
    const off = await t.request("PUT", "/api/settings", {
      org: "my-org",
      scanIntervalHours: 24,
      digestTime: "09:00",
      recipients: [],
      feedEnabled: false,
    });
    expect(off.status, off.text).toBe(200);

    expectApiError(await t.request("POST", "/api/feed/sync"), 409, "INVALID_STATE");
    expect(client.calls).toHaveLength(0);
    expect((await status(t)).enabled).toBe(false);

    const noToken = createTestApp({ tokenSource: "none" });
    expectApiError(await noToken.request("POST", "/api/feed/sync"), 400, "TOKEN_MISSING");
  });
});

describe("증분 동기화와 철회", () => {
  it("[SE-40] 전체가 끝난 뒤에는 '마지막 동기화의 시작 시각 − 1시간'보다 오래된 노드에서 멈춘다", async () => {
    const old = (index: number) =>
      fakeNode({ ghsa: `GHSA-old0-old0-000${index}`, name: `old-${index}`, updatedAt: `2026-10-01T00:00:0${index}Z` });
    const client = new FakeFeedClient([old(1), old(2), old(3), old(4)], 2);
    const t = appWith(client);
    await sync(t); // 2026-11-12T00:00Z 에 시작한 전체 동기화

    t.clock.advance(5 * HOUR);
    client.calls.length = 0;
    // 새 노드 1개(기준 이후)와 기준(2026-11-11T23:00Z)보다 오래된 노드들
    client.setNodes([
      fakeNode({ ghsa: "GHSA-new0-new0-0001", name: "fresh", updatedAt: "2026-11-12T03:00:00Z" }),
      fakeNode({ ghsa: "GHSA-new0-new0-0002", name: "edge", updatedAt: "2026-11-11T23:30:00Z" }),
      fakeNode({ ghsa: "GHSA-old0-old0-0001", name: "old-1", updatedAt: "2026-10-01T00:00:01Z", summary: "바뀐 요약" }),
      old(2),
      old(3),
      old(4),
    ]);
    const after = await sync(t);

    expect(client.calls).toEqual([null, "2"]);
    expect(after.entryCount).toBe(6);
    const items = (await entries(t)).items;
    expect(items.map((item) => item.name)).toEqual(expect.arrayContaining(["fresh", "edge"]));
    // 기준보다 오래된 노드는 받지 않았으므로 old-1 의 요약은 그대로다
    expect(items.find((item) => item.name === "old-1")?.summary).toBe("Malware in old-1");
    expect(after.lastSyncedAt).toBe(t.clock.iso());
  });

  it("[SE-41] 철회된 권고(withdrawnAt)는 그 권고의 항목을 모두 지운다", async () => {
    const list = [
      fakeNode({ ghsa: "GHSA-gone-gone-0001", name: "a", range: "= 1.0.0", updatedAt: "2026-11-01T00:00:03Z" }),
      fakeNode({ ghsa: "GHSA-gone-gone-0001", ecosystem: "PIP", name: "b", range: "= 1.0.0", updatedAt: "2026-11-01T00:00:02Z" }),
      fakeNode({ ghsa: "GHSA-keep-keep-0001", name: "c", updatedAt: "2026-11-01T00:00:01Z" }),
    ];
    const client = new FakeFeedClient(list);
    const t = appWith(client);
    expect((await sync(t)).entryCount).toBe(3);

    t.clock.advance(HOUR);
    client.setNodes([
      fakeNode({ ghsa: "GHSA-gone-gone-0001", name: "a", range: "= 1.0.0", updatedAt: "2026-11-12T00:30:00Z", withdrawnAt: "2026-11-12T00:30:00Z" }),
      ...list.slice(2),
    ]);
    const after = await sync(t);

    expect(after.entryCount).toBe(1);
    expect((await entries(t)).items.map((item) => item.name)).toEqual(["c"]);
  });

  it("[SE-42] 증분 동기화는 범위를 정리하지 않는다: 바뀐 권고의 새 범위는 더해지고 옛 범위는 다음 전체 동기화의 sweep 이 지운다 (SE-123)", async () => {
    const client = new FakeFeedClient([
      fakeNode({ ghsa: "GHSA-edit-edit-0001", name: "pkg", range: "= 1.0.0", updatedAt: "2026-11-01T00:00:02Z" }),
      fakeNode({ ghsa: "GHSA-edit-edit-0001", name: "pkg", range: "= 2.0.0", updatedAt: "2026-11-01T00:00:01Z" }),
    ]);
    const t = appWith(client);
    await sync(t);
    expect((await entries(t)).items.map((item) => item.versionRange).sort()).toEqual(["1.0.0", "2.0.0"]);

    t.clock.advance(HOUR);
    client.setNodes([
      fakeNode({ ghsa: "GHSA-edit-edit-0001", name: "pkg", range: "= 3.0.0", updatedAt: "2026-11-12T00:30:00Z" }),
    ]);
    await sync(t);

    expect((await entries(t)).items.map((item) => item.versionRange).sort()).toEqual(["1.0.0", "2.0.0", "3.0.0"]);
  });

  it("[SE-43] 값이 같은 항목은 다시 쓰지 않는다 (행 id 가 그대로이고 index 를 다시 만들지 않는다)", async () => {
    const client = new FakeFeedClient(nodes(2));
    const t = appWith(client);
    await sync(t);
    const ids = () =>
      t.instance.db.prepare<[], { id: number }>("SELECT id FROM feed_entries ORDER BY id").all().map((row) => row.id);
    const before = ids();
    const index = t.instance.services.feed.getIndex();

    t.clock.advance(HOUR);
    await sync(t);

    expect(ids()).toEqual(before);
    expect(t.instance.services.feed.getIndex()).toBe(index);
  });
});

describe("서버의 시작과 종료", () => {
  it("[SE-44] startBackground 는 feed 가 켜져 있고 토큰이 있을 때만 동기화를 시작한다. 클라이언트가 없으면 아무 일도 없다", async () => {
    const client = new FakeFeedClient(nodes(2));
    const t = appWith(client);

    t.instance.services.feed.startBackground();
    await t.instance.services.feed.waitForIdle();
    expect((await status(t)).entryCount).toBe(2);

    const none = createTestApp();
    none.instance.services.feed.startBackground();
    expect((await status(none))).toMatchObject({ syncing: false, entryCount: 0, lastError: null });
  });

  it("[SE-45] 앱을 닫으면 진행 중인 동기화가 현재 페이지에서 멈추고 cursor 가 남는다", async () => {
    const client = new FakeFeedClient(nodes(6), 2);
    const t = appWith(client);
    const gate = client.pauseNext();
    t.instance.services.feed.startBackground();
    await gate.reached;

    const closing = t.close();
    gate.release();
    await closing;

    // 첫 페이지만 받고 멈췄다. 다음 실행이 "2" 부터 이어받는다
    expect(client.calls).toEqual([null]);
    const second = new FakeFeedClient(nodes(6), 2);
    const t2 = appWith(second, { dbPath: t.dbPath, clock: t.clock });
    await sync(t2);
    expect(second.calls).toEqual(["2", "4"]);
  });

  it("[SE-46] 스캔 직전의 동기화는 최대 maxWaitMs 만 기다린다", async () => {
    const client = new FakeFeedClient(nodes(2));
    const t = appWith(client);
    const gate = client.pauseNext();

    const started = Date.now();
    await t.instance.services.feed.syncBeforeScan(30);

    expect(Date.now() - started).toBeLessThan(2_000);
    expect((await status(t)).syncing).toBe(true);
    gate.release();
    await t.instance.services.feed.waitForIdle();
    expect((await status(t)).entryCount).toBe(2);
  });
});
