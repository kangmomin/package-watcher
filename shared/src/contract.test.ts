// 공용 계약 테스트 (owner: 오케스트레이터). 도메인 에이전트는 수정하지 않는다.
import { describe, expect, it } from "vitest";
import {
  apiErrorSchema,
  blacklistCreateSchema,
  blacklistEntrySchema,
  blacklistListSchema,
  blacklistUpdateSchema,
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  findingSchema,
  findingsPageSchema,
  findingsQuerySchema,
  findingStatusInputSchema,
  scanSchema,
  scansPageSchema,
  scansQuerySchema,
  settingsInputSchema,
  settingsSchema,
  summarySchema,
  testEmailResultSchema,
  toDetails,
} from "./contract.ts";
import * as fx from "./fixtures.ts";

describe("[CT-01] fixture 는 응답 스키마를 통과한다", () => {
  it.each(fx.findings.map((finding) => [finding.id, finding] as const))(
    "Finding #%s",
    (_id, finding) => {
      expect(findingSchema.parse(finding)).toEqual(finding);
    },
  );

  it.each(fx.scans.map((scan) => [scan.status, scan] as const))("Scan %s", (_status, scan) => {
    expect(scanSchema.parse(scan)).toEqual(scan);
  });

  it("BlacklistEntry 와 목록", () => {
    expect(blacklistEntrySchema.parse(fx.blacklistEntryRanged)).toEqual(fx.blacklistEntryRanged);
    expect(blacklistEntrySchema.parse(fx.blacklistEntryAllVersions).versionRange).toBeNull();
    expect(blacklistListSchema.parse({ items: fx.blacklistEntries }).items).toHaveLength(2);
  });

  it("Summary (기본, 비어 있음, 실행 중)", () => {
    expect(summarySchema.parse(fx.summaryDefault)).toEqual(fx.summaryDefault);
    expect(summarySchema.parse(fx.summaryEmpty)).toEqual(fx.summaryEmpty);
    expect(summarySchema.parse(fx.summaryRunning).lastScan?.status).toBe("running");
  });

  it("Settings (기본, 미설정)", () => {
    expect(settingsSchema.parse(fx.settingsDefault)).toEqual(fx.settingsDefault);
    expect(settingsSchema.parse(fx.settingsUnconfigured)).toEqual(fx.settingsUnconfigured);
  });

  it("Page, TestEmailResult, ApiError", () => {
    expect(findingsPageSchema.parse(fx.findingsPage).total).toBe(fx.findings.length);
    expect(scansPageSchema.parse(fx.scansPage).limit).toBe(20);
    expect(findingsPageSchema.parse(fx.emptyFindingsPage).items).toEqual([]);
    expect(testEmailResultSchema.parse(fx.testEmailResult)).toEqual({ ok: true });
    expect(apiErrorSchema.parse(fx.apiErrorValidation).error.details).toBeDefined();
    expect(apiErrorSchema.parse(fx.apiErrorNotFound).error.details).toBeUndefined();
  });

  it("모든 ErrorCode 에 HTTP status 가 있다", () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
    }
  });
});

describe("[CT-12] 날짜와 nullable 필드", () => {
  it("ISO 8601 UTC 가 아닌 날짜를 거부한다", () => {
    expect(
      findingSchema.safeParse({ ...fx.findingOpenDirect, firstSeenAt: "2026-11-12 09:00" }).success,
    ).toBe(false);
    expect(
      findingSchema.safeParse({ ...fx.findingOpenDirect, firstSeenAt: "2026-11-12T09:00:00+09:00" })
        .success,
    ).toBe(false);
  });

  it("nullable 필드를 생략하면 거부한다 (null 로 보내야 한다)", () => {
    const { resolvedAt: _resolvedAt, ...withoutResolvedAt } = fx.findingOpenDirect;
    expect(findingSchema.safeParse(withoutResolvedAt).success).toBe(false);
    const { finishedAt: _finishedAt, ...withoutFinishedAt } = fx.scanRunning;
    expect(scanSchema.safeParse(withoutFinishedAt).success).toBe(false);
    const { error: _error, ...withoutError } = fx.scanSuccess;
    expect(scanSchema.safeParse(withoutError).success).toBe(false);
  });
});

