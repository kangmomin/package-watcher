// 계약의 표준 예시 데이터. BE·FE 테스트가 함께 쓴다. 운영 번들에는 넣지 않는다(subpath export).
import type {
  ApiError,
  BlacklistEntry,
  BulkResult,
  ImportResult,
  Finding,
  Page,
  Scan,
  ScanRepo,
  Settings,
  Summary,
  TestEmailResult,
} from "./contract.ts";

const T0 = "2026-11-12T00:00:00.000Z";
const T1 = "2026-11-12T00:05:00.000Z";
const T2 = "2026-11-13T00:00:00.000Z";

// ---------------------------------------------------------------- BlacklistEntry

export const blacklistEntryRanged: BlacklistEntry = {
  id: 1,
  ecosystem: "npm",
  name: "lodash",
  versionRange: "<4.17.21",
  reason: "취약점",
  severity: "medium",
  enabled: true,
  expiresAt: null,
  isExpired: false,
  createdAt: T0,
  updatedAt: T0,
};

export const blacklistEntryAllVersions: BlacklistEntry = {
  id: 2,
  ecosystem: "npm",
  name: "evil-pkg",
  versionRange: null,
  reason: "악성 코드",
  severity: "medium",
  enabled: true,
  expiresAt: null,
  isExpired: false,
  createdAt: T0,
  updatedAt: T0,
};

export const blacklistEntries: BlacklistEntry[] = [blacklistEntryAllVersions, blacklistEntryRanged];

// v2 변형. 기존 묶음(blacklistEntries)에는 넣지 않는다 — v1 화면 테스트가 행을 텍스트로 1개만 찾는다.

export const blacklistEntryDisabled: BlacklistEntry = {
  ...blacklistEntryAllVersions,
  id: 11,
  name: "paused-pkg",
  reason: "일시 중지",
  severity: "low",
  enabled: false,
};

export const blacklistEntryExpired: BlacklistEntry = {
  ...blacklistEntryAllVersions,
  id: 12,
  name: "old-advisory",
  reason: "기한이 지난 권고",
  severity: "high",
  expiresAt: "2026-11-01",
  isExpired: true,
};

/** 꺼짐 + 만료. 상태는 `만료` 다 (만료가 우선). */
export const blacklistEntryDisabledExpired: BlacklistEntry = {
  ...blacklistEntryExpired,
  id: 13,
  name: "stale-pkg",
  reason: "꺼진 뒤 만료",
  enabled: false,
};

export const blacklistEntryPattern: BlacklistEntry = {
  ...blacklistEntryAllVersions,
  id: 14,
  name: "@typosquat/*",
  reason: "악성 scope",
  severity: "critical",
  expiresAt: "2027-12-31",
};

export const blacklistEntryVariants: BlacklistEntry[] = [
  blacklistEntryDisabled,
  blacklistEntryExpired,
  blacklistEntryDisabledExpired,
  blacklistEntryPattern,
];

// ---------------------------------------------------------------- Finding

export const findingOpenDirect: Finding = {
  id: 1,
  repo: "api",
  filePath: "package-lock.json",
  ecosystem: "npm",
  packageName: "lodash",
  version: "4.17.20",
  severity: "medium",
  dependencyType: "direct",
  status: "open",
  blacklistEntryId: 1,
  reason: "취약점",
  htmlUrl: "https://github.com/my-org/api/blob/HEAD/package-lock.json",
  firstSeenAt: T0,
  resolvedAt: null,
  notifiedAt: T1,
};

export const findingOpenTransitive: Finding = {
  id: 2,
  repo: "web-app",
  filePath: "apps/site/pnpm-lock.yaml",
  ecosystem: "npm",
  packageName: "evil-pkg",
  version: "1.0.0",
  severity: "medium",
  dependencyType: "transitive",
  status: "open",
  blacklistEntryId: 2,
  reason: "악성 코드",
  htmlUrl: "https://github.com/my-org/web-app/blob/HEAD/apps/site/pnpm-lock.yaml",
  firstSeenAt: T0,
  resolvedAt: null,
  notifiedAt: null,
};

export const findingIgnored: Finding = {
  ...findingOpenDirect,
  id: 3,
  repo: "legacy",
  status: "ignored",
  htmlUrl: "https://github.com/my-org/legacy/blob/HEAD/package-lock.json",
};

export const findingResolved: Finding = {
  ...findingOpenDirect,
  id: 4,
  repo: "tools",
  status: "resolved",
  htmlUrl: "https://github.com/my-org/tools/blob/HEAD/package-lock.json",
  resolvedAt: T2,
};

