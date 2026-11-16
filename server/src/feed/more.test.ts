import { ECOSYSTEM_RULES } from "@pw/shared";
import { describe, expect, it } from "vitest";
import { comparableRange } from "./comparable.ts";
import { convertAdvisory } from "./ranges.ts";

describe("[SG-20] 외부 목록: RubyGems·Composer 범위의 변환", () => {
  const table: [string, string, string | null][] = [
    ["RUBYGEMS", "= 1.0.1", "= 1.0.1"],
    ["RUBYGEMS", ">= 1.0, < 2.0", ">= 1.0, < 2.0"],
    ["RUBYGEMS", "< 1.2.3", "< 1.2.3"],
    ["RUBYGEMS", "<= 1.2.3", "<= 1.2.3"],
    ["RUBYGEMS", "> 1.0, <= 2.0", "> 1.0, <= 2.0"],
    ["RUBYGEMS", ">= 0", null],
    ["RUBYGEMS", "> 0", null],
    ["RUBYGEMS", ">= 0, < 3.0", "< 3.0"],
    ["COMPOSER", "= 1.0.1", "1.0.1"],
    ["COMPOSER", ">= 1.0, < 2.0", ">=1.0 <2.0"],
    ["COMPOSER", "< 1.2.3", "<1.2.3"],
    ["COMPOSER", ">= 0", null],
  ];

  it.each(table)("%s %s → %s", (ghsa, raw, expected) => {
    const name = ghsa === "COMPOSER" ? "vendor/pkg" : "pkg";
    const converted = convertAdvisory(ghsa, name, raw);
    expect(converted).not.toBeNull();
    expect(converted?.versionRange).toBe(expected);
    if (expected !== null) {
      const rule = ECOSYSTEM_RULES[converted?.ecosystem ?? "npm"];
      expect(rule.validateRange(expected)).toBeNull();
    }
  });

  it("[SG-21] 이름 규칙에 맞지 않으면 건너뛰고, Composer 의 이름은 소문자로 저장한다", () => {
    expect(convertAdvisory("COMPOSER", "no-slash", "= 1.0.0")).toBeNull();
    expect(convertAdvisory("RUBYGEMS", "has space", "= 1.0.0")).toBeNull();
    expect(convertAdvisory("COMPOSER", "Vendor/Pkg", "= 1.0.0")?.name).toBe("vendor/pkg");
    expect(convertAdvisory("SWIFT", "pkg", "= 1.0.0")).toBeNull();
  });

  it("[SG-22] comparableRange: 새 종류의 모든 버전 표기는 '' 이고 같은 뜻은 같은 문자열이다", () => {
    for (const eco of ["rubygems", "cocoapods", "composer"]) {
      for (const all of [null, "", "*", ">=0", ">= 0", ">0"]) expect(comparableRange(eco, all), `${eco} ${all}`).toBe("");
    }
    for (const eco of ["vscode", "helm", "terraform"]) {
      for (const all of [null, "", "*"]) expect(comparableRange(eco, all), `${eco} ${all}`).toBe("");
    }
    expect(comparableRange("rubygems", ">= 1.0,<2.0")).toBe(comparableRange("rubygems", ">= 1.0, < 2.0"));
    expect(comparableRange("rubygems", "< 1.0")).not.toBe(comparableRange("rubygems", "< 1.1"));
    expect(comparableRange("composer", ">=1.0  <2.0")).toBe(comparableRange("composer", ">=1.0 <2.0"));
    expect(comparableRange("helm", "4.10.0, 4.10.1")).toBe(comparableRange("helm", "4.10.0,4.10.1"));
  });
});
