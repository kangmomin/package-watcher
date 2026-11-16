// 종류(ecosystem)별 규칙: 이름, 정규화, 범위 문법, 버전 비교, 선언 spec 의 정확한 버전.
import { describe, expect, it } from "vitest";
import { ECOSYSTEMS, usesVersionRange, type Ecosystem } from "./contract.ts";
import { ECOSYSTEM_RULES, normalizeEntryName, validateEntryFields } from "./ecosystems.ts";

const rule = (ecosystem: Ecosystem) => ECOSYSTEM_RULES[ecosystem];

/** [종류, 값] 목록을 it.each 의 표로 만든다. */
function cases(table: Partial<Record<Ecosystem, string[]>>): [Ecosystem, string][] {
  return (Object.entries(table) as [Ecosystem, string[]][]).flatMap(([ecosystem, values]) =>
    values.map((value) => [ecosystem, value] as [Ecosystem, string]),
  );
}

describe("[ME-01] 이름 규칙", () => {
  it("모든 종류에 규칙과 예시가 있고, 예시는 자기 규칙을 통과한다", () => {
    expect(Object.keys(ECOSYSTEM_RULES).sort()).toEqual([...ECOSYSTEMS].sort());
    for (const ecosystem of ECOSYSTEMS) {
      const { nameExample, rangeExample, validateName, validateRange } = rule(ecosystem);
      if (!usesVersionRange(ecosystem)) {
        // 범위를 쓰지 않는 종류: 범위의 예시가 없고 어떤 값도 받지 않는다. 이름의 예시는 [SC-01] 이 본다.
        expect(rangeExample, `${ecosystem} rangeExample`).toBe("");
        expect(validateRange("1.0.0"), `${ecosystem} 범위`).toEqual(expect.any(String));
        continue;
      }
      expect(validateName(nameExample), `${ecosystem} nameExample`).toBeNull();
      expect(rangeExample.length, `${ecosystem} rangeExample`).toBeGreaterThan(0);
      // 예시 1줄은 "A, B" 처럼 여러 예를 담을 수 있다. 첫 번째 예는 그대로 입력할 수 있어야 한다.
      const first = RANGE_EXAMPLE_FIRST[ecosystem] ?? "";
      expect(rangeExample.startsWith(first), `${ecosystem} rangeExample 의 첫 예`).toBe(true);
      expect(validateRange(first), `${ecosystem} 첫 예`).toBeNull();
    }
  });

  it.each(
    cases({
      npm: ["lodash", "@scope/pkg", "JSONStream", "a".repeat(214)],
      go: ["github.com/evil/mod", "gopkg.in/yaml.v3", "golang.org/x/net", "example.com/a/b/v2"],
      pypi: ["requests", "Foo_Bar", "zope.interface", "a", "A1"],
      nuget: ["Newtonsoft.Json", "_internal", "Microsoft.Extensions.Logging", "a".repeat(100)],
      cargo: ["serde", "serde_json", "tokio-util", "a".repeat(64)],
      pub: ["http", "flutter_bloc", "_private", "a2"],
      maven: ["com.google.guava:guava", "org.jetbrains.kotlin:kotlin-stdlib", "a:b"],
    }),
  )("%s: 이름 %s 허용", (ecosystem, name) => {
    expect(rule(ecosystem).validateName(name)).toBeNull();
  });

  it.each(
    cases({
      npm: ["has space", "@scope", "a".repeat(215)],
      go: ["/github.com/a/b", "github.com/a/b/", "github.com//b", "has space", "a:b", "a".repeat(256)],
      pypi: ["-requests", "requests-", "foo bar", "foo/bar", ".a"],
      nuget: [".Start", "has space", "a/b", "a".repeat(101)],
      cargo: ["_serde", "serde.json", "-a", "a".repeat(65)],
      pub: ["Http", "1abc", "a-b", "a.b"],
      maven: ["guava", "a:b:c", ":name", "group:", "g r:n", "a/b:c"],
    }),
  )("%s: 이름 %s 거부", (ecosystem, name) => {
    expect(rule(ecosystem).validateName(name)).toEqual(expect.any(String));
  });

  it("빈 이름은 모든 종류에서 오류다", () => {
    for (const ecosystem of ECOSYSTEMS) {
      expect(rule(ecosystem).validateName("")).toEqual(expect.any(String));
    }
  });

  it("npm 의 메시지는 묶음 1 그대로이고, 다른 종류는 메시지에 종류를 밝힌다", () => {
    expect(rule("npm").validateName("has space")).toBe("npm 패키지 이름 형식이 아닙니다");
    expect(rule("npm").validateName("a".repeat(215))).toBe("패키지 이름은 214자 이하입니다");
    expect(rule("go").validateName("has space")).toContain("Go 모듈 경로");
    expect(rule("pypi").validateName("foo bar")).toContain("PyPI");
    expect(rule("nuget").validateName("a/b")).toContain("NuGet");
    expect(rule("cargo").validateName("a.b")).toContain("Cargo");
    expect(rule("pub").validateName("Http")).toContain("pub");
    expect(rule("maven").validateName("guava")).toContain("group:name");
  });

  it.each(
    cases({
      npm: ["@evil/*", "*-malware", "ab*"],
      go: ["github.com/evil/*", "*/evil/mod"],
      pypi: ["evil-*", "*_stealer", "ab*"],
      nuget: ["Evil.*", "*Stealer"],
      cargo: ["evil-*", "*_sys"],
      pub: ["evil_*", "*_stealer"],
      maven: ["com.evil:*", "com.evil.*:*", "*:evil-lib"],
    }),
  )("%s: 패턴 %s 허용", (ecosystem, name) => {
    expect(rule(ecosystem).validateName(name)).toBeNull();
  });

  it.each(
    cases({
      npm: ["*", "@*/*", "a*", "evil/*?"],
      go: ["*", "*/*", "evil:*", "a*"],
      pypi: ["*", "a*", "evil/*", "evil *"],
      nuget: ["*", "a.*", "evil/*"],
      cargo: ["*", "evil.*", "a-*"],
      pub: ["*", "Evil_*", "evil-*", "a_*"],
      maven: ["*", "*:*", "a:*", "evil/*:x"],
    }),
  )("%s: 패턴 %s 거부", (ecosystem, name) => {
    expect(rule(ecosystem).validateName(name)).toEqual(expect.any(String));
  });

  it("패턴의 메시지는 묶음 1 그대로다 (모든 종류)", () => {
    // content 는 패턴이 아니라 글자 그대로의 문자열이라 `*` 자체를 받지 않는다.
    for (const ecosystem of ECOSYSTEMS.filter((value) => value !== "content")) {
      expect(rule(ecosystem).validateName("ab?*")).toBe("패턴에 쓸 수 없는 문자가 있습니다");
      expect(rule(ecosystem).validateName("*")).toBe("패턴에 영문자·숫자가 2자 이상 있어야 합니다");
    }
  });
});

