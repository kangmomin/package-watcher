// Integration Contract v1.3 의 단일 정의.
// BE(응답 생성·입력 검증)와 FE(응답 parse·제출 전 검증)가 같은 스키마를 쓴다.
// 브라우저 번들에 들어가므로 Node 전용 모듈을 import 하지 않는다.
import validRange from "semver/ranges/valid.js";
import { z } from "zod";

// ---------------------------------------------------------------- enum

export const FINDING_STATUSES = ["open", "resolved", "ignored"] as const;
export const DEPENDENCY_TYPES = ["direct", "transitive"] as const;
export const SCAN_TRIGGERS = ["scheduled", "manual"] as const;
export const SCAN_STATUSES = ["running", "success", "partial", "failed"] as const;
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

export const findingStatusSchema = z.enum(FINDING_STATUSES);
export const dependencyTypeSchema = z.enum(DEPENDENCY_TYPES);
export const scanTriggerSchema = z.enum(SCAN_TRIGGERS);
export const scanStatusSchema = z.enum(SCAN_STATUSES);
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
export const SCANS_DEFAULT_LIMIT = 20;
export const SCANS_MAX_LIMIT = 100;

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** ISO 8601 UTC, 밀리초 3자리 (`Date#toISOString` 형식). */
export const isoDateSchema = z.string().regex(ISO_UTC, "ISO 8601 UTC 형식이 아닙니다");
const idSchema = z.number().int().positive();
const countSchema = z.number().int().nonnegative();

// ---------------------------------------------------------------- 응답

export const findingSchema = z.object({
  id: idSchema,
  repo: z.string().min(1),
  filePath: z.string().min(1),
  packageName: z.string().min(1),
  version: z.string(),
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
  name: z.string().min(1),
  versionRange: z.string().min(1).nullable(),
  reason: z.string().min(1),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type BlacklistEntry = z.infer<typeof blacklistEntrySchema>;

export const blacklistListSchema = z.object({ items: z.array(blacklistEntrySchema) });
export type BlacklistList = z.infer<typeof blacklistListSchema>;

export const failedRepoSchema = z.object({ repo: z.string(), error: z.string() });
export type FailedRepo = z.infer<typeof failedRepoSchema>;

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
});
export type Scan = z.infer<typeof scanSchema>;

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

// npm 패키지 이름. 브라우저에서도 같은 규칙을 쓰기 위해 정규식으로 검증한다.
// 대문자는 과거에 등록된 패키지(예: JSONStream)에 있으므로 허용하고, 비교는 대소문자를 구분한다.
const NPM_NAME = /^(?:@[A-Za-z0-9-~][A-Za-z0-9-._~]*\/)?[A-Za-z0-9-~][A-Za-z0-9-._~]*$/;

const nameSchema = z
  .string({ error: "패키지 이름을 입력하십시오" })
  .trim()
  .min(1, "패키지 이름을 입력하십시오")
  .max(214, "패키지 이름은 214자 이하입니다")
  .regex(NPM_NAME, "npm 패키지 이름 형식이 아닙니다");

/** trim 후 빈 문자열과 null 은 "모든 버전"(null) 이다. */
const versionRangeSchema = z
  .union([z.string(), z.null()], { error: "버전 범위는 문자열 또는 null 입니다" })
  .transform((value) => {
    const trimmed = value?.trim() ?? "";
    return trimmed === "" ? null : trimmed;
  })
  .refine((value) => value === null || validRange(value) !== null, {
    message: "유효한 semver 범위가 아닙니다",
  });

const reasonSchema = z
  .string({ error: "사유를 입력하십시오" })
  .trim()
  .min(1, "사유를 입력하십시오")
  .max(500, "사유는 500자 이하입니다");

/** POST /api/blacklist — versionRange 생략 = null. */
export const blacklistCreateSchema = z.object({
  name: nameSchema,
  versionRange: versionRangeSchema.optional().transform((value) => value ?? null),
  reason: reasonSchema,
});
/** PUT /api/blacklist/:id — 전체 교체. versionRange 키가 반드시 있어야 한다 (A-12). */
export const blacklistUpdateSchema = z.object({
  name: nameSchema,
  versionRange: versionRangeSchema,
  reason: reasonSchema,
});
export interface BlacklistInput {
  name: string;
  versionRange: string | null;
  reason: string;
}

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
  page: pageParam.default(1),
  limit: limitParam(FINDINGS_MAX_LIMIT).default(FINDINGS_DEFAULT_LIMIT),
});
export type FindingsQuery = z.infer<typeof findingsQuerySchema>;

export const scansQuerySchema = z.object({
  page: pageParam.default(1),
  limit: limitParam(SCANS_MAX_LIMIT).default(SCANS_DEFAULT_LIMIT),
});
export type ScansQuery = z.infer<typeof scansQuerySchema>;

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
