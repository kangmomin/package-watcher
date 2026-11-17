import { createHash } from "node:crypto";
import { feedEntriesPageSchema, feedStatusSchema, type FeedStatus } from "@pw/shared";
import { afterEach, describe, expect, it } from "vitest";
import { RateLimitedError } from "../github/client.ts";
import { DAY, HOUR } from "../test/clock.ts";
import { createFetchMock } from "../test/fetchMock.ts";
import { fakeNode, FakeFeedClient, type FakeNodeInput } from "../test/feed.ts";
import { cleanupTestApps, createTestApp, putSettings, type TestApp } from "../test/testApp.ts";
import { CVE_QUERY, createFeedClient, FEED_QUERY } from "./client.ts";
import { cvssScoreOf } from "./sync.ts";

afterEach(cleanupTestApps);

function appWith(client: FakeFeedClient): TestApp {
  return createTestApp({ feedClient: client });
}

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

async function entries(t: TestApp, query: string) {
  const res = await t.request("GET", `/api/feed/entries?limit=200&${query}`);
  expect(res.status, res.text).toBe(200);
  return feedEntriesPageSchema.parse(res.json);
}

const cve = (index: number, input: Partial<FakeNodeInput> = {}) =>
  fakeNode({
    ghsa: `GHSA-cvee-cvee-${String(index).padStart(4, "0")}`,
    name: `lib-${index}`,
    severity: "HIGH",
    summary: `Vulnerability in lib-${index}`,
    updatedAt: new Date(Date.UTC(2026, 10, 1) - index * 1000).toISOString(),
    ...input,
  });
const mal = (index: number) =>
  fakeNode({
    ghsa: `GHSA-mmmm-mmmm-${String(index).padStart(4, "0")}`,
    name: `evil-${index}`,
    updatedAt: new Date(Date.UTC(2026, 10, 1) - index * 1000).toISOString(),
  });

