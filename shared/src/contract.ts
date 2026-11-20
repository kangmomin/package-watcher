// Integration Contract v1.3 + v2.2(블랙리스트 규칙 확장) 의 단일 정의.
// BE(응답 생성·입력 검증)와 FE(응답 parse·제출 전 검증)가 같은 스키마를 쓴다.
// 브라우저 번들에 들어가므로 Node 전용 모듈을 import 하지 않는다.
import { z } from "zod";
import { ECOSYSTEM_RULES, normalizeEntryName } from "./ecosystems.ts";

// ---------------------------------------------------------------- enum

export const FINDING_STATUSES = ["open", "resolved", "ignored"] as const;
export const DEPENDENCY_TYPES = ["direct", "transitive"] as const;
export const SCAN_TRIGGERS = ["scheduled", "manual"] as const;
export const SCAN_STATUSES = ["running", "success", "partial", "failed"] as const;
/**
 * 스캔 1회 안에서 repo 1개의 상태.
 * passed = 검사를 끝냈고 open 검출 0건, issue = open 검출 1건 이상, skipped = 검사할 파일이 없음.
 */
export const SCAN_REPO_STATUSES = [
  "pending",
  "running",
  "passed",
  "issue",
  "failed",
  "skipped",
] as const;
export const TOKEN_SOURCES = ["env", "gh", "none"] as const;

/**
 * 스캔 대상의 종류. `org` = 설정한 GitHub org 의 repo, `user` = 토큰으로 로그인한 계정의 repo
 * (계정이 소유한 repo 와 협업자로 초대된 repo — `GET /user/repos?affiliation=owner,collaborator`).
 * `user` 에서 계정이 소유하지 않은 repo 는 검출·스캔 기록의 repo 이름이 `owner/name` 이다(소유한 repo 는 `name`).
 */
export const SCAN_TARGETS = ["org", "user"] as const;
export type ScanTarget = (typeof SCAN_TARGETS)[number];
export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "INVALID_STATE",
  "DUPLICATE_ENTRY",
  "SCAN_RUNNING",
  "ORG_NOT_SET",
  "TOKEN_MISSING",
  "NO_RECIPIENTS",
  "SMTP_NOT_CONFIGURED",
  "SMTP_FAILED",
  "FEED_SYNC_RUNNING",
  "INTERNAL_ERROR",
] as const;

/** 패키지 registry 의 종류. 이름과 버전 범위는 그 registry 의 문법을 쓴다. */
export const PACKAGE_ECOSYSTEMS = [
  "npm",
  "go",
  "pypi",
  "nuget",
  "cargo",
  "pub",
  "maven",
  "rubygems",
  "composer",
  "cocoapods",
] as const;
/** CI 가 실행하는 것: GitHub Action 과 Docker 이미지. 버전은 정확한 값(tag, commit SHA, digest)의 목록이다. */
export const CI_ECOSYSTEMS = ["actions", "docker", "vscode", "helm", "terraform"] as const;
/**
 * 블랙리스트 항목의 종류 전체. 필드 이름은 `ecosystem` 이지만 패키지가 아닌 종류도 들어간다 (화면에는 "종류").
 * DB 는 v4 부터 이 목록을 CHECK 하지 않는다 — 검증은 이 스키마가 한다.
 */
/**
 * 침해의 흔적. 패키지가 아니라 저장소 자체를 본다: 파일 경로, 파일 내용의 문자열, 브랜치 이름.
 * 버전 범위를 쓰지 않는다 (항상 null).
 */
export const INDICATOR_ECOSYSTEMS = ["path", "content", "branch", "commit", "pr"] as const;
/**
 * 위험한 설정의 보고. 항목은 서버가 만드는 내장 검사(`POLICY_CHECKS`)이고 이름 = 검사의 id 다.
 * 사용자는 켬·끔과 심각도만 바꾼다. 추가·삭제·이름 변경은 할 수 없다. 버전 범위를 쓰지 않는다.
 */
export const POLICY_ECOSYSTEM = "policy";
export const ECOSYSTEMS = [
  ...PACKAGE_ECOSYSTEMS,
  ...CI_ECOSYSTEMS,
  ...INDICATOR_ECOSYSTEMS,
  POLICY_ECOSYSTEM,
] as const;
export const ECOSYSTEM_CATEGORIES = ["package", "ci", "indicator", "policy"] as const;
export type EcosystemCategory = (typeof ECOSYSTEM_CATEGORIES)[number];
/** 입력으로 받는 종류. 검사기가 있는 종류만 넣는다 (지금은 전부). */
// 길이가 고정된 tuple 타입으로 내보내지 않는다 — 쓰는 쪽의 `length === 1` 같은 비교가 타입 오류가 된다.
export const SUPPORTED_ECOSYSTEMS: readonly [Ecosystem, ...Ecosystem[]] = ECOSYSTEMS;
/** 높은 순. 화면의 select 순서와 정렬이 이 순서를 쓴다. */
export const SEVERITIES = ["critical", "high", "medium", "low"] as const;

export const ecosystemSchema = z.enum(ECOSYSTEMS);
export const severitySchema = z.enum(SEVERITIES);
export type Ecosystem = z.infer<typeof ecosystemSchema>;
export type Severity = z.infer<typeof severitySchema>;
export type PackageEcosystem = (typeof PACKAGE_ECOSYSTEMS)[number];
export type CiEcosystem = (typeof CI_ECOSYSTEMS)[number];
export type IndicatorEcosystem = (typeof INDICATOR_ECOSYSTEMS)[number];
export const ECOSYSTEM_CATEGORY: Record<Ecosystem, EcosystemCategory> = {
  npm: "package",
  go: "package",
  pypi: "package",
  nuget: "package",
  cargo: "package",
  pub: "package",
  maven: "package",
  rubygems: "package",
  composer: "package",
  cocoapods: "package",
  actions: "ci",
  docker: "ci",
  vscode: "ci",
  helm: "ci",
  terraform: "ci",
  path: "indicator",
  content: "indicator",
  branch: "indicator",
  commit: "indicator",
  pr: "indicator",
  policy: "policy",
};
export const categoryOf = (ecosystem: Ecosystem): EcosystemCategory => ECOSYSTEM_CATEGORY[ecosystem];
/** 이 종류의 항목이 버전 범위를 가질 수 있는가. false 이면 범위는 항상 null 이고 화면은 입력을 숨긴다. */
export const usesVersionRange = (ecosystem: Ecosystem): boolean => {
  const category = categoryOf(ecosystem);
  return category === "package" || category === "ci";
};
export const ecosystemCategorySchema = z.enum(ECOSYSTEM_CATEGORIES);
/** 사용자가 항목을 추가·삭제할 수 있는 종류인가. `policy` 는 서버가 만든다. */
export const isUserManagedEcosystem = (ecosystem: Ecosystem): boolean => ecosystem !== POLICY_ECOSYSTEM;
export const POLICY_CREATE_MESSAGE = "위험한 설정의 검사는 추가할 수 없습니다. 내장 검사의 켬·끔과 심각도만 바꿀 수 있습니다";
export const POLICY_DELETE_MESSAGE = "위험한 설정의 검사는 삭제할 수 없습니다. 끄려면 비활성으로 바꾸십시오";
export const POLICY_RENAME_MESSAGE = "위험한 설정의 검사는 이름을 바꿀 수 없습니다";

