import { scanSchema } from "@pw/shared";
import { afterEach, describe, expect, it } from "vitest";
import { HOUR } from "../test/clock.ts";
import { pkgJson } from "../test/repoFixtures.ts";
import {
  cleanupTestApps,
  createTestApp,
  expectApiError,
  getScan,
  listScans,
  putSettings,
  runScan,
  waitForScans,
} from "../test/testApp.ts";

afterEach(cleanupTestApps);

const nodeRepo = (name: string) => ({ name, files: { "package.json": pkgJson() } });

describe("POST /api/scans", () => {
  it("[EC-06][CT-06] org 미설정이면 400 ORG_NOT_SET, 스캔을 만들지 않는다", async () => {
    const t = createTestApp();

    expectApiError(await t.request("POST", "/api/scans"), 400, "ORG_NOT_SET");

    expect((await listScans(t)).total).toBe(0);
  });

  it("[EC-06][CT-06] 토큰이 none 이면 400 TOKEN_MISSING, 스캔을 만들지 않는다", async () => {
    const t = createTestApp({ tokenSource: "none" });
    await putSettings(t);

    const error = expectApiError(await t.request("POST", "/api/scans"), 400, "TOKEN_MISSING");

    expect(error.message).not.toBe("");
    expect((await listScans(t)).total).toBe(0);
  });

  it("[CT-06] 판정 순서: org 미설정과 토큰 none 이 함께면 ORG_NOT_SET", async () => {
    const t = createTestApp({ tokenSource: "none" });

    expectApiError(await t.request("POST", "/api/scans"), 400, "ORG_NOT_SET");
  });

  it("[AC-10][CT-06] 실행 중인 스캔이 없으면 202 Scan(running, manual), 종료 후 success 또는 partial", async () => {
    const t = createTestApp();
    await putSettings(t);
    t.github.setRepos([nodeRepo("api")]);

    const res = await t.request("POST", "/api/scans");

    expect(res.status).toBe(202);
    const scan = scanSchema.parse(res.json);
    expect(scan).toMatchObject({
      trigger: "manual",
      status: "running",
      finishedAt: null,
      repoCount: 0,
      newFindingCount: 0,
      failedRepos: [],
      error: null,
    });
    await waitForScans(t);
    const finished = await getScan(t, scan.id);
    expect(["success", "partial"]).toContain(finished.status);
    expect(finished.finishedAt).not.toBeNull();
  });

  it("[EC-05][CT-06] 스캔 실행 중에 POST 하면 409 SCAN_RUNNING, 새 스캔을 만들지 않는다", async () => {
    const t = createTestApp();
    await putSettings(t);
    t.github.setRepos([nodeRepo("api")]);
    const gate = t.github.pause("getTree", "api");
    expect((await t.request("POST", "/api/scans")).status).toBe(202);
    await gate.waitReached();

    expectApiError(await t.request("POST", "/api/scans"), 409, "SCAN_RUNNING");

    expect((await listScans(t)).total).toBe(1);
    gate.release();
    await waitForScans(t);
  });
});

describe("GET /api/scans, GET /api/scans/:id", () => {
  it("[CT-07] Page<Scan> 은 startedAt 내림차순(같으면 id 내림차순), 기본 page 1·limit 20", async () => {
    const t = createTestApp();
    await putSettings(t);
    t.github.setRepos([nodeRepo("api")]);
    const first = await runScan(t);
    const second = await runScan(t);
    t.clock.advance(HOUR);
    const third = await runScan(t);

    const page = await listScans(t);

    expect(page).toMatchObject({ page: 1, limit: 20, total: 3 });
    expect(page.items.map((scan) => scan.id)).toEqual([third.id, second.id, first.id]);
  });

  it("[CT-07] page·limit 페이지네이션과 범위 밖 값은 400 VALIDATION_ERROR", async () => {
    const t = createTestApp();
    await putSettings(t);
    t.github.setRepos([nodeRepo("api")]);
    await runScan(t);
    t.clock.advance(HOUR);
    await runScan(t);

    const page2 = await listScans(t, { page: "2", limit: "1" });
    expect(page2).toMatchObject({ page: 2, limit: 1, total: 2 });
    expect(page2.items).toHaveLength(1);
    expect((await listScans(t, { page: "5" })).items).toEqual([]);

    for (const query of ["limit=101", "limit=0", "page=0", "page=x"]) {
      expectApiError(await t.request("GET", `/api/scans?${query}`), 400, "VALIDATION_ERROR");
    }
  });

  it("[CT-07] GET /api/scans/:id 는 failedRepos 를 포함한 Scan, 없으면 404", async () => {
    const t = createTestApp();
    await putSettings(t);
    t.github.setRepos([nodeRepo("api"), nodeRepo("flaky")]);
    t.github.failTree("flaky", new Error("GitHub API 오류 (502)"));
    const scan = await runScan(t);

    const fetched = await getScan(t, scan.id);

    expect(fetched.status).toBe("partial");
    expect(fetched.failedRepos).toEqual([{ repo: "flaky", error: expect.any(String) }]);
    expectApiError(await t.request("GET", "/api/scans/9999"), 404, "NOT_FOUND");
    expectApiError(await t.request("GET", "/api/scans/abc"), 404, "NOT_FOUND");
  });
});
