import {
  scansQuerySchema,
  type BlacklistEntry,
  type DependencyType,
  type FailedRepo,
  type Page,
  type Scan,
  type ScanTrigger,
} from "@pw/shared";
import type { Clock } from "../clock.ts";
import type { TokenSource } from "../config.ts";
import { AppError } from "../errors.ts";
import {
  RateLimitedError,
  type GitHubClient,
  type RepoInfo,
  type TreeEntry,
} from "../github/client.ts";
import {
  errorMessage,
  isPlainObject,
  normalizeText,
  unwrapNpmAlias,
} from "../lockfiles/common.ts";
import {
  lockfileKindOf,
  parseLockfile,
  type LockfileKind,
  type LockPackage,
} from "../lockfiles/index.ts";
import type { Logger } from "../logger.ts";
import { matchExact, matchRange } from "../matcher.ts";
import type { FindingKey } from "../repositories/findings.ts";
import type { Repositories } from "../repositories/index.ts";
import type { ScanResult } from "../repositories/scans.ts";
import { assignLockfiles, dirOf, readWorkspaceGlobs } from "../workspaces.ts";
import { parseInput, toIso } from "./common.ts";
import type { Notifier } from "./notifier.ts";

/** repo 동시 처리 수 */
export const REPO_CONCURRENCY = 5;
/** repo 1개 안의 파일 동시 조회 수 */
const FILE_CONCURRENCY = 4;

export const TOKEN_MISSING_MESSAGE =
  "GitHub 토큰이 없습니다. GITHUB_TOKEN 환경 변수를 설정하거나 gh auth login 을 실행한 뒤 서버를 다시 시작하십시오";
const RATE_LIMITED = "RATE_LIMITED";
const ACCESS_SUSPECT =
  "접근 불가 의심: 대상 목록이 비었거나 직전보다 절반 넘게 줄어서 resolve 를 보류했습니다";
const STILL_EXISTS = "대상 목록에 없지만 저장소가 존재합니다. 토큰의 접근 권한을 확인하십시오";
const ORG_CHANGED = "스캔 중 GitHub org 설정이 바뀌어 결과를 저장하지 않았습니다";
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

export interface ScanService {
  /**
   * 판정 순서 ORG_NOT_SET → TOKEN_MISSING → SCAN_RUNNING (AppError). 통과하면 running 행을 만들고
   * 스캔을 백그라운드로 시작한 뒤 running `Scan` 을 바로 반환한다. 백그라운드 promise 는 항상 catch 한다.
   */
  start(trigger: ScanTrigger): Scan;
  /**
   * `start` + 완료 대기. 종료된 `Scan`(success / partial / failed)을 반환한다.
   * 실행 중 예외는 reject 하지 않고 failed 로 끝낸 행을 반환한다. 시작 판정 실패만 AppError 로 reject.
   */
  runScan(trigger: ScanTrigger): Promise<Scan>;
  isRunning(): boolean;
  /** 실행 중인 스캔이 메일 발송과 lock 해제까지 끝날 때까지 기다린다. 실행 중이 아니면 바로 끝난다. */
  waitForIdle(): Promise<void>;
  /** `scansQuerySchema` 로 검증한 뒤 목록 (`startedAt` 내림차순, 같으면 `id` 내림차순) */
  list(query: unknown): Page<Scan>;
  /** 없는 id → NOT_FOUND */
  get(id: number): Scan;
}

export interface ScanServiceDeps {
  repos: Repositories;
  /** 토큰이 없으면 null */
  github: GitHubClient | null;
  githubTokenSource: TokenSource;
  notifier: Notifier;
  clock: Clock;
  logger: Logger;
}

interface Match extends FindingKey {
  dependencyType: DependencyType;
}

type RepoOutcome =
  | { repo: string; ok: true; packageJsonCount: number; matches: Match[] }
  | { repo: string; ok: false; error: string };

