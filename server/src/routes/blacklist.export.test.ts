import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CSV_HEADER, exportRequest } from "../test/bulk.ts";
import { cleanupTestApps, createTestApp, expectApiError, type TestApp } from "../test/testApp.ts";
import { addEntry, listEntries } from "../test/v2.ts";

let t: TestApp;

beforeEach(() => {
  t = createTestApp(); // 2026-11-12T00:00:00Z = KST 2026-11-12 09:00
});

afterEach(cleanupTestApps);

interface ExportedJson {
  version: number;
  items: { ecosystem: string; name: string; versionRange: string | null }[];
}

async function exportJson(query: Record<string, string> = {}): Promise<ExportedJson> {
  const res = await exportRequest(t, { format: "json", ...query });
  expect(res.status, res.text).toBe(200);
  return JSON.parse(res.text) as ExportedJson;
}

const keyOf = (item: { ecosystem: string; name: string; versionRange: string | null }) =>
  `${item.ecosystem}:${item.name}:${item.versionRange ?? ""}`;

describe("GET /api/blacklist/export", () => {
  it("[BK-14] CSV: Content-Type 과 Content-Disposition(KST 날짜의 파일 이름), BOM + 머리글 + CRLF", async () => {
    await addEntry(t, { name: "evil-pkg", versionRange: null, reason: "악성 코드" });

    const res = await t.instance.app.request("/api/blacklist/export?format=csv");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="blacklist-20261112.csv"');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)).toBe(
      `\uFEFF${CSV_HEADER}\r\nnpm,evil-pkg,,medium,악성 코드,true,\r\n`,
    );
  });

  it("[BK-14] JSON: Content-Type 과 파일 이름, 본문은 { version: 1, items }", async () => {
    await addEntry(t, { name: "evil-pkg", versionRange: "^1.0.0", reason: "악성 코드", severity: "high", expiresAt: "2027-01-01" });

    const res = await exportRequest(t, { format: "json" });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="blacklist-20261112.json"');
    expect(JSON.parse(res.text)).toEqual({
      version: 1,
      items: [
        {
          ecosystem: "npm",
          name: "evil-pkg",
          versionRange: "^1.0.0",
          severity: "high",
          reason: "악성 코드",
          enabled: true,
          expiresAt: "2027-01-01",
        },
      ],
    });
  });

  it("[BK-14] 파일 이름의 날짜는 KST 다 (UTC 15:00 이후는 다음 날)", async () => {
    t.clock.set("2026-11-12T14:59:00.000Z");
    const before = await exportRequest(t, { format: "csv" });
    t.clock.set("2026-11-12T15:00:00.000Z");
    const after = await exportRequest(t, { format: "csv" });

    expect(before.headers.get("content-disposition")).toContain("blacklist-20261112.csv");
    expect(after.headers.get("content-disposition")).toContain("blacklist-20261113.csv");
  });

  it("[BK-14] 0건이어도 200 이다 — CSV 는 머리글만, JSON 은 items: []", async () => {
    const csv = await exportRequest(t, { format: "csv" });
    const json = await exportRequest(t, { format: "json" });

    expect(csv.status).toBe(200);
    expect(csv.text.replace(/^\uFEFF/, "")).toBe(`${CSV_HEADER}\r\n`);
    expect(json.status).toBe(200);
    expect(JSON.parse(json.text)).toEqual({ version: 1, items: [] });
  });

  it("[BK-14] name → id 순서로 내보낸다", async () => {
    await addEntry(t, { name: "b-pkg", versionRange: null, reason: "b" });
    await addEntry(t, { name: "a-pkg", versionRange: "<2.0.0", reason: "a2" });
    await addEntry(t, { name: "a-pkg", versionRange: "<1.0.0", reason: "a1" });

    const { items } = await exportJson();

    expect(items.map(keyOf)).toEqual(["npm:a-pkg:<2.0.0", "npm:a-pkg:<1.0.0", "npm:b-pkg:"]);
  });

  it("[BK-14] 필터 4개(ecosystem, enabled, q, status)가 목록과 같은 결과를 낸다", async () => {
    await addEntry(t, { name: "alpha", versionRange: null, reason: "r" });
    await addEntry(t, { name: "alpha-off", versionRange: null, reason: "r", enabled: false });
    await addEntry(t, { name: "alpha-exp", versionRange: null, reason: "r", expiresAt: "2026-11-12" });
    await addEntry(t, { name: "beta-exp-off", versionRange: null, reason: "r", enabled: false, expiresAt: "2026-11-12" });
    await addEntry(t, { ecosystem: "pypi", name: "alpha-py", versionRange: null, reason: "r" });
    t.clock.set("2026-11-12T15:00:00.000Z"); // 만료일 다음 날(KST)

    const queries: Record<string, string>[] = [
      {},
      { ecosystem: "pypi" },
      { enabled: "true" },
      { enabled: "false" },
      { q: "ALPHA" },
      { status: "active" },
      { status: "disabled" },
      { status: "expired" },
      { ecosystem: "npm", q: "exp", status: "expired", enabled: "false" },
    ];
    for (const query of queries) {
      const listed = (await listEntries(t, query)).map(keyOf);
      expect((await exportJson(query)).items.map(keyOf), JSON.stringify(query)).toEqual(listed);
      const csv = await exportRequest(t, { format: "csv", ...query });
      const csvRows = csv.text.replace(/^\uFEFF/, "").trim().split("\r\n").slice(1);
      expect(csvRows, JSON.stringify(query)).toHaveLength(listed.length);
    }
    expect((await exportJson({ status: "expired" })).items.map((item) => item.name)).toEqual(["alpha-exp", "beta-exp-off"]);
  });

  it("[BK-14] format 이 없거나 json/csv 가 아니면 400 이다. 잘못된 필터도 400", async () => {
    expectApiError(await exportRequest(t, {}), 400, "VALIDATION_ERROR");
    expectApiError(await exportRequest(t, { format: "xml" }), 400, "VALIDATION_ERROR");
    expectApiError(await exportRequest(t, { format: "csv", status: "weird" }), 400, "VALIDATION_ERROR");
    expectApiError(await exportRequest(t, { format: "csv", ecosystem: "cobol" }), 400, "VALIDATION_ERROR");
    expectApiError(await exportRequest(t, { format: "csv", enabled: "maybe" }), 400, "VALIDATION_ERROR");
  });

  it("[BK-14] /blacklist/export 는 id 로 읽히지 않는다 — DELETE 는 404", async () => {
    expectApiError(await t.request("DELETE", "/api/blacklist/export"), 404, "NOT_FOUND");
  });
});
