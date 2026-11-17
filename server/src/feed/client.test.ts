import { describe, expect, it } from "vitest";
import { RateLimitedError } from "../github/client.ts";
import { createFetchMock, type MockReply } from "../test/fetchMock.ts";
import { createFeedClient, FEED_QUERY } from "./client.ts";

const node = { updatedAt: "2026-11-01T00:00:00Z", vulnerableVersionRange: "= 1.0.0" };

function client(reply: MockReply | ((body: string | null) => MockReply)) {
  const mock = createFetchMock(({ url, body }) => {
    if (url.pathname !== "/graphql") return { status: 404, body: { message: "Not Found" } };
    return typeof reply === "function" ? reply(body) : reply;
  });
  return { mock, feed: createFeedClient({ token: "test-token", fetch: mock.fetch }) };
}

describe("createFeedClient (fetch mock)", () => {
  it("[SE-75] GraphQL 로 malware 권고만 요청하고 cursor 를 변수로 보낸다. 다음 cursor 를 돌려준다", async () => {
    const { mock, feed } = client({
      status: 200,
      body: { data: { securityVulnerabilities: { pageInfo: { hasNextPage: true, endCursor: "CUR2" }, nodes: [node] } } },
    });

    const page = await feed.fetchPage("malware", "CUR1");

    expect(page).toEqual({ nodes: [node], nextCursor: "CUR2" });
    const call = mock.calls[0];
    expect(call?.method).toBe("POST");
    expect(call?.url.href).toBe("https://api.github.com/graphql");
    expect(call?.headers.get("authorization")).toBe("token test-token");
    const sent = JSON.parse(call?.body ?? "{}") as { query: string; variables: { cursor: string } };
    expect(sent.variables).toEqual({ cursor: "CUR1" });
    expect(sent.query).toContain("classifications: MALWARE");
    expect(sent.query).toContain("UPDATED_AT");
    expect(sent.query).toBe(FEED_QUERY);
  });

  it("[SE-76] 마지막 페이지(hasNextPage=false)는 nextCursor 가 null 이다", async () => {
    const { feed } = client({
      status: 200,
      body: { data: { securityVulnerabilities: { pageInfo: { hasNextPage: false, endCursor: "X" }, nodes: [] } } },
    });

    expect(await feed.fetchPage("malware", null)).toEqual({ nodes: [], nextCursor: null });
  });

  it("[SE-77] GraphQL 의 RATE_LIMITED 오류와 primary rate limit(403 + remaining 0)은 RateLimitedError", async () => {
    const limited = client({ status: 200, body: { data: null, errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }] } });
    await expect(limited.feed.fetchPage("malware", null)).rejects.toBeInstanceOf(RateLimitedError);

    const primary = client({
      status: 403,
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "9999999999" },
      body: { message: "API rate limit exceeded" },
    });
    await expect(primary.feed.fetchPage("malware", null)).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("[SE-78] 형식이 다른 응답과 HTTP 오류는 Error 이고 토큰을 메시지에 넣지 않는다", async () => {
    const malformed = client({ status: 200, body: { data: { securityVulnerabilities: null } } });
    await expect(malformed.feed.fetchPage("malware", null)).rejects.toThrow(/형식/);

    const unauthorized = client({ status: 401, body: { message: "Bad credentials" } });
    const error = await unauthorized.feed.fetchPage("malware", null).then(
      () => null,
      (reason: unknown) => reason as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain("401");
    expect(error?.message).not.toContain("test-token");
  });
});
