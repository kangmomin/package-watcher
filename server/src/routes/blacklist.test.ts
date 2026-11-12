import { blacklistEntrySchema, blacklistListSchema } from "@pw/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MINUTE } from "../test/clock.ts";
import { pkgJson } from "../test/repoFixtures.ts";
import {
  addBlacklist,
  allFindings,
  cleanupTestApps,
  createTestApp,
  EVIL,
  expectApiError,
  findOne,
  getSummary,
  listFindings,
  LODASH,
  patchFinding,
  putSettings,
  runScan,
  type TestApp,
} from "../test/testApp.ts";

let t: TestApp;

beforeEach(() => {
  t = createTestApp();
});

afterEach(cleanupTestApps);

async function listBlacklist() {
  const res = await t.request("GET", "/api/blacklist");
  expect(res.status).toBe(200);
  return blacklistListSchema.parse(res.json).items;
}

describe("POST /api/blacklist", () => {
  it("[AC-09][CT-05] 유효한 값이면 201 + id 를 가진 항목(trim 적용), GET /api/blacklist 에 나타난다", async () => {
    const res = await t.request("POST", "/api/blacklist", {
      name: "  lodash ",
      versionRange: " <4.17.21 ",
      reason: " 취약점 ",
    });

    expect(res.status).toBe(201);
    const entry = blacklistEntrySchema.parse(res.json);
    expect(entry).toMatchObject({ name: "lodash", versionRange: "<4.17.21", reason: "취약점" });
    expect(await listBlacklist()).toEqual([entry]);
  });

  it("[CT-05] versionRange 생략·빈 문자열은 null(모든 버전)이다", async () => {
    const omitted = await addBlacklist(t, { name: "evil-pkg", reason: "악성 코드" });
    expect(omitted.versionRange).toBeNull();
    const blank = await addBlacklist(t, { name: "other-pkg", versionRange: "   ", reason: "x" });
    expect(blank.versionRange).toBeNull();
  });

  it("[CT-05] GET 은 name 오름차순, 같으면 id 오름차순", async () => {
    const zeta = await addBlacklist(t, { name: "zeta", reason: "z" });
    const alphaAll = await addBlacklist(t, { name: "alpha", versionRange: null, reason: "a" });
    const alphaRange = await addBlacklist(t, { name: "alpha", versionRange: "<2", reason: "a2" });

    expect((await listBlacklist()).map((entry) => entry.id)).toEqual([
      alphaAll.id,
      alphaRange.id,
      zeta.id,
    ]);
  });

  it("[EC-07][CT-05] 잘못된 semver range·빈 name·빈 사유·501자 사유는 저장하지 않고 400 VALIDATION_ERROR (+details)", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ name: "lodash", versionRange: "not-a-range!!", reason: "x" }, "versionRange"],
      [{ name: "", reason: "x" }, "name"],
      [{ name: "   ", reason: "x" }, "name"],
      [{ name: "has space", reason: "x" }, "name"],
      [{ name: "lodash", reason: "" }, "reason"],
      [{ name: "lodash", reason: "x".repeat(501) }, "reason"],
      [{ reason: "x" }, "name"],
    ];
    for (const [body, field] of cases) {
      const error = expectApiError(await t.request("POST", "/api/blacklist", body), 400, "VALIDATION_ERROR");
      expect(error.details, JSON.stringify(body)).toHaveProperty(field);
    }
    expect(await listBlacklist()).toEqual([]);
  });

  it("[EC-08][CT-05] 같은 name + versionRange 를 다시 추가하면 409 DUPLICATE_ENTRY (null 범위끼리, 정규화 후 비교 포함)", async () => {
    await addBlacklist(t, LODASH);
    await addBlacklist(t, EVIL);

    const duplicates = [
      { name: "lodash", versionRange: "<4.17.21", reason: "다른 사유" },
      { name: " lodash ", versionRange: " <4.17.21 ", reason: "x" },
      { name: "evil-pkg", versionRange: null, reason: "x" },
      { name: "evil-pkg", reason: "x" },
      { name: "evil-pkg", versionRange: "", reason: "x" },
    ];
    for (const body of duplicates) {
      expectApiError(await t.request("POST", "/api/blacklist", body), 409, "DUPLICATE_ENTRY");
    }
    expect(await listBlacklist()).toHaveLength(2);
  });

  it("[EC-08][CT-05] 범위가 다르거나 이름의 대소문자가 다르면 중복이 아니다", async () => {
    await addBlacklist(t, LODASH);

    await addBlacklist(t, { name: "lodash", versionRange: null, reason: "전체" });
    await addBlacklist(t, { name: "Lodash", versionRange: "<4.17.21", reason: "대문자" });

    expect(await listBlacklist()).toHaveLength(3);
  });
});

