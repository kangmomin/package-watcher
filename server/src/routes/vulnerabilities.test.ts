import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  settingsSchema,
  vulnerabilitiesPageSchema,
  vulnerabilityDetailSchema,
  type VulnerabilityDetail,
} from "@pw/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectMcp, readToolOutput } from "../test/mcp.ts";
import { cleanupTestApps, createTestApp, expectApiError, putSettings, type TestApp } from "../test/testApp.ts";

let t: TestApp;
const clients: Client[] = [];

beforeEach(() => {
  t = createTestApp();
});

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => undefined);
  await cleanupTestApps();
});

interface Advisory {
  ghsa: string;
  name: string;
  range?: string;
  score: number | null;
  severity?: "critical" | "high" | "medium" | "low";
  patched?: string | null;
  ecosystem?: string;
}

let seq = 0;

/** 권고 1건(feed 행 + 그 항목 source=cve)을 DB 에 직접 만든다. 항목 id 를 돌려준다 */
function seedAdvisory(advisory: Advisory): number {
  const { db } = t.instance;
  const ecosystem = advisory.ecosystem ?? "npm";
  const range = advisory.range ?? "<2.0.0";
  db.prepare(
    `INSERT INTO feed_entries (external_id, ecosystem, name, version_range, raw_range, severity, summary, url, updated_at, kind, cvss_score, patched_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'cve', ?, ?)`,
  ).run(
    advisory.ghsa,
    ecosystem,
    advisory.name,
    range,
    `< ${range}`,
    advisory.severity ?? "high",
    `요약 ${advisory.ghsa}`,
    `https://github.com/advisories/${advisory.ghsa}`,
    "2026-11-01T00:00:00.000Z",
    advisory.score,
    advisory.patched ?? null,
  );
  const result = db
    .prepare(
      `INSERT INTO blacklist_entries (ecosystem, name, version_range, reason, severity, created_at, updated_at, source, external_id)
       VALUES (?, ?, ?, ?, ?, 't', 't', 'cve', ?)`,
    )
    .run(ecosystem, advisory.name, range, `사유 ${advisory.ghsa}`, advisory.severity ?? "high", advisory.ghsa);
  return Number(result.lastInsertRowid);
}

interface FindingSeed {
  repo: string;
  entryId: number;
  name: string;
  ecosystem?: string;
  ref?: string;
  filePath?: string;
  dependency?: "direct" | "transitive";
  status?: "open" | "ignored" | "resolved";
  severity?: string;
}

function seedFinding(seed: FindingSeed): void {
  seq += 1;
  t.instance.db
    .prepare(
      `INSERT INTO findings (repo, ref, file_path, package_name, version, dependency_type, blacklist_entry_id, status, reason, html_url,
         first_seen_at, last_seen_at, ecosystem, severity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'r', 'https://github.com/x', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', ?, ?)`,
    )
    .run(
      seed.repo,
      seed.ref ?? "",
      seed.filePath ?? "package-lock.json",
      seed.name,
      `1.${seq}.0`,
      seed.dependency ?? "transitive",
      seed.entryId,
      seed.status ?? "open",
      seed.ecosystem ?? "npm",
      seed.severity ?? "high",
    );
}

async function list(query = "") {
  const res = await t.request("GET", `/api/vulnerabilities${query === "" ? "" : `?${query}`}`);
  expect(res.status, res.text).toBe(200);
  return vulnerabilitiesPageSchema.parse(res.json);
}

async function detail(ecosystem: string, name: string): Promise<VulnerabilityDetail> {
  const res = await t.request("GET", `/api/vulnerabilities/detail?ecosystem=${ecosystem}&name=${encodeURIComponent(name)}`);
  expect(res.status, res.text).toBe(200);
  return vulnerabilityDetailSchema.parse(res.json);
}

