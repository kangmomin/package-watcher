import { createHash } from "node:crypto";
import {
  RateLimitedError,
  type CommitInfo,
  type GitHubClient,
  type PullInfo,
  type RecentBranch,
  type RepoInfo,
  type RepoTree,
  type WorkflowCommit,
} from "../github/client.ts";

export interface FakeRepoInput {
  name: string;
  /** 로그인 계정 대상(`listAccountRepos`)에서의 owner. 기본은 로그인 계정(`login`) — 다르면 협업자 repo 다 */
  owner?: string;
  /** 경로 → 파일 내용 */
  files?: Record<string, string>;
  archived?: boolean;
  fork?: boolean;
  defaultBranch?: string;
  /** 마지막 push 시각. 기본 null — 브랜치를 조회하지 않는다 */
  pushedAt?: string | null;
}

export type FakeMethod =
  | "listOrgRepos"
  | "getAuthenticatedLogin"
  | "listAccountRepos"
  | "getRepo"
  | "getTree"
  | "getFile"
  | "listBranches"
  | "listRecentBranches"
  | "listRecentPushes"
  | "listRecentCommits"
  | "listWorkflowCommits"
  | "listRecentPulls";

/** 기본 브랜치 외의 브랜치 1개 */
export interface FakeBranchInput {
  /** 최신 커밋의 시각(ISO) */
  committedAt: string;
  /** 그 브랜치의 전체 파일 (경로 → 내용). 기본 브랜치와 같은 (경로, 내용)이면 같은 blob 이다 */
  files?: Record<string, string>;
}

interface BranchState {
  name: string;
  sha: string;
  committedAt: string;
  files: Map<string, string>;
  truncated: boolean;
  treeError: Error | null;
}

export interface FakeCall {
  method: FakeMethod;
  org: string;
  repo: string | null;
  arg: string | null;
}

/** 스캔을 특정 호출에서 멈춰 두는 장치. 스캔 중 변경(삭제·PUT·org 변경·PATCH)을 재현한다. */
export interface Gate {
  /** 멈출 호출이 도착할 때까지 기다린다. 도착하지 않으면 timeoutMs 후 reject. */
  waitReached(timeoutMs?: number): Promise<void>;
  release(): void;
}

interface RepoState {
  name: string;
  owner: string | null;
  archived: boolean;
  fork: boolean;
  defaultBranch: string;
  files: Map<string, string>;
  /** 목록에서만 빠진다 (getRepo 로는 보인다) */
  hidden: boolean;
  truncated: boolean;
  treeError: Error | null;
  fileErrors: Map<string, Error>;
  branches: string[];
  branchError: Error | null;
  pushedAt: string | null;
  /** 기본 브랜치 외의 브랜치 (listRecentBranches·getTree 가 읽는다) */
  heads: Map<string, BranchState>;
  recentError: Error | null;
  /** 브랜치 이름 → 마지막 push 시각 (listRecentPushes) */
  pushes: Map<string, string>;
  pushError: Error | null;
  /** events 의 DeleteEvent 로 알려진 브랜치 (마지막 push 보다 뒤) */
  deletedBranches: Set<string>;
  commits: CommitInfo[];
  commitsError: Error | null;
  workflowCommits: WorkflowCommit[];
  workflowError: Error | null;
  pulls: PullInfo[];
  pullsError: Error | null;
}

interface PendingGate {
  method: FakeMethod;
  repo: string | null;
  used: boolean;
  arrived: Promise<void>;
  arrive: () => void;
  released: Promise<void>;
  release: () => void;
}

/**
 * 메모리 위의 가짜 GitHub. 스캔 테스트가 repo 목록, 파일, 실패, 재확인 결과, rate limit 을 조작한다.
 * 호출은 `calls` 에 기록한다.
 */
