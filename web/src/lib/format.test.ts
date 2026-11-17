import { describe, expect, it, vi } from "vitest";
import {
  entrySourceLabel,
  feedKindLabel,
  formatCardTime,
  formatCvssScore,
  formatPatchedVersions,
  formatTableTime,
  isHttpUrl,
} from "@/lib/format";

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

describe("취약점 표시 문자열", () => {
  it("[SI-88] 출처 라벨은 직접 등록 / 자동 / 취약점이다", () => {
    expect(entrySourceLabel("manual")).toBe("직접 등록");
    expect(entrySourceLabel("feed")).toBe("자동");
    expect(entrySourceLabel("cve")).toBe("취약점");
  });

  it("[SI-89] 분류 라벨, 점수(소수 1자리, 없으면 —), 고쳐진 버전(쉼표, 없으면 —)", () => {
    expect(feedKindLabel("malware")).toBe("악성 패키지");
    expect(feedKindLabel("cve")).toBe("취약점");
    expect(formatCvssScore(9.8)).toBe("9.8");
    expect(formatCvssScore(7)).toBe("7.0");
    expect(formatCvssScore(null)).toBe("—");
    expect(formatPatchedVersions(["1.2.3", "2.0.0"])).toBe("1.2.3, 2.0.0");
    expect(formatPatchedVersions([])).toBe("—");
  });

  it("[SI-90] 링크는 http·https 만 허용한다", () => {
    expect(isHttpUrl("https://github.com/advisories/GHSA-a")).toBe(true);
    expect(isHttpUrl("http://example.com")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("//evil.example")).toBe(false);
  });
});