/** lockfile 없이 package.json 의 range 로 검출한 경우. version 은 range 문자열이다. */
export const findingRangeVersion: Finding = {
  ...findingOpenDirect,
  id: 5,
  repo: "scripts",
  filePath: "package.json",
  version: "^4.17.0",
  htmlUrl: "https://github.com/my-org/scripts/blob/HEAD/package.json",
  notifiedAt: null,
};

export const findings: Finding[] = [
  findingOpenDirect,
  findingOpenTransitive,
  findingIgnored,
  findingResolved,
  findingRangeVersion,
];

// v2 변형: 심각도별 검출. 기존 묶음(findings)에는 넣지 않는다.

export const findingCritical: Finding = {
  ...findingOpenTransitive,
  id: 11,
  repo: "payments",
  filePath: "yarn.lock",
  packageName: "@typosquat/core",
  version: "0.0.1",
  severity: "critical",
  blacklistEntryId: 14,
  reason: "악성 scope",
  htmlUrl: "https://github.com/my-org/payments/blob/HEAD/yarn.lock",
};

export const findingHigh: Finding = {
  ...findingCritical,
  id: 12,
  repo: "gateway",
  packageName: "old-advisory",
  version: "2.0.0",
  severity: "high",
  blacklistEntryId: 12,
  reason: "기한이 지난 권고",
  htmlUrl: "https://github.com/my-org/gateway/blob/HEAD/yarn.lock",
};

export const findingLow: Finding = {
  ...findingCritical,
  id: 13,
  repo: "docs-site",
  packageName: "paused-pkg",
  version: "3.1.0",
  severity: "low",
  blacklistEntryId: 11,
  reason: "일시 중지",
  htmlUrl: "https://github.com/my-org/docs-site/blob/HEAD/yarn.lock",
};

/** 심각도 높은 순. */
export const findingsBySeverity: Finding[] = [findingCritical, findingHigh, findingLow];

// ---------------------------------------------------------------- Scan

export const scanSuccess: Scan = {
  id: 3,
  trigger: "scheduled",
  status: "success",
  startedAt: T0,
  finishedAt: T1,
  repoCount: 42,
  newFindingCount: 2,
  failedRepos: [],
  error: null,
  repoStats: null,
};

export const scanRunning: Scan = {
  id: 4,
  trigger: "manual",
  status: "running",
  startedAt: T2,
  finishedAt: null,
  repoCount: 0,
  newFindingCount: 0,
  failedRepos: [],
  error: null,
  repoStats: null,
};

export const scanPartial: Scan = {
  id: 2,
  trigger: "scheduled",
  status: "partial",
  startedAt: "2026-11-11T00:00:00.000Z",
  finishedAt: "2026-11-11T00:04:00.000Z",
  repoCount: 42,
  newFindingCount: 0,
  failedRepos: [
    { repo: "big-monorepo", error: "tree 가 너무 커서 일부만 받았습니다" },
    { repo: "broken", error: "package.json 을 파싱할 수 없습니다" },
    { repo: "flaky", error: "GitHub API 오류 (502)" },
  ],
  error: null,
  repoStats: null,
};

export const scanFailed: Scan = {
  id: 1,
  trigger: "manual",
  status: "failed",
  startedAt: "2026-11-10T00:00:00.000Z",
  finishedAt: "2026-11-10T00:00:02.000Z",
  repoCount: 0,
  newFindingCount: 0,
  failedRepos: [],
  error: "org 의 repo 목록을 가져오지 못했습니다 (401)",
  repoStats: null,
};

export const scans: Scan[] = [scanRunning, scanSuccess, scanPartial, scanFailed];

// repo 별 기록이 있는 스캔. 기존 묶음(scans)에는 넣지 않는다 — v1 화면 테스트의 표시를 유지한다.

export const scanRunningWithStats: Scan = {
  ...scanRunning,
  id: 12,
  repoStats: { total: 278, pending: 153, running: 5, passed: 110, issue: 1, failed: 2, skipped: 7 },
};

export const scanPartialWithStats: Scan = {
  ...scanPartial,
  id: 11,
  repoCount: 278,
  failedRepos: [
    { repo: "legacy-theme", error: "theme/package.json 을 JSON 으로 읽을 수 없습니다" },
    { repo: "online-class", error: "pnpm-lock.yaml 을 해석할 수 없습니다" },
  ],
  repoStats: { total: 278, pending: 0, running: 0, passed: 177, issue: 3, failed: 2, skipped: 96 },
};

export const scansWithStats: Scan[] = [scanRunningWithStats, scanPartialWithStats];

// ---------------------------------------------------------------- ScanRepo

const scanRepoBase: ScanRepo = {
  repo: "web-app",
  status: "passed",
  openFindingCount: 0,
  newFindingCount: 0,
  fileCount: 4,
  error: null,
  startedAt: T0,
  finishedAt: T1,
};

