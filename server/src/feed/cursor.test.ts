import { feedStatusSchema, type FeedStatus } from "@pw/shared";
import { afterEach, describe, expect, it } from "vitest";
import { RateLimitedError } from "../github/client.ts";
import { HOUR } from "../test/clock.ts";
import { fakeNode, FakeFeedClient } from "../test/feed.ts";
import { createFetchMock } from "../test/fetchMock.ts";
import { cleanupTestApps, createTestApp, type TestApp } from "../test/testApp.ts";
import { createFeedClient, FatalFeedError, InvalidCursorError } from "./client.ts";

afterEach(cleanupTestApps);

const nodes = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    fakeNode({ ghsa: `GHSA-aaaa-bbbb-${String(i).padStart(4, "0")}`, name: `p${i}`, updatedAt: new Date(Date.UTC(2026, 10, 1) - i * 1000).toISOString() }),
  );

interface Timer {
  fn: () => void;
  ms: number;
}

function appWith(client: FakeFeedClient, options: { auto?: boolean; retries?: number[]; sleep?: (ms: number) => Promise<void> } = {}) {
  const sleeps: number[] = [];
  const timers: Timer[] = [];
  const t = createTestApp({
    feedClient: client,
    feedOptions: {
      retryDelaysMs: options.retries ?? [],
      sleep: options.sleep ?? (async (ms) => void sleeps.push(ms)),
      autoResumeDelayMs: options.auto ? 5 * 60_000 : null,
      setTimer: (fn, ms) => {
        timers.push({ fn, ms });
        return { cancel: () => undefined };
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

const savedCursor = (t: TestApp): string | undefined =>
  t.instance.db.prepare<[], { value: string }>("SELECT value FROM settings WHERE key = 'feed_cursor'").get()?.value;

/** 2쪽까지 받고 rate limit 으로 멈춘 상태(cursor "2") */
async function pausedAt2(client: FakeFeedClient, options: Parameters<typeof appWith>[1] = {}) {
  client.failures.set(2, new RateLimitedError());
  const app = appWith(client, options);
  await sync(app.t);
  client.failures.clear();
  client.calls.length = 0;
  return app;
}

describe("이어받던 cursor 를 버리는 조건", () => {
  it("[SH-60] GitHub 이 cursor 를 거부(InvalidCursorError)했을 때만 처음부터 받고, 저장된 cursor 는 처음부터의 첫 쪽이 성공한 뒤에 바뀐다", async () => {
    const client = new FakeFeedClient(nodes(6), 2);
    const { t } = await pausedAt2(client);
    client.failures.set(1, new InvalidCursorError("cursor is invalid"));

    const done = await sync(t);

    expect(client.calls).toEqual(["2", null, "2", "4"]);
    expect(done).toMatchObject({ entryCount: 6, fullSyncDone: true, lastError: null });
  });

  it("[SH-61] 처음부터의 첫 요청이 실패하면 저장된 cursor 가 그대로 남는다 (진행을 잃지 않는다)", async () => {
    const client = new FakeFeedClient(nodes(6), 2);
    const { t } = await pausedAt2(client);
    client.failures.set(1, new InvalidCursorError("cursor is invalid"));
    client.failures.set(2, new Error("502"));

    const failed = await sync(t);

    expect(failed.lastError).toContain("502");
    expect(savedCursor(t)).toBe("2");

    client.failures.clear();
    client.calls.length = 0;
    expect(await sync(t)).toMatchObject({ entryCount: 6, fullSyncDone: true });
    expect(client.calls).toEqual(["2", "4"]);
  });

  it("[SH-62] 구분할 수 없는 오류(5xx·네트워크·형식 이상)는 재시도가 모두 실패해도 cursor 를 유지하고 실패로 끝낸다", async () => {
    const client = new FakeFeedClient(nodes(6), 2);
    const { t } = await pausedAt2(client, { retries: [1, 1, 1] });
    for (const call of [1, 2, 3, 4]) client.failures.set(call, new Error("GitHub 권고 응답의 형식이 올바르지 않습니다 (일시적일 수 있음)"));

    const failed = await sync(t);

    expect(client.calls).toEqual(["2", "2", "2", "2"]);
    expect(savedCursor(t)).toBe("2");
    expect(failed).toMatchObject({ fullSyncDone: false });
    expect(failed.lastError).toContain("형식");
  });

  it("[SH-63] 클라이언트의 판정: cursor 에 대한 GraphQL 오류만 InvalidCursorError. cursor 없는 요청과 다른 오류는 아니다", async () => {
    const reply = (message: string) =>
      createFetchMock(() => ({ status: 200, body: { data: null, errors: [{ message }] } }));
    const fail = async (message: string, cursor: string | null) => {
      const feed = createFeedClient({ token: "t", fetch: reply(message).fetch });
      return feed.fetchPage(cursor).then(
        () => null,
        (reason: unknown) => reason as Error,
      );
    };

    expect(await fail("`abc` does not appear to be a valid cursor.", "abc")).toBeInstanceOf(InvalidCursorError);
    expect(await fail("Invalid value for the 'after' argument", "abc")).toBeInstanceOf(InvalidCursorError);
    expect(await fail("`abc` does not appear to be a valid cursor.", null)).not.toBeInstanceOf(InvalidCursorError);
    expect(await fail("Something went wrong while executing your query.", "abc")).not.toBeInstanceOf(InvalidCursorError);
    expect(await fail("Timeout on validation of query", "abc")).not.toBeInstanceOf(InvalidCursorError);
  });
});

describe("재시도하지 않는 오류와 중지", () => {
  it("[SH-64] 토큰 문제(401, rate limit 이 아닌 403)는 재시도하지 않고 바로 실패한다", async () => {
    const client = new FakeFeedClient(nodes(2), 2);
    client.failures.set(1, new FatalFeedError("GitHub API 오류 (401): Bad credentials"));
    const { t, sleeps } = appWith(client, { retries: [2_000, 5_000, 15_000] });

    const failed = await sync(t);

    expect(client.calls).toEqual([null]);
    expect(sleeps).toEqual([]);
    expect(failed.lastError).toContain("401");

    for (const [status, body] of [[401, { message: "Bad credentials" }], [403, { message: "Forbidden" }]] as const) {
      const mock = createFetchMock(() => ({ status, body }));
      const feed = createFeedClient({ token: "t", fetch: mock.fetch });
      await expect(feed.fetchPage(null)).rejects.toBeInstanceOf(FatalFeedError);
    }
  });

  it("[SH-65] 재시도의 대기 뒤에 중지 요청이 있으면 다시 시도하지 않고 stopped 로 끝난다 (lastError 없음, 자동 이어받기 없음)", async () => {
    const client = new FakeFeedClient(nodes(4), 2);
    client.failures.set(1, new Error("502"));
    let disable: () => Promise<unknown> = async () => undefined;
    const app = appWith(client, { auto: true, retries: [2_000], sleep: () => disable() as Promise<void> });
    disable = () =>
      app.t.request("PUT", "/api/settings", { org: "my-org", scanIntervalHours: 24, digestTime: "09:00", recipients: [], feedEnabled: false });

    await sync(app.t);

    expect(client.calls).toEqual([null]);
    expect(app.t.instance.services.feed.getStatus().lastError).toBeNull();
    expect(app.timers).toHaveLength(0);
  });

  it("[SH-66] 요청 중에 중지가 걸린 뒤의 실패도 failed 가 아니라 stopped 다", async () => {
    const client = new FakeFeedClient(nodes(4), 2);
    client.failures.set(1, new Error("502"));
    const { t, timers } = appWith(client, { auto: true, retries: [2_000] });
    const gate = client.pauseNext();

    t.instance.services.feed.startSync();
    await gate.reached;
    await t.request("PUT", "/api/settings", { org: "my-org", scanIntervalHours: 24, digestTime: "09:00", recipients: [], feedEnabled: false });
    gate.release();
    await t.instance.services.feed.waitForIdle();

    expect(client.calls).toEqual([null]);
    expect(t.instance.services.feed.getStatus().lastError).toBeNull();
    expect(timers).toHaveLength(0);
  });
});

describe("자동 이어받기의 횟수와 rate limit 뒤의 대기", () => {
  it("[SH-67] 이번 실행이 쪽을 진행했으면 연속 실패 횟수를 초기화한다 (매번 몇 쪽씩 진행하면 3번에 포기하지 않는다)", async () => {
    const client = new FakeFeedClient(nodes(20), 2);
    client.failures.set(2, new Error("끊김"));
    const { t, timers } = appWith(client, { auto: true });
    await sync(t);

    for (let round = 1; round <= 5; round += 1) {
      expect(timers).toHaveLength(round);
      client.failures.clear();
      client.failures.set(client.calls.length + 2, new Error("끊김"));
      timers[round - 1]?.fn();
      await t.instance.services.feed.waitForIdle();
    }

    expect(timers).toHaveLength(6);
  });

  it("[SH-68] 진행 없이 연속 3번 실패하면 더는 예약하지 않는다", async () => {
    const client = new FakeFeedClient(nodes(6), 2);
    client.failures.set(1, new Error("끊김"));
    const { t, timers } = appWith(client, { auto: true });
    await sync(t);

    for (let round = 1; round <= 3; round += 1) {
      expect(timers).toHaveLength(round);
      client.failures.set(client.calls.length + 1, new Error("끊김"));
      timers[round - 1]?.fn();
      await t.instance.services.feed.waitForIdle();
    }

    expect(timers).toHaveLength(3);
  });

  it("[SH-69] rate limit 으로 멈춘 뒤 1시간이 지나기 전에는 스캔 직전의 동기화가 시작하지 않는다. 1시간 뒤에는 시작한다", async () => {
    const client = new FakeFeedClient(nodes(4), 2);
    const { t } = await pausedAt2(client);

    await t.instance.services.feed.syncBeforeScan(50);
    expect(client.calls).toHaveLength(0);

    t.clock.advance(HOUR - 1_000);
    await t.instance.services.feed.syncBeforeScan(50);
    expect(client.calls).toHaveLength(0);

    t.clock.advance(2_000);
    await t.instance.services.feed.syncBeforeScan(2_000);
    await t.instance.services.feed.waitForIdle();
    expect(client.calls).toEqual(["2"]);
    expect(t.instance.services.feed.getStatus().fullSyncDone).toBe(true);
  });

  it("[SH-70] 수동 실행(startSync)은 rate limit 뒤의 대기에 걸리지 않는다", async () => {
    const client = new FakeFeedClient(nodes(4), 2);
    const { t } = await pausedAt2(client);

    t.instance.services.feed.startSync();
    await t.instance.services.feed.waitForIdle();

    expect(client.calls).toEqual(["2"]);
  });
});
