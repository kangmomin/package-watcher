import {
  findingSchema,
  findingsPageSchema,
  isoDateSchema,
  scanSchema,
  type Finding,
} from "@pw/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HOUR } from "../test/clock.ts";
import { pkgJson } from "../test/repoFixtures.ts";
import {
  addBlacklist,
  allFindings,
  cleanupTestApps,
  createTestApp,
  EVIL,
  expectApiError,
  findOne,
  getSummary,
  listFindings,
  LODASH,
  patchFinding,
  putSettings,
  runScan,
  waitForScans,
  type TestApp,
} from "../test/testApp.ts";

let t: TestApp;

beforeEach(async () => {
  t = createTestApp();
  await putSettings(t);
});

afterEach(cleanupTestApps);

interface Seeded {
  apiEvil: Finding;
  apiLodash: Finding;
  legacyEvil: Finding;
  webLodash: Finding;
}

/**
 * open 2건(api/evil-pkg, web-app/lodash), ignored 1건(api/lodash), resolved 1건(legacy-api/evil-pkg).
 * web-app/lodash 만 1시간 늦게 처음 보였다(정렬 확인용).
 */
async function seed(): Promise<Seeded> {
  await addBlacklist(t, EVIL);
  await addBlacklist(t, LODASH);
  t.github.setRepos([
    {
      name: "api",
      files: { "package.json": pkgJson({ dependencies: { "evil-pkg": "^1.0.0", lodash: "^4.17.0" } }) },
    },
    { name: "legacy-api", files: { "package.json": pkgJson({ dependencies: { "evil-pkg": "^2.0.0" } }) } },
  ]);
  await runScan(t);
  t.clock.advance(HOUR);
  t.github.upsertRepo({
    name: "web-app",
    files: { "package.json": pkgJson({ dependencies: { lodash: "^4.0.0" } }) },
  });
  await runScan(t);
  t.clock.advance(HOUR);
  t.github.setFiles("legacy-api", { "package.json": pkgJson({ dependencies: { "safe-lib": "^1.0.0" } }) });
  await runScan(t);

  let items = await allFindings(t);
  const apiLodash = findOne(items, { repo: "api", packageName: "lodash" });
  await patchFinding(t, apiLodash.id, "ignored");
  items = await allFindings(t);
  return {
    apiEvil: findOne(items, { repo: "api", packageName: "evil-pkg" }),
    apiLodash: findOne(items, { repo: "api", packageName: "lodash" }),
    legacyEvil: findOne(items, { repo: "legacy-api" }),
    webLodash: findOne(items, { repo: "web-app" }),
  };
}

function ids(items: Finding[]): number[] {
  return items.map((item) => item.id).sort((a, b) => a - b);
}