/** 계획의 표에 있는 예. 화면이 `rangeExample` 을 그대로 보여 준다. */
const RANGE_EXAMPLE_FIRST: Partial<Record<Ecosystem, string>> = {
  npm: "<4.17.21",
  go: "<v0.4.30",
  pypi: "<1.0,>=0.5",
  nuget: "[1.0,2.0)",
  cargo: "<1.2.0",
  pub: ">=1.0.0 <2.0.0",
  maven: "[1.0,2.0)",
  actions: "v0.34.0, v0.34.1",
  docker: "v1.107.0, latest",
};

describe("[v2-AC-11] 이름 정규화", () => {
  it("pypi 는 PEP 503 (소문자, -_. 의 연속 → -)", () => {
    expect(rule("pypi").normalizeName("Foo_Bar")).toBe("foo-bar");
    expect(rule("pypi").normalizeName("zope.interface")).toBe("zope-interface");
    expect(rule("pypi").normalizeName("A__b-._C")).toBe("a-b-c");
    expect(normalizeEntryName("pypi", "Foo_Bar")).toBe("foo-bar");
  });

  it("nuget 은 소문자", () => {
    expect(rule("nuget").normalizeName("Newtonsoft.Json")).toBe("newtonsoft.json");
    expect(normalizeEntryName("nuget", "Newtonsoft.Json")).toBe("newtonsoft.json");
  });

  it("패턴의 * 를 보존한다", () => {
    expect(rule("pypi").normalizeName("Evil_*")).toBe("evil-*");
    expect(rule("pypi").normalizeName("*.Stealer")).toBe("*-stealer");
    expect(rule("nuget").normalizeName("Evil.*")).toBe("evil.*");
  });

  it.each(
    cases({
      npm: ["JSONStream", "@Scope/Pkg_a.b"],
      go: ["github.com/BurntSushi/toml"],
      cargo: ["Serde_JSON"],
      pub: ["flutter_bloc"],
      maven: ["com.Google.guava:Guava"],
    }),
  )("%s: %s 는 그대로다 (대소문자 구분)", (ecosystem, name) => {
    expect(rule(ecosystem).normalizeName(name)).toBe(name);
    expect(normalizeEntryName(ecosystem, name)).toBe(name);
  });
});

