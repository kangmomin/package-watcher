import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DAY } from "../test/clock.ts";
import {
  cleanupTestApps,
  createTestApp,
  EVIL,
  expectApiError,
  LODASH,
  type TestApp,
} from "../test/testApp.ts";
import { addEntry, insertEntryRow, listEntries, putEntry } from "../test/v2.ts";

// FakeClock 기본 시각 2026-11-12T00:00:00.000Z = KST 2026-11-12 09:00
const TODAY_KST = "2026-11-12";
const YESTERDAY_KST = "2026-11-11";
const DUPLICATE_MESSAGE = "같은 종류·이름·버전 범위의 항목이 이미 있습니다";

let t: TestApp;

beforeEach(() => {
  t = createTestApp();
});

afterEach(cleanupTestApps);

const names = (entries: { name: string }[]): string[] => entries.map((entry) => entry.name).sort();

describe("POST /api/blacklist — 새 필드 (ecosystem, severity, enabled, expiresAt)", () => {
  it("[v2-AC-01][CT-16] 새 필드를 모두 넣으면 넣은 값을, 모두 생략하면 기본값(npm, medium, enabled, expiresAt null)을 201 로 반환하고 GET 에도 같다", async () => {
    const full = await addEntry(t, {
      ...EVIL,
      ecosystem: "npm",
      severity: "critical",
      enabled: false,
      expiresAt: "2026-12-31",
    });
    expect(full).toMatchObject({
      name: "evil-pkg",
      ecosystem: "npm",
      severity: "critical",
      enabled: false,
      expiresAt: "2026-12-31",
      isExpired: false,
    });

    const omitted = await addEntry(t, { name: "lodash", reason: "취약점" });
    expect(omitted).toMatchObject({
      ecosystem: "npm",
      severity: "medium",
      enabled: true,
      expiresAt: null,
      isExpired: false,
    });

    expect(await listEntries(t)).toEqual([full, omitted]);
  });

  it("[CT-16] expiresAt 의 빈 문자열(trim 후)은 null 이고, 오늘(KST) 날짜는 저장된다", async () => {
    const blank = await addEntry(t, { ...EVIL, expiresAt: "   " });
    expect(blank.expiresAt).toBeNull();

    const today = await addEntry(t, { ...LODASH, severity: "low", expiresAt: ` ${TODAY_KST} ` });
    expect(today).toMatchObject({ severity: "low", expiresAt: TODAY_KST, isExpired: false });
  });

  it("[v2-EC-01][CT-16] 영문자·숫자가 2자 미만인 패턴(`*`, `@*/*`, `a*`)은 저장하지 않고 400 VALIDATION_ERROR details.name", async () => {
    for (const name of ["*", "@*/*", "a*", "**", "*-*"]) {
      const error = expectApiError(
        await t.request("POST", "/api/blacklist", { name, reason: "너무 넓은 패턴" }),
        400,
        "VALIDATION_ERROR",
      );
      expect(error.details, name).toHaveProperty("name");
    }
    expect(await listEntries(t)).toEqual([]);
  });

  it("[v2-EC-01][CT-16] 허용 패턴은 저장되고(severity 포함), 연속한 `*` 는 1개로 정규화해서 저장한다 (정규화 후 같으면 중복)", async () => {
    for (const name of ["@evil/*", "@*/evil", "*-malware", "left-pad*"]) {
      const entry = await addEntry(t, { name, reason: "패턴", severity: "high" });
      expect(entry, name).toMatchObject({ name, versionRange: null, severity: "high" });
    }

    const normalized = await addEntry(t, { name: "@scope/**", reason: "연속 별표" });
    expect(normalized.name).toBe("@scope/*");
    expectApiError(
      await t.request("POST", "/api/blacklist", { name: "@scope/*", reason: "같은 패턴" }),
      409,
      "DUPLICATE_ENTRY",
    );
    expect(names(await listEntries(t))).toEqual(
      ["*-malware", "@*/evil", "@evil/*", "@scope/*", "left-pad*"].sort(),
    );
  });

  it("[v2-EC-02][CT-16] npm 항목에 semver 가 아닌 범위(`[1.0,2.0)`)는 패턴 이름과 함께여도 400 details.versionRange", async () => {
    const bodies = [
      { name: "lodash", versionRange: "[1.0,2.0)", reason: "x" },
      { name: "lodash", versionRange: "[1.0,2.0)", reason: "x", ecosystem: "npm", severity: "high" },
      { name: "@evil/*", versionRange: "[1.0,2.0)", reason: "x" },
    ];
    for (const body of bodies) {
      const error = expectApiError(await t.request("POST", "/api/blacklist", body), 400, "VALIDATION_ERROR");
      expect(error.details, JSON.stringify(body)).toHaveProperty("versionRange");
    }
    expect(await listEntries(t)).toEqual([]);

    const entry = await addEntry(t, { name: "@evil/*", versionRange: "<2", reason: "패턴 + 범위" });
    const put = await t.request("PUT", `/api/blacklist/${entry.id}`, {
      name: "@evil/*",
      versionRange: "[1.0,2.0)",
      reason: "x",
    });
    expect(expectApiError(put, 400, "VALIDATION_ERROR").details).toHaveProperty("versionRange");
    expect(await listEntries(t)).toEqual([entry]);
  });

  it("[v2-EC-03][CT-16] 같은 (ecosystem, name, versionRange) 를 다시 등록하면 409 DUPLICATE_ENTRY (ecosystem 생략 = npm)", async () => {
    await addEntry(t, { ...LODASH, ecosystem: "npm" });
    await addEntry(t, { name: "@evil/*", reason: "패턴" });

    const duplicates = [
      { ...LODASH, ecosystem: "npm", severity: "critical" },
      { ...LODASH, enabled: false },
      { name: "@evil/*", versionRange: null, reason: "x", ecosystem: "npm" },
      { name: "@evil/**", reason: "x" },
    ];
    for (const body of duplicates) {
      const error = expectApiError(await t.request("POST", "/api/blacklist", body), 409, "DUPLICATE_ENTRY");
      expect(error.message).toBe(DUPLICATE_MESSAGE);
    }
    expect(await listEntries(t)).toHaveLength(2);
  });

  it("[v2-EC-03][CT-16] 이름·범위가 같고 종류만 다른 행이 있으면 npm 항목은 201 로 저장된다 (POST 와 PUT 의 중복 판정 모두)", async () => {
    // `go` 는 이 묶음에서 API 로 넣을 수 없어서 DB 에 직접 넣는다.
    insertEntryRow(t, { ecosystem: "go", name: "lodash", versionRange: "<4.17.21" });
    insertEntryRow(t, { ecosystem: "go", name: "renamed-pkg" });

    const npm = await addEntry(t, LODASH);
    expect(npm).toMatchObject({ ecosystem: "npm", name: "lodash", versionRange: "<4.17.21" });

    const other = await addEntry(t, { name: "other-pkg", reason: "x" });
    const renamed = await putEntry(t, other.id, { name: "renamed-pkg", versionRange: null, reason: "x" });
    expect(renamed).toMatchObject({ ecosystem: "npm", name: "renamed-pkg", versionRange: null });

    // 같은 종류(npm)의 다른 항목과 겹치는 PUT 은 여전히 중복이다.
    const clash = await t.request("PUT", `/api/blacklist/${other.id}`, { ...LODASH });
    expect(expectApiError(clash, 409, "DUPLICATE_ENTRY").message).toBe(DUPLICATE_MESSAGE);

    const entries = await listEntries(t);
    expect(entries.map((entry) => `${entry.ecosystem}:${entry.name}`).sort()).toEqual([
      "go:lodash",
      "go:renamed-pkg",
      "npm:lodash",
      "npm:renamed-pkg",
    ]);
  });

  it("[v2-EC-04][CT-16] expiresAt 이 어제(KST) 이전이거나 없는 날짜·잘못된 형식이면 저장하지 않고 400 details.expiresAt", async () => {
    for (const expiresAt of [YESTERDAY_KST, "2020-01-01", "2027-13-40", "2027-02-30", "2026/12/31", "내일"]) {
      const error = expectApiError(
        await t.request("POST", "/api/blacklist", { ...EVIL, expiresAt }),
        400,
        "VALIDATION_ERROR",
      );
      expect(error.details, expiresAt).toHaveProperty("expiresAt");
    }
    expect(await listEntries(t)).toEqual([]);
  });

  it("[v2-EC-04][CT-16] 과거 판정의 '오늘'은 UTC 가 아니라 KST 날짜다", async () => {
    // UTC 로는 아직 11-12 이지만 KST 는 11-13 00:30 이다.
    t.clock.set("2026-11-12T15:30:00.000Z");

    const past = await t.request("POST", "/api/blacklist", { ...EVIL, expiresAt: "2026-11-12" });
    expect(expectApiError(past, 400, "VALIDATION_ERROR").details).toHaveProperty("expiresAt");

    const today = await addEntry(t, { ...EVIL, expiresAt: "2026-11-13" });
    expect(today).toMatchObject({ expiresAt: "2026-11-13", isExpired: false });
  });

  it("[v2-EC-05][CT-16] 지원하지 않는 ecosystem·잘못된 severity·문자열 enabled 는 저장하지 않고 400 VALIDATION_ERROR (go·pypi 는 올바른 이름이면 201)", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ ...EVIL, ecosystem: "cobol" }, "ecosystem"],
      [{ ...EVIL, severity: "urgent" }, "severity"],
      [{ ...EVIL, severity: "HIGH" }, "severity"],
      [{ ...EVIL, enabled: "false" }, "enabled"],
      [{ ...EVIL, enabled: 0 }, "enabled"],
    ];
    for (const [body, field] of cases) {
      const error = expectApiError(await t.request("POST", "/api/blacklist", body), 400, "VALIDATION_ERROR");
      expect(error.details, JSON.stringify(body)).toHaveProperty(field);
    }
    expect(await listEntries(t)).toEqual([]);

    const entry = await addEntry(t, { ...EVIL, severity: "high", enabled: false });
    expect(entry).toMatchObject({ severity: "high", enabled: false });
    for (const [body, field] of cases) {
      const res = await t.request("PUT", `/api/blacklist/${entry.id}`, body);
      expect(expectApiError(res, 400, "VALIDATION_ERROR").details, JSON.stringify(body)).toHaveProperty(field);
    }
    // go·pypi 는 PUT 으로 종류를 바꿀 수 없고(400 details.ecosystem), POST 는 올바른 이름이면 받는다.
    for (const ecosystem of ["go", "pypi"]) {
      const res = await t.request("PUT", `/api/blacklist/${entry.id}`, { ...EVIL, ecosystem });
      expect(expectApiError(res, 400, "VALIDATION_ERROR").details).toHaveProperty("ecosystem");
    }
    expect(await listEntries(t)).toEqual([entry]);
    for (const ecosystem of ["go", "pypi"]) {
      expect((await t.request("POST", "/api/blacklist", { ...EVIL, ecosystem })).status).toBe(201);
    }
  });
});