export class FakeGitHubClient implements GitHubClient {
  readonly calls: FakeCall[] = [];
  /** `listOrgRepos`·`listAccountRepos` 실패 (목록 조회 실패 — 페이지 실패 포함) */
  listError: Error | null = null;
  /** 토큰의 계정 (`getAuthenticatedLogin`). Error 면 throw */
  login: string | Error = "me";
  /** 목록에 두 번 나오는 repo 이름 */
  readonly duplicateInList = new Set<string>();
  /** `getRepo` 결과 덮어쓰기. Error 면 throw, null 이면 404 */
  readonly lookups = new Map<string, RepoInfo | null | Error>();
  /** 이 repo 에 대한 호출이 생기는 순간부터 모든 호출이 RateLimitedError (primary rate limit 소진) */
  rateLimitFrom: string | null = null;

  private exhausted = false;
  private readonly repos = new Map<string, RepoState>();
  private readonly gates: PendingGate[] = [];

  /** 저장소 전체를 바꾼다. 목록 순서 = 입력 순서. */
  setRepos(inputs: FakeRepoInput[]): void {
    this.repos.clear();
    for (const input of inputs) this.upsertRepo(input);
  }

  upsertRepo(input: FakeRepoInput): void {
    this.repos.set(input.name, {
      name: input.name,
      owner: input.owner ?? null,
      archived: input.archived ?? false,
      fork: input.fork ?? false,
      defaultBranch: input.defaultBranch ?? "main",
      files: new Map(Object.entries(input.files ?? {})),
      hidden: false,
      truncated: false,
      treeError: null,
      fileErrors: new Map(),
      branches: [],
      branchError: null,
      pushedAt: input.pushedAt ?? null,
      heads: new Map(),
      recentError: null,
      pushes: new Map(),
      pushError: null,
      deletedBranches: new Set(),
      commits: [],
      commitsError: null,
      workflowCommits: [],
      workflowError: null,
      pulls: [],
      pullsError: null,
    });
  }

  /** 기본 브랜치의 커밋 (listRecentCommits 가 `since` 로 거른다) */
  setCommits(name: string, commits: CommitInfo[]): void {
    this.mustGet(name).commits = [...commits];
  }

  /** `.github/workflows` 를 바꾼 커밋 (listWorkflowCommits) */
  setWorkflowCommits(name: string, commits: WorkflowCommit[]): void {
    this.mustGet(name).workflowCommits = [...commits];
  }

  setPulls(name: string, pulls: PullInfo[]): void {
    this.mustGet(name).pulls = [...pulls];
  }

  failCommits(name: string, error: Error | null): void {
    this.mustGet(name).commitsError = error;
  }

  failWorkflowCommits(name: string, error: Error | null): void {
    this.mustGet(name).workflowError = error;
  }

  failPulls(name: string, error: Error | null): void {
    this.mustGet(name).pullsError = error;
  }

  setFiles(name: string, files: Record<string, string>): void {
    this.mustGet(name).files = new Map(Object.entries(files));
  }

  setArchived(name: string, archived: boolean): void {
    this.mustGet(name).archived = archived;
  }

  /** repo 삭제: 목록에서 빠지고 `getRepo` 는 404(null) */
  removeRepo(name: string): void {
    this.repos.delete(name);
  }

  /** 목록에서만 뺀다(권한 축소 등). `getRepo` 는 같은 이름의 활성 repo 를 반환한다. */
  hide(name: string): void {
    this.mustGet(name).hidden = true;
  }

  failTree(name: string, error: Error): void {
    this.mustGet(name).treeError = error;
  }

  truncate(name: string): void {
    this.mustGet(name).truncated = true;
  }

  failFile(name: string, path: string, error: Error): void {
    this.mustGet(name).fileErrors.set(path, error);
  }

  /** 브랜치 목록 (기본 `[]`) */
  setBranches(name: string, branches: string[]): void {
    this.mustGet(name).branches = [...branches];
  }

  failBranches(name: string, error: Error): void {
    this.mustGet(name).branchError = error;
  }