/**
 * 내장 검사. 블랙리스트 없이 "위험한 설정"을 보고한다. 서버가 시작할 때 없는 것만 `policy` 항목으로 넣는다.
 * `subject` = 검출의 `packageName` 에 들어가는 것 (화면의 "대상").
 */
export const POLICY_CHECKS = [
  {
    id: "unpinned-action",
    title: "commit SHA 로 고정하지 않은 외부 action",
    description: "tag 와 브랜치는 공격자가 다른 커밋으로 옮길 수 있습니다. 외부 action 은 40자 commit SHA 로 고정하십시오.",
    severity: "medium",
  },
  {
    id: "missing-lockfile",
    title: "lock 파일이 없는 package.json",
    description: "lock 파일이 없으면 설치할 때마다 버전이 달라지고, 악성 버전이 나온 시점에 바로 받습니다.",
    severity: "medium",
  },
  {
    id: "non-registry-dependency",
    title: "registry 밖에서 받는 npm 의존성",
    description: "git·http URL 또는 .tgz 파일의 의존성은 registry 의 검사와 이 도구의 이름 대조를 거치지 않습니다.",
    severity: "medium",
  },
  {
    id: "unpinned-exec",
    title: "버전 없이 실행하는 패키지 (npx, uvx 등)",
    description: "버전이 없으면 실행할 때마다 최신 버전을 받아서 실행합니다. 정확한 버전을 적으십시오.",
    severity: "medium",
  },
  {
    id: "curl-pipe-shell",
    title: "내려받은 script 를 바로 실행 (curl | sh)",
    description: "내려받은 내용을 확인하지 않고 실행합니다. 버전이 고정된 파일을 받고 checksum 을 확인하십시오.",
    severity: "medium",
  },
  {
    id: "workflow-no-permissions",
    title: "permissions 가 없는 workflow",
    description: "permissions 가 없으면 GITHUB_TOKEN 이 저장소의 기본 권한을 가집니다. 필요한 권한만 적으십시오.",
    severity: "low",
  },
  {
    id: "unpinned-image",
    title: "tag 가 없거나 latest 인 Docker 이미지",
    description: "latest 는 빌드할 때마다 다른 이미지가 될 수 있습니다. 버전 tag 또는 digest 로 고정하십시오.",
    severity: "low",
  },
  {
    id: "committed-node-modules",
    title: "커밋된 node_modules",
    description: "커밋된 node_modules 의 패키지는 lock 파일과 다를 수 있고 이 도구가 버전을 읽지 않습니다.",
    severity: "low",
  },
  {
    id: "suspicious-filename",
    title: "제어 문자가 든 파일 이름",
    description: "보이지 않는 문자가 든 파일 이름은 화면에서 다른 파일처럼 보일 수 있습니다.",
    severity: "low",
  },
  {
    id: "workflow-changed",
    title: "최근에 workflow 를 바꾼 커밋",
    description: "CI 를 바꾸는 커밋은 secret 을 훔치는 공격의 첫 단계일 수 있습니다. 의도한 변경인지 확인하십시오. 기간이 지나면 목록에서 사라집니다.",
    severity: "low",
  },
  {
    id: "new-committer",
    title: "기본 브랜치에 처음 커밋한 계정",
    description: "이 저장소의 기본 브랜치에서 처음 본 계정의 커밋입니다. 탈취된 계정이나 외부 계정일 수 있습니다. 기간이 지나면 목록에서 사라집니다.",
    severity: "low",
  },
  {
    id: "install-script",
    title: "설치할 때 실행되는 script (package.json)",
    description: "preinstall·install·postinstall 은 npm install 만으로 실행됩니다. script 가 바뀌면 새 검출로 나옵니다.",
    severity: "low",
  },
  {
    id: "lock-external-source",
    title: "공식 registry 가 아닌 곳에서 받는 lock 항목",
    description: "lock 파일의 resolved 주소가 공식 npm registry 가 아닙니다. 사내 registry 이면 이 검출을 무시로 바꾸십시오.",
    severity: "medium",
  },
  {
    id: "custom-registry",
    title: "registry 설정 (.npmrc, pip 설정)",
    description: "추가 registry(특히 extra-index-url)는 같은 이름의 공개 패키지와 섞일 수 있습니다(dependency confusion). 의도한 설정인지 확인하십시오.",
    severity: "low",
  },
  {
    id: "npmrc-token",
    title: "설정 파일에 적힌 인증 토큰",
    description: ".npmrc 등에 토큰 값이 그대로 적혀 있습니다. 토큰을 폐기하고 환경 변수(${NPM_TOKEN})로 바꾸십시오.",
    severity: "high",
  },
  {
    id: "external-submodule",
    title: "외부 저장소를 가리키는 git submodule",
    description: "submodule 의 URL 이 이 org 의 GitHub 저장소가 아닙니다. 그 저장소가 바뀌면 이 저장소의 빌드도 바뀝니다.",
    severity: "low",
  },
] as const satisfies readonly { id: string; title: string; description: string; severity: Severity }[];
export type PolicyCheckId = (typeof POLICY_CHECKS)[number]["id"];
export const POLICY_CHECK_IDS = POLICY_CHECKS.map((check) => check.id) as readonly PolicyCheckId[];
export const policyCheckOf = (id: string) => POLICY_CHECKS.find((check) => check.id === id);
export const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export const findingStatusSchema = z.enum(FINDING_STATUSES);
export const dependencyTypeSchema = z.enum(DEPENDENCY_TYPES);
export const scanTriggerSchema = z.enum(SCAN_TRIGGERS);
export const scanStatusSchema = z.enum(SCAN_STATUSES);
export const scanRepoStatusSchema = z.enum(SCAN_REPO_STATUSES);
export type ScanRepoStatus = z.infer<typeof scanRepoStatusSchema>;
export const errorCodeSchema = z.enum(ERROR_CODES);

