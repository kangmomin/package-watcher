import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DUPLICATE_MESSAGE } from "../services/blacklistService.ts";
import { cleanupTestApps, createTestApp, expectApiError, type TestApp } from "../test/testApp.ts";
import { addEntry, getEntry, listEntries, putEntry } from "../test/v2.ts";

let t: TestApp;

beforeEach(() => {
  t = createTestApp();
});

afterEach(cleanupTestApps);

const post = (body: Record<string, unknown>) =>
  t.request("POST", "/api/blacklist", { reason: "x", ...body });

describe("POST /api/blacklist — 종류별 이름과 범위", () => {
  it("[v2-EC-02][ME-14] 7개 종류 모두 그 종류의 올바른 이름·범위로 201", async () => {
    const valid: [string, string, string | null][] = [
      ["npm", "@evil/pkg", "<2.0.0"],
      ["go", "github.com/evil/mod", ">=v1.0.0 <v2.0.0"],
      ["pypi", "evil-pkg", "<1.0,>=0.5"],
      ["nuget", "Evil.Package", "[1.0,2.0)"],
      ["cargo", "evil-crate", ">=1, <2"],
      ["pub", "evil_pub", "^1.2.3"],
      ["maven", "com.evil:lib", "(,1.5]"],
    ];
    for (const [ecosystem, name, versionRange] of valid) {
      const res = await post({ ecosystem, name, versionRange });
      expect(res.status, `${ecosystem}: ${res.text}`).toBe(201);
    }
    expect(await listEntries(t)).toHaveLength(7);
  });

  it("[v2-EC-02][ME-14] 다른 종류의 문법(이름이나 범위)은 400 details.name / details.versionRange", async () => {
    const invalid: [Record<string, unknown>, string][] = [
      [{ ecosystem: "go", name: "evil pkg" }, "name"],
      [{ ecosystem: "go", name: "github.com/evil/mod", versionRange: "<1.0.0" }, "versionRange"],
      [{ ecosystem: "pypi", name: "-bad" }, "name"],
      [{ ecosystem: "pypi", name: "evil", versionRange: "^1.0" }, "versionRange"],
      [{ ecosystem: "nuget", name: "evil", versionRange: "<1.0" }, "versionRange"],
      [{ ecosystem: "cargo", name: "evil/crate" }, "name"],
      [{ ecosystem: "cargo", name: "evil", versionRange: "[1.0,2.0)" }, "versionRange"],
      [{ ecosystem: "pub", name: "Evil" }, "name"],
      [{ ecosystem: "maven", name: "guava" }, "name"],
      [{ ecosystem: "maven", name: "com.evil:lib", versionRange: "<1.0" }, "versionRange"],
      [{ ecosystem: "cobol", name: "evil" }, "ecosystem"],
    ];
    for (const [body, field] of invalid) {
      const error = expectApiError(await post(body), 400, "VALIDATION_ERROR");
      expect(error.details, JSON.stringify(body)).toHaveProperty(field);
    }
    expect(await listEntries(t)).toEqual([]);
  });

  it("[v2-EC-02][ME-14] nuget·maven 에서 괄호 없는 버전(1.2.3)은 400 이고 [1.2.3] 형식을 안내한다", async () => {
    for (const [ecosystem, name] of [
      ["nuget", "evil"],
      ["maven", "com.evil:lib"],
    ] as const) {
      const error = expectApiError(await post({ ecosystem, name, versionRange: "1.2.3" }), 400, "VALIDATION_ERROR");
      expect(String(error.details?.versionRange)).toContain("[1.2.3]");
      const exact = await post({ ecosystem, name, versionRange: "[1.2.3]" });
      expect(exact.status, exact.text).toBe(201);
    }
  });

  it("[v2-EC-03][ME-14] pypi 와 nuget 의 이름은 저장할 때 정규화하고, 정규화한 이름이 같으면 중복이다", async () => {
    const py = await addEntry(t, { ecosystem: "pypi", name: "Foo_Bar.Baz", reason: "x" });
    expect(py.name).toBe("foo-bar-baz");
    const cs = await addEntry(t, { ecosystem: "nuget", name: "Newtonsoft.Json", reason: "x" });
    expect(cs.name).toBe("newtonsoft.json");
    const go = await addEntry(t, { ecosystem: "go", name: "github.com/Evil/Mod", reason: "x" });
    expect(go.name).toBe("github.com/Evil/Mod");

    for (const body of [
      { ecosystem: "pypi", name: "foo.bar_baz" },
      { ecosystem: "nuget", name: "NEWTONSOFT.JSON" },
    ]) {
      const error = expectApiError(await post(body), 409, "DUPLICATE_ENTRY");
      expect(error.message).toBe(DUPLICATE_MESSAGE);
    }
    // 대소문자를 구분하는 종류는 다른 이름이다.
    expect((await post({ ecosystem: "go", name: "github.com/evil/mod" })).status).toBe(201);
  });
});

