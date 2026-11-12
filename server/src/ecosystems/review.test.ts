import { describe, expect, it } from "vitest";
import { expectInputRejected } from "../test/assertions.ts";
import { parseCargoLock, parseCargoToml } from "./cargo.ts";
import { parseGoMod } from "./go.ts";
import { parseGradle, parseVersionCatalog } from "./maven.ts";
import { parseCsproj, parsePackagesLockJson } from "./nuget.ts";
import { parsePubspecYaml } from "./pub.ts";
import { parsePyproject, parseRequirements, parseUvLock } from "./pypi.ts";
import type { DeclaredDependency } from "./types.ts";

const declKeys = (deps: DeclaredDependency[]): string[] =>
  deps.map((dep) => `${dep.name}|${dep.spec}|${dep.dependencyType}`).sort();

describe("코드 리뷰 지적 수정", () => {
  it("[ME-16] Gradle: 문자열 안의 /* 가 블록 주석을 시작하지 않는다", () => {
    const text = [
      "android { packagingOptions { pickFirst 'lib/*/libc++_shared.so'; exclude \"**/*.jar\"; merge 'META-INF/*.kotlin_module' } }",
      "dependencies { implementation 'com.evil:lib:1.0.0' }",
      "/* end */",
    ].join("\n");
    expect(declKeys(parseGradle(text))).toEqual(["com.evil:lib|1.0.0|direct"]);
  });

  it("[ME-16] Gradle: 줄 주석 안의 /* 와 문자열 안의 // 를 구분하고, 진짜 주석 안의 좌표는 읽지 않는다", () => {
    const text = [
      "// see /* x",
      'repositories { maven { url "https://repo.example.com/maven" } }',
      "dependencies {",
      "  implementation 'com.evil:one:1.0.0'",
      "  /* implementation 'com.hidden:two:1.0.0' */",
      "  implementation \"com.evil:three:3.0.0\" // implementation 'com.hidden:four:1.0.0'",
      "  implementation '''com.evil:five:5.0.0'''",
      "  implementation 'it\\'s:esc:1.0'",
      "}",
      "/* 닫히지 않은 주석 implementation 'com.hidden:six:1.0.0'",
    ].join("\n");
    expect(declKeys(parseGradle(text))).toEqual([
      "com.evil:five|5.0.0|direct",
      "com.evil:one|1.0.0|direct",
      "com.evil:three|3.0.0|direct",
    ]);
  });

  it("[ME-16] 빈 pyproject.toml 과 libs.versions.toml(0바이트, 공백, 주석만)은 정상이고, 다른 선언 파일은 빈 파일이 예외다", () => {
    for (const empty of ["", "  \n\n", "# 주석뿐\n"]) {
      expect(parsePyproject(empty)).toEqual([]);
      expect(parseVersionCatalog(empty)).toEqual([]);
    }
    expectInputRejected(() => parseCargoToml(""));
    expectInputRejected(() => parsePubspecYaml(""));
    expectInputRejected(() => parseCsproj(""));
    expectInputRejected(() => parseUvLock(""));
  });

  it("[ME-16] UTF-8 로 읽을 수 없는 내용(NUL, U+FFFD)은 모든 종류의 파서에서 예외", () => {
    const utf16 = "e\0v\0i\0l\0=\0=\x001\0";
    const broken = "evil�==1";
    for (const text of [utf16, broken]) {
      expectInputRejected(() => parseRequirements(text));
      expectInputRejected(() => parseGradle(text));
      expectInputRejected(() => parseGoMod(text));
      expectInputRejected(() => parsePyproject(text));
      expectInputRejected(() => parseVersionCatalog(text));
      expectInputRejected(() => parseCargoLock(text));
      expectInputRejected(() => parsePubspecYaml(text));
      expectInputRejected(() => parseCsproj(text));
      expectInputRejected(() => parsePackagesLockJson(text));
    }
    expect(() => parseRequirements(utf16)).toThrow("UTF-8");
  });

  it("[ME-16] go.mod: 블록 형태의 module ( … ) 도 형식 표지다", () => {
    const text = "module (\n\texample.com/app\n)\n\nrequire github.com/a/b v1.0.0\n";
    expect(declKeys(parseGoMod(text))).toEqual(["github.com/a/b|v1.0.0|direct"]);
  });
});
