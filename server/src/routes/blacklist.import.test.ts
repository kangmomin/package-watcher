import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS } from "@pw/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MINUTE } from "../test/clock.ts";
import { csvFile, exportRequest, importOk, importRequest, jsonFile } from "../test/bulk.ts";
import { pkgJson } from "../test/repoFixtures.ts";
import {
  allFindings,
  cleanupTestApps,
  createTestApp,
  expectApiError,
  findOne,
  putSettings,
  runScan,
  type TestApp,
} from "../test/testApp.ts";
import { addEntry, getEntry, listEntries, startPausedScan } from "../test/v2.ts";

const EVIL = { name: "evil-pkg", versionRange: null, reason: "악성 코드" };
const LODASH = { name: "lodash", versionRange: "<4.17.21", reason: "취약점" };
const withEvil = () => pkgJson({ dependencies: { "evil-pkg": "^1.0.0" } });

let t: TestApp;

beforeEach(async () => {
  t = createTestApp();
  await putSettings(t);
});

afterEach(cleanupTestApps);

const row = (name: string, extra: Record<string, unknown> = {}) => ({ name, reason: `${name} 사유`, ...extra });

describe("POST /api/blacklist/import — 미리 보기와 적용", () => {
  it("[v2-AC-16] dryRun: true — 추가 2건·갱신 1건을 알려 주고 저장하지 않는다", async () => {
    await addEntry(t, LODASH);
    const before = await listEntries(t);
    t.clock.advance(MINUTE);
    const content = csvFile([
      ["npm", "lodash", "<4.17.21", "high", "새 사유", "true", ""],
      ["npm", "new-a", "", "medium", "추가 a", "true", ""],
      ["pypi", "new-b", ">=1.0", "low", "추가 b", "false", "2027-01-01"],
    ]);

    const result = await importOk(t, "csv", content, true);

    expect(result).toEqual({ applied: false, created: 2, updated: 1, unchanged: 0, errors: [] });
    expect(await listEntries(t)).toEqual(before);
  });

  it("[v2-AC-17] dryRun: false — applied: true, 목록에 반영되고 파일에 없는 기존 항목은 그대로다", async () => {
    const lodash = await addEntry(t, LODASH);
    const keep = await addEntry(t, EVIL);
    t.clock.advance(MINUTE);
    const content = csvFile([
      ["npm", "lodash", "<4.17.21", "high", "새 사유", "true", ""],
      ["npm", "new-a", "", "medium", "추가 a", "true", ""],
      ["pypi", "new-b", ">=1.0", "low", "추가 b", "false", "2027-01-01"],
    ]);

    const result = await importOk(t, "csv", content, false);

    expect(result).toEqual({ applied: true, created: 2, updated: 1, unchanged: 0, errors: [] });
    const items = await listEntries(t);
    expect(items).toHaveLength(4);
    expect(await getEntry(t, lodash.id)).toMatchObject({ severity: "high", reason: "새 사유", updatedAt: t.clock.iso() });
    expect(await getEntry(t, keep.id)).toEqual(keep);
    expect(items.find((item) => item.name === "new-a")).toMatchObject({
      ecosystem: "npm",
      versionRange: null,
      severity: "medium",
      reason: "추가 a",
      enabled: true,
      expiresAt: null,
    });
    expect(items.find((item) => item.name === "new-b")).toMatchObject({
      ecosystem: "pypi",
      versionRange: ">=1.0",
      severity: "low",
      enabled: false,
      expiresAt: "2027-01-01",
    });
  });

  it("[BK-13] dryRun 을 생략하면 저장하지 않는다 (미리 보기)", async () => {
    const res = await importRequest(t, "json", jsonFile([row("new-a")]));

    expect(res.status, res.text).toBe(200);
    expect(res.json).toEqual({ applied: false, created: 1, updated: 0, unchanged: 0, errors: [] });
    expect(await listEntries(t)).toEqual([]);
  });

  it("[BK-13] 이름과 사유만 있는 CSV 는 기본값(npm, medium, 켜짐, 범위·만료 없음)으로 등록된다", async () => {
    const result = await importOk(t, "csv", "name,reason\r\nlodash,취약점\r\n", false);

    expect(result).toMatchObject({ applied: true, created: 1 });
    expect(await listEntries(t)).toEqual([
      expect.objectContaining({
        ecosystem: "npm",
        name: "lodash",
        versionRange: null,
        severity: "medium",
        reason: "취약점",
        enabled: true,
        expiresAt: null,
      }),
    ]);
  });

  it("[BK-13] 이름은 종류의 규칙으로 정규화해서 저장하고, 같은 키의 기존 항목은 갱신한다 (pypi Foo_Bar → foo-bar)", async () => {
    const existing = await addEntry(t, { ecosystem: "pypi", name: "foo-bar", versionRange: null, reason: "옛 사유" });
    t.clock.advance(MINUTE);

    const result = await importOk(t, "json", jsonFile([row("Foo_Bar", { ecosystem: "pypi", reason: "새 사유" })]), false);

    expect(result).toMatchObject({ applied: true, created: 0, updated: 1, unchanged: 0 });
    expect(await listEntries(t)).toHaveLength(1);
    expect(await getEntry(t, existing.id)).toMatchObject({ name: "foo-bar", reason: "새 사유" });
  });

  it("[BK-13] 모든 필드가 같은 항목은 unchanged 이고 updatedAt 이 바뀌지 않는다", async () => {
    const a = await addEntry(t, { ...LODASH, severity: "high", expiresAt: "2027-01-01" });
    t.clock.advance(MINUTE);

    const result = await importOk(
      t,
      "json",
      jsonFile([{ ecosystem: "npm", name: "lodash", versionRange: "<4.17.21", severity: "high", reason: "취약점", enabled: true, expiresAt: "2027-01-01" }]),
      false,
    );

    expect(result).toEqual({ applied: true, created: 0, updated: 0, unchanged: 1, errors: [] });
    expect(await getEntry(t, a.id)).toEqual(a);
  });

  it("[BK-13] 같은 이름이라도 versionRange 나 종류가 다르면 다른 키다 (추가)", async () => {
    await addEntry(t, LODASH);

    const result = await importOk(
      t,
      "json",
      jsonFile([row("lodash", { versionRange: ">=5.0.0" }), row("lodash", { ecosystem: "pypi" })]),
      false,
    );

    expect(result).toMatchObject({ applied: true, created: 2, updated: 0, unchanged: 0 });
    expect(await listEntries(t)).toHaveLength(3);
  });

  it("[BK-13] 갱신으로 enabled 가 false 가 되면 그 항목의 활성 검출이 resolved 가 된다", async () => {
    await addEntry(t, EVIL);
    t.github.setRepos([{ name: "api", files: { "package.json": withEvil() } }]);
    await runScan(t);
    t.clock.advance(MINUTE);

    const result = await importOk(t, "json", jsonFile([{ ...row("evil-pkg"), reason: "악성 코드", enabled: false }]), false);

    expect(result).toMatchObject({ applied: true, updated: 1 });
    expect(await allFindings(t)).toEqual([expect.objectContaining({ status: "resolved", resolvedAt: t.clock.iso() })]);
  });

  it("[BK-13] 갱신으로 severity·reason 이 바뀌면 활성 검출도 갱신된다", async () => {
    await addEntry(t, EVIL);
    t.github.setRepos([{ name: "api", files: { "package.json": withEvil() } }]);
    await runScan(t);

    await importOk(t, "json", jsonFile([{ ...row("evil-pkg"), severity: "critical", reason: "더 나쁜 사유" }]), false);

    expect(findOne(await allFindings(t), { packageName: "evil-pkg" })).toMatchObject({
      status: "open",
      severity: "critical",
      reason: "더 나쁜 사유",
    });
  });
});