describe("[ME-02] 범위 검증", () => {
  it.each(
    cases({
      npm: ["<4.17.21", "^1.2.3", ">=1.0.0 <2.0.0", "1.x || 2.x", "1.2.3"],
      go: ["<v0.4.30", ">=v1.0.0 <v2.0.0", "=v1.2.3", "v1.2.3", "<=v2.0.0+incompatible", "<v0.0.0-20210101000000-abcdef123456"],
      pypi: ["==1.2.3", "<1.0,>=0.5", "~=1.4", "!=1.5", "==1.*", ">=1.0rc1", "< 2 , >= 1"],
      nuget: ["[1.0,2.0)", "(,1.5]", "[1.2.3]", "[1.0,)", "(1.0,2.0]", "[ 1.0 , 2.0 )", "[1.0.0-beta,1.0.0]"],
      cargo: ["<1.2.0", ">=1, <2", "=1.2.3", "1.2", "^1.2.3", "~1.2", "1.*", ">= 1.2.0", "*"],
      pub: [">=1.0.0 <2.0.0", "^1.2.3", "1.2.3", "<3.0.0"],
      maven: ["[1.0,2.0)", "(,1.5]", "[1.2.3]", "[1.0,)", "[1.0-rc1,1.0]", "[31.0-jre,32.0-jre)"],
    }),
  )("%s: 범위 %s 허용", (ecosystem, range) => {
    expect(rule(ecosystem).validateRange(range)).toBeNull();
  });

  it.each(
    cases({
      npm: ["not-a-range!!", "[1.0,2.0)", "<v1.0,>=0.5"],
      go: ["<1.0.0", ">=1.0.0 <2.0.0", "^v1.2.3", "~v1.2.3", "<v1", "[v1.0.0,v2.0.0)", "<v1.0.0,>=v0.5.0", "v", "<"],
      pypi: ["[1.0,2.0)", "1.2.3", "^1.2.3", ">=1.0.0 <2.0.0", "<1.0,", "garbage"],
      nuget: ["<1.0", "1.2.3", "^1.2.3", "[1.0,2.0", "1.0,2.0)", "(1.0)", "[2.0,1.0]", "[1.0,1.0)", "[a,b]", "[1.0,2.0,3.0]", "(,)", "[]", "[1.*]"],
      cargo: [">=1 <2", "[1.0,2.0)", "==1.2.3", "<1.0,", "v1.2.3", "!=1.5", ""],
      pub: ["[1.0,2.0)", "==1.2.3", "<1.0,>=0.5", "garbage!!"],
      maven: ["<1.0", "1.2.3", "[1.0,2.0", "(1.0)", "[2.0,1.0]", "[1.+]", "[$v]", "(,)", "[]"],
    }),
  )("%s: 범위 %s 거부", (ecosystem, range) => {
    expect(rule(ecosystem).validateRange(range)).toEqual(expect.any(String));
  });

  it("npm 의 메시지는 묶음 1 그대로다", () => {
    expect(rule("npm").validateRange("not-a-range!!")).toBe("유효한 semver 범위가 아닙니다");
  });

  it("다른 종류의 메시지는 종류와 예를 밝힌다", () => {
    expect(rule("go").validateRange("<1.0.0")).toContain("v");
    expect(rule("go").validateRange("<1.0.0")).toContain("Go");
    expect(rule("pypi").validateRange("[1.0,2.0)")).toContain("PEP 440");
    expect(rule("cargo").validateRange(">=1 <2")).toContain("Cargo");
    expect(rule("pub").validateRange("[1.0,2.0)")).toContain("pub");
  });

  it.each(["nuget", "maven"] as const)("%s: 괄호 없는 값의 메시지가 [1.2.3] 형식을 안내한다", (ecosystem) => {
    expect(rule(ecosystem).validateRange("1.2.3")).toContain(
      "정확한 버전은 [1.2.3] 형식으로 적으십시오",
    );
  });
});

describe("[v2-EC-02] validateEntryFields: 그 종류의 문법에 맞지 않는 범위", () => {
  it("오류가 있는 필드만 돌려준다", () => {
    expect(validateEntryFields("pypi", "requests", "<1.0,>=0.5")).toEqual({});
    expect(validateEntryFields("pypi", "requests", null)).toEqual({});
    expect(Object.keys(validateEntryFields("pypi", "requests", "[1.0,2.0)"))).toEqual(["versionRange"]);
    expect(Object.keys(validateEntryFields("nuget", "Newtonsoft.Json", "<1.0"))).toEqual(["versionRange"]);
    expect(Object.keys(validateEntryFields("go", "github.com/a/b", "<1.0.0"))).toEqual(["versionRange"]);
    expect(Object.keys(validateEntryFields("maven", "guava", null))).toEqual(["name"]);
    expect(Object.keys(validateEntryFields("pub", "Http", "[1.0,2.0)")).sort()).toEqual([
      "name",
      "versionRange",
    ]);
  });

  it("메시지는 규칙의 메시지와 같다", () => {
    expect(validateEntryFields("npm", "has space", "!!")).toEqual({
      name: "npm 패키지 이름 형식이 아닙니다",
      versionRange: "유효한 semver 범위가 아닙니다",
    });
    expect(validateEntryFields("go", "has space", null).name).toBe(rule("go").validateName("has space"));
  });
});

/** [버전, 범위, 기대값] */
type Match = [version: string, range: string, expected: boolean];

