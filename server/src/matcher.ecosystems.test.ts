import { describe, expect, it } from "vitest";
import { createEntryIndex } from "./matcher.ts";

const entry = (id: number, ecosystem: string, name: string) => ({ id, ecosystem, name });

describe("createEntryIndex — 종류별 이름 정규화", () => {
  it("[v2-AC-11] pypi 는 PEP 503 으로 정규화해서 비교한다 (양쪽 모두)", () => {
    const index = createEntryIndex([entry(1, "pypi", "foo-bar"), entry(2, "pypi", "Raw_Name")]);

    expect(index.match("pypi", "Foo_Bar").map((e) => e.id)).toEqual([1]);
    expect(index.match("pypi", "foo.bar").map((e) => e.id)).toEqual([1]);
    expect(index.match("pypi", "raw-name").map((e) => e.id)).toEqual([2]);
    expect(index.match("pypi", "foobar")).toEqual([]);
  });

  it("[v2-AC-11] pypi 패턴도 정규화한 이름과 비교한다", () => {
    const index = createEntryIndex([entry(1, "pypi", "evil-*")]);

    expect(index.match("pypi", "Evil_Tool").map((e) => e.id)).toEqual([1]);
    expect(index.match("pypi", "good-tool")).toEqual([]);
  });

  it("[v2-AC-11] nuget 은 대소문자를 무시한다", () => {
    const index = createEntryIndex([entry(1, "nuget", "newtonsoft.json"), entry(2, "nuget", "Evil.*")]);

    expect(index.match("nuget", "Newtonsoft.Json").map((e) => e.id)).toEqual([1]);
    expect(index.match("nuget", "EVIL.Tool").map((e) => e.id)).toEqual([2]);
  });

  it("[v2-AC-11] go·cargo·pub·maven·npm 은 대소문자를 구분하고, 종류가 다르면 일치하지 않는다", () => {
    const index = createEntryIndex([
      entry(1, "go", "github.com/Evil/Mod"),
      entry(2, "maven", "com.evil:lib"),
      entry(3, "npm", "evil"),
    ]);

    expect(index.match("go", "github.com/Evil/Mod").map((e) => e.id)).toEqual([1]);
    expect(index.match("go", "github.com/evil/mod")).toEqual([]);
    expect(index.match("maven", "com.Evil:lib")).toEqual([]);
    expect(index.match("npm", "evil").map((e) => e.id)).toEqual([3]);
    expect(index.match("pypi", "evil")).toEqual([]);
  });
});
