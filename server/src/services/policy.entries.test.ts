import {
  POLICY_CHECKS,
  POLICY_CREATE_MESSAGE,
  POLICY_DELETE_MESSAGE,
  POLICY_RENAME_MESSAGE,
  type BlacklistEntry,
} from "@pw/shared";
import { afterEach, describe, expect, it } from "vitest";
import { addEntry, listEntries, putEntry } from "../test/v2.ts";
import {
  cleanupTestApps,
  createTestApp,
  expectApiError,
  putSettings,
  type TestApp,
} from "../test/testApp.ts";

afterEach(cleanupTestApps);

const policyOf = async (t: TestApp): Promise<BlacklistEntry[]> => listEntries(t, { ecosystem: "policy" });

async function seeded(): Promise<TestApp> {
  const t = createTestApp({ seedPolicy: true });
  await putSettings(t);
  return t;
}

describe("내장 검사 항목의 생성", () => {
  it("[SD-10] 시작하면 9개를 기본값으로 만든다", async () => {
    const t = await seeded();

    const entries = await policyOf(t);

    expect(entries.map((entry) => entry.name).sort()).toEqual(POLICY_CHECKS.map((check) => check.id).sort());
    for (const check of POLICY_CHECKS) {
      const entry = entries.find((item) => item.name === check.id);
      expect(entry).toMatchObject({
        ecosystem: "policy",
        versionRange: null,
        reason: check.description,
        severity: check.severity,
        enabled: true,
        expiresAt: null,
      });
    }
  });

  it("[SD-11] 같은 DB 로 다시 시작해도 9개이고 사용자가 바꾼 값을 건드리지 않는다", async () => {
    const first = await seeded();
    const target = (await policyOf(first)).find((entry) => entry.name === "unpinned-action");
    if (!target) throw new Error("항목이 없습니다");
    await putEntry(first, target.id, {
      name: target.name,
      versionRange: null,
      reason: "내 사유",
      severity: "high",
      enabled: false,
    });
    const before = await policyOf(first);
    const { dbPath } = first;
    await first.close();

    const second = createTestApp({ seedPolicy: true, dbPath });

    const after = await policyOf(second);
    expect(after).toHaveLength(9);
    expect(after).toEqual(before);
    expect(after.find((entry) => entry.name === "unpinned-action")).toMatchObject({
      reason: "내 사유",
      severity: "high",
      enabled: false,
    });
  });

  it("[SD-12] 테스트 앱은 기본으로 만들지 않는다", async () => {
    const t = createTestApp();

    expect(await policyOf(t)).toEqual([]);
  });
});

describe("내장 검사 항목의 보호", () => {
  it("[SD-13] POST 에서 policy 는 VALIDATION_ERROR 이고 details.ecosystem 이 안내 문구다", async () => {
    const t = await seeded();

    const res = await t.request("POST", "/api/blacklist", { ecosystem: "policy", name: "my-check", reason: "x" });

    const error = expectApiError(res, 400, "VALIDATION_ERROR");
    expect(error.details).toEqual({ ecosystem: POLICY_CREATE_MESSAGE });
    expect(await policyOf(t)).toHaveLength(9);
  });

  it("[SD-14] DELETE 는 INVALID_STATE 이고 항목이 남는다", async () => {
    const t = await seeded();
    const [first] = await policyOf(t);

    const res = await t.request("DELETE", `/api/blacklist/${first?.id}`);

    const error = expectApiError(res, 409, "INVALID_STATE");
    expect(error.message).toBe(POLICY_DELETE_MESSAGE);
    expect(await policyOf(t)).toHaveLength(9);
  });

  it("[SD-15] 일괄 delete 에 policy 가 1개라도 있으면 아무것도 지우지 않고, enable·disable 은 허용한다", async () => {
    const t = await seeded();
    const evil = await addEntry(t, { name: "evil-pkg", versionRange: null, reason: "악성" });
    const [first] = await policyOf(t);

    const del = await t.request("POST", "/api/blacklist/bulk", { action: "delete", ids: [evil.id, first?.id] });

    expectApiError(del, 409, "INVALID_STATE");
    expect(await listEntries(t)).toHaveLength(10);

    const off = await t.request("POST", "/api/blacklist/bulk", { action: "disable", ids: [first?.id] });
    expect(off.status, off.text).toBe(200);
    expect((await policyOf(t)).find((entry) => entry.id === first?.id)?.enabled).toBe(false);
    const on = await t.request("POST", "/api/blacklist/bulk", { action: "enable", ids: [first?.id] });
    expect(on.status, on.text).toBe(200);
  });

  it("[SD-16] PUT 은 이름 변경만 거부하고 심각도·켬·사유·만료일은 바꿀 수 있다", async () => {
    const t = await seeded();
    const [first] = await policyOf(t);
    if (!first) throw new Error("항목이 없습니다");

    const rename = await t.request("PUT", `/api/blacklist/${first.id}`, {
      name: "other-check",
      versionRange: null,
      reason: first.reason,
    });
    const error = expectApiError(rename, 400, "VALIDATION_ERROR");
    expect(error.details).toEqual({ name: POLICY_RENAME_MESSAGE });

    const updated = await putEntry(t, first.id, {
      name: first.name,
      versionRange: null,
      reason: "새 사유",
      severity: "critical",
      enabled: false,
      expiresAt: "2027-01-01",
    });
    expect(updated).toMatchObject({ reason: "새 사유", severity: "critical", enabled: false, expiresAt: "2027-01-01" });

    const range = await t.request("PUT", `/api/blacklist/${first.id}`, {
      name: first.name,
      versionRange: "1.0.0",
      reason: "x",
    });
    expect(range.status).toBe(400);
  });

  it("[SD-17] 가져오기: 기존 항목과 키가 같은 policy 행은 갱신하고, 없는 id 는 그 행의 오류다", async () => {
    const t = await seeded();
    const [first] = await policyOf(t);
    if (!first) throw new Error("항목이 없습니다");
    const items = [
      { ecosystem: "policy", name: first.name, versionRange: null, severity: "low", reason: "바꿈", enabled: false },
      { ecosystem: "policy", name: "my-check", versionRange: null, severity: "low", reason: "없음" },
    ];

    const res = await t.request("POST", "/api/blacklist/import", {
      format: "json",
      content: JSON.stringify({ version: 1, items }),
      dryRun: false,
    });

    expect(res.status, res.text).toBe(200);
    expect(res.json).toMatchObject({
      applied: false,
      errors: [{ row: 2, field: "ecosystem", message: POLICY_CREATE_MESSAGE }],
    });

    const ok = await t.request("POST", "/api/blacklist/import", {
      format: "json",
      content: JSON.stringify({ version: 1, items: items.slice(0, 1) }),
      dryRun: false,
    });
    expect(ok.json).toMatchObject({ applied: true, created: 0, updated: 1, errors: [] });
    expect((await policyOf(t)).find((entry) => entry.id === first.id)).toMatchObject({
      severity: "low",
      reason: "바꿈",
      enabled: false,
    });
  });

  it("[SD-18] 내보내기는 policy 항목을 포함하고 그대로 다시 가져오면 모두 unchanged 다", async () => {
    const t = await seeded();

    const exported = await t.request("GET", "/api/blacklist/export?format=json");
    expect(exported.status, exported.text).toBe(200);
    expect(exported.text).toContain('"ecosystem": "policy"');

    const res = await t.request("POST", "/api/blacklist/import", {
      format: "json",
      content: exported.text,
      dryRun: false,
    });
    expect(res.json).toMatchObject({ applied: true, created: 0, updated: 0, unchanged: 9, errors: [] });
  });
});