export const scanRepoPassed: ScanRepo = scanRepoBase;
export const scanRepoIssue: ScanRepo = {
  ...scanRepoBase,
  repo: "api",
  status: "issue",
  openFindingCount: 3,
  newFindingCount: 1,
  fileCount: 12,
};
export const scanRepoFailed: ScanRepo = {
  ...scanRepoBase,
  repo: "legacy-theme",
  status: "failed",
  fileCount: 0,
  error: "theme/package.json 을 JSON 으로 읽을 수 없습니다",
};
export const scanRepoSkipped: ScanRepo = {
  ...scanRepoBase,
  repo: "infra-docs",
  status: "skipped",
  fileCount: 0,
};
export const scanRepoRunning: ScanRepo = {
  ...scanRepoBase,
  repo: "mobile",
  status: "running",
  fileCount: 0,
  finishedAt: null,
};
export const scanRepoPending: ScanRepo = {
  ...scanRepoBase,
  repo: "tools",
  status: "pending",
  fileCount: 0,
  startedAt: null,
  finishedAt: null,
};

/** API 의 정렬 순서: 실패 → 이슈 → 진행 중 → 대기 → 통과 → 건너뜀. */
export const scanRepos: ScanRepo[] = [
  scanRepoFailed,
  scanRepoIssue,
  scanRepoRunning,
  scanRepoPending,
  scanRepoPassed,
  scanRepoSkipped,
];

// ---------------------------------------------------------------- Summary

export const summaryDefault: Summary = {
  policyOpenCount: 0,
  openCount: 12,
  ignoredCount: 3,
  lastScan: scanSuccess,
  nextScanAt: T2,
};

export const summaryEmpty: Summary = {
  policyOpenCount: 0,
  openCount: 0,
  ignoredCount: 0,
  lastScan: null,
  nextScanAt: null,
};

export const summaryRunning: Summary = { ...summaryDefault, lastScan: scanRunning };

// ---------------------------------------------------------------- Settings

export const settingsDefault: Settings = {
  org: "my-org",
  scanIntervalHours: 24,
  digestTime: "09:00",
  digestTimezone: "Asia/Seoul",
  recipients: ["a@example.com", "b@example.com"],
  githubTokenSource: "env",
  smtpConfigured: true,
  notifyMinSeverity: "low",
};

export const settingsUnconfigured: Settings = {
  org: null,
  scanIntervalHours: 24,
  digestTime: "09:00",
  digestTimezone: "Asia/Seoul",
  recipients: [],
  githubTokenSource: "none",
  smtpConfigured: false,
  notifyMinSeverity: "low",
};

// ---------------------------------------------------------------- Page / 기타

export function pageOf<T>(items: T[], overrides: Partial<Page<T>> = {}): Page<T> {
  return { items, total: items.length, page: 1, limit: 50, ...overrides };
}

export const findingsPage: Page<Finding> = pageOf(findings);
export const scansPage: Page<Scan> = pageOf(scans, { limit: 20 });
export const scanReposPage: Page<ScanRepo> = pageOf(scanRepos);
export const emptyFindingsPage: Page<Finding> = pageOf<Finding>([]);
export const emptyScansPage: Page<Scan> = pageOf<Scan>([], { limit: 20 });

export const testEmailResult: TestEmailResult = { ok: true };

export const apiErrorValidation: ApiError = {
  error: {
    code: "VALIDATION_ERROR",
    message: "입력값을 확인하십시오",
    details: { versionRange: "유효한 semver 범위가 아닙니다" },
  },
};

export const apiErrorNotFound: ApiError = {
  error: { code: "NOT_FOUND", message: "대상을 찾을 수 없습니다" },
};

// ---------------------------------------------------------------- 일괄 관리

export const bulkResultDisable: BulkResult = { action: "disable", count: 2 };

/** 미리 보기: 오류가 없다. */
export const importPreviewClean: ImportResult = {
  applied: false,
  created: 2,
  updated: 1,
  unchanged: 3,
  errors: [],
};

/** 미리 보기: 오류가 있다 ([적용] 을 누를 수 없다). */
export const importPreviewWithErrors: ImportResult = {
  applied: false,
  created: 1,
  updated: 0,
  unchanged: 0,
  errors: [
    { row: 2, field: "versionRange", message: "유효한 semver 범위가 아닙니다" },
    { row: 4, field: null, message: "파일 안에서 중복된 항목입니다 (1행과 같음)" },
  ],
};

export const importApplied: ImportResult = { ...importPreviewClean, applied: true };

export function apiErrorOf(code: ApiError["error"]["code"], message: string): ApiError {
  return { error: { code, message } };
}
