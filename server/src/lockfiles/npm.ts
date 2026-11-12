import { notImplemented } from "../notImplemented.ts";
import type { LockPackage } from "./index.ts";

/**
 * `package-lock.json`.
 * - v2/v3: `packages` 만 읽는다(v2 의 `dependencies` 무시). 루트 `""` 와 `link: true` 제외.
 *   이름 = 항목의 `name`, 없으면 마지막 `node_modules/` 뒤 경로.
 * - v1: `dependencies` 를 재귀로 읽는다. `version: "npm:real@1.2.3"` 별칭 분해.
 *   버전이 semver 가 아닌 항목(git, tarball)은 이름 + 원문 버전.
 * 공통: UTF-8 BOM 제거, CRLF → LF. 파싱 실패·빈 입력은 예외.
 */
export function parseNpmLock(content: string): LockPackage[] {
  return notImplemented(content);
}
