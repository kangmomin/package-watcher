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

/**
 * 블랙리스트 항목의 이름(또는 `*` 패턴)이 패키지 이름 전체와 일치하는가. 대소문자를 구분한다.
 * `*` 가 없으면 `===`. 있으면 `*` 는 `/` 를 포함한 임의의 문자열(0자 이상)이다.
 * 정규식은 쓰지 않는다 — `*a*a*…*b` 같은 패턴이 backtracking 으로 서버 전체를 멈추기 때문이다.
 * `*` 위치 하나만 기억해서 되돌아가는 2-포인터 알고리즘이라 최악 O(이름 길이 × 패턴 길이)다.
 */
export function matchName(pattern: string, name: string): boolean {
  if (!pattern.includes("*")) return pattern === name;
  let p = 0;
  let n = 0;
  let starAt = -1;
  let resumeAt = 0;
  while (n < name.length) {
    if (p < pattern.length && pattern[p] === "*") {
      starAt = p;
      resumeAt = n;
      p += 1;
    } else if (p < pattern.length && pattern[p] === name[n]) {
      p += 1;
      n += 1;
    } else if (starAt !== -1) {
      // 마지막 `*` 가 한 글자 더 먹도록 되돌린다.
      resumeAt += 1;
      n = resumeAt;
      p = starAt + 1;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === "*") p += 1;
  return p === pattern.length;
}

export interface EntryIndex<E extends { name: string; ecosystem: string }> {
  /** 그 종류에서 이 패키지 이름과 일치하는 항목 전부 */
  match(ecosystem: string, name: string): E[];
}

/** 정확한 이름은 Map 조회, 패턴 항목은 목록 순회. lockfile 경로와 range 폴백 경로가 함께 쓴다. */
export function createEntryIndex<E extends { name: string; ecosystem: string }>(
  entries: E[],
): EntryIndex<E> {
  const exact = new Map<string, E[]>();
  const patterns: E[] = [];
  for (const entry of entries) {
    if (entry.name.includes("*")) {
      patterns.push(entry);
      continue;
    }
    const key = `${entry.ecosystem}:${entry.name}`;
    exact.set(key, [...(exact.get(key) ?? []), entry]);
  }
  return {
    match: (ecosystem, name) => [
      ...(exact.get(`${ecosystem}:${name}`) ?? []),
      ...patterns.filter((entry) => entry.ecosystem === ecosystem && matchName(entry.name, name)),
    ],
  };
}
