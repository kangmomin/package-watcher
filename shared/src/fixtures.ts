// 계약의 표준 예시 데이터. BE·FE 테스트가 함께 쓴다. 운영 번들에는 넣지 않는다(subpath export).
import type {
  ApiError,
  BlacklistEntry,
  Finding,
  Page,
  Scan,
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
  name: "lodash",
  versionRange: "<4.17.21",
  reason: "취약점",
  createdAt: T0,
  updatedAt: T0,
};

export const blacklistEntryAllVersions: BlacklistEntry = {
  id: 2,
  name: "evil-pkg",
  versionRange: null,
  reason: "악성 코드",
  createdAt: T0,
  updatedAt: T0,
};

export const blacklistEntries: BlacklistEntry[] = [blacklistEntryAllVersions, blacklistEntryRanged];

// ---------------------------------------------------------------- Finding

export const findingOpenDirect: Finding = {
  id: 1,
  repo: "api",
  filePath: "package-lock.json",
  packageName: "lodash",
  version: "4.17.20",
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
  packageName: "evil-pkg",
  version: "1.0.0",
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
};

export const scans: Scan[] = [scanRunning, scanSuccess, scanPartial, scanFailed];

// ---------------------------------------------------------------- Summary

export const summaryDefault: Summary = {
  openCount: 12,
  ignoredCount: 3,
  lastScan: scanSuccess,
  nextScanAt: T2,
};

export const summaryEmpty: Summary = {
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
};

export const settingsUnconfigured: Settings = {
  org: null,
  scanIntervalHours: 24,
  digestTime: "09:00",
  digestTimezone: "Asia/Seoul",
  recipients: [],
  githubTokenSource: "none",
  smtpConfigured: false,
};

// ---------------------------------------------------------------- Page / 기타

export function pageOf<T>(items: T[], overrides: Partial<Page<T>> = {}): Page<T> {
  return { items, total: items.length, page: 1, limit: 50, ...overrides };
}

export const findingsPage: Page<Finding> = pageOf(findings);
export const scansPage: Page<Scan> = pageOf(scans, { limit: 20 });
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

export function apiErrorOf(code: ApiError["error"]["code"], message: string): ApiError {
  return { error: { code, message } };
}
