import { describe, expect, it } from "vitest";
import { expectInputRejected } from "../test/assertions.ts";
import * as fx from "./__fixtures__/index.ts";
import { parseCargoLock, parseCargoToml } from "./cargo.ts";
import { parseGoMod } from "./go.ts";
import { parseGradle, parseVersionCatalog } from "./maven.ts";
import {
  parseCsproj,
  parseDirectoryPackagesProps,
  parsePackagesConfig,
  parsePackagesLockJson,
} from "./nuget.ts";
import { parsePoetryLock, parsePyproject, parseRequirements, parseUvLock } from "./pypi.ts";
import { parsePubspecLock, parsePubspecYaml } from "./pub.ts";
import type { DeclaredDependency, LockedPackage } from "./types.ts";

const BOM = String.fromCharCode(0xfeff);
const declKeys = (deps: DeclaredDependency[]): string[] =>
  deps.map((dep) => `${dep.name}|${dep.spec}|${dep.dependencyType}`).sort();
const lockKeys = (pkgs: LockedPackage[]): string[] =>
  [
    ...new Set(
      pkgs.map(
        (pkg) =>
          `${pkg.name}@${pkg.version}` +
          (pkg.direct === undefined ? "" : pkg.direct ? ":direct" : ":transitive"),
      ),
    ),
  ].sort();

describe("선언 파일 파서", () => {
  it("[ME-10] go.mod: require 블록과 한 줄 require 를 읽고 // indirect 는 transitive, replace·exclude·retract 는 무시한다", () => {
    expect(declKeys(parseGoMod(fx.GO_MOD))).toEqual(fx.GO_MOD_EXPECTED);
  });

  it("[ME-10] requirements.txt: ==, 범위, extras, 환경 표지, 해시, 옵션 줄(-r -e --)을 처리한다", () => {
    expect(declKeys(parseRequirements(fx.REQUIREMENTS))).toEqual(fx.REQUIREMENTS_EXPECTED);
  });

  it("[ME-10] pyproject.toml: PEP 621 · optional-dependencies · dependency-groups · poetry (python 과 path/git 은 제외)", () => {
    expect(declKeys(parsePyproject(fx.PYPROJECT))).toEqual(fx.PYPROJECT_EXPECTED);
  });

  it("[ME-10] *.csproj: Version 속성과 자식 요소, Update, 버전 없는 참조", () => {
    expect(declKeys(parseCsproj(fx.CSPROJ))).toEqual(fx.CSPROJ_EXPECTED);
  });

  it("[ME-10] packages.config 와 Directory.Packages.props", () => {
    expect(declKeys(parsePackagesConfig(fx.PACKAGES_CONFIG))).toEqual(fx.PACKAGES_CONFIG_EXPECTED);
    expect(declKeys(parseDirectoryPackagesProps(fx.DIRECTORY_PACKAGES_PROPS))).toEqual(
      fx.DIRECTORY_PACKAGES_PROPS_EXPECTED,
    );
  });

  it("[ME-10] Cargo.toml: 4종 의존성 표 + target.*.dependencies + workspace.dependencies, package rename, path/git/workspace 만 있는 것은 건너뜀", () => {
    expect(declKeys(parseCargoToml(fx.CARGO_TOML))).toEqual(fx.CARGO_TOML_EXPECTED);
  });

  it("[ME-10] pubspec.yaml: 3개 표, 문자열과 { version }, sdk/path/git 은 건너뜀", () => {
    expect(declKeys(parsePubspecYaml(fx.PUBSPEC_YAML))).toEqual(fx.PUBSPEC_YAML_EXPECTED);
  });

  it("[ME-10] libs.versions.toml: module+version.ref, group+name+version, 문자열 좌표, 버전 없는 것은 건너뜀", () => {
    expect(declKeys(parseVersionCatalog(fx.LIBS_VERSIONS_TOML))).toEqual(fx.LIBS_VERSIONS_TOML_EXPECTED);
  });

  it("[ME-10][v2-EC-07] build.gradle 과 build.gradle.kts: 따옴표 안의 g:n:v 만 읽고 $ 변수·버전 없음·주석은 건너뛴다", () => {
    expect(declKeys(parseGradle(fx.BUILD_GRADLE))).toEqual(fx.BUILD_GRADLE_EXPECTED);
    expect(declKeys(parseGradle(fx.BUILD_GRADLE_KTS))).toEqual(fx.BUILD_GRADLE_KTS_EXPECTED);
  });

  it("[ME-10] UTF-8 BOM 과 CRLF 를 정규화한다", () => {
    const crlf = (text: string) => `${BOM}${text.replace(/\n/g, "\r\n")}`;
    expect(declKeys(parseGoMod(crlf(fx.GO_MOD)))).toEqual(fx.GO_MOD_EXPECTED);
    expect(declKeys(parseRequirements(crlf(fx.REQUIREMENTS)))).toEqual(fx.REQUIREMENTS_EXPECTED);
    expect(declKeys(parseCargoToml(crlf(fx.CARGO_TOML)))).toEqual(fx.CARGO_TOML_EXPECTED);
    expect(declKeys(parsePubspecYaml(crlf(fx.PUBSPEC_YAML)))).toEqual(fx.PUBSPEC_YAML_EXPECTED);
    expect(declKeys(parseCsproj(crlf(fx.CSPROJ)))).toEqual(fx.CSPROJ_EXPECTED);
  });

  it("[v2-EC-06][ME-10] 빈 입력과 문법 오류는 예외 (repo 실패)", () => {
    expectInputRejected(() => parseGoMod(""));
    expectInputRejected(() => parseGoMod("require (\n\tgithub.com/a/b v1.0.0\n"));
    expectInputRejected(() => parseGoMod("hello world\n"));
    expectInputRejected(() => parsePyproject("[project\nname = "));
    expectInputRejected(() => parseCsproj(""));
    expectInputRejected(() => parseCsproj("<Project><ItemGroup></Project>"));
    expectInputRejected(() => parseCsproj("<NotAProject />"));
    expectInputRejected(() => parsePackagesConfig("<packages><package id='a'></packages>"));
    expectInputRejected(() => parseCargoToml(""));
    expectInputRejected(() => parseCargoToml("[dependencies\nserde = "));
    expectInputRejected(() => parsePubspecYaml(""));
    expectInputRejected(() => parsePubspecYaml("name: [unclosed"));
    expectInputRejected(() => parseVersionCatalog("[versions\nx = "));
  });

  it("[ME-10] 의존성이 없는 정상 파일은 빈 목록이다 (빈 requirements.txt, 의존성 없는 pyproject.toml)", () => {
    expect(parseRequirements("")).toEqual([]);
    expect(parseRequirements("# 주석뿐\n")).toEqual([]);
    expect(parsePyproject('[tool.black]\nline-length = 100\n')).toEqual([]);
    expect(parseGradle("")).toEqual([]);
  });
});

