import { Octokit, RequestError } from "octokit";

export interface RepoInfo {
  /** org 를 뺀 repo 이름 */
  name: string;
  /** `{owner}/{name}`. 대상에서 빠진 repo 의 이름 변경·이전 판정에 쓴다 */
  fullName: string;
  archived: boolean;
  fork: boolean;
  defaultBranch: string;
}

export interface TreeEntry {
  path: string;
  /** blob sha (tree 와 같은 커밋) */
  sha: string;
}

export interface RepoTree {
  entries: TreeEntry[];
  truncated: boolean;
}

export interface GitHubClient {
  /** 모든 페이지를 받은 배열(archived·fork 포함). 한 페이지라도 실패하면 throw. */
  listOrgRepos(org: string): Promise<RepoInfo[]>;
  /** `GET /repos/{org}/{repo}`. 404 → null. redirect(이름 변경·이전)는 따라간 최종 repo 를 반환한다. */
  getRepo(org: string, repo: string): Promise<RepoInfo | null>;
  /**
   * recursive tree. `type === "blob"` 이고 `mode !== "120000"` 인 항목만 반환한다.
   * 빈 repo(409) → `{ entries: [], truncated: false }` (실패가 아니다).
   */
  getTree(org: string, repo: string, ref: string): Promise<RepoTree>;
  /** blob API(`git/blobs/{sha}`)로 읽어 UTF-8 문자열로 반환한다. contents API 는 1MB 초과 파일을 읽지 못한다. */
  getFile(org: string, repo: string, sha: string): Promise<string>;
  /** 모든 브랜치 이름(모든 페이지, 최대 10,000개 — 넘으면 throw). 빈 repo(409)는 `[]`, 404 는 throw. */
  listBranches(org: string, repo: string): Promise<string[]>;
}

/** primary rate limit 소진. 기다리지 않고 throw 한다(스캔은 남은 repo 를 "RATE_LIMITED" 로 실패 처리). */
export class RateLimitedError extends Error {
  constructor(message = "RATE_LIMITED") {
    super(message);
    this.name = "RateLimitedError";
  }
}

export interface OctokitClientOptions {
  token: string;
  /** 테스트용 fetch 주입 */
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
}

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const SECONDARY_RETRY_AFTER_LIMIT_S = 60;
/** 5xx·네트워크 오류만 재시도한다. 409(빈 repo)를 포함한 4xx 는 모두 재시도하지 않는다. */
const DO_NOT_RETRY = Array.from({ length: 100 }, (_, index) => 400 + index);
const SYMLINK_MODE = "120000";
const MAX_BRANCH_PAGES = 100;
const MAX_BRANCHES = MAX_BRANCH_PAGES * 100;

interface RepoResponse {
  name: string;
  full_name: string;
  archived?: boolean;
  fork: boolean;
  default_branch?: string;
}

function toRepoInfo(data: RepoResponse): RepoInfo {
  return {
    name: data.name,
    fullName: data.full_name,
    archived: data.archived ?? false,
    fork: data.fork,
    defaultBranch: data.default_branch ?? "HEAD",
  };
}

function isPrimaryRateLimit(error: RequestError): boolean {
  return (
    (error.status === 403 || error.status === 429) &&
    error.response?.headers["x-ratelimit-remaining"] === "0"
  );
}

/** octokit 오류를 스캔 기록용 문장으로 바꾼다. 토큰 등 요청 헤더는 넣지 않는다. */
function translateError(error: unknown): Error {
  if (error instanceof RateLimitedError) return error;
  if (error instanceof RequestError) {
    if (isPrimaryRateLimit(error)) return new RateLimitedError();
    return new Error(`GitHub API 오류 (${error.status}): ${error.message}`);
  }
  if (error instanceof Error) return new Error(`GitHub API 요청 실패: ${error.message}`);
  return new Error(`GitHub API 요청 실패: ${String(error)}`);
}

