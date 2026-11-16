import { ECOSYSTEM_RULES, type Ecosystem } from "@pw/shared";
import { describe, expect, it } from "vitest";
import { GHSA_ECOSYSTEMS, convertAdvisory } from "./ranges.ts";

describe("convertAdvisory: 범위 표기의 변환 (종류 × 표기)", () => {
  // [종류, 원문, 기대하는 범위]
  const table: [string, string, string | null][] = [
    ["NPM", "= 1.5.1", "1.5.1"],
    ["NPM", ">= 1.0.0, < 2.0.0", ">=1.0.0 <2.0.0"],
    ["NPM", "< 1.2.3", "<1.2.3"],
    ["NPM", "<= 1.2.3", "<=1.2.3"],
    ["NPM", "> 1.2.3", ">1.2.3"],
    ["NPM", ">= 0", null],
    ["NPM", ">= 0.0.0", null],
    ["NPM", ">= 0, < 3.0.0", "<3.0.0"],
    ["PUB", ">= 1.0.0, < 2.0.0", ">=1.0.0 <2.0.0"],
    ["PUB", "= 1.0.0", "1.0.0"],
    ["PIP", "= 1.5.1", "==1.5.1"],
    ["PIP", ">= 1.0, < 2.0", ">=1.0,<2.0"],
    ["PIP", "< 1.2.3", "<1.2.3"],
    ["PIP", ">= 0", null],
    ["RUST", "= 0.1.2", "=0.1.2"],
    ["RUST", ">= 1.0.0, < 2.0.0", ">=1.0.0,<2.0.0"],
    ["RUST", "< 0.3.0", "<0.3.0"],
    ["GO", "= 1.2.3", "=v1.2.3"],
    ["GO", ">= 1.0.0, < 2.0.0", ">=v1.0.0 <v2.0.0"],
    ["GO", "< 1.2.3", "<v1.2.3"],
    ["GO", ">= 0", null],
    ["NUGET", "= 1.5.1", "[1.5.1]"],
    ["NUGET", ">= 1.0, < 2.0", "[1.0,2.0)"],
    ["NUGET", "< 1.2.3", "(,1.2.3)"],
    ["NUGET", "<= 1.2.3", "(,1.2.3]"],
    ["NUGET", ">= 1.2.3", "[1.2.3,)"],
    ["NUGET", "> 1.2.3", "(1.2.3,)"],
    ["NUGET", "> 1.0, <= 2.0", "(1.0,2.0]"],
    ["NUGET", ">= 0", null],
    ["MAVEN", "= 1.5.1", "[1.5.1]"],
    ["MAVEN", ">= 1.0, < 2.0", "[1.0,2.0)"],
    ["MAVEN", "< 1.2.3", "(,1.2.3)"],
    ["ACTIONS", "= 1.2.3", "1.2.3"],
    ["ACTIONS", ">= 0", null],
  ];

  it.each(table)("[SE-20] %s %s → %s", (ghsa, raw, expected) => {
    const converted = convertAdvisory(ghsa, ghsa === "MAVEN" ? "com.x:y" : ghsa === "ACTIONS" ? "a/b" : "pkg", raw);
    expect(converted).not.toBeNull();
    expect(converted?.versionRange).toBe(expected);
  });

  it("[SE-21] 종류의 대응: 10개를 지원하고 그 외는 건너뛴다(null)", () => {
    expect(Object.fromEntries(Object.entries(GHSA_ECOSYSTEMS))).toEqual({
      NPM: "npm",
      PIP: "pypi",
      NUGET: "nuget",
      RUST: "cargo",
      GO: "go",
      MAVEN: "maven",
      PUB: "pub",
      ACTIONS: "actions",
      RUBYGEMS: "rubygems",
      COMPOSER: "composer",
    });
    for (const skipped of ["SWIFT", "ERLANG", "", "npm"]) {
      expect(convertAdvisory(skipped, "pkg", "= 1.0.0")).toBeNull();
    }
  });

  it("[SE-22] actions 는 정확한 값만 지원한다: 비교식은 건너뛴다", () => {
    expect(convertAdvisory("ACTIONS", "a/b", "< 1.2.3")).toBeNull();
    expect(convertAdvisory("ACTIONS", "a/b", ">= 1.0, < 2.0")).toBeNull();
  });

  it("[SE-23] 이름은 종류의 규칙으로 정규화한다 (pypi = PEP 503, nuget = 소문자, actions = 소문자)", () => {
    expect(convertAdvisory("PIP", "Evil_Pkg.X", "= 1.0")?.name).toBe("evil-pkg-x");
    expect(convertAdvisory("NUGET", "Evil.Pkg", "= 1.0")?.name).toBe("evil.pkg");
    expect(convertAdvisory("ACTIONS", "Owner/Repo", "= v1")?.name).toBe("owner/repo");
    expect(convertAdvisory("NPM", "@Scope/Pkg", "= 1.0.0")?.name).toBe("@Scope/Pkg");
  });

  it("[SE-24] 읽을 수 없는 범위와 이름은 건너뛴다(null)", () => {
    expect(convertAdvisory("NPM", "pkg", "")).toBeNull();
    expect(convertAdvisory("NPM", "pkg", "garbage")).toBeNull();
    expect(convertAdvisory("NPM", "pkg", ">= 1.0, , < 2.0")).toBeNull();
    expect(convertAdvisory("NPM", "pkg", "= not.a.version!")).toBeNull();
    expect(convertAdvisory("NPM", "pkg*", "= 1.0.0")).toBeNull();
    expect(convertAdvisory("NPM", "bad name", "= 1.0.0")).toBeNull();
    expect(convertAdvisory("MAVEN", "not-a-coordinate", "= 1.0")).toBeNull();
    expect(convertAdvisory("NUGET", "pkg", ">= 1.0, >= 2.0")).toBeNull();
    expect(convertAdvisory("NUGET", "pkg", "= 1.0, < 2.0")).toBeNull();
    expect(convertAdvisory("NUGET", "pkg", ">= 2.0, < 1.0")).toBeNull();
    expect(convertAdvisory("GO", "github.com/x/y", "= 1.2")).toBeNull();
    expect(convertAdvisory("NPM", "x".repeat(300), "= 1.0.0")).toBeNull();
    expect(convertAdvisory("NPM", "pkg", `= ${"1".repeat(600)}`)).toBeNull();
  });

  it("[SE-25] 변환한 범위로 종류의 규칙이 버전을 판정한다 (끝에서 끝)", () => {
    const check = (ghsa: string, name: string, raw: string, eco: Ecosystem, version: string): boolean => {
      const converted = convertAdvisory(ghsa, name, raw);
      return ECOSYSTEM_RULES[eco].satisfies(version, converted?.versionRange ?? "");
    };
    expect(check("NPM", "p", ">= 1.0.0, < 2.0.0", "npm", "1.5.0")).toBe(true);
    expect(check("NPM", "p", ">= 1.0.0, < 2.0.0", "npm", "2.0.0")).toBe(false);
    expect(check("PIP", "p", ">= 1.0, < 2.0", "pypi", "1.5")).toBe(true);
    expect(check("GO", "github.com/x/y", ">= 1.0.0, < 2.0.0", "go", "v1.5.0")).toBe(true);
    expect(check("NUGET", "p", ">= 1.0, < 2.0", "nuget", "2.0")).toBe(false);
    expect(check("MAVEN", "a:b", "= 1.5.1", "maven", "1.5.1")).toBe(true);
    expect(check("RUST", "p", "= 0.1.2", "cargo", "0.1.2")).toBe(true);
  });
});