describe("lock 파일 파서", () => {
  it("[ME-10] uv.lock 과 poetry.lock: [[package]] 의 name·version (프로젝트 자신은 제외)", () => {
    expect(lockKeys(parseUvLock(fx.UV_LOCK))).toEqual(fx.UV_LOCK_EXPECTED);
    expect(lockKeys(parsePoetryLock(fx.POETRY_LOCK))).toEqual(fx.POETRY_LOCK_EXPECTED);
  });

  it("[ME-10] packages.lock.json: framework 별 resolved, type 으로 direct 구분, Project 는 제외, 중복은 1건", () => {
    expect(lockKeys(parsePackagesLockJson(fx.PACKAGES_LOCK_JSON))).toEqual(fx.PACKAGES_LOCK_JSON_EXPECTED);
  });

  it("[ME-10] Cargo.lock: registry 패키지만 (워크스페이스 멤버는 제외)", () => {
    expect(lockKeys(parseCargoLock(fx.CARGO_LOCK))).toEqual(fx.CARGO_LOCK_EXPECTED);
  });

  it("[ME-10] pubspec.lock: dependency 로 direct 구분, sdk 패키지는 제외", () => {
    expect(lockKeys(parsePubspecLock(fx.PUBSPEC_LOCK))).toEqual(fx.PUBSPEC_LOCK_EXPECTED);
  });

  it("[ME-10] UTF-8 BOM 과 CRLF 를 정규화한다", () => {
    const crlf = (text: string) => `${BOM}${text.replace(/\n/g, "\r\n")}`;
    expect(lockKeys(parseUvLock(crlf(fx.UV_LOCK)))).toEqual(fx.UV_LOCK_EXPECTED);
    expect(lockKeys(parseCargoLock(crlf(fx.CARGO_LOCK)))).toEqual(fx.CARGO_LOCK_EXPECTED);
    expect(lockKeys(parsePubspecLock(crlf(fx.PUBSPEC_LOCK)))).toEqual(fx.PUBSPEC_LOCK_EXPECTED);
  });

  it("[v2-EC-06][ME-10] 빈 입력, 문법 오류, 형식 표지 없는 입력은 예외 (repo 실패)", () => {
    expectInputRejected(() => parseUvLock(""));
    expectInputRejected(() => parseUvLock('[[package\nname = "x"'));
    expectInputRejected(() => parseUvLock('name = "only-a-toml"\n'));
    expectInputRejected(() => parsePoetryLock("   \n"));
    expectInputRejected(() => parsePoetryLock("hello = 1\n"));
    expectInputRejected(() => parsePackagesLockJson(""));
    expectInputRejected(() => parsePackagesLockJson('{ "version": 1, "dependencies": {'));
    expectInputRejected(() => parsePackagesLockJson('{ "hello": 1 }'));
    expectInputRejected(() => parseCargoLock(""));
    expectInputRejected(() => parseCargoLock('[[package]\nname = "x"'));
    expectInputRejected(() => parseCargoLock('hello = "world"\n'));
    expectInputRejected(() => parsePubspecLock(""));
    expectInputRejected(() => parsePubspecLock("packages: [unclosed"));
    expectInputRejected(() => parsePubspecLock("hello: world\n"));
  });
});
