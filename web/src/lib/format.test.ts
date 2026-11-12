import { describe, expect, it, vi } from "vitest";
import { formatCardTime, formatTableTime } from "@/lib/format";

// 실행 환경의 TZ 와 무관하게 Asia/Seoul 로 표시해야 한다. 로컬 TZ 가 KST 인 PC 에서도
// 검증이 의미 있도록 Asia/Seoul 이 아닌 TZ 로 바꿔서 실행한다(원복은 setup.ts 의 unstubAllEnvs).
const NON_KST_TIMEZONES = ["UTC", "America/Los_Angeles"];

describe("format (KST 날짜 형식)", () => {
  it.each(NON_KST_TIMEZONES)("[CT-12] 표 형식은 Asia/Seoul 기준 MM-dd HH:mm 이다 (TZ=%s)", (tz) => {
    vi.stubEnv("TZ", tz);

    expect(formatTableTime("2026-11-12T00:00:00.000Z")).toBe("11-12 09:00");
    // KST 로 날짜·연도가 넘어가는 경계, 자정은 00 시로 쓴다
    expect(formatTableTime("2026-12-31T15:30:00.000Z")).toBe("01-01 00:30");
    expect(formatTableTime("2026-03-05T06:07:00.000Z")).toBe("03-05 15:07");
  });

  it.each(NON_KST_TIMEZONES)("[CT-12] 카드 형식은 Asia/Seoul 기준 yyyy-MM-dd HH:mm 이다 (TZ=%s)", (tz) => {
    vi.stubEnv("TZ", tz);

    expect(formatCardTime("2026-11-12T00:00:00.000Z")).toBe("2026-11-12 09:00");
    expect(formatCardTime("2026-12-31T15:30:00.000Z")).toBe("2027-01-01 00:30");
    expect(formatCardTime("2026-03-05T06:07:00.000Z")).toBe("2026-03-05 15:07");
  });
});
