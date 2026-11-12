import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTestApps, createTestApp, expectApiError, type TestApp } from "../test/testApp.ts";
import { addEntry, listEntries } from "../test/v2.ts";

let t: TestApp;

beforeEach(async () => {
  t = createTestApp(); // KST 2026-11-12 09:00
  const base = { versionRange: null, reason: "r" };
  await addEntry(t, { ...base, name: "on" });
  await addEntry(t, { ...base, name: "off", enabled: false });
  await addEntry(t, { ...base, name: "on-today", expiresAt: "2026-11-12" });
  await addEntry(t, { ...base, name: "off-expired", enabled: false, expiresAt: "2026-11-12" });
  await addEntry(t, { ...base, name: "pypi-on", ecosystem: "pypi" });
  t.clock.set("2026-11-12T15:00:00.000Z"); // KST 11-13 — 만료일이 11-12 인 항목은 만료
});

afterEach(cleanupTestApps);

const names = async (query: Record<string, string>): Promise<string[]> =>
  (await listEntries(t, query)).map((entry) => entry.name);

describe("GET /api/blacklist?status=", () => {
  it("[BK-11] active = 켜짐 + 만료 아님", async () => {
    expect(await names({ status: "active" })).toEqual(["on", "pypi-on"]);
  });

  it("[BK-11] disabled = 꺼짐 + 만료 아님 (만료된 꺼진 항목은 expired 다)", async () => {
    expect(await names({ status: "disabled" })).toEqual(["off"]);
  });

  it("[BK-11] expired = 만료 (꺼짐 여부와 무관)", async () => {
    expect(await names({ status: "expired" })).toEqual(["off-expired", "on-today"]);
  });

  it("[BK-11] 만료일 당일은 active 다", async () => {
    t.clock.set("2026-11-12T14:59:00.000Z"); // KST 11-12 23:59
    expect(await names({ status: "active" })).toEqual(["on", "on-today", "pypi-on"]);
    expect(await names({ status: "expired" })).toEqual([]);
  });

  it("[BK-11] 상태 3개를 합치면 전체와 같고 서로 겹치지 않는다", async () => {
    const all = await names({});
    const parts = [
      ...(await names({ status: "active" })),
      ...(await names({ status: "disabled" })),
      ...(await names({ status: "expired" })),
    ];
    expect([...parts].sort()).toEqual([...all].sort());
  });

  it("[BK-11] 다른 필터와 함께 쓴다 (AND)", async () => {
    expect(await names({ status: "active", ecosystem: "pypi" })).toEqual(["pypi-on"]);
    expect(await names({ status: "expired", q: "OFF" })).toEqual(["off-expired"]);
    expect(await names({ status: "expired", enabled: "false" })).toEqual(["off-expired"]);
    expect(await names({ status: "active", enabled: "false" })).toEqual([]);
    expect(await names({ status: "active", q: "on-" })).toEqual([]);
  });

  it("[BK-11] enum 밖의 값은 400 VALIDATION_ERROR 이다", async () => {
    for (const status of ["", "enabled", "ACTIVE", "all"]) {
      expectApiError(await t.request("GET", `/api/blacklist?status=${status}`), 400, "VALIDATION_ERROR");
    }
  });
});
