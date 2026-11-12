import { bulkResultSchema } from "@pw/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MINUTE } from "../test/clock.ts";
import { bulkRequest } from "../test/bulk.ts";
import { pkgJson } from "../test/repoFixtures.ts";
import {
  allFindings,
  cleanupTestApps,
  createTestApp,
  expectApiError,
  findOne,
  putSettings,
  runScan,
  type TestApp,
} from "../test/testApp.ts";
import { addEntry, getEntry, listEntries, startPausedScan } from "../test/v2.ts";

const EVIL = { name: "evil-pkg", versionRange: null, reason: "악성 코드" };
const BAD = { name: "bad-lib", versionRange: null, reason: "나쁜 라이브러리" };
const withBoth = () => pkgJson({ dependencies: { "evil-pkg": "^1.0.0", "bad-lib": "^2.0.0" } });

let t: TestApp;

beforeEach(async () => {
  t = createTestApp();
  await putSettings(t);
});

afterEach(cleanupTestApps);

async function bulkOk(action: string, ids: number[]) {
  const res = await bulkRequest(t, action, ids);
  expect(res.status, res.text).toBe(200);
  return bulkResultSchema.parse(res.json);
}

describe("POST /api/blacklist/bulk — v2-AC-18", () => {
  it("[v2-AC-18] 항목 2건을 끄기 → 켜기 → 삭제하면 각각 count: 2 이고 목록에 반영된다", async () => {
    const a = await addEntry(t, EVIL);
    const b = await addEntry(t, BAD);
    t.github.setRepos([{ name: "api", files: { "package.json": withBoth() } }]);
    await runScan(t);
    expect(await allFindings(t)).toHaveLength(2);
    t.clock.advance(MINUTE);
    const at = t.clock.iso();

    expect(await bulkOk("disable", [a.id, b.id])).toEqual({ action: "disable", count: 2 });
    expect((await listEntries(t)).map((entry) => entry.enabled)).toEqual([false, false]);
    for (const finding of await allFindings(t)) {
      expect(finding).toMatchObject({ status: "resolved", resolvedAt: at });
    }

    t.clock.advance(MINUTE);
    expect(await bulkOk("enable", [a.id, b.id])).toEqual({ action: "enable", count: 2 });
    expect((await listEntries(t)).map((entry) => entry.enabled)).toEqual([true, true]);

    expect(await bulkOk("delete", [a.id, b.id])).toEqual({ action: "delete", count: 2 });
    expect(await listEntries(t)).toEqual([]);
  });

  it("[v2-AC-18] 삭제하면 그 항목의 활성 검출이 resolved 가 되고 resolvedAt 이 기록된다 (다른 항목의 검출은 그대로)", async () => {
    const a = await addEntry(t, EVIL);
    await addEntry(t, BAD);
    t.github.setRepos([{ name: "api", files: { "package.json": withBoth() } }]);
    await runScan(t);
    t.clock.advance(MINUTE);
    const at = t.clock.iso();

    await bulkOk("delete", [a.id]);

    const items = await allFindings(t);
    expect(findOne(items, { packageName: "evil-pkg" })).toMatchObject({ status: "resolved", resolvedAt: at });
    expect(findOne(items, { packageName: "bad-lib" }).status).toBe("open");
  });

  it("[BK-12] enable 은 검출을 만들지 않는다 (다음 스캔이 만든다)", async () => {
    const a = await addEntry(t, { ...EVIL, enabled: false });
    t.github.setRepos([{ name: "api", files: { "package.json": withBoth() } }]);
    await runScan(t);
    expect(await allFindings(t)).toEqual([]);

    await bulkOk("enable", [a.id]);

    expect(await allFindings(t)).toEqual([]);
    await runScan(t);
    expect(await allFindings(t)).toHaveLength(1);
  });

  it("[BK-12] 만료된 항목을 enable 해도 isExpired 는 그대로 true 다", async () => {
    const a = await addEntry(t, { ...EVIL, enabled: false, expiresAt: "2026-11-12" });
    t.clock.set("2026-11-12T15:00:00.000Z"); // KST 11-13 00:00 — 만료
    expect(await getEntry(t, a.id)).toMatchObject({ enabled: false, isExpired: true });

    await bulkOk("enable", [a.id]);

    expect(await getEntry(t, a.id)).toMatchObject({ enabled: true, isExpired: true });
  });

  it("[BK-12] 값이 이미 같은 항목은 수정하지 않는다 — updatedAt 이 그대로이고 count 는 요청한 id 의 수다", async () => {
    const on = await addEntry(t, EVIL);
    const off = await addEntry(t, { ...BAD, enabled: false });
    t.clock.advance(MINUTE);

    expect(await bulkOk("disable", [on.id, off.id])).toEqual({ action: "disable", count: 2 });

    const after = await listEntries(t);
    expect(after.find((entry) => entry.id === off.id)?.updatedAt).toBe(off.updatedAt);
    expect(after.find((entry) => entry.id === on.id)?.updatedAt).toBe(t.clock.iso());
    expect(on.updatedAt).not.toBe(t.clock.iso());

    t.clock.advance(MINUTE);
    const before = await listEntries(t);
    expect(await bulkOk("disable", [on.id, off.id])).toEqual({ action: "disable", count: 2 });
    expect(await listEntries(t)).toEqual(before);
  });

  it("[BK-12] 같은 id 가 여러 번 있으면 1개로 센다", async () => {
    const a = await addEntry(t, EVIL);

    expect(await bulkOk("disable", [a.id, a.id, a.id])).toEqual({ action: "disable", count: 1 });
  });

  it("[BK-12] 항목의 다른 필드는 바뀌지 않는다", async () => {
    const a = await addEntry(t, {
      name: "@evil/*",
      versionRange: null,
      reason: "스코프",
      severity: "critical",
      expiresAt: "2027-01-01",
    });
    t.clock.advance(MINUTE);

    await bulkOk("disable", [a.id]);

    expect(await getEntry(t, a.id)).toEqual({ ...a, enabled: false, updatedAt: t.clock.iso() });
  });
});