describe("GET /api/findings", () => {
  it("[CT-02] 기본 요청은 200 Page<Finding> (page 1, limit 50, total = 전체)", async () => {
    await seed();

    const res = await t.request("GET", "/api/findings");

    expect(res.status).toBe(200);
    const page = findingsPageSchema.parse(res.json);
    expect(page).toMatchObject({ page: 1, limit: 50, total: 4 });
    expect(page.items).toHaveLength(4);
  });

  it("[CT-02][AC-07] status 필터: open·ignored·resolved 각각, 생략하면 모든 상태", async () => {
    const s = await seed();

    expect(ids((await listFindings(t, { status: "open" })).items)).toEqual(
      ids([s.apiEvil, s.webLodash]),
    );
    expect(ids((await listFindings(t, { status: "ignored" })).items)).toEqual([s.apiLodash.id]);
    const resolved = await listFindings(t, { status: "resolved" });
    expect(ids(resolved.items)).toEqual([s.legacyEvil.id]);
    expect(resolved.items[0]?.resolvedAt).not.toBeNull();
    expect((await listFindings(t)).total).toBe(4);
  });

  it("[CT-02] repo·package 필터는 trim 후 대소문자 무시 부분 일치, 빈 문자열은 생략과 같다", async () => {
    const s = await seed();

    expect(ids((await listFindings(t, { repo: "  API " })).items)).toEqual(
      ids([s.apiEvil, s.apiLodash, s.legacyEvil]),
    );
    expect(ids((await listFindings(t, { package: "LODASH" })).items)).toEqual(
      ids([s.apiLodash, s.webLodash]),
    );
    expect(ids((await listFindings(t, { repo: "api", package: "evil" })).items)).toEqual(
      ids([s.apiEvil, s.legacyEvil]),
    );
    expect((await listFindings(t, { repo: "", package: "  " })).total).toBe(4);
  });

  it("[CT-02] 정렬은 firstSeenAt 내림차순, 같으면 id 내림차순", async () => {
    const s = await seed();

    const { items } = await listFindings(t);

    expect(items[0]?.id).toBe(s.webLodash.id);
    for (let index = 1; index < items.length; index += 1) {
      const prev = items[index - 1];
      const cur = items[index];
      if (!prev || !cur) throw new Error("unreachable");
      const order = prev.firstSeenAt.localeCompare(cur.firstSeenAt);
      expect(order > 0 || (order === 0 && prev.id > cur.id)).toBe(true);
    }
  });

  it("[CT-02] page·limit·total: 필터 후 total, 범위를 넘은 page 는 200 + 빈 items", async () => {
    await seed();
    const all = (await listFindings(t)).items;

    const second = await listFindings(t, { page: "2", limit: "1" });
    expect(second).toMatchObject({ page: 2, limit: 1, total: 4 });
    expect(second.items.map((item) => item.id)).toEqual([all[1]?.id]);

    const beyond = await listFindings(t, { page: "99", limit: "50" });
    expect(beyond).toMatchObject({ items: [], total: 4, page: 99 });

    expect((await listFindings(t, { status: "open", limit: "1" })).total).toBe(2);
  });

  it("[CT-02] 범위 밖·정수 아닌 page/limit, 잘못된 status 는 400 VALIDATION_ERROR (clamp 하지 않는다)", async () => {
    const cases: [string, string][] = [
      ["limit=201", "limit"],
      ["limit=0", "limit"],
      ["page=0", "page"],
      ["page=1.5", "page"],
      ["limit=abc", "limit"],
      ["status=closed", "status"],
    ];
    for (const [query, field] of cases) {
      const error = expectApiError(await t.request("GET", `/api/findings?${query}`), 400, "VALIDATION_ERROR");
      expect(Object.keys(error.details ?? {}), query).toContain(field);
    }
  });
});

describe("PATCH /api/findings/:id", () => {
  it("[CT-03][AC-08] open → ignored 는 200 Finding, summary.ignoredCount 가 일치한다", async () => {
    const s = await seed();
    const before = await getSummary(t);

    const res = await t.request("PATCH", `/api/findings/${s.apiEvil.id}`, { status: "ignored" });

    expect(res.status).toBe(200);
    expect(findingSchema.parse(res.json)).toMatchObject({ id: s.apiEvil.id, status: "ignored" });
    const after = await getSummary(t);
    expect(after.ignoredCount).toBe(before.ignoredCount + 1);
    expect(after.openCount).toBe(before.openCount - 1);
    expect(after.ignoredCount).toBe((await listFindings(t, { status: "ignored" })).total);
  });

  it("[CT-03] ignored → open, 같은 상태로의 요청은 200(변경 없음)", async () => {
    const s = await seed();

    expect((await patchFinding(t, s.apiLodash.id, "open")).status).toBe("open");
    const same = await patchFinding(t, s.apiLodash.id, "open");
    expect(same).toMatchObject({ id: s.apiLodash.id, status: "open" });
    expect((await getSummary(t)).ignoredCount).toBe(0);
  });

  it("[CT-03] PATCH 는 notifiedAt 을 바꾸지 않는다", async () => {
    const s = await seed();
    expect(s.apiEvil.notifiedAt).not.toBeNull();

    expect((await patchFinding(t, s.apiEvil.id, "ignored")).notifiedAt).toBe(s.apiEvil.notifiedAt);
    expect((await patchFinding(t, s.apiEvil.id, "open")).notifiedAt).toBe(s.apiEvil.notifiedAt);
  });

  it("[CT-03] resolved 검출의 상태 변경은 409 INVALID_STATE", async () => {
    const s = await seed();

    for (const status of ["ignored", "open"]) {
      const res = await t.request("PATCH", `/api/findings/${s.legacyEvil.id}`, { status });
      expectApiError(res, 409, "INVALID_STATE");
    }
    expect(findOne(await allFindings(t), { repo: "legacy-api" }).status).toBe("resolved");
  });

  it("[CT-03] 없는 id 와 정수가 아닌 id 는 404 NOT_FOUND", async () => {
    await seed();

    for (const id of ["99999", "abc", "1.5", "0"]) {
      expectApiError(await t.request("PATCH", `/api/findings/${id}`, { status: "ignored" }), 404, "NOT_FOUND");
    }
  });

  it("[CT-03] status 가 ignored/open 이 아니면 400 VALIDATION_ERROR (details.status)", async () => {
    const s = await seed();

    for (const body of [{ status: "resolved" }, {}, { status: 1 }]) {
      const error = expectApiError(
        await t.request("PATCH", `/api/findings/${s.apiEvil.id}`, body),
        400,
        "VALIDATION_ERROR",
      );
      expect(error.details).toHaveProperty("status");
    }
  });
});

