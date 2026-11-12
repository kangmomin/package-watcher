import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { apiErrorSchema, bulkResultSchema, importResultSchema } from "@pw/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CSV_HEADER, exportRequest } from "../test/bulk.ts";
import { connectMcp, readToolOutput } from "../test/mcp.ts";
import { cleanupTestApps, createTestApp, type TestApp } from "../test/testApp.ts";
import { addEntry, getEntry, listEntries } from "../test/v2.ts";

const OLD_TOOLS = [
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
const NEW_TOOLS = ["bulk_update_blacklist", "import_blacklist", "export_blacklist"];

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

const ITEMS = [
  { name: "evil-pkg", reason: "악성 코드" },
  { ecosystem: "pypi", name: "Foo_Bar", versionRange: ">=1.0", severity: "high", reason: "pypi 항목" },
];

describe("/mcp — 일괄 관리 tool", () => {
  it("[v2-AC-19][BK-15] tools/list 는 13개이고 기존 10개의 이름을 그대로 포함한다. 새 tool 의 입력이 선언되어 있다", async () => {
    const client = await connect();

    const { tools } = await client.listTools();

    const names = tools.map((tool) => tool.name);
    expect(names).toHaveLength(13);
    expect(names).toEqual(expect.arrayContaining([...OLD_TOOLS, ...NEW_TOOLS]));
    const propertiesOf = (name: string): string[] =>
      Object.keys(tools.find((tool) => tool.name === name)?.inputSchema.properties ?? {});
    expect(propertiesOf("bulk_update_blacklist")).toEqual(expect.arrayContaining(["action", "ids"]));
    expect(propertiesOf("import_blacklist")).toEqual(
      expect.arrayContaining(["items", "format", "content", "dryRun"]),
    );
    expect(propertiesOf("export_blacklist")).toEqual(
      expect.arrayContaining(["format", "ecosystem", "enabled", "q", "status"]),
    );
    expect(propertiesOf("list_blacklist")).toEqual(expect.arrayContaining(["status"]));
  });

  it("[v2-AC-19] import_blacklist(items 2건, dryRun: false) → REST 목록에 2건이 나타난다", async () => {
    const client = await connect();

    const out = await call(client, "import_blacklist", { items: ITEMS, dryRun: false });

    expect(out.isError, out.text).toBe(false);
    expect(importResultSchema.parse(out.json)).toEqual({
      applied: true,
      created: 2,
      updated: 0,
      unchanged: 0,
      errors: [],
    });
    const list = await listEntries(t);
    expect(list.map((entry) => [entry.ecosystem, entry.name])).toEqual([
      ["npm", "evil-pkg"],
      ["pypi", "foo-bar"],
    ]);
  });

  it("[BK-15] dryRun 을 생략하면 미리 보기다 (저장하지 않는다)", async () => {
    const client = await connect();

    const out = await call(client, "import_blacklist", { items: ITEMS });

    expect(out.isError, out.text).toBe(false);
    expect(importResultSchema.parse(out.json)).toMatchObject({ applied: false, created: 2 });
    expect(await listEntries(t)).toEqual([]);
  });

  it("[BK-15] format + content 로도 가져온다 (CSV)", async () => {
    const client = await connect();

    const out = await call(client, "import_blacklist", {
      format: "csv",
      content: "name,reason\r\nlodash,취약점\r\n",
      dryRun: false,
    });

    expect(importResultSchema.parse(out.json)).toMatchObject({ applied: true, created: 1 });
    expect(await listEntries(t)).toEqual([expect.objectContaining({ name: "lodash", reason: "취약점" })]);
  });

  it("[BK-15] 행 오류는 isError 가 아니라 결과의 errors 로 돌려준다. 오류가 있으면 저장하지 않는다", async () => {
    const client = await connect();

    const out = await call(client, "import_blacklist", {
      items: [{ name: "ok", reason: "r" }, { name: "bad", reason: "r", severity: "urgent" }, 5],
      dryRun: false,
    });

    expect(out.isError, out.text).toBe(false);
    const result = importResultSchema.parse(out.json);
    expect(result).toMatchObject({ applied: false, created: 1 });
    expect(result.errors.map((error) => [error.row, error.field])).toEqual([
      [2, "severity"],
      [3, null],
    ]);
    expect(await listEntries(t)).toEqual([]);
  });

  it("[BK-15] items 와 format+content 를 함께 주거나 둘 다 없으면 VALIDATION_ERROR 다 (isError)", async () => {
    const client = await connect();

    for (const args of [
      { items: ITEMS, format: "csv", content: "name,reason\r\na,b\r\n" },
      { items: ITEMS, format: "json" },
      { items: ITEMS, content: "x" },
      {},
      { dryRun: false },
      { format: "csv" },
      { content: "name,reason\r\na,b\r\n" },
      { items: "not-array" },
      { items: { name: "a" } },
    ]) {
      const out = await call(client, "import_blacklist", args);
      expect(out.isError, JSON.stringify(args)).toBe(true);
      expect(toolErrorSchema.parse(out.json).code).toBe("VALIDATION_ERROR");
    }
    expect(await listEntries(t)).toEqual([]);
  });

  it("[BK-15] 파일 수준의 오류(머리글 누락)도 isError 다", async () => {
    const client = await connect();

    const out = await call(client, "import_blacklist", { format: "csv", content: "name\r\na\r\n", dryRun: false });

    expect(out.isError).toBe(true);
    expect(toolErrorSchema.parse(out.json).code).toBe("VALIDATION_ERROR");
  });

  it("[BK-15] bulk_update_blacklist: disable → enable → delete 의 결과는 REST 와 같다", async () => {
    const a = await addEntry(t, { name: "a-pkg", versionRange: null, reason: "a" });
    const b = await addEntry(t, { name: "b-pkg", versionRange: null, reason: "b" });
    const client = await connect();

    const disabled = await call(client, "bulk_update_blacklist", { action: "disable", ids: [a.id, b.id] });
    expect(bulkResultSchema.parse(disabled.json)).toEqual({ action: "disable", count: 2 });
    expect(await getEntry(t, a.id)).toMatchObject({ enabled: false });

    const enabled = await call(client, "bulk_update_blacklist", { action: "enable", ids: [a.id] });
    expect(bulkResultSchema.parse(enabled.json)).toEqual({ action: "enable", count: 1 });
    expect(await getEntry(t, a.id)).toMatchObject({ enabled: true });

    const deleted = await call(client, "bulk_update_blacklist", { action: "delete", ids: [a.id, b.id] });
    expect(bulkResultSchema.parse(deleted.json)).toEqual({ action: "delete", count: 2 });
    expect(await listEntries(t)).toEqual([]);
  });

  it("[BK-15] bulk_update_blacklist: 없는 id → NOT_FOUND, 잘못된 입력 → VALIDATION_ERROR (isError)", async () => {
    const a = await addEntry(t, { name: "a-pkg", versionRange: null, reason: "a" });
    const client = await connect();

    const missing = await call(client, "bulk_update_blacklist", { action: "delete", ids: [a.id, 9999] });
    expect(missing.isError).toBe(true);
    expect(toolErrorSchema.parse(missing.json).code).toBe("NOT_FOUND");
    expect(await listEntries(t)).toHaveLength(1);

    for (const args of [{ action: "delete", ids: [] }, { action: "remove", ids: [1] }, { ids: [1] }, { action: "delete" }]) {
      const out = await call(client, "bulk_update_blacklist", args);
      expect(out.isError, JSON.stringify(args)).toBe(true);
      expect(toolErrorSchema.parse(out.json).code).toBe("VALIDATION_ERROR");
    }
  });

  it("[BK-15] export_blacklist: 파일 내용 문자열을 결과로 돌려준다 (CSV, JSON, 필터)", async () => {
    await addEntry(t, { name: "evil-pkg", versionRange: null, reason: "악성, \"코드\"" });
    await addEntry(t, { ecosystem: "pypi", name: "foo", versionRange: null, reason: "pypi", enabled: false });
    const client = await connect();

    const csv = await call(client, "export_blacklist", { format: "csv" });
    const json = await call(client, "export_blacklist", { format: "json", ecosystem: "pypi", enabled: false });

    expect(csv.isError, csv.text).toBe(false);
    const restCsv = await exportRequest(t, { format: "csv" });
    expect(csv.text.replace(/^\uFEFF/, "")).toBe(restCsv.text.replace(/^\uFEFF/, ""));
    expect(csv.text.replace(/^\uFEFF/, "").startsWith(`${CSV_HEADER}\r\n`)).toBe(true);
    expect(json.isError, json.text).toBe(false);
    expect(json.json).toEqual({
      version: 1,
      items: [
        expect.objectContaining({ ecosystem: "pypi", name: "foo", enabled: false }),
      ],
    });
  });

  it("[BK-15] export_blacklist: format 이 없거나 잘못되면 VALIDATION_ERROR 다. list_blacklist 는 status 로 거른다", async () => {
    await addEntry(t, { name: "on", versionRange: null, reason: "r" });
    await addEntry(t, { name: "off", versionRange: null, reason: "r", enabled: false });
    const client = await connect();

    for (const args of [{}, { format: "xml" }, { format: "csv", status: "weird" }]) {
      const out = await call(client, "export_blacklist", args);
      expect(out.isError, JSON.stringify(args)).toBe(true);
      expect(toolErrorSchema.parse(out.json).code).toBe("VALIDATION_ERROR");
    }
    const listed = await call(client, "list_blacklist", { status: "disabled" });
    expect((listed.json as { items: { name: string }[] }).items.map((item) => item.name)).toEqual(["off"]);
  });
});