export type FindingStatus = z.infer<typeof findingStatusSchema>;
export type DependencyType = z.infer<typeof dependencyTypeSchema>;
export type ScanTrigger = z.infer<typeof scanTriggerSchema>;
export type ScanStatus = z.infer<typeof scanStatusSchema>;
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** HTTP status 는 코드마다 1개로 고정한다 (Error Contract). */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  DUPLICATE_ENTRY: 409,
  SCAN_RUNNING: 409,
  ORG_NOT_SET: 400,
  TOKEN_MISSING: 400,
  NO_RECIPIENTS: 400,
  SMTP_NOT_CONFIGURED: 400,
  SMTP_FAILED: 502,
  FEED_SYNC_RUNNING: 409,
  INTERNAL_ERROR: 500,
};

// ---------------------------------------------------------------- 공통 값

export const DIGEST_TIMEZONE = "Asia/Seoul";
export const FINDINGS_DEFAULT_LIMIT = 50;
export const FINDINGS_MAX_LIMIT = 200;
export const SCAN_REPOS_DEFAULT_LIMIT = 50;
export const SCAN_REPOS_MAX_LIMIT = 200;
export const SCANS_DEFAULT_LIMIT = 20;
export const SCANS_MAX_LIMIT = 100;

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** ISO 8601 UTC, 밀리초 3자리 (`Date#toISOString` 형식). */
export const isoDateSchema = z.string().regex(ISO_UTC, "ISO 8601 UTC 형식이 아닙니다");
const idSchema = z.number().int().positive();

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** 실제로 있는 달력 날짜 `YYYY-MM-DD` 인가 (`2027-02-30` 은 false). */
export function isCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
/** KST 달력 날짜. 시각 필드(ISO 8601 UTC)와 다른 형식이다. */
export const calendarDateSchema = z
  .string()
  .refine(isCalendarDate, "YYYY-MM-DD 형식의 날짜가 아닙니다");

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
/** 그 시각의 KST 달력 날짜 `YYYY-MM-DD`. 만료 판정과 화면의 `min` 이 같은 함수를 쓴다. */
export function kstDateOf(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}
const countSchema = z.number().int().nonnegative();

// ---------------------------------------------------------------- 응답

/** 기본 브랜치의 검출은 `ref` 가 빈 문자열이다. */
export const DEFAULT_BRANCH_REF = "";
export const BRANCH_SCAN_DAYS_MAX = 30;
export const BRANCH_SCAN_DAYS_DEFAULT = 7;
/** 스캔 1회에서 repo 1개가 평가하는 브랜치(기본 브랜치 제외)의 최대 수. */
export const BRANCH_SCAN_MAX_BRANCHES = 20;

/**
 * 항목의 출처. 스캔에서 외부 목록(GitHub Advisory)이 일치했을 때 서버가 만든 항목은 `feed`(악성 패키지) 또는 `cve`(일반 취약점)다.
 * 사용자가 만든 항목과 같은 방법으로 끄고, 고치고, 지울 수 있다.
 */
export const ENTRY_SOURCES = ["manual", "feed", "cve"] as const;
export const entrySourceSchema = z.enum(ENTRY_SOURCES);
export type EntrySource = z.infer<typeof entrySourceSchema>;
/** 취약점(일반 CVE)의 출처. 이 출처의 검출은 "검출"과 따로 세고, 즉시 메일을 보내지 않는다. */
export const CVE_SOURCE = "cve" satisfies EntrySource;

/** 취약점을 대조하는 CVSS 점수의 기준. 0 = 대조하지 않는다. */
export const CVE_MIN_SCORE_OFF = 0;
export const CVE_MIN_SCORE_MIN = 4;
export const CVE_MIN_SCORE_MAX = 10;
export const CVE_MIN_SCORE_DEFAULT = 8;
/** 점수가 없는 권고는 GitHub 의 등급이 이 값일 때만 대조한다. */
export const CVE_UNSCORED_SEVERITY = "critical" satisfies Severity;
const CVE_MIN_SCORE_MESSAGE = `취약점의 기준 점수는 0(끔) 또는 ${CVE_MIN_SCORE_MIN}~${CVE_MIN_SCORE_MAX} 사이의 값입니다 (소수 1자리까지)`;
const isCveMinScore = (value: number): boolean =>
  (value === CVE_MIN_SCORE_OFF || (value >= CVE_MIN_SCORE_MIN && value <= CVE_MIN_SCORE_MAX)) &&
  Math.abs(value * 10 - Math.round(value * 10)) < 1e-9;
const cvssScoreSchema = z.number().min(0).max(10);

/** 권고 1건이 그 기준에서 대조 대상인가. 점수가 없으면 등급으로 판단한다. */
export function cveMeetsMinScore(score: number | null, severity: Severity, minScore: number): boolean {
  if (minScore <= CVE_MIN_SCORE_OFF) return false;
  return score === null ? severity === CVE_UNSCORED_SEVERITY : score >= minScore;
}

export const findingSchema = z.object({
  id: idSchema,
  repo: z.string().min(1),
  /** 검출한 브랜치. 기본 브랜치는 `""`, 그 외는 브랜치 이름. */
  ref: z.string(),
  filePath: z.string().min(1),
  ecosystem: ecosystemSchema,
  packageName: z.string().min(1),
  version: z.string(),
  /** 항목을 PUT 하면 활성 검출의 값도 바뀐다 (reason 과 같다). */
  severity: severitySchema,
  dependencyType: dependencyTypeSchema,
  status: findingStatusSchema,
  blacklistEntryId: idSchema,
  /** 일치한 항목의 출처. `cve` = 취약점. */
  source: entrySourceSchema,
  reason: z.string(),
  htmlUrl: z.string().min(1),
  firstSeenAt: isoDateSchema,
  resolvedAt: isoDateSchema.nullable(),
  notifiedAt: isoDateSchema.nullable(),
});
export type Finding = z.infer<typeof findingSchema>;

