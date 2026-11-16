import { describe, expect, it } from "vitest";
import { LockfileParseError } from "../lockfiles/common.ts";
import { parsePodfile, parsePodfileLock } from "./cocoapods.ts";
import { parseComposerJson, parseComposerLock } from "./composer.ts";
import { classifyFile, isExcludedPath } from "./index.ts";
import { parseGemfile, parseGemfileLock, parseGemspec } from "./rubygems.ts";
import type { DeclaredDependency, LockedPackage } from "./types.ts";

const decl = (deps: DeclaredDependency[]): string[] => deps.map((dep) => `${dep.name}|${dep.spec}`);
const lock = (pkgs: LockedPackage[]): string[] =>
  pkgs.map((pkg) => `${pkg.name}@${pkg.version}${pkg.direct === undefined ? "" : pkg.direct ? ":direct" : ":transitive"}`);

const GEMFILE_LOCK = `GIT
  remote: https://github.com/x/forked.git
  revision: abc
  specs:
    forked (9.9.9)

PATH
  remote: .
  specs:
    mine (0.1.0)

GEM
  remote: https://rubygems.org/
  specs:
    actionpack (7.0.4)
      rack (~> 2.0)
    nokogiri (1.15.5-x86_64-linux)
    rack (2.2.4)
    rails (7.0.4)
      actionpack (= 7.0.4)

PLATFORMS
  ruby
  x86_64-linux

DEPENDENCIES
  forked!
  nokogiri (>= 1.0)
  rails

BUNDLED WITH
   2.4.1
`;