function withTimeout(base: typeof globalThis.fetch): typeof globalThis.fetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return base(input, { ...init, signal });
  };
}

/**
 * octokit 구현 (throttling·retry 플러그인).
 * 재시도: 5xx·네트워크 오류와 secondary rate limit(`retry-after`, 상한 60초)만 2회. 409 를 포함한 그 외 4xx 는 재시도하지 않는다.
 * primary rate limit 은 기다리지 않고 `RateLimitedError`. 요청 타임아웃 30초.
 */
export function createOctokitClient(options: OctokitClientOptions): GitHubClient {
  const octokit = new Octokit({
    auth: options.token,
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    request: { fetch: withTimeout(options.fetch ?? globalThis.fetch) },
    retry: { doNotRetry: DO_NOT_RETRY, retries: MAX_RETRIES },
    throttle: {
      // primary rate limit 은 기다리지 않는다(lock 장기 점유 방지).
      onRateLimit: () => false,
      onSecondaryRateLimit: (retryAfter: number, _options: unknown, _octokit: unknown, retryCount: number) =>
        retryCount < MAX_RETRIES && retryAfter <= SECONDARY_RETRY_AFTER_LIMIT_S,
    },
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  });

  async function call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw translateError(error);
    }
  }

  return {
    listOrgRepos: (org) =>
      call(async () => {
        const repos = await octokit.paginate(octokit.rest.repos.listForOrg, {
          org,
          type: "all",
          per_page: 100,
        });
        return repos.map((repo) => toRepoInfo(repo));
      }),

    getRepo: (org, repo) =>
      call(async () => {
        try {
          const { data } = await octokit.rest.repos.get({ owner: org, repo });
          return toRepoInfo(data);
        } catch (error) {
          if (error instanceof RequestError && error.status === 404) return null;
          throw error;
        }
      }),

    getTree: (org, repo, ref) =>
      call(async () => {
        try {
          const { data } = await octokit.rest.git.getTree({
            owner: org,
            repo,
            tree_sha: ref,
            recursive: "1",
          });
          const entries: TreeEntry[] = [];
          for (const item of data.tree) {
            if (item.type !== "blob" || item.mode === SYMLINK_MODE || !item.path || !item.sha) continue;
            entries.push({ path: item.path, sha: item.sha });
          }
          return { entries, truncated: data.truncated };
        } catch (error) {
          // 커밋이 없는 빈 repo 는 409 다. 실패가 아니라 파일 0개로 처리한다.
          if (error instanceof RequestError && error.status === 409) return { entries: [], truncated: false };
          throw error;
        }
      }),

    listBranches: (org, repo) =>
      call(async () => {
        // 직접 페이지를 돈다. 상한을 넘는 부분 결과가 resolve 의 근거가 되면 안 되므로 자르지 않고 throw 한다.
        const names: string[] = [];
        try {
          for (let page = 1; page <= MAX_BRANCH_PAGES; page += 1) {
            const { data, headers } = await octokit.rest.repos.listBranches({ owner: org, repo, per_page: 100, page });
            for (const branch of data) names.push(branch.name);
            if (!/rel="next"/.test(headers.link ?? "")) break;
            if (page === MAX_BRANCH_PAGES) {
              throw new Error(`브랜치가 너무 많습니다(${MAX_BRANCHES.toLocaleString("en-US")}개 초과)`);
            }
          }
        } catch (error) {
          // 빈 repo(409)만 `[]`. 404 는 이미 tree 를 읽은 repo 에서는 이상 상황이라 실패로 둔다(기존 검출을 유지).
          if (error instanceof RequestError && error.status === 409) return [];
          throw error;
        }
        return names;
      }),

    getFile: (org, repo, sha) =>
      call(async () => {
        const { data } = await octokit.rest.git.getBlob({ owner: org, repo, file_sha: sha });
        return data.encoding === "base64"
          ? Buffer.from(data.content, "base64").toString("utf8")
          : data.content;
      }),
  };
}