describe("GraphQL 쿼리 (cve)", () => {
  it("[SI-20] cve 의 쿼리는 GENERAL 이고 고쳐진 버전과 CVSS 를 더한다. malware 의 쿼리 문자열은 바뀌지 않는다", async () => {
    const calls: string[] = [];
    const mock = createFetchMock(({ body }) => {
      calls.push(JSON.parse(body ?? "{}").query as string);
      return { status: 200, body: { data: { securityVulnerabilities: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } };
    });
    const feed = createFeedClient({ token: "t", fetch: mock.fetch });

    await feed.fetchPage("cve", null);
    await feed.fetchPage("malware", null);

    const [cveSent, malwareSent] = calls;
    expect(cveSent).toBe(CVE_QUERY);
    expect(cveSent).toContain("classifications: GENERAL");
    expect(cveSent).toContain("firstPatchedVersion { identifier }");
    expect(cveSent).toContain("cvssSeverities { cvssV3 { score } cvssV4 { score } }");
    expect(cveSent).toContain("UPDATED_AT");
    expect(malwareSent).toBe(FEED_QUERY);
    expect(malwareSent).toContain("classifications: MALWARE");
    // 녹화·재생 도구가 요청 body 의 hash 로 응답을 찾는다 — 이 hash 가 바뀌면 기존 녹화가 맞지 않는다
    expect(createHash("sha256").update(FEED_QUERY).digest("hex")).toBe(MALWARE_QUERY_SHA256);
  });
});

/** 묶음 I 이전의 FEED_QUERY 문자열의 sha256 */
const MALWARE_QUERY_SHA256 = createHash("sha256")
  .update(`
query($cursor: String) {
  securityVulnerabilities(classifications: MALWARE, first: 100, after: $cursor, orderBy: {field: UPDATED_AT, direction: DESC}) {
    pageInfo { hasNextPage endCursor }
    nodes {
      updatedAt
      vulnerableVersionRange
      package { ecosystem name }
      advisory { ghsaId summary severity permalink withdrawnAt updatedAt }
    }
  }
}`)
  .digest("hex");

describe("CVSS 점수와 고쳐진 버전", () => {
  it("[SI-21] 점수 = v3 와 v4 중 큰 값. 둘 다 없거나 0 이면 null", () => {
    expect(cvssScoreOf({ cvssV3: { score: 7.5 }, cvssV4: null })).toBe(7.5);
    expect(cvssScoreOf({ cvssV3: null, cvssV4: { score: 8.2 } })).toBe(8.2);
    expect(cvssScoreOf({ cvssV3: { score: 7.5 }, cvssV4: { score: 9.3 } })).toBe(9.3);
    expect(cvssScoreOf({ cvssV3: { score: 9.8 }, cvssV4: { score: 6.1 } })).toBe(9.8);
    expect(cvssScoreOf({ cvssV3: { score: 0 }, cvssV4: { score: 0 } })).toBeNull();
    expect(cvssScoreOf({ cvssV3: { score: 0 }, cvssV4: { score: 5 } })).toBe(5);
    expect(cvssScoreOf({ cvssV3: null, cvssV4: null })).toBeNull();
    expect(cvssScoreOf(null)).toBeNull();
    expect(cvssScoreOf(undefined)).toBeNull();
  });

  it("[SI-22] 동기화한 cve 행에 점수와 고쳐진 버전이 저장된다. 기준과 상관없이 모두 저장하고 malware 는 둘 다 null", async () => {
    const client = new FakeFeedClient([mal(1)]);
    client.setNodes(
      [
        cve(1, { cvssV3: 9.8, patched: "1.2.3" }),
        cve(2, { cvssV4: 8.5 }),
        cve(3, { cvssV3: 5.0, cvssV4: 6.5, patched: "4.0.0" }),
        cve(4, { cvssV3: 0, cvssV4: 0, severity: "CRITICAL" }),
        cve(5, { cvssV3: 2.0, severity: "LOW" }),
      ],
      "cve",
    );
    const t = appWith(client);
    await putSettings(t, { cveMinScore: 9 });

    const after = await sync(t);

    const items = (await entries(t, "kind=cve")).items;
    expect(items).toHaveLength(5);
    const byName = Object.fromEntries(items.map((item) => [item.name, item]));
    expect(byName["lib-1"]).toMatchObject({ kind: "cve", cvssScore: 9.8, patchedVersion: "1.2.3", severity: "high" });
    expect(byName["lib-2"]).toMatchObject({ cvssScore: 8.5, patchedVersion: null });
    expect(byName["lib-3"]).toMatchObject({ cvssScore: 6.5, patchedVersion: "4.0.0" });
    expect(byName["lib-4"]).toMatchObject({ cvssScore: null, severity: "critical" });
    expect(byName["lib-5"]).toMatchObject({ cvssScore: 2, severity: "low" });
    const malware = (await entries(t, "kind=malware")).items;
    expect(malware).toHaveLength(1);
    expect(malware[0]).toMatchObject({ kind: "malware", cvssScore: null, patchedVersion: null });
    expect(after.byKind.cve.entryCount).toBe(5);
    expect(after.byKind.malware.entryCount).toBe(1);
    expect(after.entryCount).toBe(6);
  });

  it("[SI-23] severity 를 알 수 없거나 범위를 변환하지 못하면 건너뛰고 센다 (cve)", async () => {
    const client = new FakeFeedClient();
    client.setNodes(
      [cve(1, { cvssV3: 9 }), cve(2, { severity: "UNKNOWN" }), cve(3, { range: "<><>" }), { broken: true }],
      "cve",
    );
    const t = appWith(client);

    const after = await sync(t);

    expect(after.byKind.cve.entryCount).toBe(1);
    expect(after.byKind.cve.skippedCount).toBe(3);
    expect(after.byKind.malware.skippedCount).toBe(0);
    expect(after.skippedCount).toBe(3);
  });
});

describe("kind 별 동기화", () => {
  it("[SI-24] cveMinScore = 0 이면 cve 를 요청하지 않는다. 0 → 양수로 바뀌면 다음 동기화에서 cve 가 돈다", async () => {
    const client = new FakeFeedClient([mal(1)]);
    client.setNodes([cve(1, { cvssV3: 9 })], "cve");
    const t = appWith(client);
    await putSettings(t, { cveMinScore: 0 });

    const off = await sync(t);

    expect(client.calls).toEqual([null]);
    expect(client.cveCalls).toEqual([]);
    expect(off.byKind.cve).toMatchObject({ entryCount: 0, fullSyncDone: false, lastSyncedAt: null });
    // 꺼진 분류는 기다리지 않는다: malware 가 끝났으면 top 도 끝났다
    expect(off.fullSyncDone).toBe(true);

    await putSettings(t, { cveMinScore: 8 });
    expect((await status(t)).fullSyncDone).toBe(false);
    const on = await sync(t);

    expect(client.cveCalls).toEqual([null]);
    expect(on.byKind.cve).toMatchObject({ entryCount: 1, fullSyncDone: true });
    expect(on.fullSyncDone).toBe(true);
  });

  it("[SI-25] malware 먼저, 그 다음 cve. 두 분류의 cursor 와 완료 여부가 독립이다", async () => {
    const client = new FakeFeedClient([mal(0), mal(1), mal(2), mal(3)], 2);
    client.setNodes([cve(0, { cvssV3: 9 }), cve(1, { cvssV3: 9 }), cve(2, { cvssV3: 9 })], "cve");
    const order: string[] = [];
    const original = client.fetchPage.bind(client);
    client.fetchPage = (kind, cursor) => {
      order.push(`${kind}:${cursor ?? "-"}`);
      return original(kind, cursor);
    };
    const t = appWith(client);

    const after = await sync(t);

    expect(order).toEqual(["malware:-", "malware:2", "cve:-", "cve:2"]);
    expect(after.byKind.malware).toMatchObject({ entryCount: 4, fullSyncDone: true });
    expect(after.byKind.cve).toMatchObject({ entryCount: 3, fullSyncDone: true });
    expect(after).toMatchObject({ entryCount: 7, fullSyncDone: true, lastError: null });
  });

  it("[SI-26] malware 가 실패해도 cve 를 시도하고 각자의 오류를 저장한다. 다음 실행은 malware 만 이어받는다", async () => {
    const client = new FakeFeedClient([mal(0), mal(1), mal(2), mal(3)], 2);
    client.setNodes([cve(0, { cvssV3: 9 }), cve(1, { cvssV3: 9 }), cve(2, { cvssV3: 9 })], "cve");
    client.failures.set(2, new Error("GitHub API 오류 (502): bad gateway"));
    const t = appWith(client);

    const failed = await sync(t);

    expect(client.calls).toEqual([null, "2"]);
    expect(client.cveCalls).toEqual([null, "2"]);
    expect(failed.byKind.malware).toMatchObject({ entryCount: 2, fullSyncDone: false });
    expect(failed.byKind.malware.lastError).toContain("502");
    expect(failed.byKind.cve).toMatchObject({ entryCount: 3, fullSyncDone: true, lastError: null });
    // 맨 위: 켜진 분류가 모두 끝나지 않았다, 오류는 먼저 있는 것, 마지막 동기화는 malware 가 없어서 null
    expect(failed).toMatchObject({ fullSyncDone: false, entryCount: 5, lastSyncedAt: null });
    expect(failed.lastError).toContain("502");

    client.calls.length = 0;
    client.cveCalls.length = 0;
    client.failures.clear();
    const resumed = await sync(t);

    expect(client.calls).toEqual(["2"]);
    // 끝난 cve 는 증분이다(처음부터 받지 않는다)
    expect(client.cveCalls).toEqual([null]);
    expect(resumed.byKind.malware).toMatchObject({ entryCount: 4, fullSyncDone: true, lastError: null });
    expect(resumed).toMatchObject({ fullSyncDone: true, lastError: null, entryCount: 7 });
  });

  it("[SI-27] cve 의 rate limit 은 malware 의 상태에 영향을 주지 않는다", async () => {
    const client = new FakeFeedClient([mal(0), mal(1)]);
    client.setNodes([cve(0, { cvssV3: 9 })], "cve");
    client.cveFailures.set(1, new RateLimitedError());
    const t = appWith(client);

    const after = await sync(t);

    expect(after.byKind.malware).toMatchObject({ entryCount: 2, fullSyncDone: true, lastError: null });
    expect(after.byKind.cve).toMatchObject({ entryCount: 0, fullSyncDone: false });
    expect(after.byKind.cve.lastError).toContain("한도");
    expect(after.fullSyncDone).toBe(false);
    expect(after.lastError).toContain("한도");
  });

  it("[SI-28] 한 분류의 전체 동기화(sweep)는 다른 분류의 행을 지우지 않는다", async () => {
    const client = new FakeFeedClient([mal(0), mal(1), mal(2)]);
    client.setNodes([cve(0, { cvssV3: 9 }), cve(1, { cvssV3: 9 })], "cve");
    const t = appWith(client);
    await sync(t);

    // 7일이 지나면 두 분류 모두 전체 동기화다. malware 에서만 mal(2) 가 사라진다
    t.clock.advance(8 * DAY);
    client.setNodes([mal(0), mal(1)]);
    const after = await sync(t);

    expect(after.byKind.malware.entryCount).toBe(2);
    expect(after.byKind.cve.entryCount).toBe(2);
    expect((await entries(t, "kind=malware")).items.map((item) => item.name).sort()).toEqual(["evil-0", "evil-1"]);
    expect((await entries(t, "kind=cve")).items.map((item) => item.name).sort()).toEqual(["lib-0", "lib-1"]);

    // 반대로 cve 만 줄어도 malware 는 그대로다
    t.clock.advance(8 * DAY);
    client.setNodes([cve(0, { cvssV3: 9 })], "cve");
    const again = await sync(t);

    expect(again.byKind.malware.entryCount).toBe(2);
    expect(again.byKind.cve.entryCount).toBe(1);
  });

  it("[SI-29] 철회(withdrawnAt)는 그 분류의 행만 지운다. 증분 동기화도 분류마다 따로 돈다", async () => {
    const client = new FakeFeedClient([mal(0)]);
    client.setNodes([cve(0, { cvssV3: 9 }), cve(1, { cvssV3: 9 })], "cve");
    const t = appWith(client);
    await sync(t);

    t.clock.advance(HOUR);
    client.calls.length = 0;
    client.cveCalls.length = 0;
    client.setNodes([
      cve(0, { cvssV3: 9, withdrawnAt: "2026-11-12T00:30:00Z", updatedAt: "2026-11-12T00:30:00Z" }),
      cve(1, { cvssV3: 9 }),
    ], "cve");
    const after = await sync(t);

    expect(client.calls).toEqual([null]);
    expect(client.cveCalls).toEqual([null]);
    expect(after.byKind.cve.entryCount).toBe(1);
    expect(after.byKind.malware.entryCount).toBe(1);
    expect((await entries(t, "kind=cve")).items.map((item) => item.name)).toEqual(["lib-1"]);
  });

  it("[SI-30] 목록 API: kind 필터와 응답의 kind·cvssScore·patchedVersion. 잘못된 kind 는 400", async () => {
    const client = new FakeFeedClient([mal(0)]);
    client.setNodes([cve(0, { cvssV3: 7.2, patched: "2.0.0" })], "cve");
    const t = appWith(client);
    await sync(t);

    const all = await entries(t, "");
    expect(all.total).toBe(2);
    expect(all.items.map((item) => item.kind).sort()).toEqual(["cve", "malware"]);
    const only = await entries(t, "kind=cve&q=lib");
    expect(only.items).toHaveLength(1);
    expect(only.items[0]).toMatchObject({ kind: "cve", cvssScore: 7.2, patchedVersion: "2.0.0" });
    const bad = await t.request("GET", "/api/feed/entries?kind=other");
    expect(bad.status).toBe(400);
  });
});
