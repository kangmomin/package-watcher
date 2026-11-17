import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  apiErrorSchema,
  blacklistEntrySchema,
  blacklistListSchema,
  findingsPageSchema,
} from "@pw/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectMcp, readToolOutput } from "../test/mcp.ts";
import { pkgJson } from "../test/repoFixtures.ts";
import {
  cleanupTestApps,
  createTestApp,
  EVIL,
  putSettings,
  runScan,
  type TestApp,
} from "../test/testApp.ts";
import { addEntry, getEntry, listEntries } from "../test/v2.ts";

const TOOL_NAMES = [
  "list_findings",
  "set_finding_status",
  "list_blacklist",
  "add_blacklist_entry",
  "update_blacklist_entry",
  "remove_blacklist_entry",
  "trigger_scan",
  "list_scans",
  "get_scan",
  "get_settings",
];

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

describe("/mcp — 묶음 1/3 의 새 필드와 필터", () => {
  it("[CT-23] tools/list 는 기존 10개를 그대로 포함하고(+ 일괄 관리 3개), tool 4개의 입력에 새 필드·필터가 선언되어 있다", async () => {
    const client = await connect();

    const { tools } = await client.listTools();

    const bulkTools = [
      "bulk_update_blacklist",
      "import_blacklist",
      "export_blacklist",
      "get_feed_status",
      "search_feed",
      "list_vulnerabilities",
    ];
    expect(tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES, ...bulkTools].sort());
    const propertiesOf = (name: string): string[] =>
      Object.keys(tools.find((tool) => tool.name === name)?.inputSchema.properties ?? {});
    // 선언하지 않은 키는 SDK 가 제거하므로 서비스까지 전달되지 않는다.
    expect(propertiesOf("add_blacklist_entry")).toEqual(
      expect.arrayContaining(["name", "versionRange", "reason", "ecosystem", "severity", "enabled", "expiresAt"]),
    );
    expect(propertiesOf("update_blacklist_entry")).toEqual(
      expect.arrayContaining(["id", "name", "versionRange", "reason", "ecosystem", "severity", "enabled", "expiresAt"]),
    );
    expect(propertiesOf("list_blacklist")).toEqual(expect.arrayContaining(["ecosystem", "enabled", "q"]));
    expect(propertiesOf("list_findings")).toEqual(expect.arrayContaining(["ecosystem", "severity"]));
  });

  it("[CT-23] add_blacklist_entry 와 update_blacklist_entry 는 새 필드 4개를 받아 저장한다", async () => {
    const client = await connect();

    const added = await call(client, "add_blacklist_entry", {
      name: "@evil/*",
      reason: "악성 스코프",
      ecosystem: "npm",
      severity: "critical",
      enabled: false,
      expiresAt: "2026-12-31",
    });
    expect(added.isError, added.text).toBe(false);
    const entry = blacklistEntrySchema.parse(added.json);
    expect(entry).toMatchObject({
      name: "@evil/*",
      ecosystem: "npm",
      severity: "critical",
      enabled: false,
      expiresAt: "2026-12-31",
    });
    expect(await getEntry(t, entry.id)).toEqual(entry);

    const updated = await call(client, "update_blacklist_entry", {
      id: entry.id,
      name: "@evil/*",
      versionRange: null,
      reason: "악성 스코프",
      severity: "low",
      enabled: true,
      expiresAt: null,
    });
    expect(updated.isError, updated.text).toBe(false);
    expect(blacklistEntrySchema.parse(updated.json)).toMatchObject({
      severity: "low",
      enabled: true,
      expiresAt: null,
    });
    expect(await getEntry(t, entry.id)).toMatchObject({ severity: "low", enabled: true, expiresAt: null });

    // 새 필드의 검증 오류도 다른 오류와 같은 JSON 모양이다.
    const invalid = await call(client, "add_blacklist_entry", {
      name: "other-pkg",
      reason: "x",
      severity: "urgent",
      ecosystem: "cobol",
    });
    expect(invalid.isError).toBe(true);
    const error = toolErrorSchema.parse(invalid.json);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(Object.keys(error.details ?? {})).toEqual(expect.arrayContaining(["severity", "ecosystem"]));
  });

  it("[CT-23] v1 형식의 update_blacklist_entry 호출(새 필드 없음)은 enabled: false, severity: high 인 항목의 두 값을 바꾸지 않는다", async () => {
    const entry = await addEntry(t, { ...EVIL, enabled: false, severity: "high", expiresAt: "2026-12-31" });
    const client = await connect();

    const updated = await call(client, "update_blacklist_entry", {
      id: entry.id,
      name: "evil-pkg",
      versionRange: null,
      reason: "MCP 로 고친 사유",
    });

    expect(updated.isError, updated.text).toBe(false);
    expect(blacklistEntrySchema.parse(updated.json)).toMatchObject({
      reason: "MCP 로 고친 사유",
      enabled: false,
      severity: "high",
      expiresAt: "2026-12-31",
    });
    expect(await getEntry(t, entry.id)).toMatchObject({
      reason: "MCP 로 고친 사유",
      enabled: false,
      severity: "high",
      expiresAt: "2026-12-31",
    });
  });

  it("[CT-23] list_blacklist 는 BlacklistQuery 를 받는다 (enabled 는 JSON boolean)", async () => {
    await addEntry(t, { name: "alpha-lib", reason: "a" });
    await addEntry(t, { name: "beta-lib", reason: "b", enabled: false });
    await addEntry(t, { name: "gamma", reason: "c" });
    const client = await connect();
    const namesOf = async (args: Record<string, unknown>): Promise<string[]> => {
      const output = await call(client, "list_blacklist", args);
      expect(output.isError, output.text).toBe(false);
      return blacklistListSchema.parse(output.json).items.map((item) => item.name);
    };

    expect(await namesOf({})).toEqual(["alpha-lib", "beta-lib", "gamma"]);
    expect(await namesOf({ enabled: false })).toEqual(["beta-lib"]);
    expect(await namesOf({ enabled: true })).toEqual(["alpha-lib", "gamma"]);
    expect(await namesOf({ q: "LIB" })).toEqual(["alpha-lib", "beta-lib"]);
    expect(await namesOf({ q: "lib", enabled: true })).toEqual(["alpha-lib"]);
    expect(await namesOf({ ecosystem: "npm" })).toEqual(["alpha-lib", "beta-lib", "gamma"]);
    expect(await namesOf({ ecosystem: "go" })).toEqual([]);

    const invalid = await call(client, "list_blacklist", { ecosystem: "cobol" });
    expect(invalid.isError).toBe(true);
    expect(toolErrorSchema.parse(invalid.json).code).toBe("VALIDATION_ERROR");
    expect(await listEntries(t)).toHaveLength(3);
  });

  it("[CT-23] list_findings 는 ecosystem·severity 필터를 받는다", async () => {
    await putSettings(t);
    await addEntry(t, { name: "low-pkg", reason: "낮음", severity: "low" });
    await addEntry(t, { name: "high-pkg", reason: "높음", severity: "high" });
    t.github.setRepos([
      {
        name: "api",
        files: { "package.json": pkgJson({ dependencies: { "low-pkg": "^1.0.0", "high-pkg": "^1.0.0" } }) },
      },
    ]);
    await runScan(t);
    const client = await connect();
    const packagesOf = async (args: Record<string, unknown>): Promise<string[]> => {
      const output = await call(client, "list_findings", args);
      expect(output.isError, output.text).toBe(false);
      return findingsPageSchema.parse(output.json).items.map((item) => item.packageName);
    };

    expect(await packagesOf({})).toEqual(["high-pkg", "low-pkg"]);
    expect(await packagesOf({ severity: "high" })).toEqual(["high-pkg"]);
    expect(await packagesOf({ severity: "low", ecosystem: "npm" })).toEqual(["low-pkg"]);
    expect(await packagesOf({ ecosystem: "go" })).toEqual([]);

    const invalid = await call(client, "list_findings", { severity: "urgent" });
    expect(invalid.isError).toBe(true);
    expect(toolErrorSchema.parse(invalid.json).details).toHaveProperty("severity");
  });
});