describe("PUT /api/blacklist/:id — 종류", () => {
  const stored = () => addEntry(t, { ecosystem: "go", name: "github.com/evil/mod", versionRange: "<v1.0.0", reason: "x" });

  it("[ME-14] 저장된 종류와 다른 ecosystem 은 400 details.ecosystem 이고 항목은 바뀌지 않는다", async () => {
    const entry = await stored();

    for (const ecosystem of ["npm", "pypi", "cobol"]) {
      const res = await t.request("PUT", `/api/blacklist/${entry.id}`, {
        name: "github.com/evil/mod",
        versionRange: null,
        reason: "y",
        ecosystem,
      });
      const error = expectApiError(res, 400, "VALIDATION_ERROR");
      expect(error.details, ecosystem).toHaveProperty("ecosystem");
    }
    const changed = await t.request("PUT", `/api/blacklist/${entry.id}`, {
      name: "github.com/evil/mod",
      versionRange: null,
      reason: "y",
      ecosystem: "pypi",
    });
    expect(expectApiError(changed, 400, "VALIDATION_ERROR").details?.ecosystem).toBe(
      "종류는 바꿀 수 없습니다. 새 항목으로 등록하십시오",
    );
    expect(await getEntry(t, entry.id)).toEqual(entry);
  });

  it("[ME-14] ecosystem 을 생략하거나 같은 값으로 보내면 허용한다", async () => {
    const entry = await stored();

    const same = await putEntry(t, entry.id, {
      name: "github.com/evil/mod",
      versionRange: "<v2.0.0",
      reason: "y",
      ecosystem: "go",
    });
    expect(same).toMatchObject({ ecosystem: "go", versionRange: "<v2.0.0" });
    const omitted = await putEntry(t, entry.id, { name: "github.com/evil/mod2", versionRange: null, reason: "z" });
    expect(omitted).toMatchObject({ ecosystem: "go", name: "github.com/evil/mod2", versionRange: null });
  });

  it("[ME-14] ecosystem 을 생략해도 저장된 종류로 병합한 뒤 이름·범위를 검증한다", async () => {
    const entry = await stored();

    const badRange = await t.request("PUT", `/api/blacklist/${entry.id}`, {
      name: "github.com/evil/mod",
      versionRange: "<1.0.0",
      reason: "y",
    });
    expect(expectApiError(badRange, 400, "VALIDATION_ERROR").details).toHaveProperty("versionRange");
    const badName = await t.request("PUT", `/api/blacklist/${entry.id}`, {
      name: "evil pkg",
      versionRange: null,
      reason: "y",
    });
    expect(expectApiError(badName, 400, "VALIDATION_ERROR").details).toHaveProperty("name");
    expect(await getEntry(t, entry.id)).toEqual(entry);
  });

  it("[ME-14] ecosystem 을 생략한 PUT 도 pypi 이름을 정규화하고, 정규화한 이름이 다른 항목과 같으면 409", async () => {
    const a = await addEntry(t, { ecosystem: "pypi", name: "alpha", reason: "x" });
    await addEntry(t, { ecosystem: "pypi", name: "beta", reason: "x" });

    const renamed = await putEntry(t, a.id, { name: "Alpha_Two", versionRange: null, reason: "x" });
    expect(renamed.name).toBe("alpha-two");

    const dup = await t.request("PUT", `/api/blacklist/${a.id}`, {
      name: "BETA",
      versionRange: null,
      reason: "x",
    });
    expectApiError(dup, 409, "DUPLICATE_ENTRY");
  });
});