describe("[ME-03] 버전 비교", () => {
  const check = (ecosystem: Ecosystem, table: Match[]) => {
    for (const [version, range, expected] of table) {
      expect(rule(ecosystem).satisfies(version, range), `${ecosystem}: ${version} in ${range}`).toBe(
        expected,
      );
    }
  };

  it("npm: semver, prerelease 포함", () => {
    check("npm", [
      ["4.17.20", "<4.17.21", true],
      ["4.17.21", "<4.17.21", false],
      ["4.17.21-rc.1", "<4.17.21", true],
      ["1.2.3", "1.2.3", true],
      ["2.0.0-beta.1", ">=1.0.0", true],
      ["1.5.0", "1.x || 3.x", true],
      ["2.5.0", "1.x || 3.x", false],
    ]);
  });

  it("pub: semver (연산자 없는 값 = 정확히)", () => {
    check("pub", [
      ["1.0.0", ">=1.0.0 <2.0.0", true],
      ["2.0.0", ">=1.0.0 <2.0.0", false],
      ["1.9.9", "^1.2.3", true],
      ["1.2.2", "^1.2.3", false],
      ["1.2.3", "1.2.3", true],
      ["1.2.4", "1.2.3", false],
      ["1.2.3+4", "1.2.3", true],
      ["2.0.0-dev.1", "<2.0.0", true],
    ]);
  });

  it("cargo: 연산자 없는 값은 caret, 쉼표는 AND", () => {
    check("cargo", [
      ["1.2.0", "1.2", true],
      ["1.9.0", "1.2", true],
      ["2.0.0", "1.2", false],
      ["1.1.9", "1.2", false],
      ["0.2.5", "0.2", true],
      ["0.3.0", "0.2", false],
      ["1.2.3", "=1.2.3", true],
      ["1.2.4", "=1.2.3", false],
      ["1.1.9", "<1.2.0", true],
      ["1.2.0", "<1.2.0", false],
      ["1.2.0", "<=1.2.0", true],
      ["1.0.0", ">=1, <2", true],
      ["1.9.9", ">=1, <2", true],
      ["2.0.0", ">=1, <2", false],
      ["0.9.9", ">=1, <2", false],
      ["1.2.9", "~1.2", true],
      ["1.3.0", "~1.2", false],
      ["1.9.0", "1.*", true],
      ["2.0.0", "1.*", false],
      ["1.2.0", ">1.2.0", false],
      ["1.2.1", "> 1.2.0", true],
      ["1.2.0-alpha.1", "<1.2.0", true],
    ]);
  });

  it("go: v 접두, pseudo-version, +incompatible", () => {
    check("go", [
      ["v0.4.29", "<v0.4.30", true],
      ["v0.4.30", "<v0.4.30", false],
      ["v0.0.0-20210101000000-abcdef123456", "<v0.4.30", true],
      ["v0.0.0-20210101000000-abcdef123456", ">=v0.0.1", false],
      ["v1.0.0", ">=v1.0.0 <v2.0.0", true],
      ["v1.9.9", ">=v1.0.0 <v2.0.0", true],
      ["v2.0.0", ">=v1.0.0 <v2.0.0", false],
      ["v2.0.0+incompatible", ">=v1.0.0 <v2.0.0", false],
      ["v2.0.0+incompatible", ">=v2.0.0", true],
      ["v1.2.3", "=v1.2.3", true],
      ["v1.2.4", "=v1.2.3", false],
      ["v1.2.3", "v1.2.3", true],
      ["v1.2.4", "v1.2.3", false],
      ["v1.2.3-rc.1", "<v1.2.3", true],
      // 같은 날의 pseudo-version 끼리는 시각 순서다.
      ["v0.0.0-20210101000000-abcdef123456", "<v0.0.0-20220101000000-000000000000", true],
    ]);
  });

  it("pypi: PEP 440 의 순서 (1.0rc1 < 1.0)", () => {
    check("pypi", [
      ["1.2.3", "==1.2.3", true],
      ["1.2.3.0", "==1.2.3", true],
      ["1.2.4", "==1.2.3", false],
      ["0.5", "<1.0,>=0.5", true],
      ["0.9.9", "<1.0,>=0.5", true],
      ["1.0", "<1.0,>=0.5", false],
      ["0.4", "<1.0,>=0.5", false],
      ["1.4.5", "~=1.4", true],
      ["2.0", "~=1.4", false],
      ["1.5", "!=1.5", false],
      ["1.6", "!=1.5", true],
      ["1.2.9", "==1.2.*", true],
      ["1.0rc1", "<=1.0", true],
      ["1.0rc1", ">=1.0", false],
      ["1.0rc1", ">=0.5", true],
      ["1.0a1", "<=1.0rc1", true],
      ["1.0rc2", "<=1.0rc1", false],
      ["1.0.post1", ">=1.0", true],
      ["1.0.dev1", "<=1.0a1", true],
      ["1!0.1", ">=2.0", true],
    ]);
  });

  it("pypi: `<`·`>` 는 release 마디가 같은 버전을 포함하지 않는다 (PEP 440 의 배타 비교 규칙)", () => {
    check("pypi", [
      ["1.0rc1", "<1.0", false],
      ["0.9rc1", "<1.0", true],
      ["1.0.post1", ">1.0", false],
      // 라이브러리의 단순화: PEP 440 으로는 true 지만 release 마디(1.0)가 같아서 false 다.
      ["1.0a1", "<1.0rc1", false],
    ]);
  });

  it("nuget: 구간의 열림·닫힘, 숫자 마디 4개, prerelease", () => {
    check("nuget", [
      ["1.0", "[1.0,2.0)", true],
      ["1.0.0.0", "[1.0,2.0)", true],
      ["1.9.9", "[1.0,2.0)", true],
      ["2.0", "[1.0,2.0)", false],
      ["2.0.0", "[1.0,2.0]", true],
      ["0.9.9", "[1.0,2.0)", false],
      ["1.0", "(1.0,2.0)", false],
      ["1.0.0.1", "(1.0,2.0)", true],
      ["1.5", "(,1.5]", true],
      ["1.5.0.1", "(,1.5]", false],
      ["0.0.1", "(,1.5]", true],
      ["1.5", "(,1.5)", false],
      ["9.9.9", "[1.0,)", true],
      ["0.9", "[1.0,)", false],
      ["1.2.3", "[1.2.3]", true],
      ["1.2.3.0", "[1.2.3]", true],
      ["1.2.4", "[1.2.3]", false],
      ["1.2.3+build.5", "[1.2.3]", true],
      ["1.2.3-rc1", "[1.2.3]", false],
      // prerelease < 릴리스
      ["2.0.0-beta", "[1.0,2.0)", true],
      ["1.0.0-beta", "[1.0,2.0)", false],
      ["1.0.0-BETA", "[1.0.0-beta]", true],
      ["1.0.0-alpha", "(,1.0.0-beta)", true],
      ["1.0.0-beta.2", "(1.0.0-beta.1,1.0.0-beta.10)", true],
      ["1.0.0-beta.11", "(1.0.0-beta.1,1.0.0-beta.10)", false],
      ["10.0.0", "[9.0,)", true],
      ["13.0.1", "(,13.0.1)", false],
    ]);
  });

  it("maven: 구간과 수식어의 순서", () => {
    check("maven", [
      ["1.0", "[1.0,2.0)", true],
      ["1.0.0", "[1.0,2.0)", true],
      ["2.0", "[1.0,2.0)", false],
      ["1.5", "(,1.5]", true],
      ["1.5.1", "(,1.5]", false],
      ["1.2.3", "[1.2.3]", true],
      ["1.2.4", "[1.2.3]", false],
      ["9.0", "[1.0,)", true],
      ["1.10", "(1.9,)", true],
      ["2.0-SNAPSHOT", "[1.0,2.0)", true],
      ["2.0-rc1", "[1.0,2.0)", true],
      ["1.0-rc1", "[1.0,2.0)", false],
      ["1.0-sp1", "(1.0,2.0)", true],
      // 같은 버전의 다른 표기
      ["1.0.0", "[1]", true],
      ["1.0-ga", "[1.0]", true],
      ["1.0.Final", "[1.0]", true],
      ["1.0-RELEASE", "[1.0]", true],
      ["1.0-CR1", "[1.0-rc1]", true],
      ["1.0-a1", "[1.0-alpha1]", true],
      ["1.0-ALPHA-1", "[1.0-alpha1]", true],
      ["1.0alpha1", "[1.0-alpha-1]", true],
      ["1.0.0-beta2", "[1-b2]", true],
      // 숫자는 수로 비교한다
      ["1.0-rc10", "(1.0-rc9,1.0)", true],
      ["1.0-alpha02", "[1.0-alpha2]", true],
      // 모르는 수식어: 릴리스·sp 보다 뒤, 서로는 문자열 순
      ["31.1-jre", "(31.1,)", true],
      ["31.1-android", "(,31.1-jre)", true],
      ["31.1-jre", "(,31.1-android]", false],
      ["31.1-jre", "(31.1-sp1,)", true],
      ["31.1.1", "(31.1-jre,)", true],
    ]);
  });

  it("maven: alpha < beta < milestone < rc < snapshot < 릴리스 < sp < 다음 숫자", () => {
    const ordered = [
      "1.0-alpha1",
      "1.0-alpha2",
      "1.0-beta1",
      "1.0-m1",
      "1.0-rc1",
      "1.0-SNAPSHOT",
      "1.0",
      "1.0-sp1",
      "1.0.1",
      "1.1",
    ];
    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = 0; j < ordered.length; j += 1) {
        const lower = ordered[i] as string;
        const upper = ordered[j] as string;
        expect(rule("maven").satisfies(lower, `(,${upper})`), `${lower} < ${upper}`).toBe(i < j);
        expect(rule("maven").satisfies(lower, `(,${upper}]`), `${lower} <= ${upper}`).toBe(i <= j);
      }
    }
  });
});