describe("POST /api/blacklist/bulk — 오류", () => {
  it("[v2-EC-13] 없는 id 가 1개라도 있으면 404 이고 아무것도 바뀌지 않는다 (다른 항목의 enabled·updatedAt·검출 그대로)", async () => {
    const a = await addEntry(t, EVIL);
    const b = await addEntry(t, BAD);
    t.github.setRepos([{ name: "api", files: { "package.json": withBoth() } }]);
    await runScan(t);
    t.clock.advance(MINUTE);
    const entriesBefore = await listEntries(t);
    const findingsBefore = await allFindings(t);

    for (const action of ["disable", "enable", "delete"]) {
      const res = await bulkRequest(t, action, [a.id, 99999, b.id]);
      expectApiError(res, 404, "NOT_FOUND");
    }

    expect(await listEntries(t)).toEqual(entriesBefore);
    expect(await allFindings(t)).toEqual(findingsBefore);
  });

  it("[BK-12] 400 VALIDATION_ERROR: 빈 배열, 1001개, 잘못된 action, ids 가 배열이 아님, 정수가 아닌 id, 본문 없음", async () => {
    const tooMany = Array.from({ length: 1001 }, (_, index) => index + 1);
    for (const res of [
      await bulkRequest(t, "disable", []),
      await bulkRequest(t, "disable", tooMany),
      await bulkRequest(t, "remove", [1]),
      await bulkRequest(t, "disable", "1"),
      await bulkRequest(t, "disable", [1.5]),
      await bulkRequest(t, "disable", [0]),
      await bulkRequest(t, "disable", ["1"]),
      await t.request("POST", "/api/blacklist/bulk", {}),
      await t.request("POST", "/api/blacklist/bulk", "{깨진"),
    ]) {
      expectApiError(res, 400, "VALIDATION_ERROR");
    }
  });

  it("[BK-12] 1000개는 허용한다 (없는 id 라서 404 로 끝난다) — 중복은 1개로 세므로 1001개여도 중복이면 한도 안이다", async () => {
    const ids = Array.from({ length: 1000 }, (_, index) => index + 1);
    expectApiError(await bulkRequest(t, "disable", ids), 404, "NOT_FOUND");
    const duplicated = [...ids, 1];
    expectApiError(await bulkRequest(t, "disable", duplicated), 404, "NOT_FOUND");
  });

  it("[BK-12] /blacklist/bulk 는 id 로 읽히지 않는다 — PUT·DELETE /api/blacklist/bulk 는 404", async () => {
    expectApiError(await t.request("PUT", "/api/blacklist/bulk", {}), 404, "NOT_FOUND");
    expectApiError(await t.request("DELETE", "/api/blacklist/bulk"), 404, "NOT_FOUND");
  });
});

describe("일괄 작업과 실행 중인 스캔 — v2-EC-14", () => {
  it("[v2-EC-14] 스캔 중 bulk disable 은 200 이고, 그 스캔은 바뀐 항목으로 검출을 만들지 않는다", async () => {
    const a = await addEntry(t, EVIL);
    t.github.setRepos([{ name: "alpha-svc", files: { "package.json": withBoth() } }]);
    t.clock.advance(MINUTE);
    const paused = await startPausedScan(t, "alpha-svc");

    expect(await bulkOk("disable", [a.id])).toEqual({ action: "disable", count: 1 });
    const scan = await paused.finish();

    expect(scan).toMatchObject({ status: "success", newFindingCount: 0 });
    expect(await allFindings(t)).toEqual([]);
  });

  it("[v2-EC-14] 스캔 중 bulk delete 도 200 이고 그 스캔은 지워진 항목으로 검출을 만들지 않는다", async () => {
    const a = await addEntry(t, EVIL);
    t.github.setRepos([{ name: "alpha-svc", files: { "package.json": withBoth() } }]);
    t.clock.advance(MINUTE);
    const paused = await startPausedScan(t, "alpha-svc");

    expect(await bulkOk("delete", [a.id])).toEqual({ action: "delete", count: 1 });
    const scan = await paused.finish();

    expect(scan).toMatchObject({ status: "success", newFindingCount: 0 });
    expect(await allFindings(t)).toEqual([]);
  });

  it("[BK-12] 값이 이미 같아서 건드리지 않은 항목은 스캔의 결과를 버리게 하지 않는다", async () => {
    const a = await addEntry(t, EVIL);
    t.github.setRepos([{ name: "alpha-svc", files: { "package.json": withBoth() } }]);
    t.clock.advance(MINUTE);
    const paused = await startPausedScan(t, "alpha-svc");

    await bulkOk("enable", [a.id]);
    const scan = await paused.finish();

    expect(scan).toMatchObject({ status: "success", newFindingCount: 1 });
  });
});
