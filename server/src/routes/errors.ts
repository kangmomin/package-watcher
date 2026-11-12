import type { Context } from "hono";
import { notImplemented } from "../notImplemented.ts";

/** 예외 → `ApiError` 응답. AppError 는 code 의 HTTP status 로, 그 외는 500 INTERNAL_ERROR(원인은 로그만). */
export function toErrorResponse(c: Context, error: unknown): Response {
  return notImplemented(c, error);
}

/** JSON 본문. 깨진 JSON 또는 JSON 이 아닌 Content-Type → AppError(VALIDATION_ERROR, details 없음) */
export async function readJsonBody(c: Context): Promise<unknown> {
  return notImplemented(c);
}

/** `:id` → 양의 정수. 정수가 아니면 AppError(NOT_FOUND) */
export function parseId(raw: string): number {
  return notImplemented(raw);
}
