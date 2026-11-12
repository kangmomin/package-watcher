import { createHash } from "node:crypto";
import {
  RateLimitedError,
  type GitHubClient,
  type RepoInfo,
  type RepoTree,
} from "../github/client.ts";

export interface FakeRepoInput {
  name: string;
  /** 경로 → 파일 내용 */
  files?: Record<string, string>;
  archived?: boolean;
  fork?: boolean;
  defaultBranch?: string;
}

export type FakeMethod = "listOrgRepos" | "getRepo" | "getTree" | "getFile";

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
  archived: boolean;
  fork: boolean;
  defaultBranch: string;
  files: Map<string, string>;
  /** 목록에서만 빠진다 (getRepo 로는 보인다) */
  hidden: boolean;
  truncated: boolean;
  treeError: Error | null;
  fileErrors: Map<string, Error>;
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
  /** `listOrgRepos` 실패 (org 목록 조회 실패 — 페이지 실패 포함) */
  listError: Error | null = null;
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
      archived: input.archived ?? false,
      fork: input.fork ?? false,
      defaultBranch: input.defaultBranch ?? "main",
      files: new Map(Object.entries(input.files ?? {})),
      hidden: false,
      truncated: false,
      treeError: null,
      fileErrors: new Map(),
    });
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

  clearFailures(name: string): void {
    const state = this.mustGet(name);
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
    throw new Error(`GitHub API 오류 (404): blob ${sha}`);
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
    ...overrides,
  };
}

function toInfo(org: string, state: RepoState): RepoInfo {
  return repoInfo(org, state.name, {
    archived: state.archived,
    fork: state.fork,
    defaultBranch: state.defaultBranch,
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