export const blacklistEntrySchema = z.object({
  id: idSchema,
  source: entrySourceSchema,
  /** 외부 목록의 id (`GHSA-…`). 사용자가 만든 항목은 null. */
  externalId: z.string().min(1).nullable(),
  ecosystem: ecosystemSchema,
  name: z.string().min(1),
  versionRange: z.string().min(1).nullable(),
  reason: z.string().min(1),
  severity: severitySchema,
  /** 사용자가 정한 값. 만료 여부는 `isExpired` 다. */
  enabled: z.boolean(),
  expiresAt: calendarDateSchema.nullable(),
  /** 서버가 KST 로 계산한다. 만료일 다음 날 00:00(KST)부터 true. */
  isExpired: z.boolean(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type BlacklistEntry = z.infer<typeof blacklistEntrySchema>;

export const ENTRY_STATUSES = ["active", "disabled", "expired"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];
/** 항목의 상태 1개. 만료가 끄기보다 우선한다. */
export function entryStatusOf(entry: Pick<BlacklistEntry, "enabled" | "isExpired">): EntryStatus {
  if (entry.isExpired) return "expired";
  return entry.enabled ? "active" : "disabled";
}

export const blacklistListSchema = z.object({ items: z.array(blacklistEntrySchema) });
export type BlacklistList = z.infer<typeof blacklistListSchema>;

export const failedRepoSchema = z.object({ repo: z.string(), error: z.string() });
export type FailedRepo = z.infer<typeof failedRepoSchema>;

/** repo 상태별 수. 6개 상태의 합 = total. */
export const scanRepoStatsSchema = z.object({
  total: countSchema,
  pending: countSchema,
  running: countSchema,
  passed: countSchema,
  issue: countSchema,
  failed: countSchema,
  skipped: countSchema,
});
export type ScanRepoStats = z.infer<typeof scanRepoStatsSchema>;

export const scanSchema = z.object({
  id: idSchema,
  trigger: scanTriggerSchema,
  status: scanStatusSchema,
  startedAt: isoDateSchema,
  finishedAt: isoDateSchema.nullable(),
  repoCount: countSchema,
  newFindingCount: countSchema,
  failedRepos: z.array(failedRepoSchema),
  error: z.string().nullable(),
  /** repo 별 기록이 없는 스캔(이 기능 이전의 스캔, repo 목록 조회에 실패한 스캔)은 null. */
  repoStats: scanRepoStatsSchema.nullable(),
});
export type Scan = z.infer<typeof scanSchema>;

export const scanRepoSchema = z.object({
  repo: z.string().min(1),
  status: scanRepoStatusSchema,
  /** 스캔 종료 시점의 그 repo 의 open 검출 수. */
  openFindingCount: countSchema,
  /** 이 스캔이 새로 만든 검출 수. */
  newFindingCount: countSchema,
  /** 읽은 파일 수. */
  fileCount: countSchema,
  /** 기본 브랜치 외에 평가한 브랜치의 수. */
  branchCount: countSchema,
  /** failed 일 때의 원인. */
  error: z.string().nullable(),
  startedAt: isoDateSchema.nullable(),
  finishedAt: isoDateSchema.nullable(),
});
export type ScanRepo = z.infer<typeof scanRepoSchema>;

export const summarySchema = z.object({
  /** open 검출의 수. `policy`(위험한 설정)와 취약점(`source = cve`)은 세지 않는다 — 아래의 두 값이 따로 센다. */
  openCount: countSchema,
  policyOpenCount: countSchema,
  /** 취약점(`source = cve`)의 open 검출의 수. */
  cveOpenCount: countSchema,
  ignoredCount: countSchema,
  lastScan: scanSchema.nullable(),
  nextScanAt: isoDateSchema.nullable(),
});
export type Summary = z.infer<typeof summarySchema>;

const DIGEST_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const settingsSchema = z.object({
  /** 스캔 대상의 종류. `user` 이면 `org` 는 쓰지 않는다(저장된 값은 남는다). */
  scanTarget: z.enum(SCAN_TARGETS),
  org: z.string().min(1).nullable(),
  /** `scanTarget = user` 의 마지막 스캔이 확인한 로그인 계정. 확인 전이면 null */
  accountLogin: z.string().min(1).nullable(),
  scanIntervalHours: z.number().int().min(1).max(168),
  digestTime: z.string().regex(DIGEST_TIME),
  digestTimezone: z.literal(DIGEST_TIMEZONE),
  recipients: z.array(z.string()),
  githubTokenSource: z.enum(TOKEN_SOURCES),
  smtpConfigured: z.boolean(),
  /** 즉시 메일의 최소 심각도. 이보다 낮은 검출은 일일 요약에만 들어간다. */
  notifyMinSeverity: severitySchema,
  /** 외부 목록(feed)을 동기화하고 스캔의 대조에 쓰는가. */
  feedEnabled: z.boolean(),
  /** 기본 브랜치 외에, 최근 이 일수 안에 커밋이 있는 브랜치도 스캔한다. 0 = 기본 브랜치만. */
  branchScanDays: z.number().int().min(0).max(BRANCH_SCAN_DAYS_MAX),
  /** 취약점을 대조하는 CVSS 점수의 기준. 0 = 대조하지 않는다. `feedEnabled` 가 false 이면 쓰지 않는다. */
  cveMinScore: z.number().refine(isCveMinScore),
});
export type Settings = z.infer<typeof settingsSchema>;

// ---------------------------------------------------------------- 외부 목록 (feed)

export const FEED_ENTRIES_DEFAULT_LIMIT = 50;
export const FEED_ENTRIES_MAX_LIMIT = 200;

/** 외부 목록의 분류. `malware` = 악성 패키지, `cve` = 일반 취약점. */
export const FEED_KINDS = ["malware", "cve"] as const;
export const feedKindSchema = z.enum(FEED_KINDS);
export type FeedKind = z.infer<typeof feedKindSchema>;
/** 외부 목록의 분류 → 일치했을 때 만드는 항목의 출처. */
export const FEED_KIND_SOURCE: Readonly<Record<FeedKind, EntrySource>> = { malware: "feed", cve: "cve" };

/** 외부 목록의 항목 1개 = 권고 1건의 (패키지, 범위) 1개. 블랙리스트 목록에는 나오지 않는다. */
export const feedEntrySchema = z.object({
  kind: feedKindSchema,
  /** CVSS 점수 (v3 과 v4 중 큰 값). 없으면 null. `malware` 는 항상 null. */
  cvssScore: cvssScoreSchema.nullable(),
  /** 이 범위를 고친 첫 버전. 없거나 `malware` 이면 null. */
  patchedVersion: z.string().min(1).nullable(),
  /** `GHSA-xxxx-xxxx-xxxx` */
  externalId: z.string().min(1),
  ecosystem: ecosystemSchema,
  name: z.string().min(1),
  /** 이 도구의 종류별 문법으로 바꾼 범위. null = 모든 버전. */
  versionRange: z.string().min(1).nullable(),
  /** 출처의 원문 (예: `= 1.5.1`, `>= 0`). */
  rawRange: z.string(),
  severity: severitySchema,
  summary: z.string(),
  url: z.string().min(1),
  updatedAt: isoDateSchema,
});
export type FeedEntry = z.infer<typeof feedEntrySchema>;

/** 분류 1개의 동기화 상태. */
export const feedKindStatusSchema = z.object({
  entryCount: countSchema,
  skippedCount: countSchema,
  lastSyncedAt: isoDateSchema.nullable(),
  fullSyncDone: z.boolean(),
  lastError: z.string().nullable(),
});
export type FeedKindStatus = z.infer<typeof feedKindStatusSchema>;

/** 맨 위의 값은 두 분류의 합이다: 수는 더하고, `fullSyncDone` 은 켜진 분류가 모두 끝났을 때 true, `lastError` 는 먼저 있는 것. */
export const feedStatusSchema = z.object({
  enabled: z.boolean(),
  /** 분류별 상태. `cve` 는 기준 점수와 상관없이 저장된 수다. */
  byKind: z.object({ malware: feedKindStatusSchema, cve: feedKindStatusSchema }),
  /** 저장된 항목의 수 (대조에 쓰는 것). */
  entryCount: countSchema,
  /** 종류별 수. 0건인 종류는 생략할 수 있다. */
  byEcosystem: z.record(z.string(), countSchema),
  /** 범위를 바꿀 수 없거나 지원하지 않는 종류라서 건너뛴 항목의 수 (마지막 전체 동기화 기준). */
  skippedCount: countSchema,
  /** 마지막으로 성공한 동기화의 시각. 한 번도 없으면 null. */
  lastSyncedAt: isoDateSchema.nullable(),
  /** 첫 전체 동기화가 끝났는가. false 이면 목록이 아직 일부다. */
  fullSyncDone: z.boolean(),
  syncing: z.boolean(),
  /** 진행 중인 동기화가 지금까지 받은 항목의 수. 진행 중이 아니면 0. */
  syncedSoFar: countSchema,
  /** 마지막 동기화의 오류. 성공했으면 null. */
  lastError: z.string().nullable(),
});
export type FeedStatus = z.infer<typeof feedStatusSchema>;


export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    total: countSchema,
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
  });
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
export const findingsPageSchema = pageSchema(findingSchema);
export const scansPageSchema = pageSchema(scanSchema);
export const scanReposPageSchema = pageSchema(scanRepoSchema);
export const feedEntriesPageSchema = pageSchema(feedEntrySchema);

// ---------------------------------------------------------------- 취약점 (패키지별 묶음)

export const VULNERABILITIES_DEFAULT_LIMIT = 50;
export const VULNERABILITIES_MAX_LIMIT = 200;
/** 상세의 검출 목록의 최대 수. 넘으면 `findingsTotal` 로 전체 수를 알린다. */
export const VULNERABILITY_DETAIL_MAX_FINDINGS = 500;
export const VULNERABILITY_MAX_PATCHED_VERSIONS = 10;

/** 취약점의 open 검출을 (종류, 패키지)로 묶은 1줄. 정렬: 최고 점수(없으면 뒤) → repo 수 → 이름. */
export const vulnerabilityGroupSchema = z.object({
  ecosystem: ecosystemSchema,
  packageName: z.string().min(1),
  /** 일치한 권고들의 가장 높은 CVSS 점수. 모두 점수가 없으면 null. */
  maxScore: cvssScoreSchema.nullable(),
  /** 일치한 권고들의 가장 높은 심각도. */
  severity: severitySchema,
  advisoryCount: countSchema,
  repoCount: countSchema,
  findingCount: countSchema,
  /** 직접 의존성인 검출이 1건 이상 있는가. */
  hasDirect: z.boolean(),
  /** 일치한 권고들의 "고쳐진 버전" (중복 없음, 최대 10개). 이 값들 중 가장 높은 버전 이상으로 올리면 된다. */
  patchedVersions: z.array(z.string().min(1)).max(VULNERABILITY_MAX_PATCHED_VERSIONS),
});
export type VulnerabilityGroup = z.infer<typeof vulnerabilityGroupSchema>;
export const vulnerabilitiesPageSchema = pageSchema(vulnerabilityGroupSchema);

export const vulnerabilityAdvisorySchema = z.object({
  /** 이 권고의 블랙리스트 항목(`source = cve`). 끄면 이 권고를 org 전체에서 대조하지 않는다. */
  blacklistEntryId: idSchema,
  externalId: z.string().min(1),
  cvssScore: cvssScoreSchema.nullable(),
  severity: severitySchema,
  summary: z.string(),
  url: z.string().min(1),
  versionRange: z.string().min(1).nullable(),
  patchedVersion: z.string().min(1).nullable(),
  findingCount: countSchema,
});
export type VulnerabilityAdvisory = z.infer<typeof vulnerabilityAdvisorySchema>;

/** 패키지 1개의 상세: 일치한 권고(점수 내림차순)와 open 검출(repo, 파일 순). */
export const vulnerabilityDetailSchema = z.object({
  ecosystem: ecosystemSchema,
  packageName: z.string().min(1),
  advisories: z.array(vulnerabilityAdvisorySchema),
  findings: z.array(findingSchema).max(VULNERABILITY_DETAIL_MAX_FINDINGS),
  findingsTotal: countSchema,
});
export type VulnerabilityDetail = z.infer<typeof vulnerabilityDetailSchema>;

export const testEmailResultSchema = z.object({ ok: z.literal(true) });
export type TestEmailResult = z.infer<typeof testEmailResultSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string().min(1),
    details: z.record(z.string(), z.string()).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

// ---------------------------------------------------------------- 요청

/** 이름에 `*` 가 있으면 패턴이다. `*` 는 `/` 를 포함한 임의의 문자열과 일치한다. (`content` 는 `*` 를 받지 않는다.) */
export function isNamePattern(name: string): boolean {
  return name.includes("*");
}

/** 모든 종류의 공통 상한. 종류마다 더 짧은 상한(npm 214자 등)은 종류별 규칙이 검사한다. */
const NAME_MAX_LENGTH = 255;

// 이름의 모양과 범위의 문법은 종류를 알아야 하므로 객체 단위 검증(`entryRules`)이 한다.
const nameSchema = z
  .string({ error: "패키지 이름을 입력하십시오" })
  .trim()
  .min(1, "패키지 이름을 입력하십시오")
  .max(NAME_MAX_LENGTH, `패키지 이름은 ${NAME_MAX_LENGTH}자 이하입니다`)
  // 연속한 `*` 는 뜻이 같으므로 1개로 저장한다 (중복 키 비교가 문자열 비교다).
  .transform((value) => value.replace(/\*{2,}/g, "*"));

/** trim 후 빈 문자열과 null 은 "모든 버전"(null) 이다. */
const versionRangeSchema = z
  .union([z.string(), z.null()], { error: "버전 범위는 문자열 또는 null 입니다" })
  .transform((value) => {
    const trimmed = value?.trim() ?? "";
    return trimmed === "" ? null : trimmed;
  });

const reasonSchema = z
  .string({ error: "사유를 입력하십시오" })
  .trim()
  .min(1, "사유를 입력하십시오")
  .max(500, "사유는 500자 이하입니다");

const ecosystemInputSchema = z.enum(ECOSYSTEMS, { error: "지원하지 않는 종류입니다" });
const severityInputSchema = z.enum(SEVERITIES, {
  error: "심각도는 critical, high, medium, low 중 하나입니다",
});
// 문자열 "false" 를 true 로 읽지 않도록 boolean 만 받는다.
const enabledInputSchema = z.boolean({ error: "enabled 는 true 또는 false 입니다" });

/** trim 후 빈 문자열과 null 은 "만료 없음"(null) 이다. 과거 날짜 검사는 서버가 한다 (시계가 필요하다). */
const expiresAtSchema = z
  .union([z.string(), z.null()], { error: "만료일은 YYYY-MM-DD 형식의 문자열 또는 null 입니다" })
  .transform((value) => {
    const trimmed = value?.trim() ?? "";
    return trimmed === "" ? null : trimmed;
  })
  .refine((value) => value === null || isCalendarDate(value), {
    message: "만료일은 YYYY-MM-DD 형식의 실제 날짜입니다",
  });

const isEcosystem = (value: unknown): value is Ecosystem =>
  (ECOSYSTEMS as readonly unknown[]).includes(value);

/**
 * 이름과 범위를 그 종류의 규칙으로 검증한다. 오류의 path 를 필드로 지정한다 (`toDetails` 는 path 없는 오류를 버린다).
 * `when` 으로 항상 실행한다 — 기본 동작은 다른 필드(예: severity)의 타입 오류가 있으면 건너뛰어서
 * 한 번의 응답에 이름·범위의 오류가 빠진다. 그래서 값의 타입을 직접 확인한다.
 */
const entryRules = z.superRefine<{ name?: unknown; versionRange?: unknown; ecosystem?: unknown }>(
  (data, ctx) => {
    // 종류가 없으면(PUT 의 생략) 서버가 저장된 종류와 병합한 뒤 `validateEntryFields` 로 검증한다.
    if (!isEcosystem(data.ecosystem)) return;
    // 비었거나 너무 긴 이름은 필드 스키마가 이미 오류를 냈다.
    const name =
      typeof data.name === "string" && data.name !== "" && data.name.length <= NAME_MAX_LENGTH
        ? data.name
        : null;
    const range = typeof data.versionRange === "string" ? data.versionRange : null;
    const rule = ECOSYSTEM_RULES[data.ecosystem];
    const nameError = name === null ? null : rule.validateName(name);
    const rangeError = range === null ? null : rule.validateRange(range);
    if (nameError !== null) ctx.addIssue({ code: "custom", message: nameError, path: ["name"] });
    if (rangeError !== null) {
      ctx.addIssue({ code: "custom", message: rangeError, path: ["versionRange"] });
    }
  },
  { when: () => true },
);

/** 검증을 통과한 이름을 그 종류의 저장 형태로 바꾼다 (pypi, nuget). 종류가 없으면 그대로 둔다. */
function normalizeEntry<T extends { name: string; ecosystem?: Ecosystem | undefined }>(data: T): T {
  if (data.ecosystem === undefined) return data;
  return { ...data, name: normalizeEntryName(data.ecosystem, data.name) };
}

/** POST /api/blacklist — 생략한 필드는 기본값을 쓴다. 기본값은 이 스키마만 채운다. */
export const blacklistCreateSchema = z
  .object({
    name: nameSchema,
    versionRange: versionRangeSchema.optional().transform((value) => value ?? null),
    reason: reasonSchema,
    ecosystem: ecosystemInputSchema.default("npm"),
    severity: severityInputSchema.default("medium"),
    enabled: enabledInputSchema.default(true),
    expiresAt: expiresAtSchema.optional().transform((value) => value ?? null),
  })
  .check(entryRules)
  .transform(normalizeEntry);
/**
 * PUT /api/blacklist/:id — name·versionRange·reason 은 전체 교체 (versionRange 키 필수, A-12).
 * 새 필드 4개는 생략하면 undefined 이고 서버가 저장된 값을 유지한다 (v1 클라이언트 호환).
 * `expiresAt: null` 은 만료 해제다.
 * `ecosystem` 이 있으면 create 와 같은 검증·정규화를 하고, 없으면 종류별 검증을 건너뛴다.
 */
export const blacklistUpdateSchema = z
  .object({
    name: nameSchema,
    versionRange: versionRangeSchema,
    reason: reasonSchema,
    ecosystem: ecosystemInputSchema.optional(),
    severity: severityInputSchema.optional(),
    enabled: enabledInputSchema.optional(),
    expiresAt: expiresAtSchema.optional(),
  })
  .check(entryRules)
  .transform(normalizeEntry);
/** 검증을 통과한 생성·수정 입력. 새 필드 4개는 수정에서 생략할 수 있다. */
export interface BlacklistInput {
  name: string;
  versionRange: string | null;
  reason: string;
  ecosystem?: Ecosystem;
  severity?: Severity;
  enabled?: boolean;
  expiresAt?: string | null;
}
/** 기본값을 채운 생성 입력. */
export type BlacklistCreateData = z.infer<typeof blacklistCreateSchema>;

export const findingStatusInputSchema = z.object({
  status: z.enum(["ignored", "open"], { error: "status 는 ignored 또는 open 입니다" }),
});
export type FindingStatusInput = z.infer<typeof findingStatusInputSchema>;

// GitHub org: 영숫자·하이픈 1~39자, 하이픈으로 시작·끝 불가, 연속 하이픈 불가. 소문자로 정규화한다.
const ORG = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const orgSchema = z
  .string({ error: "GitHub org 를 입력하십시오" })
  .trim()
  .toLowerCase()
  .min(1, "GitHub org 를 입력하십시오")
  .regex(ORG, "GitHub org 이름 형식이 아닙니다");

export const scanIntervalHoursSchema = z
  .number({ error: "스캔 interval 은 1~168 사이의 정수입니다" })
  .int("스캔 interval 은 1~168 사이의 정수입니다")
  .min(1, "스캔 interval 은 1~168 사이의 정수입니다")
  .max(168, "스캔 interval 은 1~168 사이의 정수입니다");

export const digestTimeSchema = z
  .string({ error: "요약 시각은 HH:mm 형식입니다" })
  .regex(DIGEST_TIME, "요약 시각은 HH:mm 형식입니다");

/** trim → 중복 제거. 형식 오류는 원소가 아니라 `recipients` 키 1개로 합친다. */
export const recipientsSchema = z
  .array(z.string(), { error: "수신자는 이메일 주소의 배열입니다" })
  .transform((values) => [...new Set(values.map((value) => value.trim()))])
  .superRefine((values, ctx) => {
    const invalid = values.filter((value) => !EMAIL.test(value));
    if (invalid.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `이메일 형식이 아닙니다: ${invalid.join(", ")}`,
      });
    }
  });

