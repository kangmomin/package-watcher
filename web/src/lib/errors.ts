// Error Contract 의 프론트 동작에 쓰는 공통 판정.
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { ApiRequestError, INTERNAL_ERROR_MESSAGE, NETWORK_ERROR_MESSAGE, type ClientErrorCode } from "@/lib/api";

export function hasErrorCode(error: unknown, ...codes: ClientErrorCode[]): boolean {
  return error instanceof ApiRequestError && codes.includes(error.code);
}

/** toast 문구 (S-8): 서버 message 그대로. INTERNAL_ERROR·NETWORK_ERROR 는 고정 문구. */
export function errorToastMessage(error: unknown): string {
  if (!(error instanceof ApiRequestError) || error.code === "INTERNAL_ERROR") return INTERNAL_ERROR_MESSAGE;
  if (error.code === "NETWORK_ERROR") return NETWORK_ERROR_MESSAGE;
  return error.message;
}

/**
 * 변경 요청이 INTERNAL_ERROR·NETWORK_ERROR(2xx parse 실패 포함)로 끝나면 서버 상태를 알 수 없다.
 * 이때는 성공했을 때와 같은 키를 무효화한다.
 */
export function isUnknownOutcome(error: unknown): boolean {
  return !(error instanceof ApiRequestError) || hasErrorCode(error, "INTERNAL_ERROR", "NETWORK_ERROR");
}

/** VALIDATION_ERROR 의 details 중 폼 필드 키만 고른다. 없으면 빈 객체. */
export function formFieldErrors<K extends string>(error: unknown, fields: readonly K[]): Partial<Record<K, string>> {
  const result: Partial<Record<K, string>> = {};
  if (!(error instanceof ApiRequestError) || error.code !== "VALIDATION_ERROR" || !error.details) return result;
  for (const field of fields) {
    const message = error.details[field];
    if (message !== undefined) result[field] = message;
  }
  return result;
}

export function invalidateKeys(queryClient: QueryClient, keys: readonly QueryKey[]): Promise<void> {
  return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))).then(() => undefined);
}
