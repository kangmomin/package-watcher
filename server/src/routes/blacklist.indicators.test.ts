import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportRequest, importOk, importRequest, jsonFile } from "../test/bulk.ts";
import { cleanupTestApps, createTestApp, expectApiError, type TestApp } from "../test/testApp.ts";
import { addEntry, listEntries } from "../test/v2.ts";

let t: TestApp;

beforeEach(() => {
  t = createTestApp();
});

afterEach(cleanupTestApps);

const post = (body: Record<string, unknown>) =>
  t.request("POST", "/api/blacklist", { reason: "x", ...body });

describe("흔적 종류의 검증", () => {
  it("[SC-40] versionRange 가 있는 path·content·branch 항목은 POST 에서 400 details.versionRange", async () => {
    for (const [ecosystem, name] of [
      ["path", ".ci-*.sh"],
      ["content", "193.32.204.199"],
      ["branch", "wfx-docs"],
    ] as const) {
      const error = expectApiError(await post({ ecosystem, name, versionRange: "<1.0.0" }), 400, "VALIDATION_ERROR");
      expect(error.details, ecosystem).toHaveProperty("versionRange");
    }
    expect(await listEntries(t)).toEqual([]);
  });

  it("[SC-41] PUT 과 가져오기도 versionRange 를 거부한다", async () => {
    const created = await addEntry(t, { ecosystem: "path", name: ".ci-*.sh", reason: "x" });
    expect(created.versionRange).toBeNull();

    const put = await t.request("PUT", `/api/blacklist/${created.id}`, {
      name: ".ci-*.sh",
      versionRange: "<1.0.0",
      reason: "x",
    });
    expect(expectApiError(put, 400, "VALIDATION_ERROR").details).toHaveProperty("versionRange");

    const result = await importOk(
      t,
      "json",
      jsonFile([{ ecosystem: "path", name: "router_init.js", versionRange: "<1.0.0", reason: "x" }]),
      true,
    );
    expect(result.errors).toHaveLength(1);
    expect(JSON.stringify(result.errors)).toContain("versionRange");
  });

  it("[SC-42] content 는 *, 5자 이하, 줄바꿈을 거부하고 6자와 200자는 받는다", async () => {
    for (const name of ["evil-*-host", "abc.d", "evil\nhost.example", "x".repeat(201)]) {
      const error = expectApiError(await post({ ecosystem: "content", name }), 400, "VALIDATION_ERROR");
      expect(error.details, name).toHaveProperty("name");
    }
    for (const name of ["abc.de", `a1${"x".repeat(198)}`]) {
      const res = await post({ ecosystem: "content", name });
      expect(res.status, name).toBe(201);
    }
  });

  it("[SC-43] 쉼표와 따옴표가 든 content 문자열이 CSV 로 내보내고 가져와도 그대로다", async () => {
    const name = 'curl -H "x: y", http://193.32.204.199/a';
    await addEntry(t, { ecosystem: "content", name, reason: '사유, "인용"' });
    const exported = await exportRequest(t, { format: "csv" });
    expect(exported.status).toBe(200);

    await t.request("DELETE", `/api/blacklist/${(await listEntries(t))[0]?.id}`);
    expect(await listEntries(t)).toEqual([]);
    const imported = await importRequest(t, "csv", exported.text, false);
    expect(imported.status, imported.text).toBe(200);

    const items = await listEntries(t);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ ecosystem: "content", name, versionRange: null, reason: '사유, "인용"' });
  });
});
