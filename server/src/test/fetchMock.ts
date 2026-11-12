export interface MockRequest {
  method: string;
  url: URL;
  headers: Headers;
  body: string | null;
}

export interface MockReply {
  status: number;
  /** 문자열이면 그대로, 그 외는 JSON */
  body?: unknown;
  /** 헤더 이름은 소문자로 쓴다 */
  headers?: Record<string, string>;
}

export type MockHandler = (request: MockRequest) => MockReply | Promise<MockReply>;

export interface FetchMock {
  fetch: typeof globalThis.fetch;
  /** redirect 를 따라간 요청까지 모두 기록한다 */
  calls: MockRequest[];
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

/**
 * octokit 구현 테스트용 fetch.
 * 실제 fetch 의 기본 동작(`redirect: "follow"`)을 흉내 내서 3xx + `location` 이면 따라간다.
 * `redirect: "manual"`/`"error"` 를 요청하면 3xx 를 그대로 돌려준다.
 */
export function createFetchMock(handler: MockHandler): FetchMock {
  const calls: MockRequest[] = [];

  const fetchImpl = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const isRequest = input instanceof Request;
    let url = new URL(isRequest ? input.url : String(input));
    const method = (init?.method ?? (isRequest ? input.method : "GET")).toUpperCase();
    const headers = new Headers(init?.headers ?? (isRequest ? input.headers : undefined));
    const body = typeof init?.body === "string" ? init.body : null;
    const follow = (init?.redirect ?? "follow") === "follow";

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const request: MockRequest = { method, url, headers, body };
      calls.push(request);
      const reply = await handler(request);
      const location = reply.headers?.location;
      if (follow && REDIRECT_STATUSES.has(reply.status) && location) {
        url = new URL(location, url);
        continue;
      }
      return toResponse(reply);
    }
    throw new TypeError("redirect count exceeded");
  };

  return { fetch: fetchImpl as typeof globalThis.fetch, calls };
}

function toResponse(reply: MockReply): Response {
  const headers = new Headers(reply.headers);
  let body: string | null = null;
  if (reply.body !== undefined && reply.status !== 204 && reply.status !== 304) {
    if (typeof reply.body === "string") {
      body = reply.body;
      if (!headers.has("content-type")) headers.set("content-type", "text/plain; charset=utf-8");
    } else {
      body = JSON.stringify(reply.body);
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/json; charset=utf-8");
      }
    }
  }
  return new Response(body, { status: reply.status, headers });
}
