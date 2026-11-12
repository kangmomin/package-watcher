// react-hook-form 과 shared 스키마 연결.
// 계약: FE 의 제출 전 검증은 BE 와 같은 스키마 + 같은 헬퍼(toDetails)를 쓴다.
// 그래서 필드 오류 문구가 서버 VALIDATION_ERROR 의 details 와 같다.
import { toDetails } from "@pw/shared";
import type { FieldError, FieldErrors, FieldPath, FieldValues, Resolver, UseFormSetError } from "react-hook-form";
import type { ZodType } from "zod";
import { formFieldErrors } from "@/lib/errors";

export function schemaResolver<TFieldValues extends FieldValues, TOutput>(
  schema: ZodType<TOutput>,
): Resolver<TFieldValues, unknown, TOutput> {
  return (values) => {
    const result = schema.safeParse(values);
    if (result.success) return { values: result.data, errors: {} };

    const errors: Record<string, FieldError> = {};
    for (const [field, message] of Object.entries(toDetails(result.error))) {
      errors[field] = { type: "validation", message };
    }
    return { values: {}, errors: errors as FieldErrors<TFieldValues> };
  };
}

/**
 * 서버 VALIDATION_ERROR 의 details 중 폼 필드 키를 그 필드의 오류로 옮긴다.
 * 옮긴 필드가 있으면 true. 없으면 호출자가 message 를 toast 로 띄운다(Error Contract).
 */
export function applyServerFieldErrors<TFieldValues extends FieldValues, K extends FieldPath<TFieldValues>>(
  setError: UseFormSetError<TFieldValues>,
  error: unknown,
  fields: readonly K[],
): boolean {
  const entries = Object.entries(formFieldErrors(error, fields)) as [K, string][];
  for (const [field, message] of entries) setError(field, { type: "server", message });
  return entries.length > 0;
}

/** 필드 오류 요소 id. 입력의 aria-describedby 와 짝을 맞춘다. */
export function errorId(fieldId: string): string {
  return `${fieldId}-error`;
}

/** aria-describedby 용 id 목록. 비면 undefined (속성을 생략한다). */
export function joinIds(...ids: (string | false | undefined)[]): string | undefined {
  const joined = ids.filter(Boolean).join(" ");
  return joined === "" ? undefined : joined;
}

/**
 * 입력의 필드 오류 aria 연결. 오류가 있을 때만 aria-invalid 를 켜고 오류 요소 id 를
 * aria-describedby 끝(다른 설명 id 뒤)에 붙인다. 두 속성이 항상 같은 조건을 따르게 한 곳에 둔다.
 */
export function fieldErrorAria(
  error: unknown,
  errorElementId: string,
  ...describedBy: string[]
): { "aria-invalid": true | undefined; "aria-describedby": string | undefined } {
  return {
    "aria-invalid": error ? true : undefined,
    "aria-describedby": joinIds(...describedBy, error ? errorElementId : undefined),
  };
}

/**
 * date 입력이 불완전한지(날짜 칸 일부만 채운 상태 = `validity.badInput`).
 * 불완전한 입력의 값은 `""` 라서 그대로 보내면 만료가 조용히 해제된다.
 * jsdom 은 badInput 을 구현하지 않으므로 테스트는 validity 를 stub 한다.
 */
export function isIncompleteDate(input: Pick<HTMLInputElement, "validity">): boolean {
  return input.validity.badInput;
}
