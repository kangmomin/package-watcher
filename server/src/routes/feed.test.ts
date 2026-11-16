import { feedEntriesPageSchema, feedStatusSchema } from "@pw/shared";
import { afterEach, describe, expect, it } from "vitest";
import { fakeNode, FakeFeedClient } from "../test/feed.ts";
import { cleanupTestApps, createTestApp, expectApiError, putSettings, type TestApp } from "../test/testApp.ts";

afterEach(cleanupTestApps);

async function withFeed(nodes: unknown[]): Promise<TestApp> {
  const t = createTestApp({ feedClient: new FakeFeedClient(nodes) });
  t.instance.services.feed.startSync();
  await t.instance.services.feed.waitForIdle();
  return t;
}

const list = async (t: TestApp, query = "") => {
  const res = await t.request("GET", `/api/feed/entries${query}`);
  expect(res.status, res.text).toBe(200);
  return feedEntriesPageSchema.parse(res.json);
};

describe("GET /api/feed", () => {
  it("[SE-80] 아무것도 받지 않은 상태: FeedStatus 스키마이고 켜져 있으며 항목 0건", async () => {
    const t = createTestApp();

    const res = await t.request("GET", "/api/feed");

    expect(res.status).toBe(200);
    expect(feedStatusSchema.parse(res.json)).toEqual({
      enabled: true,
      entryCount: 0,
      byEcosystem: {},
      skippedCount: 0,
      lastSyncedAt: null,
      fullSyncDone: false,
      syncing: false,
      syncedSoFar: 0,
      lastError: null,
    });
  });

  it("[SE-81] POST /api/feed/sync 는 202 와 시작한 뒤의 상태(syncing)를 바로 돌려준다", async () => {
    const client = new FakeFeedClient([fakeNode({ ghsa: "GHSA-aaaa-aaaa-0001", name: "a" })]);
    const t = createTestApp({ feedClient: client });
    const gate = client.pauseNext();

    const res = await t.request("POST", "/api/feed/sync");

    expect(res.status).toBe(202);
    expect(feedStatusSchema.parse(res.json).syncing).toBe(true);
    gate.release();
    await t.instance.services.feed.waitForIdle();
  });

  it("[SE-82] 설정의 feedEnabled: 기본 true, PUT 으로 끄고 켠다. 생략하면 저장된 값을 유지한다", async () => {
    const t = createTestApp();
    await putSettings(t);
    const get = async () => ((await t.request("GET", "/api/settings")).json as { feedEnabled: boolean }).feedEnabled;
    const put = (extra: object) =>
      t.request("PUT", "/api/settings", { org: "my-org", scanIntervalHours: 24, digestTime: "09:00", recipients: [], ...extra });

    expect(await get()).toBe(true);
    expect((await put({ feedEnabled: false })).status).toBe(200);
    expect(await get()).toBe(false);
    expect((await put({})).status).toBe(200);
    expect(await get()).toBe(false);
    expect((await put({ feedEnabled: true })).status).toBe(200);
    expect(await get()).toBe(true);
    expectApiError(await put({ feedEnabled: "no" }), 400, "VALIDATION_ERROR");
  });
});

describe("GET /api/feed/entries", () => {
  const nodes = [
    fakeNode({ ghsa: "GHSA-aaaa-aaaa-0001", name: "Alpha-Evil", updatedAt: "2026-11-03T00:00:00Z" }),
    fakeNode({ ghsa: "GHSA-bbbb-bbbb-0002", ecosystem: "PIP", name: "beta", range: "= 1.0", updatedAt: "2026-11-02T00:00:00Z" }),
    fakeNode({ ghsa: "GHSA-cccc-cccc-0003", name: "gamma", updatedAt: "2026-11-02T00:00:00Z" }),
    fakeNode({ ghsa: "GHSA-dddd-dddd-0004", name: "delta", updatedAt: "2026-11-01T00:00:00Z" }),
  ];

  it("[SE-83] 갱신 시각 내림차순(같으면 id)으로 쪽을 나눈다", async () => {
    const t = await withFeed(nodes);

    const first = await list(t, "?limit=2");
    expect(first).toMatchObject({ total: 4, page: 1, limit: 2 });
    expect(first.items.map((item) => item.name)).toEqual(["Alpha-Evil", "beta"]);

    const second = await list(t, "?limit=2&page=2");
    expect(second.items.map((item) => item.name)).toEqual(["gamma", "delta"]);
    expect((await list(t)).limit).toBe(50);
  });

  it("[SE-84] q 는 이름 또는 권고 id 의 대소문자 무시 부분 일치이고 ecosystem 으로 거른다", async () => {
    const t = await withFeed(nodes);

    expect((await list(t, "?q=EVIL")).items.map((item) => item.name)).toEqual(["Alpha-Evil"]);
    expect((await list(t, "?q=ghsa-bbbb")).items.map((item) => item.name)).toEqual(["beta"]);
    expect((await list(t, "?ecosystem=pypi")).total).toBe(1);
    expect((await list(t, "?ecosystem=npm&q=a")).items.map((item) => item.name)).toEqual(["Alpha-Evil", "gamma", "delta"]);
    expect((await list(t, "?q=%25")).total).toBe(0);
  });

  it("[SE-85] 잘못된 쿼리는 400 VALIDATION_ERROR", async () => {
    const t = createTestApp();

    expectApiError(await t.request("GET", "/api/feed/entries?limit=201"), 400, "VALIDATION_ERROR");
    expectApiError(await t.request("GET", "/api/feed/entries?page=0"), 400, "VALIDATION_ERROR");
    expectApiError(await t.request("GET", "/api/feed/entries?ecosystem=erlang"), 400, "VALIDATION_ERROR");
  });

  it("[SE-86] 블랙리스트 목록에는 feed 항목이 나오지 않는다", async () => {
    const t = await withFeed(nodes);

    const res = await t.request("GET", "/api/blacklist");

    expect(res.json).toEqual({ items: [] });
  });
});