/** 빈 문자열(공백만 포함)은 org 를 넣지 않은 것(null)으로 본다. */
const orgInputSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  orgSchema.nullable(),
);

export const scanTargetSchema = z.enum(SCAN_TARGETS, { error: "scanTarget 은 org 또는 user 입니다" });

export const settingsInputSchema = z.object({
  /** 생략하면 저장된 값을 유지한다(v1 클라이언트 호환). */
  scanTarget: scanTargetSchema.optional(),
  /** `scanTarget = user` 이면 생략·null 가능(저장된 org 를 유지한다). 그 외에는 필수. */
  org: orgInputSchema.optional(),
  scanIntervalHours: scanIntervalHoursSchema,
  digestTime: digestTimeSchema,
  recipients: recipientsSchema,
  /** 생략하면 저장된 값을 유지한다. */
  notifyMinSeverity: severityInputSchema.optional(),
  /** 생략하면 저장된 값을 유지한다. */
  feedEnabled: z.boolean({ error: "feedEnabled 는 true 또는 false 입니다" }).optional(),
  /** 생략하면 저장된 값을 유지한다. */
  branchScanDays: z
    .number({ error: `브랜치 스캔 기간은 0~${BRANCH_SCAN_DAYS_MAX} 사이의 정수입니다` })
    .int(`브랜치 스캔 기간은 0~${BRANCH_SCAN_DAYS_MAX} 사이의 정수입니다`)
    .min(0, `브랜치 스캔 기간은 0~${BRANCH_SCAN_DAYS_MAX} 사이의 정수입니다`)
    .max(BRANCH_SCAN_DAYS_MAX, `브랜치 스캔 기간은 0~${BRANCH_SCAN_DAYS_MAX} 사이의 정수입니다`)
    .optional(),
  /** 생략하면 저장된 값을 유지한다. */
  cveMinScore: z.number({ error: CVE_MIN_SCORE_MESSAGE }).refine(isCveMinScore, CVE_MIN_SCORE_MESSAGE).optional(),
}).superRefine((value, ctx) => {
  // 대상이 user 가 아니면(생략 포함) org 가 필요하다. 생략한 대상이 저장된 user 이어도 org 를 요구한다(v1 과 같은 규칙).
  if (value.scanTarget !== "user" && (value.org === undefined || value.org === null)) {
    ctx.addIssue({ code: "custom", path: ["org"], message: "GitHub org 를 입력하십시오" });
  }
});
export type SettingsInput = z.infer<typeof settingsInputSchema>;

