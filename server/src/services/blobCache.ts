import type { GitHubClient } from "../github/client.ts";
import type { DiskBlobCache } from "./diskBlobCache.ts";

/** repo 1개의 blob 캐시가 쥐는 내용의 상한(문자 수). 넘으면 더 넣지 않는다 */
export const BLOB_CACHE_MAX_CHARS = 64 * 1024 * 1024;

export interface BlobCache {
  /** `getFile` 만 캐시를 거치는 클라이언트 */
  client: GitHubClient;
  /**
   * 이 sha 의 내용을 이미 받았거나 받는 중이거나(메모리), 디스크에 있는가 — 다시 요청하지 않는다.
   * `diskEligible = false`(디스크에 두지 않는 파일)이면 디스크는 보지 않는다. 깨진 파일은 읽어야 알 수 있어서
   * 디스크에 "있다"고 세지만 실제로는 GitHub 에서 받는다(상한의 계산은 그대로 둔다).
   */
  has(sha: string, diskEligible?: boolean): boolean;
  /** 지금까지 메모리 캐시에 없어서 읽어 온 파일 수(디스크 캐시 적중 포함 — 평가에 쓴 파일 수의 기준) */
  fetched(): number;
  /** 백그라운드로 보낸 디스크 쓰기가 모두 끝나기를 기다린다 */
  flush(): Promise<void>;
}

/**
 * 같은 blob sha 를 다시 받지 않는다 — repo 가 끝나면 버리는 메모리 캐시(브랜치끼리 같은 변경을 공유한다).
 * 누적 크기가 `maxChars` 를 넘으면 그 뒤에 받은 내용은 넣지 않는다(이미 든 것은 유지).
 * 디스크 캐시는 메모리 다음에 본다. 디스크 쓰기는 기다리지 않고(백그라운드) 오류는 삼킨다.
 */
export function createBlobCache(
  client: GitHubClient,
  maxChars = BLOB_CACHE_MAX_CHARS,
  disk: DiskBlobCache | null = null,
): BlobCache {
  const cache = new Map<string, Promise<string>>();
  const writes = new Set<Promise<void>>();
  let total = 0;
  let fetched = 0;
  const wrapped: GitHubClient = {
    listOrgRepos: (org) => client.listOrgRepos(org),
    getAuthenticatedLogin: () => client.getAuthenticatedLogin(),
    listAccountRepos: () => client.listAccountRepos(),
    getRepo: (org, repo) => client.getRepo(org, repo),
    getTree: (org, repo, ref) => client.getTree(org, repo, ref),
    listBranches: (org, repo) => client.listBranches(org, repo),
    listRecentBranches: (org, repo, since) => client.listRecentBranches(org, repo, since),
    listRecentPushes: (org, repo, since) => client.listRecentPushes(org, repo, since),
    listRecentCommits: (org, repo, branch, since, pages) => client.listRecentCommits(org, repo, branch, since, pages),
    listWorkflowCommits: (org, repo, branch, since) => client.listWorkflowCommits(org, repo, branch, since),
    listRecentPulls: (org, repo) => client.listRecentPulls(org, repo),
    getFile(org, repo, sha, options) {
      const hit = cache.get(sha);
      if (hit) return hit;
      fetched += 1;
      // 메모리 → 디스크 → GitHub. 디스크에 두지 않는 파일(noCache)은 디스크를 읽지도 쓰지도 않는다.
      const useDisk = disk !== null && options?.noCache !== true;
      const pending = (async () => {
        if (useDisk) {
          const stored = await disk.read(sha);
          if (stored !== null) return stored;
        }
        const content = await client.getFile(org, repo, sha, options);
        if (useDisk) {
          const write = disk.write(sha, content).catch(() => undefined);
          writes.add(write);
          void write.finally(() => writes.delete(write));
        }
        return content;
      })();
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
  return {
    client: wrapped,
    has: (sha, diskEligible = true) => cache.has(sha) || (diskEligible && (disk?.has(sha) ?? false)),
    fetched: () => fetched,
    flush: async () => {
      await Promise.all([...writes]);
    },
  };
}
