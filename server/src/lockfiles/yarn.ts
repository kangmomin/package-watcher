import { notImplemented } from "../notImplemented.ts";
import type { LockPackage } from "./index.ts";

/**
 * `yarn.lock` (classic 와 berry 를 형식 표지로 구분).
 * - classic: 표지 `# yarn lockfile v1`. 한 블록의 여러 spec 은 같은 버전.
 *   이름 = spec 이 `@` 로 시작하면 두 번째 `@` 앞, 아니면 첫 `@` 앞. `a@npm:real@^1` → `real`.
 * - berry: 표지 `__metadata`(제외). 이름 = `resolution` 에서 추출. `workspace:` 제외. `patch:` 는 기본 패키지 이름.
 * 공통: UTF-8 BOM 제거, CRLF → LF. 파싱 실패·빈 입력·형식 표지 없는 입력은 예외.
 */
export function parseYarnLock(content: string): LockPackage[] {
  return notImplemented(content);
}
