// react-hook-form 과 shared 스키마 연결.
// 계약: FE 의 제출 전 검증은 BE 와 같은 스키마 + 같은 헬퍼(toDetails)를 쓴다.
// 그래서 필드 오류 문구가 서버 VALIDATION_ERROR 의 details 와 같다.
import { toDetails } from "@pw/shared";
import type { FieldError, FieldErrors, FieldValues, Resolver } from "react-hook-form";
import type { ZodType } from "zod";

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

/** 필드 오류 요소 id. 입력의 aria-describedby 와 짝을 맞춘다. */
export function errorId(fieldId: string): string {
  return `${fieldId}-error`;
}
