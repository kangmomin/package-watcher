import {
  apiErrorOf,
  apiErrorValidation,
  findingIgnored,
  findingOpenDirect,
  summaryDefault,
} from "@pw/shared/fixtures";
import { beforeEach, describe, expect, it } from "vitest";
import { api, ApiRequestError } from "@/lib/api";
import { reply, setupFetchMock, type FetchMock } from "@/test/fetchMock";

// Error Contract: FE 전용 NETWORK_ERROR 의 문구
const NETWORK_ERROR_MESSAGE = "서버에 연결할 수 없습니다";

/** 동기 throw 와 rejected promise 를 모두 잡는다. */
async function captureError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("요청이 실패해야 하는데 성공했습니다");
}

describe("api 클라이언트", () => {
  let server: FetchMock;

  beforeEach(() => {
    server = setupFetchMock();
  });

  it("[CT-10] 2xx 응답을 shared 스키마로 parse 해서 돌려준다", async () => {
    server.on("GET", "/api/summary", reply.json(summaryDefault));

    await expect(api.getSummary()).resolves.toEqual(summaryDefault);
    expect(server.count("GET", "/api/summary")).toBe(1);
  });

  it("[CT-10] ApiError 본문의 비-2xx 응답은 status·code·message·details 를 가진 ApiRequestError 로 던진다", async () => {
    server.on("POST", "/api/blacklist", reply.error(apiErrorValidation));

    const error = await captureError(() =>
      api.createBlacklistEntry({ name: "lodash", versionRange: "not a range", reason: "취약점" }),
    );

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
      message: apiErrorValidation.error.message,
      details: apiErrorValidation.error.details,
    });
  });

  it("[CT-10] details 가 없는 ApiError(409 SCAN_RUNNING)도 ApiRequestError 로 던진다", async () => {
    const body = apiErrorOf("SCAN_RUNNING", "이미 스캔이 실행 중입니다");
    server.on("POST", "/api/scans", reply.error(body));

    const error = await captureError(() => api.triggerScan());

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 409, code: "SCAN_RUNNING", message: body.error.message });
    expect((error as ApiRequestError).details).toBeUndefined();
  });

  it("[CT-10] 본문이 ApiError 가 아닌 비-2xx 응답(HTML 502)은 NETWORK_ERROR 다", async () => {
    server.on("GET", "/api/settings", reply.text("<html>Bad Gateway</html>", 502));

    const error = await captureError(() => api.getSettings());

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 502, code: "NETWORK_ERROR", message: NETWORK_ERROR_MESSAGE });
  });

  it("[CT-10] JSON 이지만 ApiError 스키마가 아닌 비-2xx 본문도 NETWORK_ERROR 다", async () => {
    server.on("GET", "/api/summary", reply.json({ message: "oops" }, 500));

    const error = await captureError(() => api.getSummary());

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 500, code: "NETWORK_ERROR", message: NETWORK_ERROR_MESSAGE });
  });

  it("[CT-10] fetch 자체가 실패하면 status 0 의 NETWORK_ERROR 다", async () => {
    server.on("GET", "/api/summary", reply.networkError());

    const error = await captureError(() => api.getSummary());

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 0, code: "NETWORK_ERROR", message: NETWORK_ERROR_MESSAGE });
  });

  it("[CT-10] 204 응답(DELETE)은 undefined 로 끝난다", async () => {
    server.on("DELETE", "/api/blacklist/1", reply.noContent());

    await expect(api.deleteBlacklistEntry(1)).resolves.toBeUndefined();
    expect(server.count("DELETE", "/api/blacklist/1")).toBe(1);
  });

  it("[CT-10] 2xx 인데 응답이 shared 스키마와 맞지 않으면 INTERNAL_ERROR 로 처리한다", async () => {
    server.on("GET", "/api/summary", reply.json({ ...summaryDefault, openCount: "12" }));

    const error = await captureError(() => api.getSummary());

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("[CT-12][CT-10] ISO 8601 UTC 가 아닌 날짜 필드는 parse 실패(INTERNAL_ERROR)다", async () => {
    server.on("GET", "/api/summary", reply.json({ ...summaryDefault, nextScanAt: "2026-11-13 09:00" }));

    const error = await captureError(() => api.getSummary());

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("[CT-12][CT-10] nullable 필드가 생략된 응답은 parse 실패(INTERNAL_ERROR)다 — null 로 존재해야 한다", async () => {
    const { resolvedAt: _omitted, ...withoutResolvedAt } = findingIgnored;
    server.on("PATCH", "/api/findings/3", reply.json(withoutResolvedAt));

    const error = await captureError(() => api.setFindingStatus(3, { status: "ignored" }));

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("[CT-10] 변경 요청은 JSON 본문과 Content-Type: application/json 으로 보낸다", async () => {
    server.on("PATCH", "/api/findings/1", reply.json({ ...findingOpenDirect, status: "ignored" }));

    await api.setFindingStatus(1, { status: "ignored" });

    const request = server.last("PATCH", "/api/findings/1");
    expect(request?.body).toEqual({ status: "ignored" });
    expect(request?.headers.get("content-type")).toMatch(/application\/json/);
  });
});
