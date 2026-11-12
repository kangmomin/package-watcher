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
  "INTERNAL_ERROR",
] as const;

/** 값 7개를 지금 정의한다. DB 의 CHECK 와 같은 목록이다. */
export const ECOSYSTEMS = ["npm", "go", "pypi", "nuget", "cargo", "pub", "maven"] as const;
/** 입력으로 받는 종류. 검사기가 있는 종류만 넣는다 (지금은 전부). */
// 길이가 고정된 tuple 타입으로 내보내지 않는다 — 쓰는 쪽의 `length === 1` 같은 비교가 타입 오류가 된다.
export const SUPPORTED_ECOSYSTEMS: readonly [Ecosystem, ...Ecosystem[]] = ECOSYSTEMS;
/** 높은 순. 화면의 select 순서와 정렬이 이 순서를 쓴다. */
export const SEVERITIES = ["critical", "high", "medium", "low"] as const;

export const ecosystemSchema = z.enum(ECOSYSTEMS);
export const severitySchema = z.enum(SEVERITIES);
export type Ecosystem = z.infer<typeof ecosystemSchema>;
export type Severity = z.infer<typeof severitySchema>;
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

export const findingSchema = z.object({
  id: idSchema,
  repo: z.string().min(1),
  filePath: z.string().min(1),
  ecosystem: ecosystemSchema,
  packageName: z.string().min(1),
  version: z.string(),
  /** 항목을 PUT 하면 활성 검출의 값도 바뀐다 (reason 과 같다). */
  severity: severitySchema,
  dependencyType: dependencyTypeSchema,
  status: findingStatusSchema,
  blacklistEntryId: idSchema,
  reason: z.string(),
  htmlUrl: z.string().min(1),
  firstSeenAt: isoDateSchema,
  resolvedAt: isoDateSchema.nullable(),
  notifiedAt: isoDateSchema.nullable(),
});
export type Finding = z.infer<typeof findingSchema>;

export const blacklistEntrySchema = z.object({
  id: idSchema,
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
  /** failed 일 때의 원인. */
  error: z.string().nullable(),
  startedAt: isoDateSchema.nullable(),
  finishedAt: isoDateSchema.nullable(),
});
export type ScanRepo = z.infer<typeof scanRepoSchema>;

export const summarySchema = z.object({
  openCount: countSchema,
  ignoredCount: countSchema,
  lastScan: scanSchema.nullable(),
  nextScanAt: isoDateSchema.nullable(),
});
export type Summary = z.infer<typeof summarySchema>;

const DIGEST_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const settingsSchema = z.object({
  org: z.string().min(1).nullable(),
  scanIntervalHours: z.number().int().min(1).max(168),
  digestTime: z.string().regex(DIGEST_TIME),
  digestTimezone: z.literal(DIGEST_TIMEZONE),
  recipients: z.array(z.string()),
  githubTokenSource: z.enum(TOKEN_SOURCES),
  smtpConfigured: z.boolean(),
  /** 즉시 메일의 최소 심각도. 이보다 낮은 검출은 일일 요약에만 들어간다. */
  notifyMinSeverity: severitySchema,
});
export type Settings = z.infer<typeof settingsSchema>;

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

/** 이름에 `*` 가 있으면 패턴이다. `*` 는 `/` 를 포함한 임의의 문자열과 일치한다. */
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

export const settingsInputSchema = z.object({
  org: orgSchema,
  scanIntervalHours: scanIntervalHoursSchema,
  digestTime: digestTimeSchema,
  recipients: recipientsSchema,
  /** 생략하면 저장된 값을 유지한다. */
  notifyMinSeverity: severityInputSchema.optional(),
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
});
export type BlacklistQuery = z.infer<typeof blacklistQuerySchema>;

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
