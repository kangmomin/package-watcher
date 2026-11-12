import { describe, expect, it } from "vitest";
import { matchExact, matchRange } from "./matcher.ts";

describe("matchExact (lockfile 의 정확한 버전)", () => {
  it("[AC-03] 범위를 만족하는 버전은 일치한다", () => {
    expect(matchExact("4.17.20", "<4.17.21")).toBe(true);
    expect(matchExact("1.0.0", "*")).toBe(true);
  });

  it("[AC-03] prerelease 도 범위 비교에 포함한다 (includePrerelease)", () => {
    expect(matchExact("4.17.21-beta.1", "<4.17.21")).toBe(true);
  });

  it("[AC-04] 범위 밖 버전은 일치하지 않는다", () => {
    expect(matchExact("4.17.21", "<4.17.21")).toBe(false);
    expect(matchExact("5.0.0", "^4.0.0")).toBe(false);
  });

  it("[AC-04] 잘못된 버전 문자열은 throw 하지 않고 불일치", () => {
    for (const version of ["not-a-version", "", "git+https://github.com/u/r.git#abc", "latest"]) {
      expect(() => matchExact(version, "<4.17.21")).not.toThrow();
      expect(matchExact(version, "<4.17.21")).toBe(false);
    }
  });
});

describe("matchRange (lockfile 이 없을 때 package.json 의 spec)", () => {
  it("[AC-02] 블랙리스트 range 가 null 이면 모든 spec 이 일치한다", () => {
    for (const spec of ["^1.0.0", "latest", "workspace:^", "", "*", "npm:lodash@^4"]) {
      expect(matchRange(spec, null)).toBe(true);
    }
  });

  it("[AC-02] semver range 는 블랙리스트 range 와 겹치면 일치한다", () => {
    expect(matchRange("^4.17.0", "<4.17.21")).toBe(true);
    expect(matchRange("^4.17.21", "<4.17.21")).toBe(false);
    expect(matchRange("~1.2.3", ">=1.2.0 <1.3.0")).toBe(true);
  });

  it('[AC-02] "" 와 "*" 는 모든 버전 range 로 본다', () => {
    expect(matchRange("", "<4.17.21")).toBe(true);
    expect(matchRange("*", "<4.17.21")).toBe(true);
  });

  it("[AC-02] 비-semver spec(dist-tag, catalog:, workspace:, git, user/repo)은 range 가 있는 항목에 일치하지 않는다 (A-13)", () => {
    for (const spec of ["latest", "catalog:", "user/repo", "github:u/r#sha", "workspace:^"]) {
      expect(() => matchRange(spec, "<14")).not.toThrow();
      expect(matchRange(spec, "<14")).toBe(false);
    }
  });

  it("[AC-02] npm: 별칭은 분해한 뒤 range 를 비교한다", () => {
    expect(matchRange("npm:lodash@^4.17.0", "<4.17.21")).toBe(true);
    expect(matchRange("npm:lodash@^4.17.21", "<4.17.21")).toBe(false);
    expect(matchRange("npm:lodash@latest", "<4.17.21")).toBe(false);
  });

  it("[AC-04] 잘못된 spec 은 throw 하지 않고 range 가 있는 항목에 불일치", () => {
    expect(() => matchRange("not valid !!", "<4")).not.toThrow();
    expect(matchRange("not valid !!", "<4")).toBe(false);
  });
});
