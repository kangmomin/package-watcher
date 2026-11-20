import type { GitHubClient, RepoInfo } from "./client.ts";

/**
 * 로그인한 계정의 repo 를 스캔할 때의 repo 이름(키).
 * 스캔은 owner 1개(`org`)와 repo 이름으로 일한다. 계정 모드에서는 owner 가 계정(login)이고,
 * 계정이 소유하지 않은 repo(협업자)는 `owner/name` 을 이름으로 쓴다 — 검출·스캔 기록에 그대로 저장된다.
 */
export function repoKeyOf(owner: string, repo: RepoInfo): string {
  const slash = repo.fullName.indexOf("/");
  const repoOwner = slash > 0 ? repo.fullName.slice(0, slash) : owner;
  return repoOwner.toLowerCase() === owner.toLowerCase() ? repo.name : `${repoOwner}/${repo.name}`;
}

/** 키를 실제 (owner, name) 으로 나눈다. `/` 가 없으면 `owner` 의 repo 다. */
export function splitRepoKey(owner: string, key: string): [owner: string, name: string] {
  const slash = key.indexOf("/");
  return slash > 0 ? [key.slice(0, slash), key.slice(slash + 1)] : [owner, key];
}

/** 키의 `owner/name` (로그·링크용) */
export function repoFullNameOf(owner: string, key: string): string {
  const [repoOwner, name] = splitRepoKey(owner, key);
  return `${repoOwner}/${name}`;
}

/**
 * 계정 모드의 클라이언트. `listOrgRepos` 는 계정의 repo(소유 + 협업자)를 키 이름으로 돌려주고,
 * 나머지 호출은 키를 실제 (owner, name) 으로 바꿔 넘긴다. 첫 인자(`owner`)는 계정의 login 이다.
 */
export function createAccountClient(client: GitHubClient): GitHubClient {
  const withKey = (owner: string, repo: RepoInfo | null): RepoInfo | null =>
    repo === null ? null : { ...repo, name: repoKeyOf(owner, repo) };
  return {
    ...(client.requestCounts ? { requestCounts: () => client.requestCounts!() } : {}),
    getAuthenticatedLogin: () => client.getAuthenticatedLogin(),
    listAccountRepos: () => client.listAccountRepos(),
    listOrgRepos: async (owner) => (await client.listAccountRepos()).map((repo) => withKey(owner, repo)!),
    getRepo: async (owner, key) => withKey(owner, await client.getRepo(...splitRepoKey(owner, key))),
    getTree: (owner, key, ref) => client.getTree(...splitRepoKey(owner, key), ref),
    getFile: (owner, key, sha, options) => client.getFile(...splitRepoKey(owner, key), sha, options),
    listBranches: (owner, key) => client.listBranches(...splitRepoKey(owner, key)),
    listRecentBranches: (owner, key, since) => client.listRecentBranches(...splitRepoKey(owner, key), since),
    listRecentPushes: (owner, key, since) => client.listRecentPushes(...splitRepoKey(owner, key), since),
    listRecentCommits: (owner, key, branch, since, pages) =>
      client.listRecentCommits(...splitRepoKey(owner, key), branch, since, pages),
    listWorkflowCommits: (owner, key, branch, since) =>
      client.listWorkflowCommits(...splitRepoKey(owner, key), branch, since),
    listRecentPulls: (owner, key) => client.listRecentPulls(...splitRepoKey(owner, key)),
  };
}
