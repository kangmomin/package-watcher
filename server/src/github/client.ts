import { Octokit, RequestError } from "octokit";

export interface RepoInfo {
  /** org 를 뺀 repo 이름 */
  name: string;
  /** `{owner}/{name}`. 대상에서 빠진 repo 의 이름 변경·이전 판정에 쓴다 */
  fullName: string;
  archived: boolean;
  fork: boolean;
  defaultBranch: string;
  /** 마지막 push 시각(ISO). 알 수 없으면 null */
  pushedAt: string | null;
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
  getFile(org: string, repo: string, sha: string, options?: GetFileOptions): Promise<string>;
  /** 이 클라이언트가 지금까지 보낸 HTTP 요청 수(REST·GraphQL). 스캔 전후의 차이로 스캔의 요청 수를 잰다. 세지 않는 구현은 생략한다 */
  requestCounts?(): RequestCounts;
  /** 모든 브랜치 이름(모든 페이지, 최대 10,000개 — 넘으면 throw). 빈 repo(409)는 `[]`, 404 는 throw. */
  listBranches(org: string, repo: string): Promise<string[]>;
  /**
   * 기본 브랜치를 뺀, `sinceIso` 이후에 커밋이 있는 브랜치 전체를 최근 순으로(GraphQL 1회, 최근 100개 브랜치 안에서).
   * 몇 개를 평가할지는 호출한 쪽이 정한다. repo 가 없거나 비었으면 `[]`. `sha` 는 그 브랜치의 최신 커밋(tree 조회에 쓴다).
   */
  listRecentBranches(org: string, repo: string, sinceIso: string): Promise<RecentBranch[]>;
  /**
   * 최근 100개 이벤트(REST 1회) 중 `sinceIso` 이후의 브랜치 push·생성: 브랜치 이름 → 마지막 push 시각.
   * 마지막 push 보다 뒤에 삭제된 브랜치는 넣지 않는다. 오래된 커밋을 새로 push 한 브랜치를 커밋 시각만으로는 놓치므로 함께 본다.
   * 404 를 포함한 모든 오류는 throw 한다(빈 결과로 처리하면 이름으로만 후보이던 브랜치의 검출이 resolve 된다).
   */
  listRecentPushes(org: string, repo: string, sinceIso: string): Promise<Map<string, string>>;
  /**
   * `branch` 의 `sinceIso` 이후 커밋(최근 순, 쪽마다 100개, 기본 1쪽). `sinceIso = null` 이면 기간 제한이 없다(기준선을 만들 때).
   * 빈 repo(409) → `[]`. 404 는 throw (이미 tree 를 읽은 repo 라서 이상 상황이다 — 호출한 쪽이 "조회 실패"로 둔다)
   */
  listRecentCommits(org: string, repo: string, branch: string, sinceIso: string | null, pages?: number): Promise<CommitInfo[]>;
  /** 위와 같되 `.github/workflows` 를 바꾼 커밋만(1쪽). 어느 파일이 바뀌었는지는 받지 않는다 */
  listWorkflowCommits(org: string, repo: string, branch: string, sinceIso: string): Promise<WorkflowCommit[]>;
  /** 최근에 바뀐 PR 50개(state 무관, 1쪽). 404 는 throw */
  listRecentPulls(org: string, repo: string): Promise<PullInfo[]>;
}

export interface CommitInfo {
  sha: string;
  /** 첫 2000자 */
  message: string;
  authorLogin: string | null;
  /** 작성자를 구분하는 데만 쓴다(hash 로 바꾼 뒤 버린다). 저장하지 않는다 */
  authorEmail: string | null;
  committedAt: string;
  url: string;
}

export interface WorkflowCommit {
  sha: string;
  committedAt: string;
  url: string;
  authorLogin: string | null;
}

export interface PullInfo {
  number: number;
  /** 첫 500자 */
  title: string;
  state: string;
  updatedAt: string;
  authorLogin: string | null;
  url: string;
}