/** 정렬·집계를 확인하는 데이터: 패키지 5개 */
function seedMixed(): void {
  // alpha: 점수 9.8, repo 2개(한 repo 는 브랜치가 둘), 직접 의존성 있음, 권고 2건
  const a1 = seedAdvisory({ ghsa: "GHSA-aaaa-aaaa-0001", name: "alpha", score: 9.8, severity: "critical", patched: "2.0.0" });
  const a2 = seedAdvisory({ ghsa: "GHSA-aaaa-aaaa-0002", name: "alpha", range: "<1.5.0", score: 7.1, severity: "high", patched: "1.5.0" });
  seedFinding({ repo: "r1", entryId: a1, name: "alpha", dependency: "direct" });
  seedFinding({ repo: "r1", entryId: a1, name: "alpha", ref: "feature-x", filePath: "package-lock.json" });
  seedFinding({ repo: "r2", entryId: a2, name: "alpha" });
  // beta: 점수 9.8, repo 3개 → alpha 보다 앞
  const b1 = seedAdvisory({ ghsa: "GHSA-bbbb-bbbb-0001", name: "beta", score: 9.8, severity: "high" });
  for (const repo of ["r1", "r2", "r3"]) seedFinding({ repo, entryId: b1, name: "beta" });
  // gamma: 점수 5.0
  const g1 = seedAdvisory({ ghsa: "GHSA-gggg-gggg-0001", name: "gamma", score: 5, severity: "medium", patched: "3.1.0" });
  seedFinding({ repo: "r1", entryId: g1, name: "gamma", dependency: "direct" });
  // delta·epsilon: 점수 없음(critical 등급). repo 수가 다르다. 맨 뒤
  const d1 = seedAdvisory({ ghsa: "GHSA-dddd-dddd-0001", name: "delta", score: null, severity: "critical" });
  seedFinding({ repo: "r1", entryId: d1, name: "delta" });
  const e1 = seedAdvisory({ ghsa: "GHSA-eeee-eeee-0001", name: "epsilon", score: null, severity: "critical" });
  seedFinding({ repo: "r1", entryId: e1, name: "epsilon" });
  seedFinding({ repo: "r2", entryId: e1, name: "epsilon" });
  // 묶음에 들어가지 않는 것: resolved·ignored, 다른 출처의 검출
  seedFinding({ repo: "r9", entryId: g1, name: "gamma", status: "resolved" });
  seedFinding({ repo: "r9", entryId: g1, name: "gamma", status: "ignored" });
  const { db } = t.instance;
  const manual = Number(
    db
      .prepare("INSERT INTO blacklist_entries (ecosystem, name, version_range, reason, created_at, updated_at) VALUES ('npm', 'alpha', '', 'r', 't', 't')")
      .run().lastInsertRowid,
  );
  seedFinding({ repo: "r8", entryId: manual, name: "alpha" });
}