describe("POST /api/blacklist/import — 왕복 (v2-AC-15)", () => {
  async function seed(): Promise<void> {
    await addEntry(t, { ...LODASH, severity: "high" });
    await addEntry(t, { name: "@scope/pkg", versionRange: null, reason: '쉼표, 큰따옴표 "인용"\n줄바꿈, 한글', enabled: false });
    await addEntry(t, { ecosystem: "pypi", name: "Foo_Bar", versionRange: ">=1.0,<2.0", reason: "pypi", expiresAt: "2027-01-01" });
    await addEntry(t, { ...EVIL, expiresAt: "2026-11-12" });
    t.clock.set("2026-11-12T15:00:00.000Z"); // KST 11-13 — 위 항목은 만료
  }

  for (const format of ["csv", "json"] as const) {
    it(`[v2-AC-15] ${format} 로 내보낸 파일을 그대로 가져오면 created: 0, updated: 0, unchanged: n 이다 (만료된 항목이 있어도)`, async () => {
      await seed();
      const before = await listEntries(t);
      expect(before.some((entry) => entry.isExpired)).toBe(true);
      const exported = await exportRequest(t, { format });
      expect(exported.status, exported.text).toBe(200);

      const preview = await importOk(t, format, exported.text, true);
      const applied = await importOk(t, format, exported.text, false);

      expect(preview).toEqual({ applied: false, created: 0, updated: 0, unchanged: 4, errors: [] });
      expect(applied).toEqual({ applied: true, created: 0, updated: 0, unchanged: 4, errors: [] });
      expect(await listEntries(t)).toEqual(before);
    });
  }

  it("[v2-EC-15] 사유에 쉼표·줄바꿈·큰따옴표·한글이 있는 항목을 내보내고 빈 DB 에 가져오면 같은 값이다", async () => {
    await seed();
    const before = (await listEntries(t)).map(({ id: _id, createdAt: _c, updatedAt: _u, isExpired: _e, ...rest }) => rest);
    const csv = (await exportRequest(t, { format: "csv" })).text;
    const json = (await exportRequest(t, { format: "json" })).text;

    for (const [format, content] of [["csv", csv], ["json", json]] as const) {
      const other = createTestApp({ now: "2026-11-01T00:00:00.000Z" });
      // 만료된 항목은 새 항목으로는 가져올 수 없으므로 가져오는 쪽의 시계를 만료 전으로 둔다
      const res = await other.request("POST", "/api/blacklist/import", { format, content, dryRun: false });
      expect(res.status, res.text).toBe(200);
      expect(res.json).toMatchObject({ applied: true, created: 4, errors: [] });
      const items = await listEntries(other);
      expect(items.map(({ id: _id, createdAt: _c, updatedAt: _u, isExpired: _e, ...rest }) => rest)).toEqual(before);
    }
  });
});

