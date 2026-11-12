import { intersects, satisfies, validRange } from "semver";
import { unwrapNpmAlias } from "./lockfiles/common.ts";

/**
 * lockfile 의 정확한 버전이 블랙리스트 range 를 만족하는가.
 * `semver.satisfies(version, range, { includePrerelease: true })`. 절대 throw 하지 않는다(잘못된 버전 → false).
 * 블랙리스트 range 가 null 인 경우는 호출 쪽이 이름만으로 판정한다.
 */
export function matchExact(version: string, range: string): boolean {
  try {
    return satisfies(version, range, { includePrerelease: true });
  } catch {
    return false;
  }
}

/**
 * lockfile 이 없을 때 `package.json` 의 spec 이 블랙리스트 range 와 겹치는가.
 * `npm:` 별칭을 먼저 분해한다. `semver.validRange(spec) === null` 이면 비-semver spec 이고
 * 블랙리스트 range 가 null 일 때만 일치한다(A-13). 그 외는 `semver.intersects`. 절대 throw 하지 않는다.
 */
export function matchRange(spec: string, range: string | null): boolean {
  if (range === null) return true;
  try {
    // `npm:lodash@^4` → `^4`. 버전이 없으면 "" (모든 버전). 이름은 쓰지 않는다.
    const actual = unwrapNpmAlias("", spec.trim()).rest;
    if (validRange(actual) === null) return false;
    return intersects(actual, range);
  } catch {
    return false;
  }
}