describe("PUT /api/blacklist/:id — 새 필드", () => {
  it("[CT-16] 새 필드를 생략하면 저장된 값을 유지하고, 넣으면 바꾸고, expiresAt null·빈 문자열은 만료 해제다", async () => {
    const created = await addEntry(t, {
      ...EVIL,
      severity: "high",
      enabled: false,
      expiresAt: "2026-12-31",
    });

    // v1 클라이언트의 본문(3개 키)
    const kept = await putEntry(t, created.id, { name: "evil-pkg", versionRange: null, reason: "새 사유" });
    expect(kept).toMatchObject({
      reason: "새 사유",
      ecosystem: "npm",
      severity: "high",
      enabled: false,
      expiresAt: "2026-12-31",
      isExpired: false,
    });

    const changed = await putEntry(t, created.id, {
      name: "evil-pkg",
      versionRange: null,
      reason: "새 사유",
      ecosystem: "npm",
      severity: "low",
      enabled: true,
      expiresAt: "2027-01-15",
    });
    expect(changed).toMatchObject({ severity: "low", enabled: true, expiresAt: "2027-01-15" });

    const released = await putEntry(t, created.id, {
      name: "evil-pkg",
      versionRange: null,
      reason: "새 사유",
      expiresAt: null,
    });
    expect(released).toMatchObject({ severity: "low", enabled: true, expiresAt: null, isExpired: false });

    await putEntry(t, created.id, { name: "evil-pkg", versionRange: null, reason: "새 사유", expiresAt: "2027-03-01" });
    const blank = await putEntry(t, created.id, { name: "evil-pkg", versionRange: null, reason: "새 사유", expiresAt: "" });
    expect(blank.expiresAt).toBeNull();
    expect(await listEntries(t)).toEqual([blank]);
  });

  it("[v2-EC-04][CT-16] PUT 의 과거 expiresAt 은 400 이지만, 저장된 값과 같으면(만료된 항목의 사유만 수정) 받는다", async () => {
    const entry = await addEntry(t, { ...EVIL, severity: "high", expiresAt: TODAY_KST });
    t.clock.advance(2 * DAY); // KST 2026-11-14

    const same = await putEntry(t, entry.id, {
      name: "evil-pkg",
      versionRange: null,
      reason: "사유만 수정",
      expiresAt: TODAY_KST,
    });
    expect(same).toMatchObject({ reason: "사유만 수정", severity: "high", expiresAt: TODAY_KST, isExpired: true });

    const omitted = await putEntry(t, entry.id, { name: "evil-pkg", versionRange: null, reason: "생략 = 유지" });
    expect(omitted).toMatchObject({ reason: "생략 = 유지", expiresAt: TODAY_KST, isExpired: true });

    const otherPast = await t.request("PUT", `/api/blacklist/${entry.id}`, {
      name: "evil-pkg",
      versionRange: null,
      reason: "다른 과거 날짜",
      expiresAt: "2026-11-13",
    });
    expect(expectApiError(otherPast, 400, "VALIDATION_ERROR").details).toHaveProperty("expiresAt");
    expect(await listEntries(t)).toEqual([omitted]);

    const extended = await putEntry(t, entry.id, {
      name: "evil-pkg",
      versionRange: null,
      reason: "연장",
      expiresAt: "2026-11-14",
    });
    expect(extended).toMatchObject({ expiresAt: "2026-11-14", isExpired: false });
  });
});

