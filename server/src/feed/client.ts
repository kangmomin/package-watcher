import { Octokit } from "octokit";
import {
  DO_NOT_RETRY,
  MAX_RETRIES,
  RateLimitedError,
  SECONDARY_RETRY_AFTER_LIMIT_S,
  translateError,
  withTimeout,
} from "../github/client.ts";

export interface FeedPage {
  /** 검증 전의 원본 노드. 형식 확인은 동기화(sync.ts)가 노드마다 한다 */
  nodes: unknown[];
  /** 다음 페이지가 없으면 null */
  nextCursor: string | null;
}

export interface FeedClient {
  /** 최근 갱신 순(UPDATED_AT DESC)의 malware 권고 100건. 실패하면 throw (rate limit 은 `RateLimitedError`) */
  fetchPage(cursor: string | null): Promise<FeedPage>;
}

/** GitHub 이 넘겨 준 cursor 를 거부했다 (GraphQL 오류가 cursor·after 인자의 형식 문제를 가리킨다). 이어받기를 처음부터 다시 하는 유일한 근거 */
export class InvalidCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCursorError";
  }
}

/** 다시 시도해도 소용없는 오류: 토큰 문제(401, rate limit 이 아닌 403) */
export class FatalFeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalFeedError";
  }
}

const AUTH_ERROR = /^GitHub API 오류 \((?:401|403)\)/;
const CURSOR_WORD = /\b(?:cursor|after)\b/i;
const CURSOR_PROBLEM = /\b(?:invalid|malformed|not (?:a )?valid|valid cursor|decode|decoding|parse|parsing|illegal|expired)\b/i;

/** 오류의 문장(octokit 이 합친 message 와 `errors[].message`)이 cursor 인자의 형식 문제를 가리키는가 */
export function isInvalidCursorMessage(error: unknown): boolean {
  const { message, errors } = (error ?? {}) as { message?: unknown; errors?: unknown };
  const texts = [message, ...(Array.isArray(errors) ? errors.map((item) => (item as { message?: unknown } | null)?.message) : [])];
  return texts.some((text) => typeof text === "string" && CURSOR_WORD.test(text) && CURSOR_PROBLEM.test(text));
}

export const PAGE_SIZE = 100;

/** 이 도구가 쓰는 필드만 요청한다. 일반 CVE 는 가져오지 않는다(classifications: MALWARE). */
export const FEED_QUERY = `
query($cursor: String) {
  securityVulnerabilities(classifications: MALWARE, first: ${PAGE_SIZE}, after: $cursor, orderBy: {field: UPDATED_AT, direction: DESC}) {
    pageInfo { hasNextPage endCursor }
    nodes {
      updatedAt
      vulnerableVersionRange
      package { ecosystem name }
      advisory { ghsaId summary severity permalink withdrawnAt updatedAt }
    }
  }
}`;

export interface FeedClientOptions {
  token: string;
  /** 테스트용 fetch 주입 */
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
}

interface GraphqlLikeError {
  errors?: unknown;
  message?: unknown;
}

/**
 * GraphQL 은 rate limit 도 200 응답의 `errors[].type` 으로 알린다. throttling 플러그인은 이를
 * `GraphQL Rate Limit Exceeded` 라는 일반 Error 로 바꾸기도 해서 메시지도 함께 본다.
 */
function isGraphqlRateLimit(error: unknown): boolean {
  const { errors, message } = (error ?? {}) as GraphqlLikeError;
  if (Array.isArray(errors) && errors.some((item) => (item as { type?: unknown } | null)?.type === "RATE_LIMITED")) {
    return true;
  }
  return typeof message === "string" && /graphql rate limit/i.test(message);
}

const MALFORMED = "GitHub 권고 응답의 형식이 올바르지 않습니다";

/**
 * 형식이 다른 응답의 오류 문장. `securityVulnerabilities` 가 없거나 null 이면 GitHub 의 일시적인 이상 응답일 수 있어 표시하고,
 * 응답에 GraphQL `errors` 가 함께 있으면 첫 메시지를 200자까지 붙인다(토큰·헤더는 넣지 않는다).
 */
export function describeMalformed(data: unknown, connection: unknown): string {
  if (connection !== null && connection !== undefined) return MALFORMED;
  const errors = (data as { errors?: unknown } | null)?.errors;
  const first = Array.isArray(errors) ? (errors[0] as { message?: unknown } | undefined)?.message : undefined;
  const detail = typeof first === "string" && first !== "" ? `: ${first.slice(0, 200)}` : "";
  return `${MALFORMED} (일시적일 수 있음)${detail}`;
}

/**
 * 권고 조회용 GraphQL 클라이언트. 같은 토큰·같은 재시도 규칙(`github/client.ts`)을 쓴다.
 * 토큰이 없으면 만들지 않는다(호출 쪽이 null 로 둔다).
 */
export function createFeedClient(options: FeedClientOptions): FeedClient {
  const octokit = new Octokit({
    auth: options.token,
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    request: { fetch: withTimeout(options.fetch ?? globalThis.fetch) },
    retry: { doNotRetry: DO_NOT_RETRY, retries: MAX_RETRIES },
    throttle: {
      onRateLimit: () => false,
      onSecondaryRateLimit: (retryAfter: number, _options: unknown, _octokit: unknown, retryCount: number) =>
        retryCount < MAX_RETRIES && retryAfter <= SECONDARY_RETRY_AFTER_LIMIT_S,
    },
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  });

  return {
    async fetchPage(cursor) {
      let data: unknown;
      try {
        data = await octokit.graphql(FEED_QUERY, { cursor });
      } catch (error) {
        if (isGraphqlRateLimit(error)) throw new RateLimitedError();
        // 처음부터의 요청(cursor 없음)에는 cursor 오류가 있을 수 없다
        if (cursor !== null && isInvalidCursorMessage(error)) {
          throw new InvalidCursorError(`GitHub 이 cursor 를 거부했습니다: ${String((error as Error).message).slice(0, 200)}`);
        }
        const translated = translateError(error);
        throw AUTH_ERROR.test(translated.message) ? new FatalFeedError(translated.message) : translated;
      }
      const connection = (data as { securityVulnerabilities?: unknown } | null)?.securityVulnerabilities as
        | { nodes?: unknown; pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } }
        | null
        | undefined;
      if (!connection || !Array.isArray(connection.nodes)) throw new Error(describeMalformed(data, connection));
      const next = connection.pageInfo?.endCursor;
      return {
        nodes: connection.nodes,
        nextCursor: connection.pageInfo?.hasNextPage === true && typeof next === "string" ? next : null,
      };
    },
  };
}