  setPushedAt(name: string, pushedAt: string | null): void {
    this.mustGet(name).pushedAt = pushedAt;
  }

  /** 기본 브랜치 외의 브랜치를 만들거나 바꾼다 */
  setHead(name: string, branch: string, input: FakeBranchInput): void {
    const state = this.mustGet(name);
    const previous = state.heads.get(branch);
    state.heads.set(branch, {
      name: branch,
      sha: `c${createHash("sha1").update(`${name}\0${branch}`).digest("hex").slice(0, 20)}`,
      committedAt: input.committedAt,
      files: new Map(Object.entries(input.files ?? {})),
      truncated: previous?.truncated ?? false,
      treeError: previous?.treeError ?? null,
    });
  }

  removeHead(name: string, branch: string): void {
    this.mustGet(name).heads.delete(branch);
  }

  /** 브랜치의 마지막 push 시각 (events API). 브랜치가 없어도 둘 수 있다 */
  setPush(name: string, branch: string, pushedAt: string): void {
    this.mustGet(name).pushes.set(branch, pushedAt);
  }

  /** events 에 DeleteEvent 가 있는 브랜치 (그 브랜치의 push 시각보다 뒤) */
  setDeletedEvent(name: string, branch: string): void {
    this.mustGet(name).deletedBranches.add(branch);
  }

  /** 지금까지 받은 호출로 센 요청 수: GraphQL 은 listRecentBranches, 나머지는 REST */
  requestCounts(): { rest: number; graphql: number } {
    const graphql = this.calls.filter((call) => call.method === "listRecentBranches").length;
    return { rest: this.calls.length - graphql, graphql };
  }

  failRecentPushes(name: string, error: Error): void {
    this.mustGet(name).pushError = error;
  }

  failRecentBranches(name: string, error: Error): void {
    this.mustGet(name).recentError = error;
  }

  failHeadTree(name: string, branch: string, error: Error): void {
    this.mustGetHead(name, branch).treeError = error;
  }

  truncateHead(name: string, branch: string): void {
    this.mustGetHead(name, branch).truncated = true;
  }

  clearFailures(name: string): void {
    const state = this.mustGet(name);
    state.recentError = null;
    state.pushError = null;
    for (const head of state.heads.values()) {
      head.truncated = false;
      head.treeError = null;
    }
    state.branchError = null;
    state.treeError = null;
    state.truncated = false;
    state.fileErrors.clear();
  }

  /** 다음 `method`(repo 지정 시 그 repo) 호출을 멈춘다. 1회용. */
  pause(method: FakeMethod, repo: string | null = null): Gate {
    let arrive: () => void = () => undefined;
    let release: () => void = () => undefined;
    const arrived = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gate: PendingGate = { method, repo, used: false, arrived, arrive, released, release };
    this.gates.push(gate);
    return {
      waitReached: (timeoutMs = 5_000) =>
        withTimeout(arrived, timeoutMs, `${method}(${repo ?? "*"}) 호출이 오지 않았습니다`),
      release,
    };
  }

  /** 남은 gate 를 모두 연다 (정리용: 실패한 테스트가 스캔을 멈춘 채로 두지 않게). */
  releaseAll(): void {
    for (const gate of this.gates) gate.release();
  }

  callsOf(method: FakeMethod, repo?: string): FakeCall[] {
    return this.calls.filter(
      (call) => call.method === method && (repo === undefined || call.repo === repo),
    );
  }

  async listOrgRepos(org: string): Promise<RepoInfo[]> {
    await this.enter("listOrgRepos", org, null, null);
    if (this.listError) throw this.listError;
    const listed: RepoInfo[] = [];
    for (const state of this.repos.values()) {
      if (state.hidden) continue;
      listed.push(toInfo(org, state));
      if (this.duplicateInList.has(state.name)) listed.push(toInfo(org, state));
    }
    return listed;
  }

