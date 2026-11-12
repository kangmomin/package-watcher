import { ERROR_HTTP_STATUS, type ErrorCode } from "@pw/shared";

/**
 * 서비스가 던지는 계약 오류. 라우트는 `ApiError` 로, MCP 는 `isError: true` + JSON 으로 바꾼다.
 * `message` 는 사용자에게 보여 줄 수 있는 한국어 문장이고 비밀값을 넣지 않는다.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, string>;

  constructor(code: ErrorCode, message: string, details?: Record<string, string>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return ERROR_HTTP_STATUS[this.code];
  }
}
