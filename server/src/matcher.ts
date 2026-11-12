import { notImplemented } from "./notImplemented.ts";

/**
 * lockfile 의 정확한 버전이 블랙리스트 range 를 만족하는가.
 * `semver.satisfies(version, range, { includePrerelease: true })`. 절대 throw 하지 않는다(잘못된 버전 → false).
 * 블랙리스트 range 가 null 인 경우는 호출 쪽이 이름만으로 판정한다.
 */
export function matchExact(version: string, range: string): boolean {
  return notImplemented(version, range);
}

/**
 * lockfile 이 없을 때 `package.json` 의 spec 이 블랙리스트 range 와 겹치는가.
 * `npm:` 별칭을 먼저 분해한다. `semver.validRange(spec) === null` 이면 비-semver spec 이고
 * 블랙리스트 range 가 null 일 때만 일치한다(A-13). 그 외는 `semver.intersects`. 절대 throw 하지 않는다.
 */
export function matchRange(spec: string, range: string | null): boolean {
  return notImplemented(spec, range);
}