  async getAuthenticatedLogin(): Promise<string> {
    await this.enter("getAuthenticatedLogin", "", null, null);
    if (this.login instanceof Error) throw this.login;
    return this.login;
  }

  /** 모든 repo 를 owner(기본: 로그인 계정)의 repo 로 나열한다. 이름은 owner 를 뺀 이름이다 */
  async listAccountRepos(): Promise<RepoInfo[]> {
    await this.enter("listAccountRepos", "", null, null);
    if (this.listError) throw this.listError;
    const login = this.login instanceof Error ? "me" : this.login;
    const listed: RepoInfo[] = [];
    for (const state of this.repos.values()) {
      if (state.hidden) continue;
      listed.push(toInfo(state.owner ?? login, state));
      if (this.duplicateInList.has(state.name)) listed.push(toInfo(state.owner ?? login, state));
    }
    return listed;
  }

  async getRepo(org: string, repo: string): Promise<RepoInfo | null> {
    await this.enter("getRepo", org, repo, null);
    if (this.lookups.has(repo)) {
      const result = this.lookups.get(repo);
      if (result instanceof Error) throw result;
      return result ?? null;
    }
    const state = this.repos.get(repo);
    return state ? toInfo(org, state) : null;
  }

  async getTree(org: string, repo: string, ref: string): Promise<RepoTree> {
    await this.enter("getTree", org, repo, ref);
    const state = this.repos.get(repo);
    if (!state) throw new Error(`GitHub API 오류 (404): ${repo}`);
    const head = [...state.heads.values()].find((candidate) => candidate.sha === ref || candidate.name === ref);
    if (head) {
      if (head.treeError) throw head.treeError;
      return {
        entries: [...head.files].map(([path, content]) => ({ path, sha: blobSha(repo, path, content) })),
        truncated: head.truncated,
      };
    }
    // 이름으로 부른 브랜치가 지워졌으면 404 (push 기록만 남은 브랜치)
    if (ref !== state.defaultBranch && state.pushes.has(ref)) throw new Error(`GitHub API 오류 (404): ${ref}`);
    if (state.treeError) throw state.treeError;
    return {
      entries: [...state.files].map(([path, content]) => ({
        path,
        sha: blobSha(repo, path, content),
      })),
      truncated: state.truncated,
    };
  }

  async getFile(org: string, repo: string, sha: string): Promise<string> {
    await this.enter("getFile", org, repo, sha);
    const state = this.repos.get(repo);
    if (!state) throw new Error(`GitHub API 오류 (404): ${repo}`);
    for (const [path, content] of state.files) {
      if (blobSha(repo, path, content) !== sha) continue;
      const error = state.fileErrors.get(path);
      if (error) throw error;
      return content;
    }
    for (const head of state.heads.values()) {
      for (const [path, content] of head.files) {
        if (blobSha(repo, path, content) !== sha) continue;
        const error = state.fileErrors.get(path);
        if (error) throw error;
        return content;
      }
    }
    throw new Error(`GitHub API 오류 (404): blob ${sha}`);
  }

  async listBranches(org: string, repo: string): Promise<string[]> {
    await this.enter("listBranches", org, repo, null);
    const state = this.repos.get(repo);
    if (!state) throw new Error(`GitHub API 오류 (404): ${repo}`);
    if (state.branchError) throw state.branchError;
    return [...state.branches];
  }

  async listRecentBranches(org: string, repo: string, sinceIso: string): Promise<RecentBranch[]> {
    await this.enter("listRecentBranches", org, repo, sinceIso);
    const state = this.repos.get(repo);
    if (!state) return [];
    if (state.recentError) throw state.recentError;
    return [...state.heads.values()]
      .filter((head) => Date.parse(head.committedAt) >= Date.parse(sinceIso))
      .sort((a, b) => Date.parse(b.committedAt) - Date.parse(a.committedAt))
      .map(({ name, committedAt, sha }) => ({ name, committedAt, sha }));
  }

