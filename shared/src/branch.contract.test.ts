import { describe, expect, it } from "vitest";
import {
  BRANCH_SCAN_DAYS_DEFAULT,
  BRANCH_SCAN_DAYS_MAX,
  findingSchema,
  scanRepoSchema,
  settingsInputSchema,
  settingsSchema,
} from "./contract.ts";
import * as fx from "./fixtures.ts";

describe("[SF-01] 브랜치 스캔의 계약", () => {
  it("검출에 ref 가 있다: 기본 브랜치는 빈 문자열", () => {
    expect(fx.findingOpenDirect.ref).toBe("");
    expect(findingSchema.safeParse(fx.findingOpenDirect).success).toBe(true);
    expect(findingSchema.safeParse({ ...fx.findingOpenDirect, ref: "feature/x" }).success).toBe(true);
    const { ref: _ref, ...withoutRef } = fx.findingOpenDirect;
    expect(findingSchema.safeParse(withoutRef).success).toBe(false);
  });

  it("스캔의 repo 행에 평가한 브랜치의 수가 있다", () => {
    expect(fx.scanRepoPassed.branchCount).toBe(0);
    expect(scanRepoSchema.safeParse({ ...fx.scanRepoPassed, branchCount: 3 }).success).toBe(true);
    const { branchCount: _count, ...withoutCount } = fx.scanRepoPassed;
    expect(scanRepoSchema.safeParse(withoutCount).success).toBe(false);
  });

  it("설정의 branchScanDays: 0~30 의 정수, 응답에는 필수, 입력에서는 생략할 수 있다", () => {
    expect(BRANCH_SCAN_DAYS_DEFAULT).toBe(7);
    expect(fx.settingsDefault.branchScanDays).toBe(7);
    const { branchScanDays: _days, ...withoutDays } = fx.settingsDefault;
    expect(settingsSchema.safeParse(withoutDays).success).toBe(false);
    const input = { org: "my-org", scanIntervalHours: 24, digestTime: "09:00", recipients: [] };
    expect(settingsInputSchema.parse(input).branchScanDays).toBeUndefined();
    expect(settingsInputSchema.parse({ ...input, branchScanDays: 0 }).branchScanDays).toBe(0);
    expect(settingsInputSchema.parse({ ...input, branchScanDays: BRANCH_SCAN_DAYS_MAX }).branchScanDays).toBe(30);
    for (const bad of [-1, 31, 1.5, "7"]) {
      expect(settingsInputSchema.safeParse({ ...input, branchScanDays: bad }).success, String(bad)).toBe(false);
    }
  });
});
