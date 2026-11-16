import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { POLICY_CHECK_IDS, POLICY_CREATE_MESSAGE, findingsPageSchema } from "@pw/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectMcp, readToolOutput } from "../test/mcp.ts";
import { pkgJson } from "../test/repoFixtures.ts";
import { cleanupTestApps, createTestApp, putSettings, runScan, type TestApp } from "../test/testApp.ts";
import { addEntry } from "../test/v2.ts";

let t: TestApp;
let client: Client;

beforeEach(async () => {
  t = createTestApp({ seedPolicy: true });
  await putSettings(t);
  client = await connectMcp(t);
});

afterEach(async () => {
  await client.close().catch(() => undefined);
  await cleanupTestApps();
});

describe("MCP — policy", () => {
  it("[SD-70] tool 은 13개 그대로이고 list_findings 에 category·excludeCategory, 종류 설명에 policy 가 있다", async () => {
    const { tools } = await client.listTools();

    expect(tools).toHaveLength(13);
    const list = tools.find((tool) => tool.name === "list_findings");
    const properties = (list?.inputSchema.properties ?? {}) as Record<string, { enum?: string[] }>;
    expect(properties.category?.enum).toEqual(["package", "ci", "indicator", "policy"]);
    expect(properties.excludeCategory?.enum).toEqual(["package", "ci", "indicator", "policy"]);
    const add = tools.find((tool) => tool.name === "add_blacklist_entry");
    const addProps = (add?.inputSchema.properties ?? {}) as Record<string, { description?: string }>;
    const text = `${addProps.ecosystem?.description}${addProps.name?.description}`;
    expect(text).toContain("policy");
    for (const id of POLICY_CHECK_IDS) expect(text).toContain(id);
  });

  it("[SD-71] list_findings 의 category 로 policy 검출만 거른다", async () => {
    await addEntry(t, { name: "evil-pkg", versionRange: null, reason: "악성" });
    t.github.setRepos([
      {
        name: "svc",
        files: { "package.json": pkgJson({ dependencies: { "evil-pkg": "1.0.0" } }), "x\u0001": "x" },
      },
    ]);
    await runScan(t);

    const only = readToolOutput(await client.callTool({ name: "list_findings", arguments: { category: "policy" } }));
    const rest = readToolOutput(
      await client.callTool({ name: "list_findings", arguments: { excludeCategory: "policy" } }),
    );

    const policyItems = findingsPageSchema.parse(only.json).items;
    expect(policyItems.length).toBeGreaterThan(0);
    expect(policyItems.every((item) => item.ecosystem === "policy")).toBe(true);
    expect(findingsPageSchema.parse(rest.json).items.map((item) => item.packageName)).toEqual(["evil-pkg"]);
  });

  it("[SD-72] add_blacklist_entry 에 policy 를 주면 VALIDATION_ERROR 가 그대로 나온다", async () => {
    const out = readToolOutput(
      await client.callTool({
        name: "add_blacklist_entry",
        arguments: { ecosystem: "policy", name: "my-check", reason: "x" },
      }),
    );

    expect(out.isError).toBe(true);
    expect(out.json).toMatchObject({ code: "VALIDATION_ERROR", details: { ecosystem: POLICY_CREATE_MESSAGE } });
  });
});