export const COMMIT_MESSAGE_MAX = 2000;
export const PULL_TITLE_MAX = 500;
const SHA_FORMAT = /^[0-9a-f]{7,64}$/i;

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** `GET /commits` 응답의 항목을 고른다. sha 나 시각의 형식이 맞지 않는 항목은 건너뛴다(신뢰할 수 없는 입력) */
export function pickCommits(data: unknown): CommitInfo[] {
  if (!Array.isArray(data)) return [];
  const found: CommitInfo[] = [];
  for (const item of data as ({
    sha?: unknown;
    html_url?: unknown;
    author?: { login?: unknown } | null;
    commit?: { message?: unknown; author?: { email?: unknown; date?: unknown } | null; committer?: { date?: unknown } | null };
  } | null)[]) {
    const sha = str(item?.sha);
    const committedAt = str(item?.commit?.committer?.date) ?? str(item?.commit?.author?.date);
    if (sha === null || !SHA_FORMAT.test(sha) || committedAt === null || Number.isNaN(Date.parse(committedAt))) continue;
    found.push({
      sha,
      message: (str(item?.commit?.message) ?? "").slice(0, COMMIT_MESSAGE_MAX),
      authorLogin: str(item?.author?.login),
      authorEmail: str(item?.commit?.author?.email),
      committedAt,
      url: str(item?.html_url) ?? "",
    });
  }
  return found;
}

/** `GET /pulls` 응답의 항목을 고른다 */
export function pickPulls(data: unknown): PullInfo[] {
  if (!Array.isArray(data)) return [];
  const found: PullInfo[] = [];
  for (const item of data as ({
    number?: unknown;
    title?: unknown;
    state?: unknown;
    updated_at?: unknown;
    html_url?: unknown;
    user?: { login?: unknown } | null;
  } | null)[]) {
    const number = item?.number;
    if (typeof number !== "number" || !Number.isInteger(number) || number <= 0) continue;
    found.push({
      number,
      title: (str(item?.title) ?? "").slice(0, PULL_TITLE_MAX),
      state: str(item?.state) ?? "",
      updatedAt: str(item?.updated_at) ?? "",
      authorLogin: str(item?.user?.login),
      url: str(item?.html_url) ?? "",
    });
  }
  return found;
}

export interface GetFileOptions {
  /** 토큰이 들어 있을 수 있는 파일 — 디스크 캐시에 읽지도 쓰지도 않는다 */
  noCache?: boolean;
}

export interface RequestCounts {
  rest: number;
  graphql: number;
}