describe("GET /api/vulnerabilities", () => {
  it("[SI-70] open 검출을 (종류, 패키지)로 묶는다: 집계 값과 정렬(최고 점수 → repo 수 → 이름, 점수 없음은 뒤)", async () => {
    seedMixed();

    const page = await list();

    expect(page.total).toBe(5);
    expect(page.items.map((item) => item.packageName)).toEqual(["beta", "alpha", "gamma", "epsilon", "delta"]);
    const byName = Object.fromEntries(page.items.map((item) => [item.packageName, item]));
    expect(byName.alpha).toEqual({
      ecosystem: "npm",
      packageName: "alpha",
      maxScore: 9.8,
      severity: "critical",
      advisoryCount: 2,
      repoCount: 2, // r1 의 두 브랜치는 repo 1개, r8 의 수동 항목 검출은 세지 않는다
      findingCount: 3,
      hasDirect: true,
      patchedVersions: ["1.5.0", "2.0.0"],
    });
    expect(byName.beta).toMatchObject({ maxScore: 9.8, severity: "high", repoCount: 3, findingCount: 3, hasDirect: false, patchedVersions: [] });
    expect(byName.gamma).toMatchObject({ maxScore: 5, severity: "medium", repoCount: 1, findingCount: 1, hasDirect: true, patchedVersions: ["3.1.0"] });
    expect(byName.delta).toMatchObject({ maxScore: null, severity: "critical", repoCount: 1 });
    expect(byName.epsilon).toMatchObject({ maxScore: null, repoCount: 2 });
  });

  it("[SI-71] directOnly=true 는 직접 의존성이 있는 묶음만. ecosystem·q 필터", async () => {
    seedMixed();
    seedFinding({
      repo: "r1",
      entryId: seedAdvisory({ ghsa: "GHSA-pppp-pppp-0001", name: "py-lib", ecosystem: "pypi", score: 8.1 }),
      name: "py-lib",
      ecosystem: "pypi",
      dependency: "direct",
    });

    expect((await list("directOnly=true")).items.map((item) => item.packageName)).toEqual(["alpha", "py-lib", "gamma"]);
    expect((await list("directOnly=false")).total).toBe(6);
    expect((await list("ecosystem=pypi")).items.map((item) => item.packageName)).toEqual(["py-lib"]);
    expect((await list("q=ETA")).items.map((item) => item.packageName)).toEqual(["beta"]);
    expect((await list("directOnly=true&q=gam")).items.map((item) => item.packageName)).toEqual(["gamma"]);
  });

  it("[SI-72] 쪽 나눔: total 은 묶음의 수이고 쪽마다 정렬이 이어진다. 범위를 넘으면 빈 목록", async () => {
    seedMixed();

    const first = await list("limit=2&page=1");
    const second = await list("limit=2&page=2");
    const last = await list("limit=2&page=3");
    const beyond = await list("limit=2&page=9");

    expect([first.total, second.total, last.total]).toEqual([5, 5, 5]);
    expect(first.items.map((item) => item.packageName)).toEqual(["beta", "alpha"]);
    expect(second.items.map((item) => item.packageName)).toEqual(["gamma", "epsilon"]);
    expect(last.items.map((item) => item.packageName)).toEqual(["delta"]);
    expect(beyond).toMatchObject({ items: [], total: 5, page: 9, limit: 2 });
    expectApiError(await t.request("GET", "/api/vulnerabilities?limit=1000"), 400, "VALIDATION_ERROR");
    expect((await list()).limit).toBe(50);
  });

  it("[SI-73] patchedVersions 는 중복이 없고 최대 10개다", async () => {
    for (let i = 0; i < 12; i += 1) {
      const entry = seedAdvisory({
        ghsa: `GHSA-many-many-${String(i).padStart(4, "0")}`,
        name: "many",
        range: `<1.${i}.0`,
        score: 8,
        patched: i < 11 ? `1.${i}.1` : "1.0.1", // 마지막은 첫 값과 같다
      });
      seedFinding({ repo: "r1", entryId: entry, name: "many" });
    }

    const [group] = (await list()).items;

    expect(group?.advisoryCount).toBe(12);
    expect(group?.patchedVersions).toHaveLength(10);
    expect(new Set(group?.patchedVersions).size).toBe(10);
  });

  it("[SI-74] 2,800건 / 패키지 300개의 집계는 빠르다", async () => {
    const entries: number[] = [];
    for (let p = 0; p < 300; p += 1) {
      entries.push(seedAdvisory({ ghsa: `GHSA-perf-perf-${String(p).padStart(4, "0")}`, name: `pkg-${p}`, score: 8 + (p % 20) / 10, patched: "9.9.9" }));
    }
    t.instance.db.transaction(() => {
      for (let i = 0; i < 2_800; i += 1) {
        const p = i % 300;
        seedFinding({ repo: `repo-${i % 159}`, entryId: entries[p] ?? 0, name: `pkg-${p}`, filePath: `app-${i}/package-lock.json`, dependency: i % 5 === 0 ? "direct" : "transitive" });
      }
    })();

    const started = performance.now();
    const page = await list("limit=200");
    const second = await list("limit=200&page=2&directOnly=true");
    const elapsed = performance.now() - started;

    expect(page.total).toBe(300);
    expect(page.items[0]?.maxScore).toBe(9.9);
    expect(second.total).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1_500);
  });
});