type Collected =
  | { kind: "listFailed"; error: string }
  | {
      kind: "listed";
      /** archived·fork 를 포함한 목록 크기 (`listed_baseline` 비교용) */
      listedCount: number;
      /** 대상 repo(archived·fork 제외)마다 1개 */
      outcomes: RepoOutcome[];
      /** ② 재확인 결과 resolve 할 repo */
      resolveRepos: string[];
      /** ② 보류·유지로 실패 처리한 repo */
      lookupFailures: FailedRepo[];
      /** ② resolve 를 보류했다 → `listed_baseline` 을 갱신하지 않는다 */
      held: boolean;
    };

interface Manifest {
  raw: Record<string, unknown>;
  /** 직접 의존성. `name` 은 실제 패키지 이름(`npm:` 별칭 분해), `spec` 은 원문 */
  dependencies: { name: string; spec: string }[];
}

interface LockfileFile {
  path: string;
  kind: LockfileKind;
}

const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const joinPath = (dir: string, name: string): string => (dir === "" ? name : `${dir}/${name}`);
const isInNodeModules = (path: string): boolean => `/${path}/`.includes("/node_modules/");

function findingKey(match: FindingKey): string {
  return [match.repo, match.filePath, match.packageName, match.version, match.blacklistEntryId].join(
    "\u0000",
  );
}

function describeError(error: unknown): string {
  if (error instanceof RateLimitedError) return RATE_LIMITED;
  return errorMessage(error) || "알 수 없는 오류";
}

