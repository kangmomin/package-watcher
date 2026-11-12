// 전역 fetch 를 vi.fn 으로 바꾸고, method + path 로 응답을 고른다.
// 나간 요청은 모두 기록해서 테스트가 URL·query·body·재요청 횟수를 검증한다.
import { ERROR_HTTP_STATUS, type ApiError } from "@pw/shared";
import { vi, type Mock } from "vitest";

export interface RecordedRequest {
  method: string;
  url: URL;
  /** pathname (query 제외). 예: `/api/findings` */
  path: string;
  /** query string 을 객체로. 같은 키가 여러 번이면 마지막 값. */
  query: Record<string, string>;
  headers: Headers;
  /** 본문 원문. 본문이 없으면 undefined */
  rawBody: string | undefined;
  /** JSON 이면 parse 한 값, 아니면 원문, 없으면 undefined */
  body: unknown;
}

export type ReplyFactory = (request: RecordedRequest) => Response | Promise<Response>;
export type PathMatcher = string | RegExp;

interface Route {
  method: string;
  path: PathMatcher;
  reply: ReplyFactory;
  once: boolean;
}

/** 응답 생성기. 같은 응답을 여러 번 줄 수 있게 매번 새 Response 를 만든다. */
export const reply = {
  json(body: unknown, status = 200): ReplyFactory {
    return () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
  },
  /** ApiError 본문. status 는 계약의 코드별 HTTP status 를 쓴다. */
  error(error: ApiError, status: number = ERROR_HTTP_STATUS[error.error.code]): ReplyFactory {
    return reply.json(error, status);
  },
  noContent(): ReplyFactory {
    return () => new Response(null, { status: 204 });
  },
  text(body: string, status: number, contentType = "text/html"): ReplyFactory {
    return () => new Response(body, { status, headers: { "Content-Type": contentType } });
  },
  /** fetch 자체가 실패한다 (서버 연결 불가). */
  networkError(): ReplyFactory {
    return () => Promise.reject(new TypeError("Failed to fetch"));
  },
};

/**
 * 응답을 붙잡아 두는 handler. `resolve` 전까지 요청이 끝나지 않는다("요청 중" 상태 검증용).
 * 붙잡힌 동안 들어온 요청은 모두 같은 응답을 받는다.
 */
export function deferredReply() {
  let release!: (factory: ReplyFactory) => void;
  const ready = new Promise<ReplyFactory>((resolve) => {
    release = resolve;
  });
  const handler: ReplyFactory = async (request) => (await ready)(request);
  return {
    reply: handler,
    resolve(factory: ReplyFactory) {
      release(factory);
    },
  };
}

function matchesPath(matcher: PathMatcher, path: string): boolean {
  return typeof matcher === "string" ? matcher === path : matcher.test(path);
}

async function recordRequest(input: RequestInfo | URL, init?: RequestInit): Promise<RecordedRequest> {
  let urlText: string;
  let method: string;
  let headers: Headers;
  let rawBody: string | undefined;

  if (input instanceof Request) {
    urlText = input.url;
    method = init?.method ?? input.method;
    headers = new Headers(init?.headers ?? input.headers);
    const text = init?.body != null ? String(init.body) : await input.clone().text();
    rawBody = text === "" ? undefined : text;
  } else {
    urlText = input instanceof URL ? input.href : String(input);
    method = init?.method ?? "GET";
    headers = new Headers(init?.headers);
    rawBody = init?.body == null ? undefined : String(init.body);
  }

  const url = new URL(urlText, "http://localhost");
  let body: unknown = rawBody;
  if (rawBody !== undefined) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = rawBody;
    }
  }
  return {
    method: method.toUpperCase(),
    url,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers,
    rawBody,
    body,
  };
}

export interface FetchMock {
  fetch: Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>;
  /** 처리한 순서대로 모든 요청 */
  calls: RecordedRequest[];
  /** 등록된 route 가 없어 실패시킨 요청 */
  unhandled: RecordedRequest[];
  /** 계속 쓰는 응답. 나중에 등록한 것이 우선한다. */
  on(method: string, path: PathMatcher, factory: ReplyFactory): FetchMock;
  /** 1회만 쓰는 응답. 같은 요청에 대해 `on` 보다 먼저 쓴다. */
  once(method: string, path: PathMatcher, factory: ReplyFactory): FetchMock;
  requests(method: string, path: PathMatcher): RecordedRequest[];
  count(method: string, path: PathMatcher): number;
  last(method: string, path: PathMatcher): RecordedRequest | undefined;
}

/** 전역 fetch 를 mock 으로 바꾼다. 원복은 setup.ts 의 `vi.unstubAllGlobals()` 가 한다. */
export function setupFetchMock(): FetchMock {
  const routes: Route[] = [];
  const calls: RecordedRequest[] = [];
  const unhandled: RecordedRequest[] = [];

  const pickRoute = (request: RecordedRequest): Route | undefined => {
    const candidates = routes.filter(
      (route) => route.method === request.method && matchesPath(route.path, request.path),
    );
    // once 를 먼저(등록 순서대로), 그다음 나중에 등록한 on.
    const once = candidates.find((route) => route.once);
    if (once) {
      routes.splice(routes.indexOf(once), 1);
      return once;
    }
    return candidates.at(-1);
  };

  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = await recordRequest(input, init);
    calls.push(request);
    const route = pickRoute(request);
    if (!route) {
      unhandled.push(request);
      throw new TypeError(`[fetchMock] 등록되지 않은 요청: ${request.method} ${request.url.pathname}${request.url.search}`);
    }
    return route.reply(request);
  });
  vi.stubGlobal("fetch", fetchFn);

  const select = (method: string, path: PathMatcher) =>
    calls.filter((call) => call.method === method.toUpperCase() && matchesPath(path, call.path));

  const mock: FetchMock = {
    fetch: fetchFn,
    calls,
    unhandled,
    on(method, path, factory) {
      routes.push({ method: method.toUpperCase(), path, reply: factory, once: false });
      return mock;
    },
    once(method, path, factory) {
      routes.push({ method: method.toUpperCase(), path, reply: factory, once: true });
      return mock;
    },
    requests: select,
    count: (method, path) => select(method, path).length,
    last: (method, path) => select(method, path).at(-1),
  };
  return mock;
}