/** query string 값은 문자열이므로 숫자는 변환한다. 범위 밖은 clamp 하지 않고 거부한다. */
const pageParam = z.coerce
  .number({ error: "page 는 1 이상의 정수입니다" })
  .int("page 는 1 이상의 정수입니다")
  .min(1, "page 는 1 이상의 정수입니다");
const limitParam = (max: number) =>
  z.coerce
    .number({ error: `limit 는 1~${max} 사이의 정수입니다` })
    .int(`limit 는 1~${max} 사이의 정수입니다`)
    .min(1, `limit 는 1~${max} 사이의 정수입니다`)
    .max(max, `limit 는 1~${max} 사이의 정수입니다`);
/** trim 후 빈 문자열은 생략과 같다. */
const textFilter = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim() ?? "";
    return trimmed === "" ? undefined : trimmed;
  });

export const findingsQuerySchema = z.object({
  status: findingStatusSchema.optional(),
  repo: textFilter,
  package: textFilter,
  /** 정확히 일치하는 값만 반환한다 ("이상" 이 아니다). */
  ecosystem: ecosystemSchema.optional(),
  /** 그 분류의 검출만. */
  category: ecosystemCategorySchema.optional(),
  /** 그 분류를 뺀 검출. 화면의 "검출" 탭이 `policy` 를 뺄 때 쓴다. */
  excludeCategory: ecosystemCategorySchema.optional(),
  /** 그 출처의 항목이 만든 검출만. */
  source: entrySourceSchema.optional(),
  /** 그 출처를 뺀 검출. 화면의 "검출" 탭이 `cve` 를 뺄 때 쓴다. */
  excludeSource: entrySourceSchema.optional(),
  severity: severitySchema.optional(),
  page: pageParam.default(1),
  limit: limitParam(FINDINGS_MAX_LIMIT).default(FINDINGS_DEFAULT_LIMIT),
});
export type FindingsQuery = z.infer<typeof findingsQuerySchema>;