describe("PUT /api/blacklist/:id", () => {
  it("[CT-05] 전체 교체로 200, updatedAt 이 바뀐다. 같은 값으로 PUT 해도 200", async () => {
    const entry = await addBlacklist(t, LODASH);
    t.clock.advance(MINUTE);

    const res = await t.request("PUT", `/api/blacklist/${entry.id}`, {
      name: "lodash",
      versionRange: null,
      reason: "전체 금지",
    });

    expect(res.status).toBe(200);
    const updated = blacklistEntrySchema.parse(res.json);
    expect(updated).toMatchObject({
      id: entry.id,
      name: "lodash",
      versionRange: null,
      reason: "전체 금지",
      createdAt: entry.createdAt,
    });
    expect(updated.updatedAt).not.toBe(entry.updatedAt);
    const same = await t.request("PUT", `/api/blacklist/${entry.id}`, {
      name: "lodash",
      versionRange: null,
      reason: "전체 금지",
    });
    expect(same.status).toBe(200);
  });

  it("[CT-05] versionRange 키가 없으면 400 (PUT 은 전체 교체)", async () => {
    const entry = await addBlacklist(t, LODASH);

    const error = expectApiError(
      await t.request("PUT", `/api/blacklist/${entry.id}`, { name: "lodash", reason: "x" }),
      400,
      "VALIDATION_ERROR",
    );

    expect(error.details).toHaveProperty("versionRange");
    expect((await listBlacklist())[0]?.versionRange).toBe("<4.17.21");
  });

  it("[EC-08][CT-05] 다른 항목과 같은 값으로 바꾸면 409 DUPLICATE_ENTRY", async () => {
    await addBlacklist(t, LODASH);
    const other = await addBlacklist(t, { name: "lodash", versionRange: null, reason: "전체" });

    expectApiError(
      await t.request("PUT", `/api/blacklist/${other.id}`, {
        name: "lodash",
        versionRange: "<4.17.21",
        reason: "x",
      }),
      409,
      "DUPLICATE_ENTRY",
    );
  });

  it("[CT-05] 없는 id·정수가 아닌 id 는 404 NOT_FOUND", async () => {
    for (const id of ["999", "abc"]) {
      expectApiError(
        await t.request("PUT", `/api/blacklist/${id}`, { name: "x", versionRange: null, reason: "x" }),
        404,
        "NOT_FOUND",
      );
    }
  });
});

describe("DELETE /api/blacklist/:id", () => {
  it("[CT-05] 204 본문 없음, 다시 삭제하면 404, 정수가 아닌 id 는 404", async () => {
    const entry = await addBlacklist(t, LODASH);

    const res = await t.request("DELETE", `/api/blacklist/${entry.id}`);
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    expect(await listBlacklist()).toEqual([]);

    expectApiError(await t.request("DELETE", `/api/blacklist/${entry.id}`), 404, "NOT_FOUND");
    expectApiError(await t.request("DELETE", "/api/blacklist/abc"), 404, "NOT_FOUND");
  });
});

describe("블랙리스트 변경과 검출 (EC-09, CT-13)", () => {
  async function seedFindings() {
    await putSettings(t);
    const evil = await addBlacklist(t, EVIL);
    const lodash = await addBlacklist(t, LODASH);
    t.github.setRepos([
      { name: "api", files: { "package.json": pkgJson({ dependencies: { "evil-pkg": "^1.0.0" } }) } },
      { name: "web", files: { "package.json": pkgJson({ dependencies: { "evil-pkg": "^2.0.0" } }) } },
      { name: "old", files: { "package.json": pkgJson({ dependencies: { "evil-pkg": "^3.0.0" } }) } },
      { name: "lib", files: { "package.json": pkgJson({ dependencies: { lodash: "^4.17.0" } }) } },
    ]);
    await runScan(t);
    t.github.setFiles("old", { "package.json": pkgJson() });
    t.clock.advance(MINUTE);
    await runScan(t);
    const items = await allFindings(t);
    await patchFinding(t, findOne(items, { repo: "web" }).id, "ignored");
    return { evil, lodash };
  }

  it("[EC-09][CT-13] 항목을 삭제하면 그 항목의 open·ignored 검출이 resolved(+resolvedAt)가 되고 openCount 가 줄어든다", async () => {
    const { evil } = await seedFindings();
    const before = await getSummary(t);
    t.clock.advance(MINUTE);

    const res = await t.request("DELETE", `/api/blacklist/${evil.id}`);
    expect(res.status).toBe(204);

    const resolved = await listFindings(t, { status: "resolved" });
    for (const repo of ["api", "web"]) {
      const finding = findOne(resolved.items, { repo });
      expect(finding.blacklistEntryId).toBe(evil.id);
      expect(finding.resolvedAt).not.toBeNull();
    }
    const after = await getSummary(t);
    expect(after.openCount).toBe(before.openCount - 1);
    expect(after.ignoredCount).toBe(before.ignoredCount - 1);
    expect(findOne(await allFindings(t), { repo: "lib" }).status).toBe("open");
  });

  it("[CT-13] 항목을 PUT 하면 그 항목의 활성 검출 reason 이 즉시 바뀐다 (resolved 검출은 그대로)", async () => {
    const { evil } = await seedFindings();

    const res = await t.request("PUT", `/api/blacklist/${evil.id}`, {
      name: "evil-pkg",
      versionRange: null,
      reason: "공급망 공격",
    });
    expect(res.status).toBe(200);

    const items = await allFindings(t);
    expect(findOne(items, { repo: "api" }).reason).toBe("공급망 공격");
    expect(findOne(items, { repo: "web" }).reason).toBe("공급망 공격");
    expect(findOne(items, { repo: "old" }).reason).toBe("악성 코드");
    expect(findOne(items, { repo: "lib" }).reason).toBe("취약점");
  });

  it("[CT-13] 블랙리스트 추가·수정은 스캔을 자동 실행하지 않는다", async () => {
    await putSettings(t);
    const entry = await addBlacklist(t, EVIL);
    await t.request("PUT", `/api/blacklist/${entry.id}`, {
      name: "evil-pkg",
      versionRange: "<2",
      reason: "x",
    });

    const res = await t.request("GET", "/api/scans");
    expect(res.status).toBe(200);
    expect((res.json as { total: number }).total).toBe(0);
  });
});