export interface RecentBranch {
  name: string;
  committedAt: string;
  sha: string;
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

export const REQUEST_TIMEOUT_MS = 30_000;
export const MAX_RETRIES = 2;
export const SECONDARY_RETRY_AFTER_LIMIT_S = 60;
/** 5xx·네트워크 오류만 재시도한다. 409(빈 repo)를 포함한 4xx 는 모두 재시도하지 않는다. */
export const DO_NOT_RETRY = Array.from({ length: 100 }, (_, index) => 400 + index);
/** 최근 순 100개만 본다(정렬이 최신순이라 20개를 고르기에 충분하다) */
export const RECENT_BRANCHES_QUERY = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { name }
    refs(refPrefix: "refs/heads/", first: 100, orderBy: {field: TAG_COMMIT_DATE, direction: DESC}) {
      nodes { name target { ... on Commit { oid committedDate } } }
    }
  }
}`;

/** GraphQL 은 rate limit 도 200 응답의 `errors[].type` 으로 알린다 */
function isGraphqlRateLimit(error: unknown): boolean {
  const { errors, message } = (error ?? {}) as { errors?: unknown; message?: unknown };
  if (Array.isArray(errors) && errors.some((item) => (item as { type?: unknown } | null)?.type === "RATE_LIMITED")) {
    return true;
  }
  return typeof message === "string" && /graphql rate limit/i.test(message);
}

/** GraphQL 응답에서 조건에 맞는 브랜치를 고른다. 형식이 맞지 않는 노드는 건너뛴다. */
export function pickRecentBranches(data: unknown, sinceIso: string): RecentBranch[] {
  const repository = (data as { repository?: unknown } | null)?.repository as
    | { defaultBranchRef?: { name?: unknown } | null; refs?: { nodes?: unknown } | null }
    | null
    | undefined;
  const nodes = repository?.refs?.nodes;
  if (!repository || !Array.isArray(nodes)) return [];
  const defaultName = repository.defaultBranchRef?.name;
  const since = Date.parse(sinceIso);
  const found: RecentBranch[] = [];
  for (const node of nodes as ({ name?: unknown; target?: { oid?: unknown; committedDate?: unknown } | null } | null)[]) {
    const name = node?.name;
    const sha = node?.target?.oid;
    const committedAt = node?.target?.committedDate;
    if (typeof name !== "string" || typeof sha !== "string" || typeof committedAt !== "string") continue;
    if (name === defaultName) continue;
    const time = Date.parse(committedAt);
    if (Number.isNaN(time) || time < since) continue;
    found.push({ name, committedAt, sha });
  }
  found.sort((a, b) => Date.parse(b.committedAt) - Date.parse(a.committedAt));
  return found;
}

const HEADS_PREFIX = "refs/heads/";

/**
 * repo 이벤트에서 `sinceIso` 이후의 브랜치 push·생성을 골라 브랜치마다 가장 최근 시각을 남기고,
 * 그보다 뒤에 삭제(DeleteEvent)된 브랜치는 뺀다. 이벤트는 최신이 앞이다(시각이 같으면 앞이 더 새롭다).
 */
export function pickRecentPushes(events: unknown, sinceIso: string): Map<string, string> {
  const since = Date.parse(sinceIso);
  const pushed = new Map<string, string>();
  if (!Array.isArray(events)) return pushed;
  const lastPush = new Map<string, { time: number; index: number; at: string }>();
  const lastDelete = new Map<string, { time: number; index: number }>();
  const newer = (a: { time: number; index: number }, b: { time: number; index: number }): boolean =>
    a.time > b.time || (a.time === b.time && a.index < b.index);
  (events as ({ type?: unknown; created_at?: unknown; payload?: { ref?: unknown; ref_type?: unknown } } | null)[]).forEach((event, index) => {
    const ref = event?.payload?.ref;
    const createdAt = event?.created_at;
    if (typeof ref !== "string" || typeof createdAt !== "string") return;
    const time = Date.parse(createdAt);
    if (Number.isNaN(time) || time < since) return;
    if (event?.type === "DeleteEvent") {
      if (event.payload?.ref_type !== "branch" || ref === "") return;
      const previous = lastDelete.get(ref);
      if (!previous || newer({ time, index }, previous)) lastDelete.set(ref, { time, index });
      return;
    }
    let name: string;
    if (event?.type === "PushEvent") {
      if (ref.startsWith(HEADS_PREFIX)) name = ref.slice(HEADS_PREFIX.length);
      else if (ref.startsWith("refs/")) return;
      else name = ref;
    } else if (event?.type === "CreateEvent" && event.payload?.ref_type === "branch") name = ref;
    else return;
    if (name === "") return;
    const previous = lastPush.get(name);
    if (!previous || newer({ time, index }, previous)) lastPush.set(name, { time, index, at: createdAt });
  });
  for (const [name, push] of lastPush) {
    const removed = lastDelete.get(name);
    if (removed && newer(removed, push)) continue;
    pushed.set(name, push.at);
  }
  return pushed;
}

const SYMLINK_MODE = "120000";
const MAX_BRANCH_PAGES = 100;
const MAX_BRANCHES = MAX_BRANCH_PAGES * 100;

interface RepoResponse {
  name: string;
  full_name: string;
  archived?: boolean;
  fork: boolean;
  default_branch?: string;
  pushed_at?: string | null;
}

function toRepoInfo(data: RepoResponse): RepoInfo {
  return {
    name: data.name,
    fullName: data.full_name,
    archived: data.archived ?? false,
    fork: data.fork,
    defaultBranch: data.default_branch ?? "HEAD",
    pushedAt: data.pushed_at ?? null,
  };
}

function isPrimaryRateLimit(error: RequestError): boolean {
  return (
    (error.status === 403 || error.status === 429) &&
    error.response?.headers["x-ratelimit-remaining"] === "0"
  );
}

/** octokit 오류를 스캔 기록용 문장으로 바꾼다. 토큰 등 요청 헤더는 넣지 않는다. */
export function translateError(error: unknown): Error {
  if (error instanceof RateLimitedError) return error;
  if (error instanceof RequestError) {
    if (isPrimaryRateLimit(error)) return new RateLimitedError();
    return new Error(`GitHub API 오류 (${error.status}): ${error.message}`);
  }
  if (error instanceof Error) return new Error(`GitHub API 요청 실패: ${error.message}`);
  return new Error(`GitHub API 요청 실패: ${String(error)}`);
}

export function withTimeout(base: typeof globalThis.fetch): typeof globalThis.fetch {
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

  // 스캔 1회의 요청 수를 재려고 HTTP 요청을 센다(GraphQL 은 `/graphql`)
  const counts: RequestCounts = { rest: 0, graphql: 0 };
  octokit.hook.before("request", (requestOptions) => {
    if (requestOptions.url === "/graphql") counts.graphql += 1;
    else counts.rest += 1;
  });

  async function call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw translateError(error);
    }
  }

  return {
    requestCounts: () => ({ ...counts }),
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

    listRecentBranches: async (org, repo, sinceIso) => {
      let data: unknown;
      try {
        data = await octokit.graphql(RECENT_BRANCHES_QUERY, { owner: org, name: repo });
      } catch (error) {
        if (isGraphqlRateLimit(error)) throw new RateLimitedError();
        // repo 가 없으면 `repository: null` 과 NOT_FOUND 오류가 함께 온다 — 실패가 아니라 브랜치 없음이다.
        const errors = (error as { errors?: unknown } | null)?.errors;
        if (Array.isArray(errors) && errors.length > 0 && errors.every((item) => (item as { type?: unknown } | null)?.type === "NOT_FOUND")) {
          return [];
        }
        throw translateError(error);
      }
      return pickRecentBranches(data, sinceIso);
    },

    listRecentPushes: (org, repo, sinceIso) =>
      call(async () => {
        const { data } = await octokit.rest.activity.listRepoEvents({ owner: org, repo, per_page: 100 });
        return pickRecentPushes(data, sinceIso);
      }),

    listRecentCommits: (org, repo, branch, sinceIso, pages = 1) =>
      call(async () => {
        const found: CommitInfo[] = [];
        try {
          for (let page = 1; page <= pages; page += 1) {
            const { data } = await octokit.rest.repos.listCommits({
              owner: org,
              repo,
              sha: branch,
              ...(sinceIso === null ? {} : { since: sinceIso }),
              per_page: 100,
              page,
            });
            found.push(...pickCommits(data));
            if (!Array.isArray(data) || data.length < 100) break;
          }
        } catch (error) {
          if (error instanceof RequestError && error.status === 409) return [];
          throw error;
        }
        return found;
      }),

    listWorkflowCommits: (org, repo, branch, sinceIso) =>
      call(async () => {
        try {
          const { data } = await octokit.rest.repos.listCommits({
            owner: org,
            repo,
            sha: branch,
            since: sinceIso,
            path: ".github/workflows",
            per_page: 100,
          });
          return pickCommits(data).map(({ sha, committedAt, url, authorLogin }) => ({ sha, committedAt, url, authorLogin }));
        } catch (error) {
          if (error instanceof RequestError && error.status === 409) return [];
          throw error;
        }
      }),

    listRecentPulls: (org, repo) =>
      call(async () => {
        const { data } = await octokit.rest.pulls.list({
          owner: org,
          repo,
          state: "all",
          sort: "updated",
          direction: "desc",
          per_page: 50,
        });
        return pickPulls(data);
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
