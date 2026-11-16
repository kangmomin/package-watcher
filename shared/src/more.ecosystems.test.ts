import { describe, expect, it } from "vitest";
import { categoryOf, usesVersionRange, type Ecosystem } from "./contract.ts";
import { ECOSYSTEM_RULES } from "./ecosystems.ts";

const rule = (ecosystem: Ecosystem) => ECOSYSTEM_RULES[ecosystem];

describe("[SG-01] rubygems·cocoapods: gem 의 버전과 요구식", () => {
  it.each(["rubygems", "cocoapods"] as const)("%s 범위: 쉼표로 나눈 비교식", (ecosystem) => {
    const { validateRange } = rule(ecosystem);
    for (const range of ["= 1.2.3", "1.2.3", ">= 1.0, < 2.0", "~> 1.2", "!= 1.0", ">=1.0.0.rc1", "< 1.2.3-beta"]) {
      expect(validateRange(range), range).toBeNull();
    }
    for (const range of ["", "^1.0", ">= 1.0 < 2.0", "latest", ">= a.b", ","]) {
      expect(validateRange(range), JSON.stringify(range)).toEqual(expect.any(String));
    }
  });

  it("비교: 마디 수가 달라도 같고, 문자 마디(prerelease)는 릴리스보다 작다", () => {
    const { satisfies } = rule("rubygems");
    expect(satisfies("1.0", "= 1.0.0")).toBe(true);
    expect(satisfies("1.6.13", ">= 1.6.10, < 1.6.14")).toBe(true);
    expect(satisfies("1.6.14", ">= 1.6.10, < 1.6.14")).toBe(false);
    expect(satisfies("1.0.0.rc1", "< 1.0.0")).toBe(true);
    expect(satisfies("1.0.0.rc1", ">= 1.0.0")).toBe(false);
    expect(satisfies("1.0.0-beta", "< 1.0.0")).toBe(true);
    expect(satisfies("1.0.0.rc2", "> 1.0.0.rc1")).toBe(true);
    expect(satisfies("10.0.0", "> 9.9.9")).toBe(true);
    expect(satisfies("1.2.3", "!= 1.2.3")).toBe(false);
    expect(satisfies("not a version", ">= 0")).toBe(false);
    expect(satisfies("1.0", "not a range")).toBe(false);
  });

  it("~> 는 마지막 마디만 올라갈 수 있다", () => {
    const { satisfies } = rule("rubygems");
    expect(satisfies("1.2.9", "~> 1.2.3")).toBe(true);
    expect(satisfies("1.3.0", "~> 1.2.3")).toBe(false);
    expect(satisfies("1.2.2", "~> 1.2.3")).toBe(false);
    expect(satisfies("1.9", "~> 1.2")).toBe(true);
    expect(satisfies("2.0", "~> 1.2")).toBe(false);
    expect(satisfies("1.5", "~> 1")).toBe(true);
    expect(satisfies("2.0", "~> 1")).toBe(false);
  });

  it("선언의 고정 버전: `= x` 와 버전만 있는 것", () => {
    expect(rule("rubygems").exactVersionOf("= 1.2.3")).toBe("1.2.3");
    expect(rule("rubygems").exactVersionOf("1.2.3")).toBe("1.2.3");
    expect(rule("rubygems").exactVersionOf("~> 1.2")).toBeNull();
    expect(rule("rubygems").exactVersionOf(">= 1.0")).toBeNull();
    expect(rule("cocoapods").exactVersionOf("3.2.1")).toBe("3.2.1");
  });

  it("이름: gem 과 pod(subspec 포함)", () => {
    expect(rule("rubygems").validateName("rest-client")).toBeNull();
    expect(rule("rubygems").validateName("has space")).toEqual(expect.any(String));
    expect(rule("cocoapods").validateName("Firebase/Auth")).toBeNull();
    expect(rule("cocoapods").validateName("GoogleUtilities+Extra")).toBeNull();
    expect(rule("cocoapods").validateName("/Auth")).toEqual(expect.any(String));
  });
});

