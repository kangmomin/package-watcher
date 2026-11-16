import { feedStatusSchema, type FeedStatus } from "@pw/shared";
import { afterEach, describe, expect, it } from "vitest";
import { RateLimitedError } from "../github/client.ts";
import { fakeNode, FakeFeedClient } from "../test/feed.ts";
import { createFetchMock } from "../test/fetchMock.ts";
import { cleanupTestApps, createTestApp, type TestApp } from "../test/testApp.ts";
import { createFeedClient, describeMalformed } from "./client.ts";

afterEach(cleanupTestApps);

const nodes = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    fakeNode({ ghsa: `GHSA-aaaa-bbbb-${String(i).padStart(4, "0")}`, name: `p${i}`, updatedAt: new Date(Date.UTC(2026, 10, 1) - i * 1000).toISOString() }),
  );

interface Timer {
  fn: () => void;
  ms: number;
  cancelled: boolean;
}

/** 대기와 타이머를 기록하는 앱 */
function appWith(client: FakeFeedClient, options: { auto?: boolean } = {}) {
  const sleeps: number[] = [];
  const timers: Timer[] = [];
  const t = createTestApp({
    feedClient: client,
    feedOptions: {
      retryDelaysMs: [],
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      autoResumeDelayMs: options.auto ? 5 * 60_000 : null,
      rateLimitResumeDelayMs: 60 * 60_000,
      setTimer: (fn, ms) => {
        const timer: Timer = { fn, ms, cancelled: false };
        timers.push(timer);
        return { cancel: () => (timer.cancelled = true) };
      },
    },
  });
  return { t, sleeps, timers };
}

async function sync(t: TestApp): Promise<FeedStatus> {
  t.instance.services.feed.startSync();
  await t.instance.services.feed.waitForIdle();
  return feedStatusSchema.parse((await t.request("GET", "/api/feed")).json);
}

// retryDelaysMs 를 주지 않은 앱은 기본(2초, 5초, 15초)이다
function withRetries(client: FakeFeedClient, auto = false) {
  const sleeps: number[] = [];
  const timers: Timer[] = [];
  const t = createTestApp({
    feedClient: client,
    feedOptions: {
      retryDelaysMs: [2_000, 5_000, 15_000],
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      autoResumeDelayMs: auto ? 5 * 60_000 : null,
      setTimer: (fn, ms) => {
        const timer: Timer = { fn, ms, cancelled: false };
        timers.push(timer);
        return { cancel: () => (timer.cancelled = true) };
      },
    },
  });
  return { t, sleeps, timers };
}

describe("쪽 단위의 재시도", () => {
  it("[SH-10] 일시적인 오류는 같은 cursor 로 다시 시도하고, 성공하면 lastError 가 남지 않는다", async () => {
    const client = new FakeFeedClient(nodes(4), 2);
    client.failures.set(2, new Error("GitHub 권고 응답의 형식이 올바르지 않습니다"));
    const { t, sleeps } = withRetries(client);

    const status = await sync(t);

    expect(client.calls).toEqual([null, "2", "2"]);
    expect(sleeps).toEqual([2_000]);
    expect(status).toMatchObject({ entryCount: 4, fullSyncDone: true, lastError: null });
  });

  it("[SH-11] 3번 더 시도한다: 대기 2초 → 5초 → 15초, 마지막 시도가 성공하면 이어간다", async () => {
    const client = new FakeFeedClient(nodes(2), 2);
    for (const call of [1, 2, 3]) client.failures.set(call, new Error("502"));
    const { t, sleeps } = withRetries(client);

    const status = await sync(t);

    expect(sleeps).toEqual([2_000, 5_000, 15_000]);
    expect(client.calls).toEqual([null, null, null, null]);
    expect(status).toMatchObject({ entryCount: 2, fullSyncDone: true, lastError: null });
  });

  it("[SH-12] 4번 모두 실패하면 멈추고 lastError 를 남기며 cursor 는 유지된다 (이어받기)", async () => {
    const client = new FakeFeedClient(nodes(4), 2);
    for (const call of [2, 3, 4, 5]) client.failures.set(call, new Error("502 bad gateway"));
    const { t, sleeps } = withRetries(client);

    const failed = await sync(t);

    expect(sleeps).toEqual([2_000, 5_000, 15_000]);
    expect(client.calls).toEqual([null, "2", "2", "2", "2"]);
    expect(failed).toMatchObject({ entryCount: 2, fullSyncDone: false });
    expect(failed.lastError).toContain("502");
    expect(t.instance.db.prepare<[], { value: string }>("SELECT value FROM settings WHERE key = 'feed_cursor'").get()?.value).toBe("2");

    client.failures.clear();
    client.calls.length = 0;
    expect(await sync(t)).toMatchObject({ entryCount: 4, fullSyncDone: true, lastError: null });
    expect(client.calls).toEqual(["2"]);
  });

  it("[SH-13] rate limit 은 재시도하지 않는다", async () => {
    const client = new FakeFeedClient(nodes(4), 2);
    client.failures.set(2, new RateLimitedError());
    const { t, sleeps } = withRetries(client);

    const failed = await sync(t);

    expect(sleeps).toEqual([]);
    expect(client.calls).toEqual([null, "2"]);
    expect(failed.lastError).toMatch(/한도/);
  });

  it("[SH-14] 이어받기의 첫 요청은 재시도 3번 뒤에도 실패했을 때만 cursor 를 버린다", async () => {
    const list = nodes(5);
    const first = new FakeFeedClient(list, 2);
    first.failures.set(2, new RateLimitedError());
    const { t } = withRetries(first);
    await sync(t);

    // 재시도 안에서 성공하면 cursor 를 버리지 않는다
    first.calls.length = 0;
    first.failures.clear();
    first.failures.set(1, new Error("x"));
    first.failures.set(2, new Error("x"));
    await sync(t);
    expect(first.calls).toEqual(["2", "2", "2", "4"]);

    // 4번 모두 실패하면 처음부터 다시 받는다
    const second = new FakeFeedClient(list, 2);
    second.failures.set(2, new RateLimitedError());
    const other = withRetries(second);
    await sync(other.t);
    second.calls.length = 0;
    second.failures.clear();
    for (const call of [1, 2, 3, 4]) second.failures.set(call, new Error("cursor invalid"));
    const done = await sync(other.t);
    expect(second.calls).toEqual(["2", "2", "2", "2", null, "2", "4"]);
    expect(done).toMatchObject({ entryCount: 5, fullSyncDone: true });
  });
});