describe("[v2-EC-09] 읽을 수 없는 버전·범위는 불일치다 (예외 없음)", () => {
  const UNREADABLE_VERSIONS = ["", " ", "abc", "latest", "1.2.3.4.5.6!", "$(Version)", "${version}", "*", "1.+", "^^1", "git+https://x/y.git", "\u0000"];

  it.each(
    cases({
      npm: ["<4.17.21"],
      go: ["<v0.4.30"],
      pypi: ["<1.0,>=0.5"],
      nuget: ["[1.0,2.0)"],
      cargo: [">=1, <2"],
      pub: [">=1.0.0 <2.0.0"],
      maven: ["[1.0,2.0)"],
    }),
  )("%s: 읽을 수 없는 버전 → false (범위 %s)", (ecosystem, range) => {
    for (const version of UNREADABLE_VERSIONS) {
      expect(rule(ecosystem).satisfies(version, range), JSON.stringify(version)).toBe(false);
    }
  });

  it.each(
    cases({
      npm: ["1.5.0"],
      go: ["v1.5.0"],
      pypi: ["1.5.0"],
      nuget: ["1.5.0"],
      cargo: ["1.5.0"],
      pub: ["1.5.0"],
      maven: ["1.5.0"],
    }),
  )("%s: 읽을 수 없는 범위 → false (버전 %s)", (ecosystem, version) => {
    for (const range of ["not a range!!", "[1.0,2.0", "<<1", "\u0000", "[a,b]", "v", ",", "(,)"]) {
      expect(rule(ecosystem).satisfies(version, range), JSON.stringify(range)).toBe(false);
    }
  });

  it("종류의 규칙 밖의 버전 표기", () => {
    // go.mod 의 버전에는 항상 v 가 있다.
    expect(rule("go").satisfies("1.5.0", ">=v1.0.0")).toBe(false);
    expect(rule("go").satisfies("v1.5", ">=v1.0.0")).toBe(false);
    expect(rule("go").satisfies("v1.5.0", ">=1.0.0")).toBe(false);
    expect(rule("nuget").satisfies("1.2.3.4.5", "[1.0,2.0)")).toBe(false);
    expect(rule("nuget").satisfies("1.*", "[1.0,2.0)")).toBe(false);
    expect(rule("maven").satisfies("latest.release", "[1.0,2.0)")).toBe(false);
    expect(rule("cargo").satisfies("1.5", ">=1, <2")).toBe(false);
    expect(rule("pypi").satisfies("1.5.0", "[1.0,2.0)")).toBe(false);
  });

  it("문자열이 아닌 값이 들어와도 예외를 던지지 않는다", () => {
    for (const ecosystem of ECOSYSTEMS) {
      const { satisfies, exactVersionOf } = rule(ecosystem);
      expect(satisfies(undefined as unknown as string, "1.0")).toBe(false);
      expect(satisfies("1.0", null as unknown as string)).toBe(false);
      expect(exactVersionOf(undefined as unknown as string)).toBeNull();
    }
  });
});

