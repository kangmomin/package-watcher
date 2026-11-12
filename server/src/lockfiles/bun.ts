import { notImplemented } from "../notImplemented.ts";
import type { LockPackage } from "./index.ts";

/**
 * `bun.lock` (JSONC). `jsonc-parser` 를 `allowTrailingComma: true` 로 호출한다.
 * `packages` 값 튜플의 [0](`name@version`)을 yarn 이름 규칙으로 분해한다.
 * 공통: UTF-8 BOM 제거, CRLF → LF. 파싱 실패·빈 입력은 예외. `bun.lockb` 는 다루지 않는다(EC-12).
 */
export function parseBunLock(content: string): LockPackage[] {
  return notImplemented(content);
}