describe("GET /api/summary", () => {
  it("[CT-04] 스캔 이력이 없으면 lastScan null, 카운트 0", async () => {
    const summary = await getSummary(t);

    expect(summary).toMatchObject({ openCount: 0, ignoredCount: 0, lastScan: null });
  });

  it("[CT-04][AC-07] openCount = GET /api/findings?status=open 의 total, ignoredCount = ignored total", async () => {
    await seed();

    const summary = await getSummary(t);

    expect(summary.openCount).toBe((await listFindings(t, { status: "open" })).total);
    expect(summary.ignoredCount).toBe((await listFindings(t, { status: "ignored" })).total);
    expect(summary).toMatchObject({ openCount: 2, ignoredCount: 1 });
  });

  it("[CT-04] lastScan 은 startedAt 이 가장 최신인 1건이고 running 도 포함한다", async () => {
    await addBlacklist(t, EVIL);
    t.github.setRepos([{ name: "api", files: { "package.json": pkgJson() } }]);
    const finished = await runScan(t);
    expect((await getSummary(t)).lastScan?.id).toBe(finished.id);

    t.clock.advance(HOUR);
    const gate = t.github.pause("getTree", "api");
    const res = await t.request("POST", "/api/scans");
    expect(res.status).toBe(202);
    const running = scanSchema.parse(res.json);
    await gate.waitReached();

    expect((await getSummary(t)).lastScan).toMatchObject({ id: running.id, status: "running" });
    gate.release();
    await waitForScans(t);
    expect((await getSummary(t)).lastScan).toMatchObject({ id: running.id, status: "success" });
  });
});

describe("날짜·nullable 형식", () => {
  it("[CT-12] 날짜는 ISO 8601 UTC 문자열이고 nullable 필드는 생략하지 않고 null 로 보낸다", async () => {
    await seed();
    t.mailer.failWith = new Error("SMTP down");
    t.github.upsertRepo({
      name: "fresh",
      files: { "package.json": pkgJson({ dependencies: { "evil-pkg": "^1.0.0" } }) },
    });
    await runScan(t);

    const res = await t.request("GET", "/api/findings?status=open&repo=fresh");
    const body = res.json as { items: Record<string, unknown>[] };
    const [raw] = body.items;
    expect(raw).toBeDefined();
    expect(Object.hasOwn(raw ?? {}, "resolvedAt")).toBe(true);
    expect(raw?.resolvedAt).toBeNull();
    expect(Object.hasOwn(raw ?? {}, "notifiedAt")).toBe(true);
    expect(raw?.notifiedAt).toBeNull();
    expect(isoDateSchema.safeParse(raw?.firstSeenAt).success).toBe(true);

    const summary = (await t.request("GET", "/api/summary")).json as Record<string, unknown>;
    expect(Object.hasOwn(summary, "nextScanAt")).toBe(true);
    expect(isoDateSchema.safeParse(summary.nextScanAt).success).toBe(true);
  });
});