describe("[SG-02] composer", () => {
  it("이름은 vendor/package 이고 소문자로 저장한다", () => {
    expect(rule("composer").validateName("intercom/intercom-php")).toBeNull();
    expect(rule("composer").normalizeName("Intercom/Intercom-PHP")).toBe("intercom/intercom-php");
    expect(rule("composer").validateName("intercom-php")).toEqual(expect.any(String));
    expect(rule("composer").validateName("vendor/*")).toBeNull();
  });

  it("범위: 공백·쉼표는 AND, | 와 || 는 OR, v 접두를 받는다", () => {
    const { validateRange, satisfies } = rule("composer");
    for (const range of ["5.0.2", "v5.0.2", ">=1.0 <2.0", ">=1.0,<2.0", "^1.2", "~1.2.3", "1.0.* || 2.0.*", "1.0|2.0", ">=1.0@stable"]) {
      expect(validateRange(range), range).toBeNull();
    }
    for (const range of ["", "dev-master", ">= a"]) {
      expect(validateRange(range), JSON.stringify(range)).toEqual(expect.any(String));
    }
    expect(satisfies("5.0.2", "5.0.2")).toBe(true);
    expect(satisfies("v5.0.2", "5.0.2")).toBe(true);
    expect(satisfies("1.5.0", ">=1.0,<2.0")).toBe(true);
    expect(satisfies("2.0.0", ">=1.0,<2.0")).toBe(false);
    expect(satisfies("2.0.3", "1.0.* || 2.0.*")).toBe(true);
    expect(satisfies("1.2.3.4", ">=1.2.3 <1.2.4")).toBe(true);
    expect(satisfies("dev-master", ">=1.0")).toBe(false);
  });

  it("선언의 고정 버전", () => {
    expect(rule("composer").exactVersionOf("5.0.2")).toBe("5.0.2");
    expect(rule("composer").exactVersionOf("v5.0.2")).toBe("v5.0.2");
    expect(rule("composer").exactVersionOf("^5.0")).toBeNull();
    expect(rule("composer").exactVersionOf("dev-master")).toBeNull();
    expect(rule("composer").exactVersionOf("1.0.*")).toBeNull();
  });
});

describe("[SG-03] vscode·helm·terraform: 정확한 값의 목록", () => {
  it("분류는 ci 이고 범위를 쓴다", () => {
    for (const ecosystem of ["vscode", "helm", "terraform"] as const) {
      expect(categoryOf(ecosystem)).toBe("ci");
      expect(usesVersionRange(ecosystem)).toBe(true);
      expect(rule(ecosystem).validateRange("1.0.0, 1.0.1")).toBeNull();
      expect(rule(ecosystem).validateRange(">=1.0.0")).toEqual(expect.any(String));
      expect(rule(ecosystem).satisfies("1.0.1", "1.0.0, 1.0.1")).toBe(true);
      expect(rule(ecosystem).satisfies("1.0.2", "1.0.0, 1.0.1")).toBe(false);
      // 앞부분 비교는 SHA·digest 가 있는 종류(actions, docker)만 한다.
      expect(rule(ecosystem).satisfies("1234567890abcdef1234567890abcdef12345678", "1234567")).toBe(false);
      expect(rule(ecosystem).exactVersionOf("1.0.0")).toBe("1.0.0");
    }
  });

  it("이름", () => {
    expect(rule("vscode").validateName("ms-python.python")).toBeNull();
    expect(rule("vscode").normalizeName("MS-Python.Python")).toBe("ms-python.python");
    expect(rule("vscode").validateName("python")).toEqual(expect.any(String));
    expect(rule("helm").validateName("ingress-nginx")).toBeNull();
    expect(rule("helm").validateName("bitnami/redis")).toBeNull();
    expect(rule("helm").validateName("has space")).toEqual(expect.any(String));
    expect(rule("terraform").validateName("terraform-aws-modules/vpc/aws")).toBeNull();
    expect(rule("terraform").validateName("git::https://github.com/org/module.git")).toBeNull();
    expect(rule("terraform").validateName("has space")).toEqual(expect.any(String));
  });
});

describe("[SG-04] commit·pr: 글자 그대로의 문자열", () => {
  it.each(["commit", "pr"] as const)("%s: 6~200자, * 와 줄바꿈은 거부, 범위를 쓰지 않는다", (ecosystem) => {
    const { validateName, validateRange, nameExample } = rule(ecosystem);
    expect(categoryOf(ecosystem)).toBe("indicator");
    expect(usesVersionRange(ecosystem)).toBe(false);
    expect(validateName(nameExample)).toBeNull();
    expect(validateName("Add Github Actions Security workflow")).toBeNull();
    for (const name of ["", "abcde", "a".repeat(201), "abc\ndef", "chore: *", "......"]) {
      expect(validateName(name), JSON.stringify(name)).toEqual(expect.any(String));
    }
    expect(validateRange("1")).toEqual(expect.any(String));
  });
});
