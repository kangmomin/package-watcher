import type { GitHubClient } from "../github/client.ts";

/** repo 1개의 blob 캐시가 쥐는 내용의 상한(문자 수). 넘으면 더 넣지 않는다 */
export const BLOB_CACHE_MAX_CHARS = 64 * 1024 * 1024;

export interface BlobCache {
  /** `getFile` 만 캐시를 거치는 클라이언트 */
  client: GitHubClient;
  /** 이 sha 의 내용을 이미 받았거나 받는 중인가 — 다시 요청하지 않는다 */
  has(sha: string): boolean;
  /** 지금까지 GitHub 에 실제로 보낸 `getFile` 요청 수 */
  fetched(): number;
}

/**
 * 같은 blob sha 를 다시 받지 않는다 — repo 가 끝나면 버리는 메모리 캐시(브랜치끼리 같은 변경을 공유한다).
 * 누적 크기가 `maxChars` 를 넘으면 그 뒤에 받은 내용은 넣지 않는다(이미 든 것은 유지).
 */
export function createBlobCache(client: GitHubClient, maxChars = BLOB_CACHE_MAX_CHARS): BlobCache {
  const cache = new Map<string, Promise<string>>();
  let total = 0;
  let fetched = 0;
  const wrapped: GitHubClient = {
    listOrgRepos: (org) => client.listOrgRepos(org),
    getRepo: (org, repo) => client.getRepo(org, repo),
    getTree: (org, repo, ref) => client.getTree(org, repo, ref),
    listBranches: (org, repo) => client.listBranches(org, repo),
    listRecentBranches: (org, repo, since) => client.listRecentBranches(org, repo, since),
    listRecentPushes: (org, repo, since) => client.listRecentPushes(org, repo, since),
    listRecentCommits: (org, repo, branch, since) => client.listRecentCommits(org, repo, branch, since),
    listWorkflowCommits: (org, repo, branch, since) => client.listWorkflowCommits(org, repo, branch, since),
    listRecentPulls: (org, repo) => client.listRecentPulls(org, repo),
    getFile(org, repo, sha) {
      const hit = cache.get(sha);
      if (hit) return hit;
      fetched += 1;
      const pending = client.getFile(org, repo, sha);
      cache.set(sha, pending);
      pending.then(
        (content) => {
          if (total + content.length > maxChars) cache.delete(sha);
          else total += content.length;
        },
        () => cache.delete(sha),
      );
      return pending;
    },
  };
  return { client: wrapped, has: (sha) => cache.has(sha), fetched: () => fetched };
}