describe("[SG-10] rubygems 파서", () => {
  it("Gemfile.lock: GEM 의 4칸 줄만 읽고 PATH·GIT 과 하위 의존성은 제외, 플랫폼 접미는 뗀다, DEPENDENCIES 로 direct 를 정한다", () => {
    expect(lock(parseGemfileLock(GEMFILE_LOCK))).toEqual([
      "actionpack@7.0.4:transitive",
      "nokogiri@1.15.5:direct",
      "rack@2.2.4:transitive",
      "rails@7.0.4:direct",
    ]);
  });

  it("Gemfile.lock: 형식 표지가 없거나 비어 있으면 형식 오류다", () => {
    expect(() => parseGemfileLock("hello: world\n")).toThrow(LockfileParseError);
    expect(() => parseGemfileLock("")).toThrow(LockfileParseError);
    expect(() => parseGemfileLock("a\u0000b GEM\n")).toThrow(LockfileParseError);
  });

  it("Gemfile: 따옴표 2종, 여러 요구식, 옵션, git·path·github 는 건너뛴다", () => {
    const text = `source "https://rubygems.org"
# gem "commented"
gem "rails", "~> 7.0"
gem 'rack'
gem 'nokogiri', '>= 1.0', '< 2.0', require: false
gem "forked", git: "https://github.com/x/forked.git"
gem "local", path: "../local"
gem "gh", github: "x/gh"
gem "old", :git => "https://x.io/old.git"
gem("paren", "1.2.3") # 끝 주석
gem "multi",
    ">= 2.0",
    group: :test
git "https://x.io/many.git" do
  gem "inside-git"
end
group :test do
  gem "rspec", "3.12.0"
end
gemspec
`;
    expect(decl(parseGemfile(text))).toEqual([
      "rails|~> 7.0",
      "rack|",
      "nokogiri|>= 1.0, < 2.0",
      "paren|1.2.3",
      "multi|>= 2.0",
      "rspec|3.12.0",
    ]);
  });

  it("*.gemspec: add_dependency·add_runtime_dependency·add_development_dependency", () => {
    const text = `Gem::Specification.new do |s|
  s.name = "mine"
  s.add_dependency "thor", "~> 1.0"
  s.add_runtime_dependency('rack', '>= 2.0', '< 4')
  s.add_development_dependency "rspec"
end
`;
    expect(decl(parseGemspec(text, "mine.gemspec"))).toEqual(["thor|~> 1.0", "rack|>= 2.0, < 4", "rspec|"]);
  });

  it("classifyFile: Gemfile·Gemfile.lock·*.gemspec, vendor/ 아래는 제외", () => {
    expect(classifyFile("Gemfile")).toEqual({ ecosystem: "rubygems", role: "manifest" });
    expect(classifyFile("app/Gemfile.lock")).toEqual({ ecosystem: "rubygems", role: "lock" });
    expect(classifyFile("lib/mine.gemspec")).toEqual({ ecosystem: "rubygems", role: "manifest" });
    expect(isExcludedPath("vendor/bundle/Gemfile")).toBe(true);
  });

  it("파일당 항목은 5000개까지만 읽고 큰 입력도 빠르다", () => {
    const gems = Array.from({ length: 7000 }, (_, i) => `gem "g${i}"`).join("\n");
    const started = Date.now();
    expect(parseGemfile(gems)).toHaveLength(5000);
    expect(parseGemfile(`gem "x", "${"a".repeat(500_000)}`)).toHaveLength(0);
    expect(parseGemfile("gem " + '"'.repeat(200_000))).toHaveLength(0);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("[SG-11] composer 파서", () => {
  it("composer.lock: packages 와 packages-dev, v 접두와 dev- 버전은 그대로", () => {
    const text = JSON.stringify({
      "content-hash": "x",
      packages: [
        { name: "Monolog/Monolog", version: "v2.9.1" },
        { name: "a/b", version: "dev-main" },
        { name: "c/d", version: "1.0.0" },
        { name: "bad" },
      ],
      "packages-dev": [{ name: "phpunit/phpunit", version: "10.1.0" }],
    });
    expect(lock(parseComposerLock(text))).toEqual(["Monolog/Monolog@v2.9.1", "a/b@dev-main", "c/d@1.0.0", "phpunit/phpunit@10.1.0"]);
  });

  it("composer.lock: JSON 오류와 형식 표지 없음은 형식 오류", () => {
    expect(() => parseComposerLock("{")).toThrow(LockfileParseError);
    expect(() => parseComposerLock(JSON.stringify({ hello: 1 }))).toThrow(LockfileParseError);
    expect(() => parseComposerLock("")).toThrow(LockfileParseError);
  });

  it("composer.json: require·require-dev, php·ext-* 는 건너뛴다", () => {
    const text = JSON.stringify({
      require: { php: ">=8.1", "ext-json": "*", "vendor/pkg": "^1.2", "x/y": ">=1.0 <2.0 || ^3.0" },
      "require-dev": { "phpunit/phpunit": "10.1.0" },
    });
    expect(decl(parseComposerJson(text))).toEqual([
      "vendor/pkg|^1.2",
      "x/y|>=1.0 <2.0 || ^3.0",
      "phpunit/phpunit|10.1.0",
    ]);
    expect(parseComposerJson(JSON.stringify({ name: "x/y", require: [] }))).toEqual([]);
  });

  it("classifyFile", () => {
    expect(classifyFile("composer.json")).toEqual({ ecosystem: "composer", role: "manifest" });
    expect(classifyFile("web/composer.lock")).toEqual({ ecosystem: "composer", role: "lock" });
  });
});

const PODFILE_LOCK = `PODS:
  - Alamofire (5.6.4)
  - Firebase/Auth (10.1.0):
    - Firebase/CoreOnly
  - Firebase/CoreOnly (10.1.0)
  - Local (0.1.0)

DEPENDENCIES:
  - Alamofire (~> 5.0)
  - Firebase/Auth
  - Local (from \`../Local\`)

SPEC CHECKSUMS:
  Alamofire: abc

COCOAPODS: 1.12.0
`;

describe("[SG-12] cocoapods 파서", () => {
  it("Podfile.lock: PODS 의 문자열과 { 이름: [...] }, DEPENDENCIES 의 이름으로 direct", () => {
    expect(lock(parsePodfileLock(PODFILE_LOCK))).toEqual([
      "Alamofire@5.6.4:direct",
      "Firebase/Auth@10.1.0:direct",
      "Firebase/CoreOnly@10.1.0:transitive",
      "Local@0.1.0:direct",
    ]);
  });

  it("Podfile.lock: 형식 오류", () => {
    expect(() => parsePodfileLock("a: [")).toThrow(LockfileParseError);
    expect(() => parsePodfileLock("hello: world\n")).toThrow(LockfileParseError);
    expect(() => parsePodfileLock("")).toThrow(LockfileParseError);
  });

  it("Podfile: pod 줄, 요구식, :git·:path·:podspec 는 건너뛴다", () => {
    const text = `platform :ios, '13.0'
target 'App' do
  pod 'Alamofire', '~> 5.0'
  pod "Firebase/Auth"
  pod 'Moya', '>= 15.0', '< 16.0'
  pod 'Forked', :git => 'https://x.io/forked.git'
  pod 'Local', :path => '../Local'
  pod 'Spec', :podspec => 'https://x.io/Spec.podspec'
  pod 'Exact', '1.2.3' # 주석
  # pod 'Commented'
end
`;
    expect(decl(parsePodfile(text))).toEqual([
      "Alamofire|~> 5.0",
      "Firebase/Auth|",
      "Moya|>= 15.0, < 16.0",
      "Exact|1.2.3",
    ]);
  });

  it("classifyFile: Pods/ 아래는 제외", () => {
    expect(classifyFile("ios/Podfile")).toEqual({ ecosystem: "cocoapods", role: "manifest" });
    expect(classifyFile("ios/Podfile.lock")).toEqual({ ecosystem: "cocoapods", role: "lock" });
    expect(isExcludedPath("ios/Pods/Podfile.lock")).toBe(true);
  });
});