describe("POST /api/blacklist/import — 행 오류", () => {
  it("[v2-EC-10] 잘못된 행이 1건 있으면 dryRun: false 여도 applied: false 이고 아무것도 저장하지 않는다. errors 에 행·필드·메시지가 있다", async () => {
    await addEntry(t, LODASH);
    const before = await listEntries(t);
    const content = csvFile([
      ["npm", "good-a", "", "medium", "좋은 행", "true", ""],
      ["npm", "bad-row", "", "urgent", "심각도 오류", "true", ""],
      ["npm", "lodash", "<4.17.21", "high", "갱신 행", "true", ""],
    ]);

    const result = await importOk(t, "csv", content, false);

    expect(result.applied).toBe(false);
    expect(result.errors).toEqual([{ row: 2, field: "severity", message: expect.stringMatching(/.+/) }]);
    // 오류가 있어도 나머지 행의 분류를 알려 준다
    expect(result).toMatchObject({ created: 1, updated: 1, unchanged: 0 });
    expect(await listEntries(t)).toEqual(before);
  });

  it("[BK-13] 종류별 검증의 오류가 행의 field(name/versionRange)로 나온다", async () => {
    const result = await importOk(
      t,
      "json",
      jsonFile([
        row("has space", { versionRange: "not-a-range!!" }),
        row("ok-name"),
        row("only-bad-range", { ecosystem: "pypi", versionRange: "^^^" }),
        row(""),
      ]),
      false,
    );

    expect(result.applied).toBe(false);
    expect(result.created).toBe(1);
    const fields = (n: number) => result.errors.filter((error) => error.row === n).map((error) => error.field).sort();
    expect(fields(1)).toEqual(["name", "versionRange"]);
    expect(fields(3)).toEqual(["versionRange"]);
    expect(fields(4)).toEqual(["name"]);
    expect(result.errors.some((error) => error.row === 2)).toBe(false);
  });

  it("[BK-13] 필수 값(name, reason)이 빠진 행과 객체가 아닌 JSON 항목은 그 행의 오류다", async () => {
    const result = await importOk(
      t,
      "json",
      jsonFile([{ name: "no-reason" }, 7, row("fine")]),
      false,
    );

    expect(result.applied).toBe(false);
    expect(result.created).toBe(1);
    expect(result.errors).toEqual([
      { row: 1, field: "reason", message: expect.stringMatching(/.+/) },
      { row: 2, field: null, message: expect.stringMatching(/.+/) },
    ]);
  });

  it("[BK-13] CSV 의 열 수가 머리글과 다른 행은 그 행의 오류다", async () => {
    const result = await importOk(t, "csv", "name,reason\r\na,b\r\nonly-name\r\nc,d\r\n", false);

    expect(result.applied).toBe(false);
    expect(result).toMatchObject({ created: 2 });
    expect(result.errors).toEqual([{ row: 2, field: null, message: expect.stringMatching(/.+/) }]);
  });

  it("[BK-13] 새 항목의 과거 expiresAt 은 오류이고, 기존 항목의 저장된 값과 다른 과거 값도 오류다", async () => {
    const a = await addEntry(t, { ...EVIL, expiresAt: "2026-12-01" });
    const content = jsonFile([
      row("new-past", { expiresAt: "2026-11-11" }),
      { ...EVIL, expiresAt: "2026-11-01" },
      row("new-today", { expiresAt: "2026-11-12" }),
    ]);

    const result = await importOk(t, "json", content, false);

    expect(result.applied).toBe(false);
    expect(result.errors).toEqual([
      { row: 1, field: "expiresAt", message: expect.stringMatching(/.+/) },
      { row: 2, field: "expiresAt", message: expect.stringMatching(/.+/) },
    ]);
    expect(result).toMatchObject({ created: 1, updated: 0 });
    expect(await getEntry(t, a.id)).toEqual(a);
  });

  it("[v2-EC-12] 파일 안에서 같은 키가 2번 나오면 두 번째 행이 오류다 (정규화한 키로 비교: pypi Foo_Bar 와 foo-bar)", async () => {
    const content = jsonFile([
      row("Foo_Bar", { ecosystem: "pypi" }),
      row("foo-bar", { ecosystem: "pypi" }),
      row("lodash", { versionRange: "<1.0.0" }),
      row("lodash", { versionRange: "<1.0.0", reason: "다른 사유" }),
      row("lodash", { versionRange: "<2.0.0" }),
    ]);

    const result = await importOk(t, "json", content, false);

    expect(result.applied).toBe(false);
    expect(result.errors).toEqual([
      { row: 2, field: null, message: expect.stringContaining("중복") },
      { row: 4, field: null, message: expect.stringContaining("중복") },
    ]);
    expect(result).toMatchObject({ created: 3 });
    expect(await listEntries(t)).toEqual([]);
  });

  it("[v2-EC-12] 중복 행이 없으면 같은 항목의 다른 종류는 중복이 아니다", async () => {
    const result = await importOk(t, "json", jsonFile([row("same"), row("same", { ecosystem: "pypi" })]), false);

    expect(result).toMatchObject({ applied: true, created: 2, errors: [] });
  });
});

