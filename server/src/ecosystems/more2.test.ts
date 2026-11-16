import { describe, expect, it } from "vitest";
import { parsePodfile } from "./cocoapods.ts";
import { parseComposerLock } from "./composer.ts";
import { parseGemfile, parseGemfileLock } from "./rubygems.ts";

const names = (deps: { name: string; spec: string }[]): string[] => deps.map((dep) => `${dep.name}|${dep.spec}`);

describe("[SG-200] Gemfile 의 후위 if·unless", () => {
  it("따옴표 밖의 if·unless 뒤는 떼고 읽는다", () => {
    const text = `gem "a" if ENV["X"]\ngem "b", "1.0" unless defined?(Y)\ngem "if-in-name", "~> 2.0"\ngem "c", "1.0", require: "if x"\n`;
    expect(names(parseGemfile(text))).toEqual(["a|", "b|1.0", "if-in-name|~> 2.0", "c|1.0"]);
  });
});

describe("[SG-201] Gemfile 블록의 중첩과 source", () => {
  it("git·path·source 블록 안의 중첩된 end 를 세고 블록 밖의 gem 만 읽는다", () => {
    const text = `source "https://rubygems.org"
git "https://x.io/g.git" do
  group :a do
    gem "in-git"
  end
  if ENV["X"]
    gem "in-git2"
  end
  gem "in-git3"
end
gem "after"
source "https://gems.example.com" do
  gem "private"
end
source "https://rubygems.org" do
  gem "official-block"
end
`;
    expect(names(parseGemfile(text))).toEqual(["after|", "official-block|"]);
  });

  it("최상위 source 가 rubygems.org 가 아닌 것뿐이면 그 Gemfile 의 gem 은 건너뛴다", () => {
    expect(parseGemfile('source "https://gems.example.com"\ngem "x"\n')).toEqual([]);
    expect(names(parseGemfile('source "https://gems.example.com"\nsource "https://rubygems.org/"\ngem "x"\n'))).toEqual(["x|"]);
    expect(names(parseGemfile('gem "x"\n'))).toEqual(["x|"]);
  });

  it("Podfile: 기본 CDN 이 아닌 source 뿐이면 pod 을 건너뛴다", () => {
    expect(parsePodfile("source 'https://git.example.com/specs.git'\npod 'A'\n")).toEqual([]);
    expect(names(parsePodfile("source 'https://git.example.com/specs.git'\nsource 'https://cdn.cocoapods.org/'\npod 'A'\n"))).toEqual(["A|"]);
    expect(names(parsePodfile("source 'https://github.com/CocoaPods/Specs.git'\npod 'A'\n"))).toEqual(["A|"]);
    expect(names(parsePodfile("pod 'A'\n"))).toEqual(["A|"]);
  });
});

describe("[SG-202] composer.lock 의 dev- 버전", () => {
  it("버전 그대로 넣는다", () => {
    const text = JSON.stringify({ packages: [{ name: "a/b", version: "dev-main" }, { name: "c/d", version: "1.0.0" }] });
    expect(parseComposerLock(text).map((pkg) => `${pkg.name}@${pkg.version}`)).toEqual(["a/b@dev-main", "c/d@1.0.0"]);
  });
});

describe("[SG-203] Gemfile.lock 의 플랫폼 접미", () => {
  it("알려진 플랫폼 접미만 뗀다", () => {
    const text = `GEM
  remote: https://rubygems.org/
  specs:
    a (1.15.5-x86_64-linux)
    b (1.0.0-beta)
    c (1.0.0-java)
    d (2.0-arm64-darwin)
    e (3.0.0-universal-darwin)
    f (1.0.0-x64-mingw32)

PLATFORMS
  ruby
`;
    expect(parseGemfileLock(text).map((pkg) => `${pkg.name}@${pkg.version}`)).toEqual([
      "a@1.15.5",
      "b@1.0.0-beta",
      "c@1.0.0",
      "d@2.0",
      "e@3.0.0",
      "f@1.0.0",
    ]);
  });
});