describe("자동 이어받기", () => {
  it("[SH-15] 전체 동기화가 오류로 멈추면 5분 뒤에 1번 이어받는다. 성공하면 횟수가 초기화된다", async () => {
    const client = new FakeFeedClient(nodes(4), 2);
    client.failures.set(2, new Error("끊김"));
    const { t, timers } = appWith(client, { auto: true });

    await sync(t);
    expect(timers.map((timer) => timer.ms)).toEqual([5 * 60_000]);

    client.failures.clear();
    client.calls.length = 0;
    timers[0]?.fn();
    await t.instance.services.feed.waitForIdle();

    expect(client.calls).toEqual(["2"]);
    expect(t.instance.services.feed.getStatus()).toMatchObject({ fullSyncDone: true, entryCount: 4, lastError: null });
    expect(timers).toHaveLength(1);
  });

  it("[SH-16] 연속 3번까지만 자동으로 시도한다 (첫 실패 + 자동 이어받기 3번이 모두 실패하면 더는 예약하지 않는다)", async () => {
    const client = new FakeFeedClient(nodes(4), 2);
    client.failures.set(2, new Error("끊김"));
    const { t, timers } = appWith(client, { auto: true });
    await sync(t);

    for (let round = 1; round <= 3; round += 1) {
      expect(timers).toHaveLength(round);
      client.calls.length = 0;
      client.failures.clear();
      for (let call = 1; call <= 4; call += 1) client.failures.set(call, new Error("계속 실패"));
      timers[round - 1]?.fn();
      await t.instance.services.feed.waitForIdle();
    }

    expect(timers).toHaveLength(3);
  });

  it("[SH-17] rate limit 으로 멈추면 1시간 뒤에 이어받는다", async () => {
    const client = new FakeFeedClient(nodes(4), 2);
    client.failures.set(2, new RateLimitedError());
    const { t, timers } = appWith(client, { auto: true });

    await sync(t);

    expect(timers.map((timer) => timer.ms)).toEqual([60 * 60_000]);
  });

  it("[SH-18] feed 가 꺼졌거나 이미 실행 중이면 이어받지 않는다. 서버를 닫으면 타이머를 지운다. 증분 동기화의 실패는 예약하지 않는다", async () => {
    const client = new FakeFeedClient(nodes(4), 2);
    client.failures.set(2, new Error("끊김"));
    const { t, timers } = appWith(client, { auto: true });
    await sync(t);
    client.failures.clear();
    client.calls.length = 0;

    const off = await t.request("PUT", "/api/settings", { org: "my-org", scanIntervalHours: 24, digestTime: "09:00", recipients: [], feedEnabled: false });
    expect(off.status, off.text).toBe(200);
    timers[0]?.fn();
    await t.instance.services.feed.waitForIdle();
    expect(client.calls).toHaveLength(0);

    const closing = new FakeFeedClient(nodes(4), 2);
    closing.failures.set(2, new Error("끊김"));
    const other = appWith(closing, { auto: true });
    await sync(other.t);
    await other.t.close();
    expect(other.timers[0]?.cancelled).toBe(true);

    const done = new FakeFeedClient(nodes(2));
    const incremental = appWith(done, { auto: true });
    await sync(incremental.t);
    incremental.t.clock.advance(60_000);
    done.failures.set(done.calls.length + 1, new Error("끊김"));
    await sync(incremental.t);
    expect(incremental.timers).toHaveLength(0);
  });
});

describe("형식이 다른 응답", () => {
  it("[SH-19] securityVulnerabilities 가 null 이면 '(일시적일 수 있음)'을 붙이고 errors 의 첫 메시지는 200자로 자른다", async () => {
    expect(describeMalformed({ securityVulnerabilities: null }, null)).toBe("GitHub 권고 응답의 형식이 올바르지 않습니다 (일시적일 수 있음)");
    const long = "x".repeat(500);
    const message = describeMalformed({ errors: [{ message: long }, { message: "둘째" }] }, undefined);
    expect(message).toBe(`GitHub 권고 응답의 형식이 올바르지 않습니다 (일시적일 수 있음): ${"x".repeat(200)}`);
    // 연결은 있는데 nodes 가 배열이 아닌 경우는 표시하지 않는다
    expect(describeMalformed({}, { nodes: null })).toBe("GitHub 권고 응답의 형식이 올바르지 않습니다");

    const mock = createFetchMock(() => ({ status: 200, body: { data: { securityVulnerabilities: null } } }));
    const feed = createFeedClient({ token: "secret-token", fetch: mock.fetch });
    const error = await feed.fetchPage(null).then(
      () => null,
      (reason: unknown) => reason as Error,
    );
    expect(error?.message).toContain("(일시적일 수 있음)");
    expect(error?.message).not.toContain("secret-token");
  });
});