describe("POST /api/blacklist/import — 파일 수준의 오류 (400)", () => {
  it("[v2-EC-11] 읽을 수 없는 내용, 머리글 누락, 잘못된 version 은 400 VALIDATION_ERROR 이고 저장하지 않는다", async () => {
    for (const [format, content] of [
      ["json", "{깨진 json"],
      ["json", JSON.stringify({ version: 2, items: [] })],
      ["json", JSON.stringify({ items: [] })],
      ["json", JSON.stringify({ version: 1, items: "x" })],
      ["csv", "name\r\nlodash\r\n"],
      ["csv", "ecosystem,name\r\nnpm,a\r\n"],
      ["csv", 'name,reason\r\n"닫히지 않음,r\r\n'],
      ["csv", ""],
    ] as const) {
      expectApiError(await importRequest(t, format, content, false), 400, "VALIDATION_ERROR");
    }
    expect(await listEntries(t)).toEqual([]);
  });

  it("[v2-EC-11] content 가 1 MB 를 넘으면 400 이고, 정확히 1 MB 는 읽는다", async () => {
    const prefix = "name,reason\r\n";
    const atLimit = `${prefix}a,${"x".repeat(IMPORT_MAX_BYTES - prefix.length - 2)}`;
    const over = `${atLimit}x`;

    expectApiError(await importRequest(t, "csv", over, true), 400, "VALIDATION_ERROR");
    const ok = await importRequest(t, "csv", atLimit, true);
    expect(ok.status, ok.text.slice(0, 200)).toBe(200);
    // 사유가 500자를 넘으므로 행 오류이지 파일 오류가 아니다
    expect(ok.json).toMatchObject({ applied: false, errors: [{ row: 1, field: "reason" }] });
  });

  it("[v2-EC-11] 데이터 행이 5000 을 넘으면 400 이고, 5000 은 읽는다", async () => {
    const body = (count: number) => csvFile(Array.from({ length: count }, (_, index) => [`n${index}`, "사유"]), "name,reason");

    expectApiError(await importRequest(t, "csv", body(IMPORT_MAX_ROWS + 1), true), 400, "VALIDATION_ERROR");
    const ok = await importRequest(t, "csv", body(IMPORT_MAX_ROWS), true);
    expect(ok.status, ok.text.slice(0, 200)).toBe(200);
    expect(ok.json).toMatchObject({ applied: false, created: IMPORT_MAX_ROWS, errors: [] });
  });

  it("[BK-13] 요청 본문이 4 MB 를 넘으면 400 VALIDATION_ERROR 다 (413 이 아니다)", async () => {
    const res = await t.raw("/api/blacklist/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format: "csv", content: "x".repeat(5 * 1024 * 1024) }),
    });

    expectApiError(res, 400, "VALIDATION_ERROR");
  });

  it("[BK-13] format·content·dryRun 의 형식 오류와 JSON 이 아닌 요청은 400 이다", async () => {
    for (const body of [
      {},
      { format: "xml", content: "x" },
      { format: "csv" },
      { format: "csv", content: 1 },
      { format: "csv", content: "name,reason\r\n", dryRun: "false" },
      { format: "csv", content: "name,reason\r\n", dryRun: null },
    ]) {
      expectApiError(await t.request("POST", "/api/blacklist/import", body), 400, "VALIDATION_ERROR");
    }
    expectApiError(await t.request("POST", "/api/blacklist/import", "{깨진"), 400, "VALIDATION_ERROR");
    const text = await t.raw("/api/blacklist/import", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "name,reason",
    });
    expectApiError(text, 400, "VALIDATION_ERROR");
  });

  it("[BK-13] /blacklist/import 는 id 로 읽히지 않는다 — PUT 은 404", async () => {
    expectApiError(await t.request("PUT", "/api/blacklist/import", {}), 404, "NOT_FOUND");
  });
});

describe("가져오기와 실행 중인 스캔 — v2-EC-14", () => {
  it("[v2-EC-14] 스캔 중 가져오기를 적용하면 200 이고, 그 스캔은 바뀐 항목으로 검출을 만들지 않는다", async () => {
    await addEntry(t, EVIL);
    t.github.setRepos([{ name: "alpha-svc", files: { "package.json": withEvil() } }]);
    t.clock.advance(MINUTE);
    const paused = await startPausedScan(t, "alpha-svc");

    const result = await importOk(t, "json", jsonFile([{ ...row("evil-pkg"), reason: "악성 코드", enabled: false }]), false);
    const scan = await paused.finish();

    expect(result).toMatchObject({ applied: true, updated: 1 });
    expect(scan).toMatchObject({ status: "success", newFindingCount: 0 });
    expect(await allFindings(t)).toEqual([]);
  });
});
