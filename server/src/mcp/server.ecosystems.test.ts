import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { apiErrorSchema, blacklistEntrySchema, ECOSYSTEM_RULES, SUPPORTED_ECOSYSTEMS } from "@pw/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectMcp, readToolOutput } from "../test/mcp.ts";
import { cleanupTestApps, createTestApp, type TestApp } from "../test/testApp.ts";
import { listEntries } from "../test/v2.ts";

const toolErrorSchema = apiErrorSchema.shape.error;

let t: TestApp;
const clients: Client[] = [];

async function connect(): Promise<Client> {
  const client = await connectMcp(t);
  clients.push(client);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  return readToolOutput(await client.callTool({ name, arguments: args }));
}

beforeEach(() => {
  t = createTestApp();
});

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => undefined);
  await cleanupTestApps();
});

describe("/mcp — 여러 종류", () => {
  it("[ME-15] add_blacklist_entry 의 입력 설명이 모든 종류와 종류별 범위 예시를 안내한다", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((item) => item.name === "add_blacklist_entry");
    const properties = (tool?.inputSchema.properties ?? {}) as Record<string, { enum?: string[]; description?: string }>;

    expect(tool, "add_blacklist_entry 가 없습니다").toBeDefined();
    expect(properties.ecosystem?.enum).toEqual([...SUPPORTED_ECOSYSTEMS]);
    const rangeText = properties.versionRange?.description ?? "";
    for (const ecosystem of SUPPORTED_ECOSYSTEMS) {
      expect(rangeText, ecosystem).toContain(ECOSYSTEM_RULES[ecosystem].rangeExample);
    }
    expect(properties.name?.description ?? "").not.toBe("npm 패키지 이름(스코프 포함, 대소문자 구분)");
    for (const word of ["go", "pypi", "nuget", "cargo", "pub", "maven"]) {
      expect(`${properties.name?.description} ${properties.ecosystem?.description}`).toContain(word);
    }
  });

  it("[SB-60] tool 은 13개 그대로이고 ecosystem enum 에 actions·docker 와 범위의 문법 설명이 있다", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const properties = (tools.find((item) => item.name === "add_blacklist_entry")?.inputSchema.properties ??
      {}) as Record<string, { enum?: string[]; description?: string }>;

    expect(tools).toHaveLength(13);
    expect(properties.ecosystem?.enum).toEqual(expect.arrayContaining(["actions", "docker"]));
    expect(properties.versionRange?.description).toContain("sha256");
    expect(properties.versionRange?.description).toContain("쉼표");
    expect(properties.name?.description).toContain("owner/repo");
  });

  it("[SB-61] add_blacklist_entry 로 actions·docker 를 등록하고 이름을 정규화하며 잘못된 범위는 거부한다", async () => {
    const client = await connect();

    const action = await call(client, "add_blacklist_entry", {
      ecosystem: "actions",
      name: "Aquasecurity/Trivy-Action",
      versionRange: "v0.34.0, v0.34.1",
      reason: "변조",
    });
    const image = await call(client, "add_blacklist_entry", {
      ecosystem: "docker",
      name: "docker.io/library/Node",
      versionRange: "20",
      reason: "x",
    });
    const bad = await call(client, "add_blacklist_entry", {
      ecosystem: "docker",
      name: "node:20",
      reason: "x",
    });

    expect(blacklistEntrySchema.parse(action.json)).toMatchObject({ name: "aquasecurity/trivy-action" });
    expect(blacklistEntrySchema.parse(image.json)).toMatchObject({ ecosystem: "docker", name: "node" });
    expect(bad.isError).toBe(true);
    expect(toolErrorSchema.parse(bad.json).details).toHaveProperty("name");
  });

  it("[ME-15] add_blacklist_entry 로 go 항목을 등록하고, 이름·범위는 종류의 규칙으로 검증한다", async () => {
    const client = await connect();

    const added = await call(client, "add_blacklist_entry", {
      ecosystem: "go",
      name: "github.com/evil/mod",
      versionRange: "<v1.0.0",
      reason: "악성",
    });
    expect(added.isError, added.text).toBe(false);
    expect(blacklistEntrySchema.parse(added.json)).toMatchObject({ ecosystem: "go", name: "github.com/evil/mod" });

    const invalid = await call(client, "add_blacklist_entry", {
      ecosystem: "go",
      name: "github.com/evil/other",
      versionRange: "<1.0.0",
      reason: "x",
    });
    expect(invalid.isError).toBe(true);
    expect(toolErrorSchema.parse(invalid.json).details).toHaveProperty("versionRange");
    expect(await listEntries(t)).toHaveLength(1);
  });

  it("[ME-15] update_blacklist_entry 로 종류를 바꾸려 하면 details.ecosystem 으로 거부한다", async () => {
    const client = await connect();
    const added = await call(client, "add_blacklist_entry", { ecosystem: "pypi", name: "Evil_Pkg", reason: "x" });
    const entry = blacklistEntrySchema.parse(added.json);
    expect(entry.name).toBe("evil-pkg");

    const changed = await call(client, "update_blacklist_entry", {
      id: entry.id,
      name: "evil-pkg",
      versionRange: null,
      reason: "x",
      ecosystem: "npm",
    });
    expect(changed.isError).toBe(true);
    expect(toolErrorSchema.parse(changed.json).details).toHaveProperty("ecosystem");
  });
});
