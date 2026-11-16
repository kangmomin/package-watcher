import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  apiErrorSchema,
  blacklistEntrySchema,
  blacklistListSchema,
  scanSchema,
} from "@pw/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectMcp, readToolOutput } from "../test/mcp.ts";
import { pkgJson } from "../test/repoFixtures.ts";
import {
  cleanupTestApps,
  createTestApp,
  listScans,
  putSettings,
  waitForScans,
  type TestApp,
} from "../test/testApp.ts";

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

/** 오류 결과: isError + `{code, message, details?}` JSON (ApiError 의 error 부분과 같은 모양) */
const toolErrorSchema = apiErrorSchema.shape.error;

let t: TestApp;
const clients: Client[] = [];

async function connect(): Promise<Client> {
  const client = await connectMcp(t);
  clients.push(client);
  return client;
}

beforeEach(() => {
  t = createTestApp();
});

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => undefined);
  await cleanupTestApps();
});

describe("/mcp (Streamable HTTP, stateless)", () => {
  it("[AC-13][CT-11] tools/list 는 계약의 tool 15개(기존 10개 + 일괄 관리 3개 + 외부 목록 2개) 이름을 정확히 반환한다", async () => {
    const client = await connect();

    const { tools } = await client.listTools();

    const bulkTools = [
      "bulk_update_blacklist",
      "import_blacklist",
      "export_blacklist",
      "get_feed_status",
      "search_feed",
    ];
    expect(tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES, ...bulkTools].sort());
  });

  it("[AC-14][CT-11] add_blacklist_entry 후 항목이 GET /api/blacklist 에 나타나고 trigger_scan 은 manual 스캔을 시작한다", async () => {
    await putSettings(t);
    t.github.setRepos([{ name: "api", files: { "package.json": pkgJson() } }]);
    const client = await connect();

    const added = readToolOutput(
      await client.callTool({
        name: "add_blacklist_entry",
        arguments: { name: "evil-pkg", reason: "악성 코드" },
      }),
    );
    expect(added.isError).toBe(false);
    const entry = blacklistEntrySchema.parse(added.json);
    expect(entry).toMatchObject({ name: "evil-pkg", versionRange: null, reason: "악성 코드" });
    const list = await t.request("GET", "/api/blacklist");
    expect(blacklistListSchema.parse(list.json).items.map((item) => item.id)).toEqual([entry.id]);

    const triggered = readToolOutput(await client.callTool({ name: "trigger_scan", arguments: {} }));
    expect(triggered.isError).toBe(false);
    const scan = scanSchema.parse(triggered.json);
    expect(scan).toMatchObject({ trigger: "manual", status: "running" });
    await waitForScans(t);
    const scans = await listScans(t);
    expect(scans.items.map((item) => [item.id, item.trigger])).toEqual([[scan.id, "manual"]]);
  });

  it("[CT-11] 검증 실패와 서비스 오류는 isError: true + {code, message, details?} JSON 이다", async () => {
    const client = await connect();

    const invalid = readToolOutput(
      await client.callTool({
        name: "add_blacklist_entry",
        arguments: { name: "has space", versionRange: "not-a-range!!", reason: "x" },
      }),
    );
    expect(invalid.isError).toBe(true);
    const validation = toolErrorSchema.parse(invalid.json);
    expect(validation.code).toBe("VALIDATION_ERROR");
    expect(Object.keys(validation.details ?? {})).toEqual(
      expect.arrayContaining(["name", "versionRange"]),
    );

    const notSet = readToolOutput(await client.callTool({ name: "trigger_scan", arguments: {} }));
    expect(notSet.isError).toBe(true);
    expect(toolErrorSchema.parse(notSet.json).code).toBe("ORG_NOT_SET");
    expect((await listScans(t)).total).toBe(0);
  });

  it("[CT-11] 동시 2요청과 연속 3요청이 모두 성공한다", async () => {
    const [first, second] = await Promise.all([connect(), connect()]);
    const concurrent = await Promise.all([
      first.callTool({ name: "list_blacklist", arguments: {} }),
      second.callTool({ name: "get_settings", arguments: {} }),
    ]);
    for (const result of concurrent) expect(readToolOutput(result).isError).toBe(false);

    for (let index = 0; index < 3; index += 1) {
      const output = readToolOutput(await first.callTool({ name: "list_blacklist", arguments: {} }));
      expect(output.isError).toBe(false);
      expect(blacklistListSchema.parse(output.json).items).toEqual([]);
    }
  });

  it("[CT-11] GET /mcp 는 405", async () => {
    const res = await t.request("GET", "/mcp");

    expect(res.status).toBe(405);
  });
});