  async listRecentPushes(org: string, repo: string, sinceIso: string): Promise<Map<string, string>> {
    await this.enter("listRecentPushes", org, repo, sinceIso);
    const state = this.repos.get(repo);
    if (!state) throw new Error(`GitHub API 오류 (404): ${repo}`);
    if (state.pushError) throw state.pushError;
    const pushed = new Map([...state.pushes].filter(([, at]) => Date.parse(at) >= Date.parse(sinceIso)));
    for (const name of state.deletedBranches) pushed.delete(name);
    return pushed;
  }

  async listRecentCommits(
    org: string,
    repo: string,
    branch: string,
    sinceIso: string | null,
    pages = 1,
  ): Promise<CommitInfo[]> {
    await this.enter("listRecentCommits", org, repo, `${branch}|${sinceIso ?? ""}${pages === 1 ? "" : `|${pages}`}`);
    const state = this.repos.get(repo);
    if (!state) return [];
    if (state.commitsError) throw state.commitsError;
    return state.commits
      .filter((commit) => sinceIso === null || Date.parse(commit.committedAt) >= Date.parse(sinceIso))
      .slice(0, 100 * pages);
  }

  async listWorkflowCommits(org: string, repo: string, branch: string, sinceIso: string): Promise<WorkflowCommit[]> {
    await this.enter("listWorkflowCommits", org, repo, `${branch}|${sinceIso}`);
    const state = this.repos.get(repo);
    if (!state) return [];
    if (state.workflowError) throw state.workflowError;
    return state.workflowCommits.filter((commit) => Date.parse(commit.committedAt) >= Date.parse(sinceIso)).slice(0, 100);
  }

  async listRecentPulls(org: string, repo: string): Promise<PullInfo[]> {
    await this.enter("listRecentPulls", org, repo, null);
    const state = this.repos.get(repo);
    if (!state) return [];
    if (state.pullsError) throw state.pullsError;
    return state.pulls.slice(0, 50);
  }

  private async enter(
    method: FakeMethod,
    org: string,
    repo: string | null,
    arg: string | null,
  ): Promise<void> {
    this.calls.push({ method, org, repo, arg });
    const gate = this.gates.find(
      (candidate) =>
        !candidate.used &&
        candidate.method === method &&
        (candidate.repo === null || candidate.repo === repo),
    );
    if (gate) {
      gate.used = true;
      gate.arrive();
      await gate.released;
    }
    if (repo !== null && repo === this.rateLimitFrom) this.exhausted = true;
    if (this.exhausted) throw new RateLimitedError();
  }

  private mustGetHead(name: string, branch: string): BranchState {
    const head = this.mustGet(name).heads.get(branch);
    if (!head) throw new Error(`가짜 브랜치가 없습니다: ${name}@${branch}`);
    return head;
  }

  private mustGet(name: string): RepoState {
    const state = this.repos.get(name);
    if (!state) throw new Error(`가짜 repo 가 없습니다: ${name}`);
    return state;
  }
}

/** 이름 변경·이전 재확인용 RepoInfo */
export function repoInfo(org: string, name: string, overrides: Partial<RepoInfo> = {}): RepoInfo {
  return {
    name,
    fullName: `${org}/${name}`,
    archived: false,
    fork: false,
    defaultBranch: "main",
    pushedAt: null,
    ...overrides,
  };
}

function toInfo(org: string, state: RepoState): RepoInfo {
  return repoInfo(org, state.name, {
    archived: state.archived,
    fork: state.fork,
    defaultBranch: state.defaultBranch,
    pushedAt: state.pushedAt,
  });
}

function blobSha(repo: string, path: string, content: string): string {
  return createHash("sha1").update(`${repo}\0${path}\0${content}`).digest("hex");
}

function withTimeout(promise: Promise<void>, ms: number, message: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
