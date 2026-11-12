import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTestApps,
  createTestApp,
  expectApiError,
  putSettings,
  type TestApp,
} from "./test/testApp.ts";

let t: TestApp;

beforeEach(() => {
  t = createTestApp();
});

afterEach(cleanupTestApps);

describe("오류 응답 (Error Contract)", () => {
  it("[CT-10] 등록되지 않은 /api/* 는 404 NOT_FOUND ApiError (SPA HTML 로 폴백하지 않는다)", async () => {
    for (const [method, path] of [
      ["GET", "/api/does-not-exist"],
      ["POST", "/api/does-not-exist"],
      ["GET", "/api/findings/1/extra"],
    ] as const) {
      const res = await t.request(method, path);
      expectApiError(res, 404, "NOT_FOUND");
      expect(res.headers.get("content-type") ?? "").toContain("application/json");
    }
  });

  it("[CT-10] 깨진 JSON 본문은 400 VALIDATION_ERROR (details 없음)", async () => {
    await putSettings(t);
    for (const [method, path] of [
      ["POST", "/api/blacklist"],
      ["PUT", "/api/settings"],
    ] as const) {
      const error = expectApiError(await t.request(method, path, "{ broken json"), 400, "VALIDATION_ERROR");
      expect(error.details, `${method} ${path}`).toBeUndefined();
    }
  });

  it("[CT-10] JSON 이 아닌 Content-Type 은 400 VALIDATION_ERROR (details 없음)", async () => {
    const res = await t.raw("/api/blacklist", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ name: "evil-pkg", reason: "악성 코드" }),
    });

    const error = expectApiError(res, 400, "VALIDATION_ERROR");
    expect(error.details).toBeUndefined();
    const list = await t.request("GET", "/api/blacklist");
    expect((list.json as { items: unknown[] }).items).toEqual([]);
  });

  it("[CT-10] 예상하지 못한 예외는 500 INTERNAL_ERROR ApiError 이고 내부 오류 문장을 그대로 노출하지 않는다", async () => {
    t.instance.db.exec("DROP TABLE findings");

    const error = expectApiError(await t.request("GET", "/api/findings"), 500, "INTERNAL_ERROR");

    expect(error.message).not.toMatch(/no such table/i);
  });
});