describe("[ME-04] exactVersionOf", () => {
  /** [spec, 기대값] */
  const check = (ecosystem: Ecosystem, table: [string, string | null][]) => {
    for (const [spec, expected] of table) {
      expect(rule(ecosystem).exactVersionOf(spec), `${ecosystem}: ${spec}`).toBe(expected);
    }
  };

  it("npm: 항상 null (범위 겹침 경로가 따로 있다)", () => {
    check("npm", [["1.2.3", null], ["^1.2.3", null], ["=1.2.3", null]]);
  });

  it("go: 그 값 그대로", () => {
    check("go", [
      ["v1.2.3", "v1.2.3"],
      [" v1.2.3 ", "v1.2.3"],
      ["v0.0.0-20210101000000-abcdef123456", "v0.0.0-20210101000000-abcdef123456"],
      ["v2.0.0+incompatible", "v2.0.0+incompatible"],
      ["", null],
    ]);
  });

  it("pypi: == 만 (와일드카드 제외)", () => {
    check("pypi", [
      ["==1.2.3", "1.2.3"],
      ["== 1.2.3", "1.2.3"],
      [" ==1.0rc1 ", "1.0rc1"],
      ["==1.*", null],
      ["==1.2.*", null],
      [">=1.2.3", null],
      ["~=1.4", null],
      ["==1.2.3,!=1.2.4", null],
      ["===1.2.3", null],
      ["1.2.3", null],
      ["==abc", null],
      ["", null],
    ]);
  });

  it("nuget: 구간·와일드카드가 아니면 그 값, [1.2.3] 은 1.2.3", () => {
    check("nuget", [
      ["13.0.1", "13.0.1"],
      [" 13.0.1 ", "13.0.1"],
      ["1.0.0-beta", "1.0.0-beta"],
      ["[1.2.3]", "1.2.3"],
      ["[ 1.2.3 ]", "1.2.3"],
      ["[1.0,2.0)", null],
      ["(,1.5]", null],
      ["[1.0,)", null],
      ["1.*", null],
      ["*", null],
      ["[1.*]", null],
      ["", null],
    ]);
  });

  it("cargo: =1.2.3 만", () => {
    check("cargo", [
      ["=1.2.3", "1.2.3"],
      ["= 1.2.3", "1.2.3"],
      ["=1.2.3-alpha.1", "1.2.3-alpha.1"],
      ["1.2.3", null],
      ["^1.2.3", null],
      ["=1.2", null],
      ["=1.2.*", null],
      [">=1, <2", null],
      ["=1.2.3, <2", null],
      ["*", null],
      ["", null],
    ]);
  });

  it("pub: 연산자 없는 유효한 버전만", () => {
    check("pub", [
      ["1.2.3", "1.2.3"],
      [" 1.2.3 ", "1.2.3"],
      ["1.2.3-dev.1", "1.2.3-dev.1"],
      ["1.2.3+4", "1.2.3+4"],
      ["^1.2.3", null],
      [">=1.0.0 <2.0.0", null],
      ["any", null],
      ["1.2", null],
      ["v1.2.3", null],
      ["", null],
    ]);
  });

  it("maven: 구간·+·latest.*·$ 가 아니면 그 값", () => {
    check("maven", [
      ["1.2.3", "1.2.3"],
      [" 31.1-jre ", "31.1-jre"],
      ["1.0-SNAPSHOT", "1.0-SNAPSHOT"],
      ["[1.0,2.0)", null],
      ["(,1.5]", null],
      ["[1.2.3]", null],
      ["1.+", null],
      ["+", null],
      ["latest.release", null],
      ["latest.integration", null],
      ["$version", null],
      ["${libs.versions.foo}", null],
      ["", null],
    ]);
  });
});