describe("GET /api/blacklist — 필터 (ecosystem, enabled, q)", () => {
  async function seed() {
    const alpha = await addEntry(t, { name: "alpha-lib", reason: "a", severity: "high" });
    const beta = await addEntry(t, { name: "Beta-Lib", reason: "b", enabled: false });
    const gamma = await addEntry(t, { name: "gamma", reason: "c", expiresAt: TODAY_KST });
    return { alpha, beta, gamma };
  }

  it("[CT-17] ?enabled=false 는 꺼진 항목만, ?enabled=true 는 사용자가 켠 항목만(만료된 항목 포함) 반환한다", async () => {
    const { alpha, beta, gamma } = await seed();

    expect(await listEntries(t, { enabled: "false" })).toEqual([beta]);
    expect(names(await listEntries(t, { enabled: "true" }))).toEqual(names([alpha, gamma]));
    expect(await listEntries(t)).toHaveLength(3);

    t.clock.advance(DAY); // gamma 만료
    const enabled = await listEntries(t, { enabled: "true" });
    expect(names(enabled)).toEqual(names([alpha, gamma]));
    expect(enabled.find((entry) => entry.id === gamma.id)).toMatchObject({ enabled: true, isExpired: true });
    expect(names(await listEntries(t, { enabled: "false" }))).toEqual(["Beta-Lib"]);
  });

  it("[CT-17] ?q 는 trim 후 이름의 대소문자 무시 부분 일치이고 빈 값은 생략과 같다 (enabled 와 함께 쓸 수 있다)", async () => {
    await seed();

    expect(names(await listEntries(t, { q: "LIB" }))).toEqual(["Beta-Lib", "alpha-lib"]);
    expect(names(await listEntries(t, { q: "  beta " }))).toEqual(["Beta-Lib"]);
    expect(names(await listEntries(t, { q: "mm" }))).toEqual(["gamma"]);
    expect(await listEntries(t, { q: "없는-이름" })).toEqual([]);
    expect(await listEntries(t, { q: "   " })).toHaveLength(3);
    expect(names(await listEntries(t, { q: "lib", enabled: "true" }))).toEqual(["alpha-lib"]);
    expect(names(await listEntries(t, { q: "lib", enabled: "false" }))).toEqual(["Beta-Lib"]);
  });

  it("[CT-17] ?ecosystem 은 정확히 일치하는 종류만 반환하고 enum 7개를 모두 받는다", async () => {
    await seed();
    insertEntryRow(t, { ecosystem: "go", name: "github.com/evil/tool" });

    expect(names(await listEntries(t, { ecosystem: "go" }))).toEqual(["github.com/evil/tool"]);
    expect(names(await listEntries(t, { ecosystem: "npm" }))).toEqual(["Beta-Lib", "alpha-lib", "gamma"]);
    for (const ecosystem of ["pypi", "nuget", "cargo", "pub", "maven"]) {
      expect(await listEntries(t, { ecosystem }), ecosystem).toEqual([]);
    }
    expect(names(await listEntries(t, { ecosystem: "npm", enabled: "false" }))).toEqual(["Beta-Lib"]);
  });

  it("[CT-17] enum 밖의 ecosystem 과 true/false 가 아닌 enabled 는 400 VALIDATION_ERROR (+details), 꺼진 항목 필터는 그대로 동작한다", async () => {
    const { beta } = await seed();

    const badEcosystem = await t.request("GET", "/api/blacklist?ecosystem=cobol");
    expect(expectApiError(badEcosystem, 400, "VALIDATION_ERROR").details).toHaveProperty("ecosystem");
    for (const value of ["yes", "1", "TRUE"]) {
      const res = await t.request("GET", `/api/blacklist?enabled=${value}`);
      expect(expectApiError(res, 400, "VALIDATION_ERROR").details, value).toHaveProperty("enabled");
    }

    expect(await listEntries(t, { enabled: "false" })).toEqual([beta]);
  });
});