// [Assumption] org·repo·경로 조각을 percent-encoding 한다 — 근거: 공백·`#` 이 든 경로도 유효한 URL 이 되게 한다(일반 이름은 계약 형식과 같다).
function htmlUrlOf(org: string, repo: string, filePath: string): string {
  const path = filePath.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/blob/HEAD/${path}`;
}

/** 순서를 유지하며 최대 `limit` 개씩 실행한다. 하나라도 실패하면 새 작업을 시작하지 않고 그 오류로 reject. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await fn(items[index] as T);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function parseManifest(path: string, content: string): Manifest {
  let data: unknown;
  try {
    data = JSON.parse(normalizeText(content));
  } catch (error) {
    throw new Error(`${path} 을 JSON 으로 읽을 수 없습니다: ${errorMessage(error)}`);
  }
  if (!isPlainObject(data)) throw new Error(`${path} 의 형식이 올바르지 않습니다`);
  const dependencies: Manifest["dependencies"] = [];
  for (const field of DEPENDENCY_FIELDS) {
    const deps = data[field];
    if (!isPlainObject(deps)) continue;
    for (const [alias, spec] of Object.entries(deps)) {
      if (typeof spec !== "string") continue;
      // `"x": "npm:real@^1"` 은 실제 이름 real 의 의존성이다.
      const { name } = unwrapNpmAlias(alias, spec);
      dependencies.push({ name, spec });
    }
  }
  return { raw: data, dependencies };
}

function parseLockfileOrThrow(file: LockfileFile, content: string): LockPackage[] {
  try {
    return parseLockfile(file.kind, content);
  } catch (error) {
    throw new Error(`${file.path} 을 해석할 수 없습니다: ${errorMessage(error)}`);
  }
}

export function createScanService(deps: ScanServiceDeps): ScanService {
  const { repos, github, githubTokenSource, notifier, clock, logger } = deps;
  let running: Promise<Scan> | null = null;

  // ---------------------------------------------------------------- repo 1개

  async function scanRepo(
    org: string,
    client: GitHubClient,
    repo: RepoInfo,
    entriesByName: Map<string, BlacklistEntry[]>,
  ): Promise<{ packageJsonCount: number; matches: Match[] }> {
    const tree = await client.getTree(org, repo.name, repo.defaultBranch);
    if (tree.truncated) {
      throw new Error("파일 트리가 너무 커서 GitHub 가 일부만 반환했습니다(truncated)");
    }
    // 트리는 수만 개일 수 있어 한 번만 돌며 파일 이름으로 나눈다(각 목록은 트리 순서 유지).
    const packageJsons: TreeEntry[] = [];
    const lockfiles: (TreeEntry & LockfileFile)[] = [];
    const bunLockbs: TreeEntry[] = [];
    const yamlCandidates: TreeEntry[] = [];
    for (const entry of tree.entries) {
      if (isInNodeModules(entry.path)) continue;
      const name = baseName(entry.path);
      if (name === "package.json") packageJsons.push(entry);
      else if (name === "bun.lockb") bunLockbs.push(entry);
      else if (name === "pnpm-workspace.yaml") yamlCandidates.push(entry);
      else {
        const kind = lockfileKindOf(name);
        if (kind) lockfiles.push({ ...entry, kind });
      }
    }
    // package.json 이 0개면 Node 프로젝트가 아니다(실패 아님).
    if (packageJsons.length === 0) return { packageJsonCount: 0, matches: [] };

    const dirsOf = (kind: LockfileKind) =>
      new Set(lockfiles.filter((file) => file.kind === kind).map((file) => dirOf(file.path)));
    const bunLockDirs = dirsOf("bun");
    for (const entry of bunLockbs) {
      if (!bunLockDirs.has(dirOf(entry.path))) {
        logger.warn(
          `bun.lockb 는 읽지 않습니다. lockfile 이 없는 것으로 처리합니다 (EC-12): ` +
            `${org}/${repo.name}/${entry.path}`,
        );
      }
    }
    const pnpmDirs = dirsOf("pnpm");
    const workspaceYamls = yamlCandidates.filter((entry) => pnpmDirs.has(dirOf(entry.path)));

    // 파일 1개라도 조회·파싱에 실패하면 repo 전체가 실패다(호출 쪽이 failedRepos 로 기록).
    const contents = new Map<string, string>();
    const toFetch = [...packageJsons, ...lockfiles, ...workspaceYamls];
    await mapWithConcurrency(toFetch, FILE_CONCURRENCY, async (entry) => {
      contents.set(entry.path, await client.getFile(org, repo.name, entry.sha));
    });
    const contentOf = (path: string): string => contents.get(path) ?? "";

    const manifests = new Map<string, Manifest>();
    for (const entry of packageJsons) {
      manifests.set(entry.path, parseManifest(entry.path, contentOf(entry.path)));
    }
    const lockPackages = new Map<string, LockPackage[]>();
    for (const file of lockfiles) {
      lockPackages.set(file.path, parseLockfileOrThrow(file, contentOf(file.path)));
    }

    const assignment = assignLockfiles(
      packageJsons.map((entry) => entry.path),
      lockfiles.map((file) => {
        const dir = dirOf(file.path);
        return {
          path: file.path,
          globs: readWorkspaceGlobs(file.kind, {
            packageJson: manifests.get(joinPath(dir, "package.json"))?.raw,
            pnpmWorkspaceYaml: contents.get(joinPath(dir, "pnpm-workspace.yaml")) ?? null,
          }),
        };
      }),
    );

    const matches: Match[] = [];
    // lockfile 의 정확한 버전으로 검출한다. 담당 package.json 의 직접 의존성이면 direct.
    for (const file of lockfiles) {
      const owners = assignment.byLockfile.get(file.path) ?? [];
      const directNames = new Set(
        owners.flatMap((path) => manifests.get(path)?.dependencies.map((dep) => dep.name) ?? []),
      );
      for (const pkg of lockPackages.get(file.path) ?? []) {
        for (const entry of entriesByName.get(pkg.name) ?? []) {
          if (entry.versionRange !== null && !matchExact(pkg.version, entry.versionRange)) continue;
          matches.push({
            repo: repo.name,
            filePath: file.path,
            packageName: pkg.name,
            version: pkg.version,
            dependencyType: directNames.has(pkg.name) ? "direct" : "transitive",
            blacklistEntryId: entry.id,
          });
        }
      }
    }
    // 담당 lockfile 이 없거나, 담당 lockfile 모두에 없는 직접 의존성만 range 검사를 한다.
    // 모노레포는 package.json 여럿이 같은 lockfile 을 공유하므로 이름 집합은 lockfile 마다 1번만 만든다.
    const lockedNames = new Map(
      [...lockPackages].map(([lockPath, pkgs]) => [lockPath, new Set(pkgs.map((pkg) => pkg.name))]),
    );
    for (const [path, manifest] of manifests) {
      const owners = assignment.byPackageJson.get(path) ?? [];
      for (const dep of manifest.dependencies) {
        if (owners.some((lockPath) => lockedNames.get(lockPath)?.has(dep.name))) continue;
        for (const entry of entriesByName.get(dep.name) ?? []) {
          if (!matchRange(dep.spec, entry.versionRange)) continue;
          matches.push({
            repo: repo.name,
            filePath: path,
            packageName: dep.name,
            version: dep.spec,
            dependencyType: "direct",
            blacklistEntryId: entry.id,
          });
        }
      }
    }
    return { packageJsonCount: packageJsons.length, matches };
  }

  // ---------------------------------------------------------------- GitHub 단계 (DB 에 쓰지 않는다)

  async function collect(org: string, client: GitHubClient, snapshot: BlacklistEntry[]): Promise<Collected> {
    let listed: RepoInfo[];
    try {
      listed = await client.listOrgRepos(org);
    } catch (error) {
      const message = `GitHub repo 목록을 가져오지 못했습니다: ${describeError(error)}`;
      return { kind: "listFailed", error: message };
    }
    const unique = [...new Map(listed.map((repo) => [repo.name, repo])).values()];
    const targets = unique.filter((repo) => !repo.archived && !repo.fork);

    const entriesByName = new Map<string, BlacklistEntry[]>();
    for (const entry of snapshot) {
      entriesByName.set(entry.name, [...(entriesByName.get(entry.name) ?? []), entry]);
    }

    let rateLimited = false;
    const scanTarget = async (repo: RepoInfo): Promise<RepoOutcome> => {
      // primary rate limit 이 소진되면 기다리지 않고 남은 repo 를 모두 실패로 둔다.
      if (rateLimited) return { repo: repo.name, ok: false, error: RATE_LIMITED };
      try {
        return { repo: repo.name, ok: true, ...(await scanRepo(org, client, repo, entriesByName)) };
      } catch (error) {
        if (error instanceof RateLimitedError) rateLimited = true;
        return { repo: repo.name, ok: false, error: describeError(error) };
      }
    };
    const outcomes = await mapWithConcurrency(targets, REPO_CONCURRENCY, scanTarget);

    // ② 대상 목록에 없는 repo 의 활성 검출 — 재확인 후에만 resolve 한다.
    const targetNames = new Set(targets.map((repo) => repo.name));
    const candidates = [...new Set(repos.findings.listActive().map((finding) => finding.repo))]
      .filter((name) => !targetNames.has(name))
      .sort();
    const baseline = Number.parseInt(repos.settings.get("listed_baseline") ?? "", 10);
    // 목록이 비었거나 절반 넘게 줄면 토큰 접근 축소로 보고 ② 를 모두 보류한다.
    const suspicious =
      targets.length === 0 || (Number.isInteger(baseline) && unique.length * 2 < baseline);

    const resolveRepos: string[] = [];
    const lookupFailures: FailedRepo[] = [];
    for (const name of candidates) {
      if (rateLimited || suspicious) {
        lookupFailures.push({ repo: name, error: rateLimited ? RATE_LIMITED : ACCESS_SUSPECT });
        continue;
      }
      try {
        const info = await client.getRepo(org, name);
        const renamed = info !== null && info.fullName.toLowerCase() !== `${org}/${name}`.toLowerCase();
        if (info === null || info.archived || info.fork || renamed) resolveRepos.push(name);
        else lookupFailures.push({ repo: name, error: STILL_EXISTS });
      } catch (error) {
        if (error instanceof RateLimitedError) rateLimited = true;
        lookupFailures.push({ repo: name, error: describeError(error) });
      }
    }

    return {
      kind: "listed",
      listedCount: unique.length,
      outcomes,
      resolveRepos,
      lookupFailures,
      // 재확인할 repo 가 있었고 rate limit 또는 접근 축소 의심으로 그 일부라도 확인하지 못했다.
      held: candidates.length > 0 && (rateLimited || suspicious),
    };
  }

  // ---------------------------------------------------------------- 종료 트랜잭션

  function failedResult(error: string): ScanResult {
    return {
      status: "failed",
      finishedAt: toIso(clock.now()),
      repoCount: 0,
      newFindingCount: 0,
      failedRepos: [],
      error,
    };
  }

  /** 스냅샷 이후 삭제·수정되지 않은 항목(현재 값). 그 외 항목의 결과는 버린다(다음 스캔이 평가). */
  function unchangedEntries(snapshot: BlacklistEntry[]): Map<number, BlacklistEntry> {
    const valid = new Map<number, BlacklistEntry>();
    for (const snap of snapshot) {
      const current = repos.blacklist.get(snap.id);
      if (
        current &&
        current.updatedAt === snap.updatedAt &&
        current.name === snap.name &&
        current.versionRange === snap.versionRange
      ) {
        valid.set(snap.id, current);
      }
    }
    return valid;
  }

  /** 동기 트랜잭션 1개: ① org 확인 ② 유효 항목 ③ 생성·resolve ④ 스캔 행 마감 */
  function finalize(
    scanId: number,
    org: string,
    snapshot: BlacklistEntry[],
    collected: Collected,
  ): { scan: Scan; sendMail: boolean } {
    return repos.transaction(() => {
      if (repos.settings.get("org") !== org) {
        return { scan: repos.scans.finish(scanId, failedResult(ORG_CHANGED)), sendMail: false };
      }
      if (collected.kind === "listFailed") {
        return { scan: repos.scans.finish(scanId, failedResult(collected.error)), sendMail: true };
      }

      const now = toIso(clock.now());
      const entries = unchangedEntries(snapshot);
      const results = new Map<string, Match>();
      for (const outcome of collected.outcomes) {
        if (!outcome.ok) continue;
        for (const match of outcome.matches) {
          if (!entries.has(match.blacklistEntryId)) continue;
          const key = findingKey(match);
          const existing = results.get(key);
          // 같은 검출 키가 여러 번 나오면 direct 를 우선한다.
          if (!existing || (existing.dependencyType === "transitive" && match.dependencyType === "direct")) {
            results.set(key, match);
          }
        }
      }

      const active = repos.findings.listActive();
      const activeByKey = new Map(active.map((finding) => [findingKey(finding), finding]));
      const seen = new Set<number>();
      let newFindingCount = 0;
      for (const [key, match] of results) {
        const existing = activeByKey.get(key);
        if (existing) {
          // 스캔은 open ↔ ignored 를 바꾸지 않는다. 다시 보인 행은 last_seen_at·dependency_type 만 갱신한다.
          repos.findings.touch(existing.id, match.dependencyType, now);
          seen.add(existing.id);
          continue;
        }
        repos.findings.insertOpen(
          {
            ...match,
            reason: entries.get(match.blacklistEntryId)?.reason ?? "",
            htmlUrl: htmlUrlOf(org, match.repo, match.filePath),
          },
          now,
        );
        newFindingCount += 1;
      }

      const packageJsonCounts = new Map<string, number>();
      for (const outcome of collected.outcomes) {
        if (outcome.ok) packageJsonCounts.set(outcome.repo, outcome.packageJsonCount);
      }
      const resolveRepos = new Set(collected.resolveRepos);
      const toResolve: number[] = [];
      for (const finding of active) {
        if (seen.has(finding.id)) continue;
        if (resolveRepos.has(finding.repo)) {
          toResolve.push(finding.id); // ② 삭제·archived·fork·이름 변경
          continue;
        }
        const count = packageJsonCounts.get(finding.repo);
        if (count === undefined) continue; // 실패한 repo 는 그대로 둔다
        if (count === 0 || entries.has(finding.blacklistEntryId)) toResolve.push(finding.id); // ③, ①
      }
      repos.findings.resolve(toResolve, now);

      const failedRepos: FailedRepo[] = [
        ...collected.outcomes.flatMap((outcome) =>
          outcome.ok ? [] : [{ repo: outcome.repo, error: outcome.error }],
        ),
        ...collected.lookupFailures,
      ];
      if (!collected.held) repos.settings.set("listed_baseline", String(collected.listedCount));
      const scan = repos.scans.finish(scanId, {
        status: failedRepos.length > 0 ? "partial" : "success",
        finishedAt: now,
        repoCount: collected.outcomes.length,
        newFindingCount,
        failedRepos,
        error: null,
      });
      return { scan, sendMail: true };
    });
  }

  // ---------------------------------------------------------------- 실행

  /** 예상하지 못한 예외: 스캔 행을 failed 로 바꾸고 검출은 그대로 둔다. 이 함수도 throw 하지 않는다. */
  function failUnexpected(scan: Scan, error: unknown): Scan {
    const result = failedResult(`스캔 중 예상하지 못한 오류가 발생했습니다: ${describeError(error)}`);
    try {
      return repos.scans.finish(scan.id, result);
    } catch (finishError) {
      logger.error("스캔 실패 기록을 저장하지 못했습니다", finishError);
      return { ...scan, ...result };
    }
  }

  async function execute(
    scan: Scan,
    org: string,
    client: GitHubClient,
    snapshot: BlacklistEntry[],
  ): Promise<Scan> {
    let finished: Scan;
    let sendMail = false;
    try {
      const collected = await collect(org, client, snapshot);
      ({ scan: finished, sendMail } = finalize(scan.id, org, snapshot, collected));
    } catch (error) {
      logger.error(`스캔 #${scan.id} 중 예상하지 못한 오류`, error);
      finished = failUnexpected(scan, error);
    }
    // 메일은 트랜잭션이 끝난 뒤에 보낸다. SMTP 실패는 스캔 status 를 바꾸지 않는다.
    if (sendMail) {
      try {
        await notifier.notifyNewFindings();
      } catch (error) {
        logger.error(`스캔 #${scan.id} 의 신규 검출 메일 처리 중 오류`, error);
      }
    }
    return finished;
  }

  function begin(trigger: ScanTrigger): { scan: Scan; done: Promise<Scan> } {
    const org = repos.settings.get("org");
    if (!org) {
      throw new AppError("ORG_NOT_SET", "GitHub org 가 설정되지 않았습니다. 설정 화면에서 org 를 저장하십시오");
    }
    if (githubTokenSource === "none" || !github) throw new AppError("TOKEN_MISSING", TOKEN_MISSING_MESSAGE);
    if (running) throw new AppError("SCAN_RUNNING", "스캔이 이미 실행 중입니다");

    const snapshot = repos.blacklist.list();
    const scan = repos.scans.insertRunning(trigger, toIso(clock.now()));
    // lock 은 메일 발송까지 끝난 뒤 finally 에서 푼다.
    const done = execute(scan, org, github, snapshot).finally(() => {
      running = null;
    });
    running = done;
    return { scan, done };
  }

  return {
    start(trigger) {
      const { scan, done } = begin(trigger);
      done.catch((error: unknown) => logger.error("백그라운드 스캔 오류", error));
      return scan;
    },
    runScan: async (trigger) => begin(trigger).done,
    isRunning: () => running !== null,
    async waitForIdle() {
      while (running) await running.catch(() => undefined);
    },
    list(query) {
      const { page, limit } = parseInput(scansQuerySchema, query);
      return repos.scans.list(page, limit);
    },
    get(id) {
      const scan = repos.scans.get(id);
      if (!scan) throw new AppError("NOT_FOUND", "스캔을 찾을 수 없습니다");
      return scan;
    },
  };
}
