// 공용 계약 테스트 (owner: 오케스트레이터). 도메인 에이전트는 수정하지 않는다.
import { describe, expect, it } from "vitest";
import {
  apiErrorSchema,
  blacklistCreateSchema,
  blacklistEntrySchema,
  blacklistListSchema,
  blacklistQuerySchema,
  blacklistUpdateSchema,
  ECOSYSTEMS,
  entryStatusOf,
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  kstDateOf,
  SEVERITIES,
  SEVERITY_RANK,
  SUPPORTED_ECOSYSTEMS,
  findingSchema,
  findingsPageSchema,
  findingsQuerySchema,
  findingStatusInputSchema,
  scanRepoSchema,
  scanReposPageSchema,
  scanReposQuerySchema,
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
    ).toEqual({
      name: "lodash",
      versionRange: "<4.17.21",
      reason: "취약점",
      ecosystem: "npm",
      severity: "medium",
      enabled: true,
      expiresAt: null,
    });
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

// ---------------------------------------------------------------- v2 (블랙리스트 규칙 확장)

describe("[CT-15] v2 fixture 와 상수", () => {
  it.each(fx.blacklistEntryVariants.map((entry) => [entry.name, entry] as const))(
    "BlacklistEntry 변형 %s",
    (_name, entry) => {
      expect(blacklistEntrySchema.parse(entry)).toEqual(entry);
    },
  );

  it.each(fx.findingsBySeverity.map((finding) => [finding.severity, finding] as const))(
    "Finding %s",
    (_severity, finding) => {
      expect(findingSchema.parse(finding)).toEqual(finding);
    },
  );

  it("기존 fixture 는 새 필드의 기본값을 가진다", () => {
    for (const entry of fx.blacklistEntries) {
      expect(entry).toMatchObject({
        ecosystem: "npm",
        severity: "medium",
        enabled: true,
        expiresAt: null,
        isExpired: false,
      });
    }
    for (const finding of fx.findings) {
      expect(finding).toMatchObject({ ecosystem: "npm", severity: "medium" });
    }
    expect(fx.settingsDefault.notifyMinSeverity).toBe("low");
  });

  it("새 필드가 없는 응답을 거부한다", () => {
    const { severity: _severity, ...entryWithoutSeverity } = fx.blacklistEntryRanged;
    expect(blacklistEntrySchema.safeParse(entryWithoutSeverity).success).toBe(false);
    const { ecosystem: _ecosystem, ...findingWithoutEcosystem } = fx.findingOpenDirect;
    expect(findingSchema.safeParse(findingWithoutEcosystem).success).toBe(false);
    const { notifyMinSeverity: _min, ...settingsWithoutMin } = fx.settingsDefault;
    expect(settingsSchema.safeParse(settingsWithoutMin).success).toBe(false);
  });

  it("상수: 종류 7개, 입력은 npm 만, 심각도는 높은 순", () => {
    expect(ECOSYSTEMS).toEqual(["npm", "go", "pypi", "nuget", "cargo", "pub", "maven"]);
    expect(SUPPORTED_ECOSYSTEMS).toEqual(["npm"]);
    expect(SEVERITIES).toEqual(["critical", "high", "medium", "low"]);
    const ranks = SEVERITIES.map((severity) => SEVERITY_RANK[severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
  });

  it("entryStatusOf: 만료가 끄기보다 우선한다", () => {
    expect(entryStatusOf({ enabled: true, isExpired: false })).toBe("active");
    expect(entryStatusOf({ enabled: false, isExpired: false })).toBe("disabled");
    expect(entryStatusOf({ enabled: true, isExpired: true })).toBe("expired");
    expect(entryStatusOf({ enabled: false, isExpired: true })).toBe("expired");
  });

  it("kstDateOf: UTC 15:00 에 KST 날짜가 바뀐다", () => {
    expect(kstDateOf(new Date("2026-11-12T14:59:59.999Z"))).toBe("2026-11-12");
    expect(kstDateOf(new Date("2026-11-12T15:00:00.000Z"))).toBe("2026-11-13");
  });
});

describe("[CT-15] v2 입력 스키마", () => {
  const base = { name: "a-pkg", reason: "x" };

  it("create 는 기본값을 채우고, update 와 settings 입력은 생략한 필드를 넣지 않는다", () => {
    expect(blacklistCreateSchema.parse(base)).toEqual({
      ...base,
      versionRange: null,
      ecosystem: "npm",
      severity: "medium",
      enabled: true,
      expiresAt: null,
    });
    const updated = blacklistUpdateSchema.parse({ ...base, versionRange: null });
    expect(updated.ecosystem).toBeUndefined();
    expect(updated.severity).toBeUndefined();
    expect(updated.enabled).toBeUndefined();
    expect(updated.expiresAt).toBeUndefined();
    const settings = settingsInputSchema.parse({
      org: "my-org",
      scanIntervalHours: 24,
      digestTime: "09:00",
      recipients: [],
    });
    expect(settings.notifyMinSeverity).toBeUndefined();
  });

  it("update 의 expiresAt: null 은 만료 해제로 남는다 (생략과 다르다)", () => {
    const parsed = blacklistUpdateSchema.parse({ ...base, versionRange: null, expiresAt: null });
    expect(parsed.expiresAt).toBeNull();
    expect("expiresAt" in parsed).toBe(true);
  });

  it.each(["@evil/*", "@*/evil", "*-malware", "left-pad*", "ab*"])("패턴 %s 허용", (name) => {
    expect(blacklistCreateSchema.parse({ ...base, name }).name).toBe(name);
  });

  it.each(["*", "@*/*", "a*", "**", "has space*", "evil/*?"])("패턴 %s 거부", (name) => {
    const result = blacklistCreateSchema.safeParse({ ...base, name });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(Object.keys(toDetails(result.error))).toEqual(["name"]);
  });

  it("연속한 * 는 1개로 정규화한다", () => {
    expect(blacklistCreateSchema.parse({ ...base, name: "@evil/**" }).name).toBe("@evil/*");
    expect(blacklistUpdateSchema.parse({ ...base, name: "ab***cd", versionRange: null }).name).toBe(
      "ab*cd",
    );
  });

  it("* 가 없는 이름은 v1 규칙 그대로다", () => {
    expect(blacklistCreateSchema.safeParse({ ...base, name: "@scope" }).success).toBe(false);
    expect(blacklistCreateSchema.parse({ ...base, name: "JSONStream" }).name).toBe("JSONStream");
  });

  it("expiresAt: 빈 문자열 → null, 없는 날짜와 형식 오류 거부", () => {
    expect(blacklistCreateSchema.parse({ ...base, expiresAt: "  " }).expiresAt).toBeNull();
    expect(blacklistCreateSchema.parse({ ...base, expiresAt: " 2027-01-31 " }).expiresAt).toBe(
      "2027-01-31",
    );
    for (const expiresAt of ["2027-13-40", "2027-02-30", "2027/01/31", "2027-1-31", 20270131]) {
      const result = blacklistCreateSchema.safeParse({ ...base, expiresAt });
      expect(result.success).toBe(false);
      if (result.success) continue;
      expect(Object.keys(toDetails(result.error))).toEqual(["expiresAt"]);
    }
  });

  it("ecosystem: 입력은 지원하는 종류만 받는다", () => {
    for (const ecosystem of ["go", "pypi", "maven", "unknown"]) {
      const result = blacklistCreateSchema.safeParse({ ...base, ecosystem });
      expect(result.success).toBe(false);
      if (result.success) continue;
      expect(Object.keys(toDetails(result.error))).toEqual(["ecosystem"]);
    }
  });

  it("severity 와 enabled: enum 밖의 값과 문자열 boolean 거부", () => {
    expect(blacklistCreateSchema.safeParse({ ...base, severity: "urgent" }).success).toBe(false);
    expect(blacklistCreateSchema.safeParse({ ...base, enabled: "false" }).success).toBe(false);
    expect(
      blacklistUpdateSchema.safeParse({ ...base, versionRange: null, enabled: "false" }).success,
    ).toBe(false);
    expect(blacklistCreateSchema.parse({ ...base, severity: "critical", enabled: false })).toMatchObject(
      { severity: "critical", enabled: false },
    );
  });

  it("settings: notifyMinSeverity 는 enum 4개", () => {
    const input = { org: "my-org", scanIntervalHours: 24, digestTime: "09:00", recipients: [] };
    expect(settingsInputSchema.parse({ ...input, notifyMinSeverity: "high" }).notifyMinSeverity).toBe(
      "high",
    );
    expect(settingsInputSchema.safeParse({ ...input, notifyMinSeverity: "none" }).success).toBe(false);
  });

  it("query: 블랙리스트 필터와 검출 필터", () => {
    expect(blacklistQuerySchema.parse({})).toEqual({});
    expect(blacklistQuerySchema.parse({ ecosystem: "go", enabled: "false", q: " Evil " })).toEqual({
      ecosystem: "go",
      enabled: false,
      q: "Evil",
    });
    expect(blacklistQuerySchema.parse({ enabled: true }).enabled).toBe(true);
    expect(blacklistQuerySchema.parse({ enabled: "true", q: "  " })).toEqual({ enabled: true });
    expect(blacklistQuerySchema.safeParse({ enabled: "yes" }).success).toBe(false);
    expect(blacklistQuerySchema.safeParse({ ecosystem: "foo" }).success).toBe(false);

    expect(findingsQuerySchema.parse({ ecosystem: "maven", severity: "high" })).toMatchObject({
      ecosystem: "maven",
      severity: "high",
    });
    expect(findingsQuerySchema.safeParse({ severity: "urgent" }).success).toBe(false);
    expect(findingsQuerySchema.safeParse({ ecosystem: "foo" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------- 스캔의 repo 별 진행 상황

describe("[SP-00] 스캔 집계와 repo 별 기록", () => {
  it("기존 Scan fixture 는 repoStats 가 null 이고, 키를 생략하면 거부한다", () => {
    for (const scan of fx.scans) expect(scan.repoStats).toBeNull();
    const { repoStats: _repoStats, ...withoutStats } = fx.scanSuccess;
    expect(scanSchema.safeParse(withoutStats).success).toBe(false);
  });

  it.each(fx.scansWithStats.map((scan) => [scan.status, scan] as const))(
    "집계가 있는 Scan %s: 상태별 수의 합 = total",
    (_status, scan) => {
      const stats = scanSchema.parse(scan).repoStats;
      expect(stats).not.toBeNull();
      if (!stats) return;
      const { total, ...byStatus } = stats;
      expect(Object.values(byStatus).reduce((sum, value) => sum + value, 0)).toBe(total);
    },
  );

  it.each(fx.scanRepos.map((row) => [row.status, row] as const))("ScanRepo %s", (_status, row) => {
    expect(scanRepoSchema.parse(row)).toEqual(row);
  });

  it("Page<ScanRepo> 와 query 의 기본값·검증", () => {
    expect(scanReposPageSchema.parse(fx.scanReposPage).total).toBe(fx.scanRepos.length);
    expect(scanReposQuerySchema.parse({})).toEqual({ page: 1, limit: 50 });
    expect(scanReposQuerySchema.parse({ status: "failed", q: " Api ", page: "2", limit: "200" })).toEqual({
      status: "failed",
      q: "Api",
      page: 2,
      limit: 200,
    });
    expect(scanReposQuerySchema.safeParse({ status: "done" }).success).toBe(false);
    expect(scanReposQuerySchema.safeParse({ limit: "201" }).success).toBe(false);
  });
});
