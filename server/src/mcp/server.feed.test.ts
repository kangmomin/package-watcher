import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { feedEntriesPageSchema, feedStatusSchema } from "@pw/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeNode, FakeFeedClient } from "../test/feed.ts";
import { connectMcp, readToolOutput } from "../test/mcp.ts";
import { cleanupTestApps, createTestApp, expectApiError, type TestApp } from "../test/testApp.ts";

let t: TestApp;
const clients: Client[] = [];

async function connect(): Promise<Client> {
  const client = await connectMcp(t);
  clients.push(client);
  return client;
}

const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
  readToolOutput(await client.callTool({ name, arguments: args }));

beforeEach(async () => {
  t = createTestApp({
    feedClient: new FakeFeedClient([
      fakeNode({ ghsa: "GHSA-aaaa-aaaa-0001", name: "alpha-evil", updatedAt: "2026-11-03T00:00:00Z" }),
      fakeNode({ ghsa: "GHSA-bbbb-bbbb-0002", ecosystem: "PIP", name: "beta", range: "= 1.0", updatedAt: "2026-11-02T00:00:00Z" }),
    ]),
  });
  t.instance.services.feed.startSync();
  await t.instance.services.feed.waitForIdle();
});

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => undefined);
  await cleanupTestApps();
});

describe("/mcp — 외부 목록(feed)", () => {
  it("[SE-110] get_feed_status 는 GET /api/feed 와 같은 FeedStatus 를 돌려준다", async () => {
    const client = await connect();

    const output = await call(client, "get_feed_status");

    expect(output.isError).toBe(false);
    const rest = await t.request("GET", "/api/feed");
    expect(feedStatusSchema.parse(output.json)).toEqual(feedStatusSchema.parse(rest.json));
    expect(feedStatusSchema.parse(output.json)).toMatchObject({ entryCount: 2, byEcosystem: { npm: 1, pypi: 1 }, fullSyncDone: true });
  });

  it("[SE-111] search_feed 는 q·ecosystem·page·limit 로 검색한다. 잘못된 값은 VALIDATION_ERROR", async () => {
    const client = await connect();

    const found = feedEntriesPageSchema.parse((await call(client, "search_feed", { q: "evil" })).json);
    expect(found.items.map((item) => item.name)).toEqual(["alpha-evil"]);
    const paged = feedEntriesPageSchema.parse((await call(client, "search_feed", { limit: 1, page: 2 })).json);
    expect(paged.items.map((item) => item.name)).toEqual(["beta"]);
    expect(paged.total).toBe(2);
    const bad = await call(client, "search_feed", { limit: 1000 });
    expect(bad.isError).toBe(true);
    expect(bad.json).toMatchObject({ code: "VALIDATION_ERROR" });
    expectApiError(await t.request("GET", "/api/feed/entries?limit=1000"), 400, "VALIDATION_ERROR");
  });

  it("[SE-112] list_blacklist 와 export_blacklist 의 입력에 source 가 선언되어 있고 필터가 동작한다", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    for (const name of ["list_blacklist", "export_blacklist"]) {
      const properties = (tools.find((tool) => tool.name === name)?.inputSchema.properties ?? {}) as Record<string, { enum?: string[] }>;
      expect(properties.source?.enum, name).toEqual(["manual", "feed"]);
    }
    await call(client, "add_blacklist_entry", { name: "manual-pkg", reason: "수동" });

    const manual = await call(client, "list_blacklist", { source: "manual" });
    const feed = await call(client, "list_blacklist", { source: "feed" });
    const bad = await call(client, "list_blacklist", { source: "x" });

    expect((manual.json as { items: unknown[] }).items).toHaveLength(1);
    expect((feed.json as { items: unknown[] }).items).toHaveLength(0);
    expect(bad.isError).toBe(true);
  });
});
