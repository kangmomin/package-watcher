import { parse as parseJsonc, printParseErrorCode, type ParseError } from "jsonc-parser";
import {
  isPlainObject,
  LockfileParseError,
  requireContent,
  splitNameAndRest,
  unwrapNpmAlias,
} from "./common.ts";
import type { LockPackage } from "./index.ts";

/**
 * `bun.lock` (JSONC). `jsonc-parser` 를 `allowTrailingComma: true` 로 호출한다.
 * `packages` 값 튜플의 [0](`name@version`)을 yarn 이름 규칙으로 분해한다.
 * 공통: UTF-8 BOM 제거, CRLF → LF. 파싱 실패·빈 입력은 예외. `bun.lockb` 는 다루지 않는다(EC-12).
 */
export function parseBunLock(content: string): LockPackage[] {
  const text = requireContent(content, "bun.lock");
  const errors: ParseError[] = [];
  const data: unknown = parseJsonc(text, errors, { allowTrailingComma: true });
  const [first] = errors;
  if (first) {
    throw new LockfileParseError(
      `bun.lock 을 해석할 수 없습니다: ${printParseErrorCode(first.error)} (offset ${first.offset})`,
    );
  }
  if (!isPlainObject(data) || !("lockfileVersion" in data)) {
    throw new LockfileParseError("bun.lock 에 형식 표지(lockfileVersion)가 없습니다");
  }
  if (data.packages === undefined || data.packages === null) return [];
  if (!isPlainObject(data.packages)) {
    throw new LockfileParseError("bun.lock 의 packages 형식이 올바르지 않습니다");
  }

  const packages: LockPackage[] = [];
  for (const value of Object.values(data.packages)) {
    if (!Array.isArray(value) || typeof value[0] !== "string") continue;
    const split = splitNameAndRest(value[0]);
    // [Assumption] 버전이 없거나 `workspace:` 인 항목은 설치된 의존성이 아니라서 건너뛴다 — 근거: yarn berry 규칙(Backend Plan)과 S-13 을 bun.lock 에도 적용.
    if (split.rest === null || split.rest === "" || split.rest.startsWith("workspace:")) continue;
    const { name, rest } = unwrapNpmAlias(split.name, split.rest);
    packages.push({ name, version: rest });
  }
  return packages;
}