describe("[SB-01] actions·docker: 정확한 값의 목록", () => {
  const SHA = "57a97c7e7821a5776cebc9bb87c984fa69cba8f1";
  const DIGEST = `sha256:${"ab12".repeat(16)}`;

  it("이름: actions 는 owner/repo, 소문자로 저장한다", () => {
    expect(rule("actions").validateName("aquasecurity/trivy-action")).toBeNull();
    expect(rule("actions").validateName("Actions-Cool/issues-helper")).toBeNull();
    expect(rule("actions").normalizeName("Actions-Cool/Issues-Helper")).toBe("actions-cool/issues-helper");
    expect(rule("actions").validateName("trivy-action")).toEqual(expect.any(String));
    expect(rule("actions").validateName("a/b/c")).toEqual(expect.any(String));
    expect(rule("actions").validateName("actions-cool/*")).toBeNull();
  });

  it("이름: docker 는 저장소 이름, Docker Hub 의 기본 접두를 뗀다", () => {
    for (const name of ["node", "ghcr.io/berriai/litellm", "localhost:5000/team/app", "library/node"]) {
      expect(rule("docker").validateName(name), name).toBeNull();
    }
    expect(rule("docker").normalizeName("docker.io/library/Node")).toBe("node");
    expect(rule("docker").normalizeName("index.docker.io/bitnami/redis")).toBe("bitnami/redis");
    expect(rule("docker").normalizeName("ghcr.io/BerriAI/litellm")).toBe("ghcr.io/berriai/litellm");
    // tag 를 이름에 적는 실수를 막는다.
    expect(rule("docker").validateName("node:18")).toEqual(expect.any(String));
    expect(rule("docker").validateName("ghcr.io/berriai/litellm:v1.107.0")).toEqual(expect.any(String));
  });

  it("docker 패턴: 기본 접두를 뗀 뒤에 거의 모든 이미지와 일치하는 패턴은 거부", () => {
    expect(rule("docker").validateName("docker.io/*")).toBe("패턴에 영문자·숫자가 2자 이상 있어야 합니다");
    expect(rule("docker").validateName("library/*")).toBe("패턴에 영문자·숫자가 2자 이상 있어야 합니다");
    expect(rule("docker").validateName("docker.io/library/*")).toEqual(expect.any(String));
    expect(rule("docker").validateName("ghcr.io/*")).toBeNull();
    expect(rule("docker").validateName("docker.io/bitnami/*")).toBeNull();
  });

  it.each(["actions", "docker"] as const)("%s 범위: 쉼표로 나눈 값, 빈 조각·공백·51개는 거부", (ecosystem) => {
    const { validateRange } = rule(ecosystem);
    expect(validateRange("v1")).toBeNull();
    expect(validateRange("v1, v2,v3")).toBeNull();
    expect(validateRange("v1,,v2")).toEqual(expect.any(String));
    expect(validateRange("v1 v2")).toEqual(expect.any(String));
    expect(validateRange(">=1.0.0")).toEqual(expect.any(String));
    expect(validateRange(Array.from({ length: 51 }, (_, i) => `v${i}`).join(","))).toEqual(expect.any(String));
  });

  it("actions 일치: 같은 tag, 전체 SHA, 7자 이상의 SHA 앞부분", () => {
    const { satisfies } = rule("actions");
    expect(satisfies("v0.34.0", "v0.34.0, v0.34.1")).toBe(true);
    expect(satisfies("v0.34.2", "v0.34.0, v0.34.1")).toBe(false);
    expect(satisfies("V0.34.0", "v0.34.0")).toBe(false);
    expect(satisfies(SHA, SHA)).toBe(true);
    expect(satisfies(SHA, "57a97c7")).toBe(true);
    expect(satisfies(SHA.toUpperCase(), "57a97c7e")).toBe(true);
    expect(satisfies(SHA, "57a97c")).toBe(false);
    // 버전이 tag 이면 16진수처럼 보여도 앞부분 비교를 하지 않는다.
    expect(satisfies("abcdef1234", "abcdef1")).toBe(false);
    expect(satisfies("", "v1")).toBe(false);
    expect(satisfies("v1", "not a list")).toBe(false);
  });

  it("docker 일치: 같은 tag, 전체 digest, 12자 이상의 digest 앞부분", () => {
    const { satisfies } = rule("docker");
    expect(satisfies("v1.107.0", "v1.107.0, latest")).toBe(true);
    expect(satisfies("latest", "v1.107.0, latest")).toBe(true);
    expect(satisfies("v1.107.1", "v1.107.0, latest")).toBe(false);
    expect(satisfies(DIGEST, DIGEST)).toBe(true);
    expect(satisfies(DIGEST, "sha256:ab12ab12ab12")).toBe(true);
    expect(satisfies(DIGEST, "sha256:ab12ab1")).toBe(false);
    expect(satisfies(DIGEST, "ab12ab12ab12")).toBe(false);
  });

  it("선언의 버전은 그대로 정확한 버전이다", () => {
    expect(rule("actions").exactVersionOf("v4")).toBe("v4");
    expect(rule("docker").exactVersionOf(" 18-alpine ")).toBe("18-alpine");
    expect(rule("docker").exactVersionOf("")).toBeNull();
  });
});