describe("[CT-01] 입력 스키마는 규칙 밖의 값을 거부한다", () => {
  it("블랙리스트: trim, 빈 범위 → null, 잘못된 값 거부", () => {
    expect(
      blacklistCreateSchema.parse({ name: " lodash ", versionRange: " <4.17.21 ", reason: " 취약점 " }),
    ).toEqual({ name: "lodash", versionRange: "<4.17.21", reason: "취약점" });
    expect(blacklistCreateSchema.parse({ name: "@scope/pkg", reason: "x" }).versionRange).toBeNull();
    expect(
      blacklistCreateSchema.parse({ name: "a", versionRange: "  ", reason: "x" }).versionRange,
    ).toBeNull();

    expect(blacklistCreateSchema.safeParse({ name: "", reason: "x" }).success).toBe(false);
    expect(blacklistCreateSchema.safeParse({ name: "has space", reason: "x" }).success).toBe(false);
    expect(
      blacklistCreateSchema.safeParse({ name: "a", versionRange: "not-a-range!!", reason: "x" })
        .success,
    ).toBe(false);
    expect(blacklistCreateSchema.safeParse({ name: "a", reason: "" }).success).toBe(false);
    expect(blacklistCreateSchema.safeParse({ name: "a", reason: "x".repeat(501) }).success).toBe(
      false,
    );
  });

  it("블랙리스트 PUT 은 versionRange 키가 필수다", () => {
    expect(blacklistUpdateSchema.safeParse({ name: "a", reason: "x" }).success).toBe(false);
    expect(blacklistUpdateSchema.parse({ name: "a", versionRange: null, reason: "x" })).toEqual({
      name: "a",
      versionRange: null,
      reason: "x",
    });
  });

  it("검출 상태 입력은 ignored / open 만 받는다", () => {
    expect(findingStatusInputSchema.safeParse({ status: "resolved" }).success).toBe(false);
    expect(findingStatusInputSchema.parse({ status: "ignored" }).status).toBe("ignored");
  });

  it("설정: org 소문자 정규화, 수신자 trim + 중복 제거", () => {
    expect(
      settingsInputSchema.parse({
        org: " My-Org ",
        scanIntervalHours: 6,
        digestTime: "09:00",
        recipients: [" a@x.com ", "a@x.com", "b@x.com"],
      }),
    ).toEqual({
      org: "my-org",
      scanIntervalHours: 6,
      digestTime: "09:00",
      recipients: ["a@x.com", "b@x.com"],
    });
  });

  it.each([
    ["org 가 하이픈으로 시작", { org: "-org" }],
    ["org 에 연속 하이픈", { org: "my--org" }],
    ["org 가 40자", { org: "a".repeat(40) }],
    ["interval 0", { scanIntervalHours: 0 }],
    ["interval 169", { scanIntervalHours: 169 }],
    ["interval 소수", { scanIntervalHours: 1.5 }],
    ["요약 시각 9:00", { digestTime: "9:00" }],
    ["요약 시각 24:00", { digestTime: "24:00" }],
    ["잘못된 이메일", { recipients: ["not-an-email"] }],
  ])("설정: %s 거부", (_label, override) => {
    const base = { org: "my-org", scanIntervalHours: 24, digestTime: "09:00", recipients: [] };
    expect(settingsInputSchema.safeParse({ ...base, ...override }).success).toBe(false);
  });

  it("query: 기본값, 문자열 숫자 변환, 범위 밖 거부", () => {
    expect(findingsQuerySchema.parse({})).toMatchObject({ page: 1, limit: 50 });
    expect(findingsQuerySchema.parse({ page: "2", limit: "200", repo: "  " })).toMatchObject({
      page: 2,
      limit: 200,
      repo: undefined,
    });
    expect(findingsQuerySchema.safeParse({ limit: "201" }).success).toBe(false);
    expect(findingsQuerySchema.safeParse({ page: "0" }).success).toBe(false);
    expect(findingsQuerySchema.safeParse({ page: "1.5" }).success).toBe(false);
    expect(findingsQuerySchema.safeParse({ status: "closed" }).success).toBe(false);
    expect(scansQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(scansQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
  });
});

describe("[CT-01] toDetails", () => {
  it("최상위 필드 이름을 키로 쓴다", () => {
    const result = blacklistCreateSchema.safeParse({ name: "", versionRange: "!!", reason: "" });
    expect(result.success).toBe(false);
    if (result.success) return;
    const details = toDetails(result.error);
    expect(Object.keys(details).sort()).toEqual(["name", "reason", "versionRange"]);
  });

  it("배열 원소 오류는 recipients 1개로 합치고 값을 메시지에 넣는다", () => {
    const result = settingsInputSchema.safeParse({
      org: "my-org",
      scanIntervalHours: 24,
      digestTime: "09:00",
      recipients: ["ok@x.com", "bad-1", "bad-2"],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const details = toDetails(result.error);
    expect(Object.keys(details)).toEqual(["recipients"]);
    expect(details.recipients).toContain("bad-1");
    expect(details.recipients).toContain("bad-2");
  });
});
