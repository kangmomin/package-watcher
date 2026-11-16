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
        throw isGraphqlRateLimit(error) ? new RateLimitedError() : translateError(error);
      }
      const connection = (data as { securityVulnerabilities?: unknown } | null)?.securityVulnerabilities as
        | { nodes?: unknown; pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } }
        | null
        | undefined;
      if (!connection || !Array.isArray(connection.nodes)) {
        throw new Error("GitHub 권고 응답의 형식이 올바르지 않습니다");
      }
      const next = connection.pageInfo?.endCursor;
      return {
        nodes: connection.nodes,
        nextCursor: connection.pageInfo?.hasNextPage === true && typeof next === "string" ? next : null,
      };
    },
  };
}