describe("GET /api/vulnerabilities/detail", () => {
  it("[SI-75] 권고(점수 내림차순)와 open 검출(repo, ref, 파일 순)과 findingsTotal", async () => {
    seedMixed();

    const result = await detail("npm", "alpha");

    expect(result).toMatchObject({ ecosystem: "npm", packageName: "alpha", findingsTotal: 3 });
    expect(result.advisories.map((advisory) => [advisory.externalId, advisory.cvssScore, advisory.findingCount])).toEqual([
      ["GHSA-aaaa-aaaa-0001", 9.8, 2],
      ["GHSA-aaaa-aaaa-0002", 7.1, 1],
    ]);
    expect(result.advisories[0]).toMatchObject({
      severity: "critical",
      summary: "요약 GHSA-aaaa-aaaa-0001",
      url: "https://github.com/advisories/GHSA-aaaa-aaaa-0001",
      versionRange: "<2.0.0",
      patchedVersion: "2.0.0",
    });
    expect(result.findings.map((finding) => [finding.repo, finding.ref, finding.status, finding.source])).toEqual([
      ["r1", "", "open", "cve"],
      ["r1", "feature-x", "open", "cve"],
      ["r2", "", "open", "cve"],
    ]);
  });

  it("[SI-76] 검출은 최대 500건이고 findingsTotal 이 전체 수를 알린다", async () => {
    const entry = seedAdvisory({ ghsa: "GHSA-bigg-bigg-0001", name: "big", score: 9 });
    t.instance.db.transaction(() => {
      for (let i = 0; i < 520; i += 1) seedFinding({ repo: `repo-${String(i).padStart(3, "0")}`, entryId: entry, name: "big" });
    })();

    const result = await detail("npm", "big");

    expect(result.findings).toHaveLength(500);
    expect(result.findingsTotal).toBe(520);
    expect(result.findings[0]?.repo).toBe("repo-000");
  });

  it("[SI-77] open 검출이 없으면 404 NOT_FOUND. 필수 query 가 없으면 400. 이름에 / 가 있어도 찾는다", async () => {
    seedMixed();
    const scoped = seedAdvisory({ ghsa: "GHSA-scop-scop-0001", name: "@scope/pkg", score: 8.8 });
    seedFinding({ repo: "r1", entryId: scoped, name: "@scope/pkg" });
    const resolved = seedAdvisory({ ghsa: "GHSA-done-done-0001", name: "done", score: 9 });
    seedFinding({ repo: "r1", entryId: resolved, name: "done", status: "resolved" });

    expect((await detail("npm", "@scope/pkg")).findingsTotal).toBe(1);
    expectApiError(await t.request("GET", "/api/vulnerabilities/detail?ecosystem=npm&name=done"), 404, "NOT_FOUND");
    expectApiError(await t.request("GET", "/api/vulnerabilities/detail?ecosystem=npm&name=nothing"), 404, "NOT_FOUND");
    expectApiError(await t.request("GET", "/api/vulnerabilities/detail?ecosystem=pypi&name=alpha"), 404, "NOT_FOUND");
    expectApiError(await t.request("GET", "/api/vulnerabilities/detail?ecosystem=npm"), 400, "VALIDATION_ERROR");
    expectApiError(await t.request("GET", "/api/vulnerabilities/detail?name=alpha"), 400, "VALIDATION_ERROR");
  });

  it("[SI-78] 수동 항목의 검출만 있는 패키지는 취약점이 아니라서 404 다", async () => {
    seedMixed();
    t.instance.db
      .prepare("INSERT INTO blacklist_entries (ecosystem, name, version_range, reason, created_at, updated_at) VALUES ('npm', 'solo', '', 'r', 't', 't')")
      .run();
    const manual = Number(t.instance.db.prepare<[], { id: number }>("SELECT id FROM blacklist_entries WHERE name = 'solo'").get()?.id);
    seedFinding({ repo: "r1", entryId: manual, name: "solo" });

    expectApiError(await t.request("GET", "/api/vulnerabilities/detail?ecosystem=npm&name=solo"), 404, "NOT_FOUND");
  });
});

