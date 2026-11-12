import { notImplemented } from "../notImplemented.ts";

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

/**
 * octokit 구현 (throttling·retry 플러그인).
 * 재시도: 5xx·네트워크 오류와 secondary rate limit(`retry-after`, 상한 60초)만 2회. 409 를 포함한 그 외 4xx 는 재시도하지 않는다.
 * primary rate limit 은 기다리지 않고 `RateLimitedError`. 요청 타임아웃 30초.
 */
export function createOctokitClient(options: OctokitClientOptions): GitHubClient {
  return notImplemented(options);
}
