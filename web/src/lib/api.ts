// REST 클라이언트.
// 계약: 응답은 shared 스키마로 parse 한다(실패 → INTERNAL_ERROR). 비-2xx → ApiRequestError.
// 본문이 ApiError 가 아니거나 fetch 실패 → NETWORK_ERROR("서버에 연결할 수 없습니다"). 204 → undefined.
import {
  apiErrorSchema,
  blacklistEntrySchema,
  blacklistListSchema,
  bulkResultSchema,
  findingSchema,
  findingsPageSchema,
  importResultSchema,
  scanReposPageSchema,
  scanSchema,
  scansPageSchema,
  settingsSchema,
  summarySchema,
  testEmailResultSchema,
  type BlacklistEntry,
  type BlacklistInput,
  type BlacklistFileFormat,
  type BlacklistList,
  type BulkInput,
  type BulkResult,
  type Ecosystem,
  type EntryStatus,
  type ErrorCode,
  type Finding,
  type FindingStatus,
  type FindingStatusInput,
  type ImportInput,
  type ImportResult,
  type Page,
  type Scan,
  type ScanRepo,
  type ScanRepoStatus,
  type Settings,
  type SettingsInput,
  type Severity,
  type Summary,
  type TestEmailResult,
} from "@pw/shared";
import type { ZodType } from "zod";

/** shared `ErrorCode` + FE 전용 `NETWORK_ERROR` */
export type ClientErrorCode = ErrorCode | "NETWORK_ERROR";

export const NETWORK_ERROR_MESSAGE = "서버에 연결할 수 없습니다";
export const INTERNAL_ERROR_MESSAGE = "서버 오류가 발생했습니다";

/** status = HTTP status (fetch 실패 = 0). retry 판정은 status 를 쓴다. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ClientErrorCode;
  readonly details: Record<string, string> | undefined;

  constructor(status: number, code: ClientErrorCode, message: string, details?: Record<string, string>) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** 블랙리스트 목록·내보내기의 필터. 값이 없는 키는 요청에 넣지 않는다. */
export interface BlacklistFilter {
  ecosystem?: Ecosystem;
  status?: EntryStatus;
  q?: string;
}

export interface FindingsFilter {
  status?: FindingStatus;
  repo?: string;
  package?: string;
  ecosystem?: Ecosystem;
  severity?: Severity;
}

export interface FindingsParams extends FindingsFilter {
  page: number;
  limit: number;
}

export interface ScansParams {
  page: number;
  limit: number;
}

export interface ScanReposFilter {
  status?: ScanRepoStatus;
  q?: string;
}

export interface ScanReposParams extends ScanReposFilter {
  page: number;
  limit: number;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

async function send(method: Method, path: string, body?: unknown): Promise<Response> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  try {
    const response = await fetch(path, init);
    if (!response.ok) throw await toRequestError(response);
    return response;
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    throw new ApiRequestError(0, "NETWORK_ERROR", NETWORK_ERROR_MESSAGE);
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/** 비-2xx: 본문이 ApiError 이면 그 값을, 아니면(프록시 HTML 등) NETWORK_ERROR 를 쓴다. */
async function toRequestError(response: Response): Promise<ApiRequestError> {
  const parsed = apiErrorSchema.safeParse(await readJson(response));
  if (!parsed.success) {
    return new ApiRequestError(response.status, "NETWORK_ERROR", NETWORK_ERROR_MESSAGE);
  }
  const { code, message, details } = parsed.data.error;
  return new ApiRequestError(response.status, code, message, details);
}

async function request<T>(schema: ZodType<T>, method: Method, path: string, body?: unknown): Promise<T> {
  const response = await send(method, path, body);
  const parsed = schema.safeParse(await readJson(response));
  if (!parsed.success) {
    // 2xx 인데 계약과 다른 응답 = 서버 상태를 알 수 없다 (S-9)
    throw new ApiRequestError(response.status, "INTERNAL_ERROR", INTERNAL_ERROR_MESSAGE);
  }
  return parsed.data;
}

function withQuery(path: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const query = search.toString();
  return query === "" ? path : `${path}?${query}`;
}

function blacklistParams({ ecosystem, status, q }: BlacklistFilter) {
  return { ecosystem, status, q };
}

/** 내보내기 링크. 목록과 같은 필터를 붙인다(선택 상태는 쓰지 않는다). */
export function exportBlacklistUrl(format: BlacklistFileFormat, filter: BlacklistFilter): string {
  return withQuery("/api/blacklist/export", { format, ...blacklistParams(filter) });
}

export const api = {
  getSummary: (): Promise<Summary> => request(summarySchema, "GET", "/api/summary"),
  listFindings: ({ status, repo, package: pkg, ecosystem, severity, page, limit }: FindingsParams): Promise<Page<Finding>> =>
    request(
      findingsPageSchema,
      "GET",
      withQuery("/api/findings", { status, repo, package: pkg, ecosystem, severity, page, limit }),
    ),
  setFindingStatus: (id: number, input: FindingStatusInput): Promise<Finding> =>
    request(findingSchema, "PATCH", `/api/findings/${id}`, input),
  listBlacklist: (filter: BlacklistFilter = {}): Promise<BlacklistList> =>
    request(blacklistListSchema, "GET", withQuery("/api/blacklist", blacklistParams(filter))),
  bulkBlacklist: (input: BulkInput): Promise<BulkResult> =>
    request(bulkResultSchema, "POST", "/api/blacklist/bulk", input),
  importBlacklist: (input: ImportInput): Promise<ImportResult> =>
    request(importResultSchema, "POST", "/api/blacklist/import", input),
  createBlacklistEntry: (input: BlacklistInput): Promise<BlacklistEntry> =>
    request(blacklistEntrySchema, "POST", "/api/blacklist", input),
  /** PUT 은 전체 교체다. versionRange 키를 항상 보낸다 (A-12). */
  updateBlacklistEntry: (id: number, input: BlacklistInput): Promise<BlacklistEntry> =>
    request(blacklistEntrySchema, "PUT", `/api/blacklist/${id}`, {
      name: input.name,
      versionRange: input.versionRange,
      reason: input.reason,
      ecosystem: input.ecosystem,
      severity: input.severity,
      enabled: input.enabled,
      expiresAt: input.expiresAt,
    }),
  deleteBlacklistEntry: async (id: number): Promise<void> => {
    await send("DELETE", `/api/blacklist/${id}`);
  },
  listScans: ({ page, limit }: ScansParams): Promise<Page<Scan>> =>
    request(scansPageSchema, "GET", withQuery("/api/scans", { page, limit })),
  listScanRepos: (scanId: number, { status, q, page, limit }: ScanReposParams): Promise<Page<ScanRepo>> =>
    request(scanReposPageSchema, "GET", withQuery(`/api/scans/${scanId}/repos`, { status, q, page, limit })),
  triggerScan: (): Promise<Scan> => request(scanSchema, "POST", "/api/scans"),
  getSettings: (): Promise<Settings> => request(settingsSchema, "GET", "/api/settings"),
  saveSettings: (input: SettingsInput): Promise<Settings> => request(settingsSchema, "PUT", "/api/settings", input),
  sendTestEmail: (): Promise<TestEmailResult> =>
    request(testEmailResultSchema, "POST", "/api/settings/test-email"),
};
