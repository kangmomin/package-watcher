import { describe, expect, it } from "vitest";
import { matchName } from "./matcher.ts";

describe("matchName (블랙리스트 이름·패턴 ↔ 패키지 이름)", () => {
  it("[v2-AC-02] `*` 가 없는 이름은 정확히 일치할 때만 일치한다 (대소문자 구분)", () => {
    expect(matchName("lodash", "lodash")).toBe(true);
    expect(matchName("@scope/pkg", "@scope/pkg")).toBe(true);
    expect(matchName("lodash", "lodash-es")).toBe(false);
    expect(matchName("lodash", "my-lodash")).toBe(false);
    expect(matchName("JSONStream", "jsonstream")).toBe(false);
  });

  it("[v2-AC-02] `@evil/*` 는 그 스코프의 모든 패키지와 일치하고 다른 스코프와는 일치하지 않는다", () => {
    expect(matchName("@evil/*", "@evil/a")).toBe(true);
    expect(matchName("@evil/*", "@evil/b-long.name")).toBe(true);
    expect(matchName("@evil/*", "@evilx/a")).toBe(false);
    expect(matchName("@evil/*", "evil")).toBe(false);
    expect(matchName("@evil/*", "prefix-@evil/a")).toBe(false);
  });

  it("[v2-AC-02] `*` 는 0자 이상이고 이름 전체와 비교한다 (`left-pad*`, `*-malware`)", () => {
    expect(matchName("left-pad*", "left-pad")).toBe(true);
    expect(matchName("left-pad*", "left-pad-utils")).toBe(true);
    expect(matchName("left-pad*", "my-left-pad")).toBe(false);
    expect(matchName("*-malware", "x-malware")).toBe(true);
    expect(matchName("*-malware", "x-malware-kit")).toBe(false);
    expect(matchName("a*b*c", "a-b-c")).toBe(true);
    expect(matchName("a*b*c", "abc")).toBe(true);
    expect(matchName("a*b*c", "a-c-b")).toBe(false);
  });

  it("[v2-AC-02] `*` 는 `/` 를 넘는다", () => {
    expect(matchName("*-malware", "@scope/x-malware")).toBe(true);
    expect(matchName("@*/evil", "@any-scope/evil")).toBe(true);
    expect(matchName("@*/evil", "@any-scope/evil-two")).toBe(false);
    expect(matchName("github.com/evil/*", "github.com/evil/tool/sub/path")).toBe(true);
  });

  it("[v2-AC-02] 정규식 특수문자는 글자 그대로 비교한다", () => {
    expect(matchName("lodash.merge*", "lodash.merge")).toBe(true);
    expect(matchName("lodash.merge*", "lodashxmerge")).toBe(false);
    expect(matchName("a.b*", "a.b1")).toBe(true);
    expect(matchName("a.b*", "axb1")).toBe(false);
    expect(matchName("pkg~1*", "pkg~1-next")).toBe(true);
    expect(matchName("pkg~1*", "pkg1-next")).toBe(false);
  });

  it("[v2-AC-02] 패턴도 대소문자를 구분한다", () => {
    expect(matchName("@Evil/*", "@evil/a")).toBe(false);
    expect(matchName("@evil/*", "@EVIL/a")).toBe(false);
    expect(matchName("Left-Pad*", "left-pad")).toBe(false);
  });

  it("[v2-AC-02] 병리 패턴(`*a*a*…*b` × 긴 `aaaa…`)도 정해진 시간 안에 불일치로 끝난다 (정규식 backtracking 금지)", () => {
    const pattern = `${"*a".repeat(30)}*b`;
    const name = "a".repeat(5_000);

    const startedAt = performance.now();
    const matched = matchName(pattern, name);
    const elapsedMs = performance.now() - startedAt;

    expect(matched).toBe(false);
    expect(elapsedMs).toBeLessThan(1_000);
    expect(matchName(pattern, `${name}b`)).toBe(true);
  });
});
