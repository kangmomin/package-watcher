import { afterEach, describe, expect, it } from "vitest";
import { HOUR } from "../test/clock.ts";
import {
  cleanupTestApps,
  createTestApp,
  DEFAULT_SETTINGS,
  expectApiError,
  getSettings,
  getSummary,
  putSettings,
} from "../test/testApp.ts";
import { putSettingsV2 } from "../test/v2.ts";

afterEach(cleanupTestApps);

describe("GET/PUT /api/settings — notifyMinSeverity", () => {
  it("[v2-AC-07][CT-20] 기본값은 low, PUT high → 응답과 GET 이 high, 키를 생략한 PUT 은 저장된 값을 유지한다 (재시작 후에도)", async () => {
    const t = createTestApp();
    expect((await getSettings(t)).notifyMinSeverity).toBe("low");

    const saved = await putSettingsV2(t, { notifyMinSeverity: "high" });
    expect(saved.notifyMinSeverity).toBe("high");
    expect((await getSettings(t)).notifyMinSeverity).toBe("high");

    // v1 클라이언트의 본문(키 4개): 다른 필드는 바뀌고 notifyMinSeverity 는 그대로다.
    const omitted = await putSettings(t, { digestTime: "07:30" });
    expect(omitted).toMatchObject({ digestTime: "07:30", notifyMinSeverity: "high" });
    expect((await getSettings(t)).notifyMinSeverity).toBe("high");

    for (const severity of ["critical", "medium", "low"]) {
      expect((await putSettingsV2(t, { notifyMinSeverity: severity })).notifyMinSeverity).toBe(severity);
    }
    await putSettingsV2(t, { notifyMinSeverity: "critical" });
    await t.close();

    const restarted = createTestApp({ dbPath: t.dbPath });
    expect((await getSettings(restarted)).notifyMinSeverity).toBe("critical");
  });

  it("[CT-20] 잘못된 notifyMinSeverity 는 400 VALIDATION_ERROR details.notifyMinSeverity 이고 저장된 값은 그대로다", async () => {
    const t = createTestApp();
    await putSettingsV2(t, { notifyMinSeverity: "high" });

    for (const value of ["urgent", "HIGH", "", 3]) {
      const res = await t.request("PUT", "/api/settings", {
        ...DEFAULT_SETTINGS,
        digestTime: "06:00",
        notifyMinSeverity: value,
      });
      const error = expectApiError(res, 400, "VALIDATION_ERROR");
      expect(error.details, JSON.stringify(value)).toHaveProperty("notifyMinSeverity");
    }

    expect(await getSettings(t)).toMatchObject({ digestTime: "09:00", notifyMinSeverity: "high" });
  });

  it("[CT-20] notifyMinSeverity 만 바꾸면 nextScanAt 은 그대로다", async () => {
    const t = createTestApp({ now: "2026-11-12T00:00:00.000Z" });
    await putSettings(t, { scanIntervalHours: 6 });
    expect((await getSummary(t)).nextScanAt).toBe("2026-11-12T06:00:00.000Z");

    t.clock.advance(HOUR);
    const saved = await putSettingsV2(t, { scanIntervalHours: 6, notifyMinSeverity: "critical" });

    expect(saved.notifyMinSeverity).toBe("critical");
    expect((await getSummary(t)).nextScanAt).toBe("2026-11-12T06:00:00.000Z");
  });
});
