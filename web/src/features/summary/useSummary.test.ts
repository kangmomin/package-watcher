import { scanFailed, scanPartial, summaryDefault, summaryEmpty, summaryRunning } from "@pw/shared/fixtures";
import { describe, expect, it } from "vitest";
import { isScanRunning } from "@/features/summary/useSummary";

describe("isScanRunning (스캔 실행 중 판정의 단일 소스)", () => {
  it("[CT-06] summary.lastScan?.status === 'running' 일 때만 true 다", () => {
    expect(isScanRunning(summaryRunning)).toBe(true);

    expect(isScanRunning(summaryDefault)).toBe(false);
    expect(isScanRunning({ ...summaryDefault, lastScan: scanFailed })).toBe(false);
    expect(isScanRunning({ ...summaryDefault, lastScan: scanPartial })).toBe(false);
    expect(isScanRunning(summaryEmpty)).toBe(false);
    // summary loading 중(데이터 없음)
    expect(isScanRunning(undefined)).toBe(false);
  });
});
