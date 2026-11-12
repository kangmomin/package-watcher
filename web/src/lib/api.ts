// REST 클라이언트 (Phase 6.1 스텁 — Phase 6.2 에서 구현).
// 계약: 응답은 shared 스키마로 parse 한다(실패 → INTERNAL_ERROR). 비-2xx → ApiRequestError.
// 본문이 ApiError 가 아니거나 fetch 실패 → NETWORK_ERROR("서버에 연결할 수 없습니다"). 204 → undefined.
import type {
  BlacklistEntry,
  BlacklistInput,
  BlacklistList,
  ErrorCode,
  Finding,
  FindingStatus,
  FindingStatusInput,
  Page,
  Scan,
  Settings,
  SettingsInput,
  Summary,
  TestEmailResult,
} from "@pw/shared";

/** shared `ErrorCode` + FE 전용 `NETWORK_ERROR` */
export type ClientErrorCode = ErrorCode | "NETWORK_ERROR";

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

export interface FindingsFilter {
  status?: FindingStatus;
  repo?: string;
  package?: string;
}

export interface FindingsParams extends FindingsFilter {
  page: number;
  limit: number;
}

export interface ScansParams {
  page: number;
  limit: number;
}

function notImplemented(): never {
  throw new Error("not implemented");
}

export const api = {
  getSummary: (): Promise<Summary> => notImplemented(),
  listFindings: (_params: FindingsParams): Promise<Page<Finding>> => notImplemented(),
  setFindingStatus: (_id: number, _input: FindingStatusInput): Promise<Finding> => notImplemented(),
  listBlacklist: (): Promise<BlacklistList> => notImplemented(),
  createBlacklistEntry: (_input: BlacklistInput): Promise<BlacklistEntry> => notImplemented(),
  /** PUT 은 전체 교체다. versionRange 키를 항상 보낸다 (A-12). */
  updateBlacklistEntry: (_id: number, _input: BlacklistInput): Promise<BlacklistEntry> => notImplemented(),
  deleteBlacklistEntry: (_id: number): Promise<void> => notImplemented(),
  listScans: (_params: ScansParams): Promise<Page<Scan>> => notImplemented(),
  triggerScan: (): Promise<Scan> => notImplemented(),
  getSettings: (): Promise<Settings> => notImplemented(),
  saveSettings: (_input: SettingsInput): Promise<Settings> => notImplemented(),
  sendTestEmail: (): Promise<TestEmailResult> => notImplemented(),
};
