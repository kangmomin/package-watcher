import type { ApiError } from "@pw/shared";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "../errors.ts";

const INTERNAL_MESSAGE = "서버 오류가 발생했습니다";
const ID_PATTERN = /^[1-9]\d*$/;

/** `ApiError` 본문. details 는 있을 때만 넣는다. */
export function toApiError(error: AppError): ApiError {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details && Object.keys(error.details).length > 0 ? { details: error.details } : {}),
    },
  };
}

/** AppError 는 그대로, 그 외는 INTERNAL_ERROR. 원인 로그는 호출 쪽이 남긴다(REST·MCP 공용). */
export function toAppError(error: unknown): AppError {
  return error instanceof AppError ? error : new AppError("INTERNAL_ERROR", INTERNAL_MESSAGE);
}

/** 예외 → `ApiError` 응답. AppError 는 code 의 HTTP status 로, 그 외는 500 INTERNAL_ERROR(원인은 로그만). */
export function toErrorResponse(c: Context, error: unknown): Response {
  const appError = toAppError(error);
  return c.json(toApiError(appError), appError.status as ContentfulStatusCode);
}

/** JSON 본문. 깨진 JSON 또는 JSON 이 아닌 Content-Type → AppError(VALIDATION_ERROR, details 없음) */
export async function readJsonBody(c: Context): Promise<unknown> {
  const contentType = c.req.header("content-type") ?? "";
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  // [Assumption] `+json` 접미사 미디어 타입(RFC 6839)도 JSON 으로 받는다 — 근거: 계약은 "JSON 이 아닌 Content-Type" 만 400 으로 정한다.
  if (mediaType !== "application/json" && !mediaType.endsWith("+json")) {
    throw new AppError("VALIDATION_ERROR", "요청 본문은 Content-Type: application/json 이어야 합니다");
  }
  const text = await c.req.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError("VALIDATION_ERROR", "요청 본문이 올바른 JSON 이 아닙니다");
  }
}

/** `:id` → 양의 정수. 정수가 아니면 AppError(NOT_FOUND) */
export function parseId(raw: string): number {
  const id = Number(raw);
  if (!ID_PATTERN.test(raw) || !Number.isSafeInteger(id)) {
    throw new AppError("NOT_FOUND", "대상을 찾을 수 없습니다");
  }
  return id;
}