/** query string 은 문자열 "true"/"false", MCP 는 JSON boolean 을 보낸다. */
const booleanParam = z
  .union([z.boolean(), z.enum(["true", "false"])], { error: "enabled 는 true 또는 false 입니다" })
  .transform((value) => value === true || value === "true");

export const blacklistQuerySchema = z.object({
  ecosystem: ecosystemSchema.optional(),
  /** 사용자가 정한 값으로 거른다. `true` 에는 만료된 항목도 들어간다. */
  enabled: booleanParam.optional(),
  /** 이름의 대소문자 무시 부분 일치. */
  q: textFilter,
  /** 화면의 상태(켬·끔·만료)와 같은 뜻이다. 만료가 끔보다 우선한다. */
  status: z.enum(ENTRY_STATUSES).optional(),
  /** 출처. `feed` = 외부 목록의 악성 패키지가 만든 항목만, `cve` = 취약점이 만든 항목만. */
  source: entrySourceSchema.optional(),
  /** 그 출처를 뺀 항목. 화면의 기본 보기가 `cve` 를 뺄 때 쓴다. */
  excludeSource: entrySourceSchema.optional(),
});
export type BlacklistQuery = z.infer<typeof blacklistQuerySchema>;

export const feedEntriesQuerySchema = z.object({
  kind: feedKindSchema.optional(),
  ecosystem: ecosystemSchema.optional(),
  /** 이름 또는 id(`GHSA-…`)의 대소문자 무시 부분 일치. */
  q: textFilter,
  page: pageParam.default(1),
  limit: limitParam(FEED_ENTRIES_MAX_LIMIT).default(FEED_ENTRIES_DEFAULT_LIMIT),
});
export type FeedEntriesQuery = z.infer<typeof feedEntriesQuerySchema>;