describe("설정의 cveMinScore", () => {
  it("[SI-80] 기본 8, 저장·조회, 입력에서 생략하면 유지, 0(끔)과 4~10 의 소수 1자리만 허용", async () => {
    const get = async () => settingsSchema.parse((await t.request("GET", "/api/settings")).json);
    expect((await get()).cveMinScore).toBe(8);

    expect((await putSettings(t, { cveMinScore: 9.5 })).cveMinScore).toBe(9.5);
    expect((await get()).cveMinScore).toBe(9.5);
    expect((await putSettings(t)).cveMinScore).toBe(9.5); // 생략 = 유지
    expect((await putSettings(t, { cveMinScore: 0 })).cveMinScore).toBe(0);
    expect((await get()).cveMinScore).toBe(0);

    for (const bad of [3, 3.9, 10.5, 8.55, -1]) {
      const res = await t.request("PUT", "/api/settings", { org: "my-org", scanIntervalHours: 24, digestTime: "09:00", recipients: [], cveMinScore: bad });
      expectApiError(res, 400, "VALIDATION_ERROR");
    }
    expect((await get()).cveMinScore).toBe(0);
  });
});

describe("/mcp — list_vulnerabilities", () => {
  it("[SI-90] tool 은 16개이고 list_vulnerabilities 는 GET /api/vulnerabilities 와 같은 결과를 돌려준다 (읽기 전용 설명, list_findings 안내)", async () => {
    seedMixed();
    const client = await connectMcp(t);
    clients.push(client);

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(16);
    const tool = tools.find((item) => item.name === "list_vulnerabilities");
    expect(tool?.description).toContain("source: cve");
    expect(tool?.description).toContain("list_findings");
    const properties = (tool?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(properties).sort()).toEqual(["directOnly", "ecosystem", "limit", "page", "q"]);

    const output = readToolOutput(await client.callTool({ name: "list_vulnerabilities", arguments: { directOnly: true, limit: 2 } }));
    expect(output.isError).toBe(false);
    const rest = await t.request("GET", "/api/vulnerabilities?directOnly=true&limit=2");
    expect(vulnerabilitiesPageSchema.parse(output.json)).toEqual(vulnerabilitiesPageSchema.parse(rest.json));

    const bad = readToolOutput(await client.callTool({ name: "list_vulnerabilities", arguments: { limit: 1000 } }));
    expect(bad.isError).toBe(true);
    expect(bad.json).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("[SI-91] list_findings 는 source·excludeSource 를, list_blacklist 는 source 의 cve 와 excludeSource 를 선언한다", async () => {
    const client = await connectMcp(t);
    clients.push(client);

    const { tools } = await client.listTools();
    const props = (name: string) =>
      (tools.find((tool) => tool.name === name)?.inputSchema as { properties?: Record<string, { enum?: string[] }> }).properties ?? {};

    expect(props("list_findings").source?.enum).toEqual(["manual", "feed", "cve"]);
    expect(props("list_findings").excludeSource?.enum).toEqual(["manual", "feed", "cve"]);
    expect(props("list_blacklist").excludeSource?.enum).toEqual(["manual", "feed", "cve"]);
    expect(props("list_blacklist").source?.enum).toEqual(["manual", "feed", "cve"]);
    // 사용자가 source 를 정하는 tool 은 없다
    for (const name of ["add_blacklist_entry", "update_blacklist_entry", "import_blacklist"]) {
      expect(Object.keys(props(name)), name).not.toContain("source");
    }
  });
});
