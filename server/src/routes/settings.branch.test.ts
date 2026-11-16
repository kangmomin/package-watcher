import { afterEach, describe, expect, it } from "vitest";
import { cleanupTestApps, createTestApp, expectApiError, getSettings, putSettings } from "../test/testApp.ts";

afterEach(cleanupTestApps);

describe("설정 branchScanDays", () => {
  it("[SF-70] 기본 7, 저장하면 바뀌고 생략하면 저장된 값을 유지한다", async () => {
    const t = createTestApp();
    expect((await getSettings(t)).branchScanDays).toBe(7);

    expect((await putSettings(t, { branchScanDays: 0 })).branchScanDays).toBe(0);
    expect((await putSettings(t)).branchScanDays).toBe(0);
    expect((await putSettings(t, { branchScanDays: 30 })).branchScanDays).toBe(30);
    expect((await getSettings(t)).branchScanDays).toBe(30);
  });

  it("[SF-71] 0~30 의 정수가 아니면 VALIDATION_ERROR", async () => {
    const t = createTestApp();
    for (const value of [31, -1, 1.5, "7"]) {
      const res = await t.request("PUT", "/api/settings", {
        org: "my-org",
        scanIntervalHours: 24,
        digestTime: "09:00",
        recipients: [],
        branchScanDays: value,
      });
      expectApiError(res, 400, "VALIDATION_ERROR");
    }
  });
});