export const vulnerabilitiesQuerySchema = z.object({
  ecosystem: ecosystemSchema.optional(),
  /** 패키지 이름의 대소문자 무시 부분 일치. */
  q: textFilter,
  /** true 이면 직접 의존성인 검출이 있는 패키지만. */
  directOnly: booleanParam.optional(),
  page: pageParam.default(1),
  limit: limitParam(VULNERABILITIES_MAX_LIMIT).default(VULNERABILITIES_DEFAULT_LIMIT),
});
export type VulnerabilitiesQuery = z.infer<typeof vulnerabilitiesQuerySchema>;

/** 패키지 이름에 `/` 가 있어서(`@scope/pkg`, go module) 경로가 아니라 query 로 받는다. */
export const vulnerabilityDetailQuerySchema = z.object({
  ecosystem: ecosystemSchema,
  name: z.string().trim().min(1, "name 이 필요합니다").max(255),
});
export type VulnerabilityDetailQuery = z.infer<typeof vulnerabilityDetailQuerySchema>;

// ---------------------------------------------------------------- 일괄 관리 (bulk, import, export)

export const BULK_ACTIONS = ["enable", "disable", "delete"] as const;
export const BULK_MAX_IDS = 1000;
export const BLACKLIST_FILE_FORMATS = ["json", "csv"] as const;
export const BLACKLIST_FILE_VERSION = 1;
/** CSV 의 머리글이자 JSON 항목의 키. 가져오기와 내보내기가 같은 형식을 쓴다. */
export const BLACKLIST_FILE_COLUMNS = [
  "ecosystem",
  "name",
  "versionRange",
  "severity",
  "reason",
  "enabled",
  "expiresAt",
] as const;
/** 가져오기에서 반드시 있어야 하는 열. 나머지는 생략하면 기본값을 쓴다. */
export const BLACKLIST_FILE_REQUIRED_COLUMNS = ["name", "reason"] as const;
export const IMPORT_MAX_BYTES = 1024 * 1024;
export const IMPORT_MAX_ROWS = 5000;

export type BulkAction = (typeof BULK_ACTIONS)[number];
export type BlacklistFileFormat = (typeof BLACKLIST_FILE_FORMATS)[number];

const bulkIdSchema = z
  .number({ error: "ids 는 1 이상의 정수의 배열입니다" })
  .int("ids 는 1 이상의 정수의 배열입니다")
  .positive("ids 는 1 이상의 정수의 배열입니다");

export const bulkInputSchema = z.object({
  action: z.enum(BULK_ACTIONS, { error: "action 은 enable, disable, delete 중 하나입니다" }),
  /** 중복은 1개로 센다. */
  ids: z
    .array(bulkIdSchema, { error: "ids 는 1 이상의 정수의 배열입니다" })
    .transform((ids) => [...new Set(ids)])
    .refine((ids) => ids.length >= 1 && ids.length <= BULK_MAX_IDS, {
      message: `ids 는 1~${BULK_MAX_IDS}개입니다`,
    }),
});
export type BulkInput = z.infer<typeof bulkInputSchema>;

export const bulkResultSchema = z.object({
  action: z.enum(BULK_ACTIONS),
  /** 요청한 항목의 수 (중복 제거 후). */
  count: countSchema,
});
export type BulkResult = z.infer<typeof bulkResultSchema>;

const fileFormatSchema = z.enum(BLACKLIST_FILE_FORMATS, { error: "format 은 json 또는 csv 입니다" });

export const importInputSchema = z.object({
  format: fileFormatSchema,
  /** 파일의 내용. 크기와 행 수의 한도는 서버가 검사한다. */
  content: z.string({ error: "content 는 파일의 내용(문자열)입니다" }),
  /** true = 미리 보기(저장하지 않음). 실수로 바로 적용되지 않게 기본값이 true 다. */
  dryRun: z.boolean({ error: "dryRun 은 true 또는 false 입니다" }).default(true),
});
export type ImportInput = z.infer<typeof importInputSchema>;

export const importErrorSchema = z.object({
  /** 1부터 시작하는 데이터 행 번호 (CSV 의 머리글은 세지 않는다). */
  row: z.number().int().min(1),
  field: z.string().nullable(),
  message: z.string().min(1),
});
export type ImportError = z.infer<typeof importErrorSchema>;

export const importResultSchema = z.object({
  /** 저장했는가. 미리 보기이거나 오류가 1건이라도 있으면 false. */
  applied: z.boolean(),
  created: countSchema,
  updated: countSchema,
  unchanged: countSchema,
  errors: z.array(importErrorSchema),
});
export type ImportResult = z.infer<typeof importResultSchema>;

export const exportQuerySchema = blacklistQuerySchema.extend({ format: fileFormatSchema });
export type ExportQuery = z.infer<typeof exportQuerySchema>;

/** 파일의 항목 1개. 응답의 항목에서 id·시각·isExpired 를 뺀 것이다. */
export interface BlacklistFileItem {
  ecosystem: Ecosystem;
  name: string;
  versionRange: string | null;
  severity: Severity;
  reason: string;
  enabled: boolean;
  expiresAt: string | null;
}
export interface BlacklistFile {
  version: typeof BLACKLIST_FILE_VERSION;
  items: BlacklistFileItem[];
}

export const scansQuerySchema = z.object({
  page: pageParam.default(1),
  limit: limitParam(SCANS_MAX_LIMIT).default(SCANS_DEFAULT_LIMIT),
});
export type ScansQuery = z.infer<typeof scansQuerySchema>;

export const scanReposQuerySchema = z.object({
  /** 정확히 일치하는 상태만 반환한다. */
  status: scanRepoStatusSchema.optional(),
  /** repo 이름의 대소문자 무시 부분 일치. */
  q: textFilter,
  page: pageParam.default(1),
  limit: limitParam(SCAN_REPOS_MAX_LIMIT).default(SCAN_REPOS_DEFAULT_LIMIT),
});
export type ScanReposQuery = z.infer<typeof scanReposQuerySchema>;

// ---------------------------------------------------------------- 헬퍼

/**
 * zod 오류를 `ApiError.details` 로 바꾼다.
 * 키 = 최상위 필드 이름. 같은 필드의 오류가 여러 개면 첫 번째만 쓴다.
 */
export function toDetails(error: z.ZodError): Record<string, string> {
  const details: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (key === undefined) continue;
    const field = String(key);
    if (!(field in details)) details[field] = issue.message;
  }
  return details;
}