describe("[SC-01] 침해의 흔적: path, content, branch", () => {
  const NO_RANGE = "이 종류는 버전 범위를 쓰지 않습니다. 비워 두십시오";
  const VALID_NAME = { path: "ab-cd", content: "abcdef", branch: "ab-cd" } as const;

  it("세 종류 모두 버전 범위를 쓰지 않는다", () => {
    for (const ecosystem of ["path", "content", "branch"] as const) {
      expect(usesVersionRange(ecosystem)).toBe(false);
      expect(rule(ecosystem).validateRange("v1")).toBe(NO_RANGE);
      expect(rule(ecosystem).satisfies("v1", "v1")).toBe(false);
      expect(rule(ecosystem).exactVersionOf("v1")).toBeNull();
      expect(validateEntryFields(ecosystem, VALID_NAME[ecosystem], null)).toEqual({});
      expect(validateEntryFields(ecosystem, VALID_NAME[ecosystem], "v1")).toEqual({ versionRange: NO_RANGE });
    }
    expect(usesVersionRange("npm")).toBe(true);
    expect(usesVersionRange("docker")).toBe(true);
  });

  it("path: 경로와 패턴. 제어 문자, ?, 역슬래시, 맨 앞의 / 는 거부", () => {
    const { validateName, normalizeName } = rule("path");
    for (const name of [
      ".ci-*.sh",
      ".github/workflows/github_actions_security.yml",
      "docs/wfx-audit.md",
      "*/router_init.js",
      "한글 폴더/파일 (1).txt",
      ".claude/setup.mjs",
    ]) {
      expect(validateName(name), name).toBeNull();
    }
    for (const name of ["", "/abs/path", "a\\b", "what?.sh", "ab\ncd", "*", "*/*", "a".repeat(256)]) {
      expect(validateName(name), JSON.stringify(name)).toEqual(expect.any(String));
    }
    expect(normalizeName("Docs/README.md")).toBe("Docs/README.md");
  });

  it("content: 6~200자의 글자 그대로의 문자열. * 와 줄바꿈은 거부", () => {
    const { validateName } = rule("content");
    for (const name of ["193.32.204.199", "git-tanstack.com", "api/workflow/receive?inj=", "a b c d e f"]) {
      expect(validateName(name), name).toBeNull();
    }
    for (const name of ["", "abcde", "a".repeat(201), "abc\ndef", "evil-*-pkg", "......", "------x"]) {
      expect(validateName(name), JSON.stringify(name)).toEqual(expect.any(String));
    }
  });

  it("branch: 이름과 패턴. 공백과 git 이 받지 않는 문자는 거부", () => {
    const { validateName } = rule("branch");
    for (const name of ["wfx-docs", "chore/*", "release/v1.2", "feature/a_b+c@d"]) {
      expect(validateName(name), name).toBeNull();
    }
    for (const name of ["", "has space", "a~b", "a:b", "*", "x", "a".repeat(256)]) {
      expect(validateName(name), JSON.stringify(name)).toEqual(expect.any(String));
    }
  });

  it("이름의 예시는 자기 규칙을 통과한다 ('또는' 으로 나눈 각 예)", () => {
    for (const ecosystem of ["path", "content", "branch"] as const) {
      for (const example of rule(ecosystem).nameExample.split(" 또는 ")) {
        expect(rule(ecosystem).validateName(example), `${ecosystem}: ${example}`).toBeNull();
      }
    }
  });
});
