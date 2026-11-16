import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import {
  POLICY_ECOSYSTEM,
  isNamePattern,
  scanReposQuerySchema,
  scansQuerySchema,
  usesVersionRange,
  type BlacklistEntry,
  type Ecosystem,
  type DependencyType,
  type FailedRepo,
  type Page,
  type Scan,
  type ScanRepo,
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
import {
  ECOSYSTEM_SUPPORT,
  classifyFile,
  isExcludedPath,
  type FileEcosystem,
} from "../ecosystems/index.ts";
import { detectEcosystem, type ParsedLock, type ParsedManifest } from "../ecosystems/detect.ts";
import type { Logger } from "../logger.ts";
import { createCompositeIndex, feedRowIdOf, isFeedTempId, type FeedIndex } from "../feed/index.ts";
import { createEntryIndex, matchExact, matchRange, type EntryIndex, type MatchableEntry } from "../matcher.ts";
import type { FindingKey } from "../repositories/findings.ts";
import type { Repositories } from "../repositories/index.ts";
import type { RepoDone } from "../repositories/scanRepos.ts";
import type { ScanResult } from "../repositories/scans.ts";
import { assignLockfiles, dirOf, readWorkspaceGlobs } from "../workspaces.ts";
import { mapWithConcurrency, parseInput, printable, toIso } from "./common.ts";
import { isEntryActive, todayKst } from "./entryActivity.ts";
import type { FeedSource } from "./feedService.ts";
import type { Notifier } from "./notifier.ts";
import { createIndicatorRules, type IndicatorRules } from "./scanIndicators.ts";
import { createPolicyRules, type PolicyManifest, type PolicyMatch, type PolicyRules } from "./scanPolicy.ts";
import { needsSourceKind, scanSources, sourceFileOf, type SourceFile } from "./scanSources.ts";
import type { SourceFacts } from "../sources/index.ts";

const NPM: Ecosystem = "npm";
/** registry 에서 받지 않는 의존성의 spec */
const LOCAL_SPEC = /^(?:workspace|link|file|portal):/i;
const isFeedEntry = (entry: MatchableEntry): boolean => entry.id < 0 || entry.source === "feed";
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
const ABANDONED = "비정상 종료";
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
  /** 없는 스캔 → NOT_FOUND, 그 다음 `scanReposQuerySchema` 검증(VALIDATION_ERROR). 정렬은 repo 의 상태 순서 */
  listRepos(id: number, query: unknown): Page<ScanRepo>;
}

export interface ScanServiceDeps {
  repos: Repositories;
  /** 토큰이 없으면 null */
  github: GitHubClient | null;
  githubTokenSource: TokenSource;
  notifier: Notifier;
  clock: Clock;
  logger: Logger;
  /** 외부 목록(feed). 없으면 블랙리스트 항목만 대조한다 */
  feed?: FeedSource;
}

/** 스캔이 시작될 때 정해지는 외부 목록의 대조 자료 */
interface FeedContext {
  index: FeedIndex;
  /** 이미 블랙리스트에 있는 (종류, 이름, 범위). 같은 키의 외부 목록 항목은 대조하지 않는다 */
  blocked: Set<string>;
}

/** 외부 목록의 항목으로 만드는 블랙리스트 항목의 사유 (최대 500자) */
function feedReason(summary: string, externalId: string, url: string): string {
  return `${summary} (${externalId}) 출처: ${url}`.trim().slice(0, 500);
}

interface Match extends FindingKey {
  dependencyType: DependencyType;
}

type RepoOutcome =
  | {
      repo: string;
      ok: true;
      /** 실제 선언·보조 파일 수 (흔적 때문에 올리지 않는다) */
      declaredCount: number;
      /** path·branch 의 흔적이나 policy 의 tree 검사를 평가했는가 (선언·보조 파일이 0개여도 검사 대상) */
      traced: boolean;
      fileCount: number;
      /** policy 를 뺀 검출. repo 의 상태(passed·issue)와 신규 수는 이것만 센다 */
      matches: Match[];
      /** 위험한 설정(policy)의 검출 */
      policyMatches: PolicyMatch[];
      /** 받았지만 평가하지 못한 파일(해석 실패, 크기 초과) — 그 파일의 기존 검출은 resolve 하지 않는다 */
      skippedPaths: ReadonlySet<string>;
    }
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

/**
 * ② 재확인 응답의 `full_name` 이 그 repo 자신인가.
 * org 는 소문자로 정규화해 저장하므로 org 부분은 대소문자를 무시한다. repo 이름은 목록이 준 정식 이름이므로
 * 대소문자까지 같아야 한다 — 대소문자만 바뀐 이름(`Foo` → `foo`)도 이름 변경이다(S-15).
 */
function isSameRepo(fullName: string, org: string, repo: string): boolean {
  const slash = fullName.indexOf("/");
  return (
    slash !== -1 &&
    fullName.slice(0, slash).toLowerCase() === org.toLowerCase() &&
    fullName.slice(slash + 1) === repo
  );
}

const BRANCH_REF_PREFIX = "refs/heads/";

// org·repo·경로 조각을 percent-encoding 한다 — 근거: 공백·`#` 이 든 경로도 유효한 URL 이 되게 한다(일반 이름은 계약 형식과 같다).
// branch 검출(`refs/heads/<이름>`)은 파일이 아니라 브랜치의 tree 로 연결한다. 실제 파일 `refs/heads/x`(path 검출)와 구분하려고 종류로 판정한다.
// 짝 없는 surrogate 가 든 경로는 encodeURIComponent 가 던지므로 repo 루트로 대신한다(finalize 트랜잭션 전체를 실패시키지 않는다).
function htmlUrlOf(org: string, repo: string, filePath: string, ecosystem: Ecosystem): string {
  const root = `https://github.com/${org}/${repo}`;
  try {
    const base = `https://github.com/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`;
    if (ecosystem === "branch" && filePath.startsWith(BRANCH_REF_PREFIX)) {
      const branch = filePath.slice(BRANCH_REF_PREFIX.length).split("/").map(encodeURIComponent).join("/");
      return `${base}/tree/${branch}`;
    }
    const path = filePath.split("/").map(encodeURIComponent).join("/");
    // committed-node-modules 의 검출은 파일이 아니라 폴더다.
    if (ecosystem === POLICY_ECOSYSTEM && (filePath === "node_modules" || filePath.endsWith("/node_modules"))) {
      return `${base}/tree/HEAD/${path}`;
    }
    return `${base}/blob/HEAD/${path}`;
  } catch {
    return root;
  }
}

function parseManifest(path: string, content: string): Manifest {
  const text = normalizeText(content);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    // Sencha Cmd 등이 쓰는 주석·끝 쉼표가 든 파일은 JSONC 로 다시 읽는다. 그래도 오류가 남으면 실패다.
    const errors: ParseError[] = [];
    data = parseJsonc(text, errors, { allowTrailingComma: true });
    if (errors.length > 0) {
      throw new Error(`${path} 을 JSON 으로 읽을 수 없습니다: ${errorMessage(error)}`);
    }
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

const LOCKFILE_ERROR_MARKER = " 을 해석할 수 없습니다: ";

function parseLockfileOrThrow(file: LockfileFile, content: string): LockPackage[] {
  try {
    return parseLockfile(file.kind, content);
  } catch (error) {
    // 파서의 메시지가 이미 "<파일 이름> 을 해석할 수 없습니다: " 로 시작하면 경로만 바꿔서 문구가 겹치지 않게 한다.
    const message = errorMessage(error);
    const at = message.indexOf(LOCKFILE_ERROR_MARKER);
    const detail = at === -1 ? message : message.slice(at + LOCKFILE_ERROR_MARKER.length);
    throw new Error(`${file.path}${LOCKFILE_ERROR_MARKER}${detail}`);
  }
}

export function createScanService(deps: ScanServiceDeps): ScanService {
  const { repos, github, githubTokenSource, notifier, clock, logger, feed } = deps;
  let running: Promise<Scan> | null = null;

  // ---------------------------------------------------------------- 진행 기록

  /** 진행 기록은 부가 정보라서 쓰기가 실패해도 스캔은 계속한다(로그만 남긴다). */
  function track(what: string, write: () => void): void {
    try {
      write();
    } catch (error) {
      logger.error(`스캔 진행 기록을 저장하지 못했습니다 (${what})`, error);
    }
  }

  /** 끝나지 않은 repo 행(pending·running)을 failed 로 바꾼다 */
  function failProgress(scanId: number, error: string): void {
    track("남은 repo 를 failed 로", () => repos.scanRepos.failUnfinished(scanId, error, toIso(clock.now())));
  }

  /** 이 스캔이 찾은 매칭이 1건 이상이면 임시로 issue, 종료 트랜잭션이 확정한다 */
  function doneOf(outcome: RepoOutcome): RepoDone {
    const finishedAt = toIso(clock.now());
    if (!outcome.ok) return { status: "failed", fileCount: 0, error: outcome.error, finishedAt };
    if (outcome.declaredCount === 0 && !outcome.traced) return { status: "skipped", fileCount: 0, error: null, finishedAt };
    return {
      status: outcome.matches.length > 0 ? "issue" : "passed",
      fileCount: outcome.fileCount,
      error: null,
      finishedAt,
    };
  }

  // ---------------------------------------------------------------- repo 1개

  async function scanRepo(
    org: string,
    client: GitHubClient,
    repo: RepoInfo,
    entryIndex: EntryIndex<MatchableEntry>,
    activeEcosystems: ReadonlySet<string>,
    indicators: IndicatorRules,
    policy: PolicyRules,
  ): Promise<{
    declaredCount: number;
    traced: boolean;
    fileCount: number;
    matches: Match[];
    policyMatches: PolicyMatch[];
    skippedPaths: ReadonlySet<string>;
  }> {
    const tree = await client.getTree(org, repo.name, repo.defaultBranch);
    if (tree.truncated) {
      throw new Error("파일 트리가 너무 커서 GitHub 가 일부만 반환했습니다(truncated)");
    }
    // 트리는 수만 개일 수 있어 한 번만 돌며 파일 이름으로 나눈다(각 목록은 트리 순서 유지).
    const packageJsons: TreeEntry[] = [];
    const lockfiles: (TreeEntry & LockfileFile)[] = [];
    const bunLockbs: TreeEntry[] = [];
    const sourceFiles: SourceFile[] = [];
    const yamlCandidates: TreeEntry[] = [];
    const otherFiles = new Map<FileEcosystem, { manifests: TreeEntry[]; locks: TreeEntry[] }>();
    let otherManifestCount = 0;
    // path 는 제외 폴더(node_modules 등)를 포함한 tree 전체를 본다. 파일을 받지 않는다.
    const matches: Match[] = indicators.hasPath
      ? await indicators.matchPaths(repo.name, `${org}/${repo.name}`, tree.entries.map((entry) => entry.path), logger)
      : [];
    for (const entry of tree.entries) {
      if (isInNodeModules(entry.path)) continue;
      const name = baseName(entry.path);
      if (name === "package.json") packageJsons.push(entry);
      else if (name === "bun.lockb") bunLockbs.push(entry);
      else if (name === "pnpm-workspace.yaml") yamlCandidates.push(entry);
      else {
        const kind = lockfileKindOf(name);
        if (kind) {
          lockfiles.push({ ...entry, kind });
          continue;
        }
        const other = isExcludedPath(entry.path) ? null : classifyFile(entry.path);
        if (!other) {
          const source = sourceFileOf(entry);
          if (source) sourceFiles.push(source);
          continue;
        }
        const files = otherFiles.get(other.ecosystem) ?? { manifests: [], locks: [] };
        if (other.role === "manifest") {
          files.manifests.push(entry);
          otherManifestCount += 1;
        } else files.locks.push(entry);
        otherFiles.set(other.ecosystem, files);
      }
    }
    // 선언 파일과 보조 파일이 모두 0개면 검사할 프로젝트가 아니다(실패 아님). 읽지 않는 종류의 파일도 센다.
    // 단 path·branch·policy 항목이 활성이면 tree 와 브랜치는 볼 수 있으므로 "흔적만 볼 수 있는 repo"로 검사한다.
    // 이때 다른 종류의 스캔은 하지 않는다(그 범위가 이 항목들의 켬·끔에 따라 달라지면 안 된다).
    const declaredCount = packageJsons.length + otherManifestCount + sourceFiles.length;
    const policyActive = policy.active.size > 0;
    const traced = (indicators.hasPath || indicators.hasBranch || policyActive) && tree.entries.length > 0;
    if (declaredCount === 0 && !traced) {
      return { declaredCount: 0, traced: false, fileCount: 0, matches: [], policyMatches: [], skippedPaths: new Set() };
    }
    const evaluatePolicy = (manifests: PolicyManifest[], sources: SourceFacts[]): Promise<PolicyMatch[]> =>
      policyActive
        ? policy.evaluate(
            { org, repo: repo.name, treePaths: tree.entries.map((entry) => entry.path), manifests, sources },
            logger,
          )
        : Promise.resolve([]);

    if (indicators.hasBranch) {
      const branches = await client.listBranches(org, repo.name);
      matches.push(...indicators.matchBranches(repo.name, `${org}/${repo.name}`, branches, logger));
    }
    if (declaredCount === 0) {
      return {
        declaredCount: 0,
        traced,
        fileCount: 0,
        matches,
        policyMatches: await evaluatePolicy([], []),
        skippedPaths: new Set(),
      };
    }

    // content 검사용: 이 스캔이 받은 모든 파일의 (경로 → 내용). content 항목이 없으면 내용을 보관하지 않는다.
    const received = indicators.hasContent ? new Map<string, string>() : undefined;
    const npm = await scanNpm(org, client, repo, entryIndex, { packageJsons, lockfiles, bunLockbs, yamlCandidates }, received);
    matches.push(...npm.matches);
    let fileCount = npm.fileCount;
    // 블랙리스트에 활성 항목이 있는 종류의 파일만 받는다(GitHub 요청 수를 늘리지 않는다).
    for (const [ecosystem, files] of otherFiles) {
      if (!activeEcosystems.has(ecosystem)) continue;
      const result = await scanEcosystem(org, client, repo, entryIndex, ecosystem, files, received);
      matches.push(...result.matches);
      fileCount += result.fileCount;
    }
    // 보조 파일은 그 파일에서 나오는 종류(또는 활성 policy 검사)의 활성 항목이 있을 때만 받는다.
    const wantedSources = sourceFiles.filter((file) => needsSourceKind(file.kind, activeEcosystems, policy.active));
    const sourceFacts: SourceFacts[] = [];
    const skippedPaths = new Set<string>();
    if (wantedSources.length > 0) {
      const result = await scanSources(
        org,
        client,
        repo,
        entryIndex,
        wantedSources,
        logger,
        undefined,
        received,
        policyActive ? sourceFacts : undefined,
        skippedPaths,
      );
      matches.push(...result.matches);
      fileCount += result.fileCount;
    }
    if (indicators.hasContent) {
      matches.push(...(await indicators.matchContents(repo.name, `${org}/${repo.name}`, received ?? new Map(), logger, skippedPaths)));
    }
    return {
      declaredCount,
      traced,
      fileCount,
      matches,
      policyMatches: await evaluatePolicy(npm.manifests, sourceFacts),
      skippedPaths,
    };
  }

  /** npm: lockfile 과 package.json (동작은 이 묶음 이전과 같다) */
  async function scanNpm(
    org: string,
    client: GitHubClient,
    repo: RepoInfo,
    entryIndex: EntryIndex<MatchableEntry>,
    files: {
      packageJsons: TreeEntry[];
      lockfiles: (TreeEntry & LockfileFile)[];
      bunLockbs: TreeEntry[];
      yamlCandidates: TreeEntry[];
    },
    received?: Map<string, string>,
  ): Promise<{ matches: Match[]; fileCount: number; manifests: PolicyManifest[] }> {
    const { packageJsons, lockfiles, bunLockbs, yamlCandidates } = files;
    // package.json 이 0개면 Node 프로젝트가 아니다.
    if (packageJsons.length === 0) return { matches: [], fileCount: 0, manifests: [] };

    const dirsOf = (kind: LockfileKind) =>
      new Set(lockfiles.filter((file) => file.kind === kind).map((file) => dirOf(file.path)));
    const bunLockDirs = dirsOf("bun");
    for (const entry of bunLockbs) {
      if (!bunLockDirs.has(dirOf(entry.path))) {
        logger.warn(
          `bun.lockb 는 읽지 않습니다. lockfile 이 없는 것으로 처리합니다 (EC-12): ` +
            printable(`${org}/${repo.name}/${entry.path}`),
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
    if (received) for (const [path, content] of contents) received.set(path, content);
    const contentOf = (path: string): string => contents.get(path) ?? "";

    const manifests = new Map<string, Manifest>();
    for (const entry of packageJsons) {
      manifests.set(entry.path, parseManifest(entry.path, contentOf(entry.path)));
    }
    const lockPackages = new Map<string, LockPackage[]>();
    for (const file of lockfiles) {
      lockPackages.set(file.path, parseLockfileOrThrow(file, contentOf(file.path)));
    }

    // 문법이 깨진 pnpm-workspace.yaml 은 readWorkspaceGlobs 가 throw 해서 repo 실패가 된다(S-14).
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
        for (const entry of entryIndex.match(NPM, pkg.name)) {
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
    // lockfile 파서는 workspace 패키지를 빼므로, 같은 repo 의 다른 workspace 를 가리키는 직접 의존성은 항상 이 경로로 온다.
    // 패턴 항목(`*-utils`)이 org 내부 패키지를 잡지 않도록 그 repo 의 package.json 들의 name 은 패턴 매칭에서 뺀다.
    const internalNames = new Set(
      [...manifests.values()].flatMap((manifest) =>
        typeof manifest.raw.name === "string" ? [manifest.raw.name] : [],
      ),
    );
    for (const [path, manifest] of manifests) {
      const owners = assignment.byPackageJson.get(path) ?? [];
      for (const dep of manifest.dependencies) {
        if (owners.some((lockPath) => lockedNames.get(lockPath)?.has(dep.name))) continue;
        for (const entry of entryIndex.match(NPM, dep.name)) {
          if (isNamePattern(entry.name) && internalNames.has(dep.name)) continue;
          // 외부 목록의 항목은 registry 의 패키지에만 해당한다: 같은 repo 의 패키지와 registry 에서 받지 않는 spec 은 제외
          if (isFeedEntry(entry) && (internalNames.has(dep.name) || LOCAL_SPEC.test(dep.spec.trim()))) continue;
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
    // policy 검사(lock 파일 없음, registry 밖의 의존성, 선언된 로컬 도구)가 쓰는 package.json 의 사실
    // bun.lockb 는 읽지 않아도 있다는 것은 안다: 같은 폴더나 상위 폴더에 있으면 lock 이 있는 것으로 본다.
    const bunDirs = new Set(bunLockbs.map((entry) => dirOf(entry.path)));
    const hasBunLockb = (path: string): boolean => {
      for (let dir = dirOf(path); ; dir = dirOf(dir)) {
        if (bunDirs.has(dir)) return true;
        if (dir === "") return false;
      }
    };
    const policyManifests = packageJsons.map((entry): PolicyManifest => ({
      path: entry.path,
      dependencies: manifests.get(entry.path)?.dependencies ?? [],
      locked: (assignment.byPackageJson.get(entry.path) ?? []).length > 0 || hasBunLockb(entry.path),
    }));
    return { matches, fileCount: toFetch.length, manifests: policyManifests };
  }

  /** npm 을 뺀 종류 1개: 선언 파일과 lock 을 받아 파싱하고 검출한다. 파일 1개라도 실패하면 repo 실패다. */
  async function scanEcosystem(
    org: string,
    client: GitHubClient,
    repo: RepoInfo,
    entryIndex: EntryIndex<MatchableEntry>,
    ecosystem: FileEcosystem,
    files: { manifests: TreeEntry[]; locks: TreeEntry[] },
    received?: Map<string, string>,
  ): Promise<{ matches: Match[]; fileCount: number }> {
    const support = ECOSYSTEM_SUPPORT[ecosystem];
    const toFetch = [...files.manifests, ...files.locks];
    const contents = new Map<string, string>();
    await mapWithConcurrency(toFetch, FILE_CONCURRENCY, async (entry) => {
      contents.set(entry.path, await client.getFile(org, repo.name, entry.sha));
    });
    if (received) for (const [path, content] of contents) received.set(path, content);
    const manifests: ParsedManifest[] = files.manifests.map((entry) => ({
      path: entry.path,
      deps: support.parseManifest(entry.path, contents.get(entry.path) ?? ""),
    }));
    const locks: ParsedLock[] = files.locks.map((entry) => ({
      path: entry.path,
      packages: support.parseLock(entry.path, contents.get(entry.path) ?? ""),
    }));
    const matches = detectEcosystem(ecosystem, manifests, locks, entryIndex).map(
      (found): Match => ({ repo: repo.name, ...found }),
    );
    return { matches, fileCount: toFetch.length };
  }

  // ---------------------------------------------------------------- GitHub 단계 (DB 에 쓰지 않는다)

  async function collect(
    scanId: number,
    org: string,
    client: GitHubClient,
    snapshot: BlacklistEntry[],
    feedContext: FeedContext | null,
  ): Promise<Collected> {
    let listed: RepoInfo[];
    try {
      listed = await client.listOrgRepos(org);
    } catch (error) {
      const message = `GitHub repo 목록을 가져오지 못했습니다: ${describeError(error)}`;
      return { kind: "listFailed", error: message };
    }
    const unique = [...new Map(listed.map((repo) => [repo.name, repo])).values()];
    const targets = unique.filter((repo) => !repo.archived && !repo.fork);

    const entryIndex = createCompositeIndex(createEntryIndex(snapshot), feedContext?.index ?? null, feedContext?.blocked ?? new Set());
    const indicators = createIndicatorRules(snapshot);
    const policy = createPolicyRules(snapshot);
    // 외부 목록에 항목이 있는 종류도 그 종류의 파일을 받는다.
    const activeEcosystems = new Set<string>([
      ...snapshot.map((entry) => entry.ecosystem),
      ...(feedContext?.index.ecosystems ?? []),
    ]);

    // 대상 목록을 받은 직후에 오래된 기록을 지우고 repo 마다 pending 행을 만든다.
    track("대상 repo 등록", () =>
      repos.transaction(() => {
        repos.scanRepos.prune();
        repos.scanRepos.insertPending(
          scanId,
          targets.map((repo) => repo.name),
        );
      }),
    );

    let rateLimited = false;
    const inspect = async (repo: RepoInfo): Promise<RepoOutcome> => {
      // primary rate limit 이 소진되면 기다리지 않고 남은 repo 를 모두 실패로 둔다.
      if (rateLimited) return { repo: repo.name, ok: false, error: RATE_LIMITED };
      track("repo 시작", () => repos.scanRepos.markRunning(scanId, repo.name, toIso(clock.now())));
      try {
        return { repo: repo.name, ok: true, ...(await scanRepo(org, client, repo, entryIndex, activeEcosystems, indicators, policy)) };
      } catch (error) {
        if (error instanceof RateLimitedError) rateLimited = true;
        return { repo: repo.name, ok: false, error: describeError(error) };
      }
    };
    const scanTarget = async (repo: RepoInfo): Promise<RepoOutcome> => {
      const outcome = await inspect(repo);
      track("repo 결과", () => repos.scanRepos.markDone(scanId, repo.name, doneOf(outcome)));
      return outcome;
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
        if (info === null || info.archived || info.fork || !isSameRepo(info.fullName, org, name)) {
          resolveRepos.push(name); // 삭제·archived·fork·이름 변경(대소문자만 바뀐 것 포함)·이전
        } else lookupFailures.push({ repo: name, error: STILL_EXISTS });
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

  /**
   * 스냅샷 이후 삭제·수정되지 않았고 지금도 활성인 항목(현재 값). 그 외 항목의 결과는 버린다(다음 스캔이 평가).
   * 활성 판정은 스냅샷 시각이 아니라 종료 트랜잭션의 `today` 로 한다(스캔 도중 자정을 넘겨 만료된 항목 제외).
   */
  function unchangedEntries(snapshot: BlacklistEntry[], today: string): Map<number, BlacklistEntry> {
    const valid = new Map<number, BlacklistEntry>();
    for (const snap of snapshot) {
      const current = repos.blacklist.get(snap.id, today);
      if (
        current &&
        current.updatedAt === snap.updatedAt &&
        current.ecosystem === snap.ecosystem &&
        current.name === snap.name &&
        current.versionRange === snap.versionRange &&
        isEntryActive(current, today)
      ) {
        valid.set(snap.id, current);
      }
    }
    return valid;
  }

  /**
   * 검사를 끝낸 repo 의 상태를 확정한다: 그 repo 의 open 검출이 1건 이상이면 issue, 아니면 passed(ignored 만 있어도 passed).
   * 종료 트랜잭션 안에서 부른다. 실패해도 스캔 결과는 저장해야 하므로 savepoint 로 감싸서 이 기록만 되돌린다.
   */
  function confirmRepoStatuses(scanId: number, outcomes: RepoOutcome[], newByRepo: Map<string, number>): void {
    track("repo 상태 확정", () =>
      repos.transaction(() => {
        // repo 별 open 검출 수는 SQL 로 센다 (위험한 설정은 repo 의 상태·검출 수에 넣지 않는다)
        const openByRepo = repos.findings.openCountsByRepo();
        for (const outcome of outcomes) {
          if (!outcome.ok || (outcome.declaredCount === 0 && !outcome.traced)) continue;
          const openFindingCount = openByRepo.get(outcome.repo) ?? 0;
          repos.scanRepos.finalize(scanId, outcome.repo, {
            status: openFindingCount > 0 ? "issue" : "passed",
            openFindingCount,
            newFindingCount: newByRepo.get(outcome.repo) ?? 0,
          });
        }
      }),
    );
  }

  /**
   * 외부 목록(feed)과 일치한 항목(임시 id)을 블랙리스트 항목으로 만든다(`source = feed`). 종료 트랜잭션 안에서 부른다.
   * 같은 키의 항목이 이미 있으면(그 사이에 만들어진 경우) 새로 만들지 않고, 그 항목이 활성일 때만 쓴다 — 꺼진 항목이 다시 살아나지 않게.
   * 반환: 임시 id → 실제 id. 만들 수 없거나(행이 지워짐) 쓸 수 없는 항목은 들어 있지 않다. 쓰는 항목은 `entries` 에도 더한다.
   */
  function materializeFeedEntries(
    outcomes: RepoOutcome[],
    entries: Map<number, BlacklistEntry>,
    feedIndex: FeedIndex | null,
    now: string,
    today: string,
  ): Map<number, number> {
    const mapping = new Map<number, number>();
    const tempIds = new Set<number>();
    for (const outcome of outcomes) {
      if (!outcome.ok) continue;
      for (const match of outcome.matches) if (isFeedTempId(match.blacklistEntryId)) tempIds.add(match.blacklistEntryId);
    }
    for (const tempId of tempIds) {
      const row = repos.feed.get(feedRowIdOf(tempId));
      if (!row) continue;
      // 스캔이 본 임시 항목과 같은 (이름, 범위)의 행인가 — 행이 바뀌었거나 id 가 다른 행에 쓰였으면 이 일치는 버린다.
      const seen = feedIndex?.match(row.ecosystem, row.name)?.find((item) => item.id === tempId);
      if (!seen || seen.versionRange !== row.versionRange) continue;
      const existing = repos.blacklist.findSameMeaning(row.ecosystem, row.name, row.versionRange, today);
      const entry =
        existing ??
        repos.blacklist.insert(
          {
            ecosystem: row.ecosystem,
            name: row.name,
            versionRange: row.versionRange,
            reason: feedReason(row.summary, row.externalId, row.url),
            severity: row.severity,
            enabled: true,
            expiresAt: null,
            source: "feed",
            externalId: row.externalId,
          },
          now,
          today,
        );
      if (!isEntryActive(entry, today)) continue;
      entries.set(entry.id, entry);
      mapping.set(tempId, entry.id);
    }
    return mapping;
  }

  /** 동기 트랜잭션 1개: ① org 확인 ② 유효 항목 ③ 생성·resolve ④ 스캔 행 마감 */
  function finalize(
    scanId: number,
    org: string,
    snapshot: BlacklistEntry[],
    collected: Collected,
    feedIndex: FeedIndex | null,
  ): { scan: Scan; sendMail: boolean } {
    return repos.transaction(() => {
      if (repos.settings.get("org") !== org) {
        failProgress(scanId, ORG_CHANGED);
        return { scan: repos.scans.finish(scanId, failedResult(ORG_CHANGED)), sendMail: false };
      }
      // today 는 1번만 구해서 두 판정에 같이 쓴다(두 번 구하면 자정에 판정이 갈린다).
      const today = todayKst(clock);
      // 비활성 항목의 활성 검출을 먼저 정리한다 — 이후 메일과 요약이 읽는 시점에 불변식이 성립한다.
      repos.findings.resolveForInactiveEntries(today, toIso(clock.now()));
      if (collected.kind === "listFailed") {
        failProgress(scanId, collected.error);
        return { scan: repos.scans.finish(scanId, failedResult(collected.error)), sendMail: true };
      }

      const now = toIso(clock.now());
      const entries = unchangedEntries(snapshot, today);
      const feedIds = materializeFeedEntries(collected.outcomes, entries, feedIndex, now, today);
      const results = new Map<string, Match>();
      for (const outcome of collected.outcomes) {
        if (!outcome.ok) continue;
        for (const found of [...outcome.matches, ...outcome.policyMatches]) {
          // 외부 목록의 일치는 방금 만들었거나 이미 있던 블랙리스트 항목의 id 로 바꾼다. 못 바꾼 것은 버린다.
          const realId = isFeedTempId(found.blacklistEntryId) ? feedIds.get(found.blacklistEntryId) : found.blacklistEntryId;
          if (realId === undefined) continue;
          const match = realId === found.blacklistEntryId ? found : { ...found, blacklistEntryId: realId };
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
      const newByRepo = new Map<string, number>();
      for (const [key, match] of results) {
        const existing = activeByKey.get(key);
        if (existing) {
          // 스캔은 open ↔ ignored 를 바꾸지 않는다. 다시 보인 행은 last_seen_at·dependency_type 만 갱신한다.
          repos.findings.touch(existing.id, match.dependencyType, now);
          seen.add(existing.id);
          continue;
        }
        // results 에는 entries 에 있는 항목의 결과만 들어 있다.
        const entry = entries.get(match.blacklistEntryId);
        if (!entry) continue;
        repos.findings.insertOpen(
          {
            ...match,
            ecosystem: entry.ecosystem,
            severity: entry.severity,
            reason: entry.reason,
            htmlUrl: htmlUrlOf(org, match.repo, match.filePath, entry.ecosystem),
          },
          now,
        );
        // 위험한 설정은 스캔과 repo 의 신규 수에 넣지 않는다 (처음에 수백 건이 나온다).
        if (entry.ecosystem !== POLICY_ECOSYSTEM) {
          newFindingCount += 1;
          newByRepo.set(match.repo, (newByRepo.get(match.repo) ?? 0) + 1);
        }
      }

      const declaredCounts = new Map<string, number>();
      const skippedByRepo = new Map<string, ReadonlySet<string>>();
      for (const outcome of collected.outcomes) {
        if (!outcome.ok) continue;
        declaredCounts.set(outcome.repo, outcome.declaredCount);
        if (outcome.skippedPaths.size > 0) skippedByRepo.set(outcome.repo, outcome.skippedPaths);
      }
      // 흔적 검출(path·content·branch)은 선언 파일 수가 아니라 이번 스캔의 결과에 따른다.
      const resolveRepos = new Set(collected.resolveRepos);
      const toResolve: number[] = [];
      for (const finding of active) {
        if (seen.has(finding.id)) continue;
        if (resolveRepos.has(finding.repo)) {
          toResolve.push(finding.id); // ② 삭제·archived·fork·이름 변경
          continue;
        }
        const count = declaredCounts.get(finding.repo);
        if (count === undefined) continue; // 실패한 repo 는 그대로 둔다
        // 받았지만 평가하지 못한 파일(해석 실패, 크기 초과)의 검출은 그대로 둔다 — 파일이 고쳐지면 같은 행이 이어진다.
        if (skippedByRepo.get(finding.repo)?.has(finding.filePath)) continue;
        const isTrace = !usesVersionRange(finding.ecosystem);
        if ((!isTrace && count === 0) || entries.has(finding.blacklistEntryId)) toResolve.push(finding.id); // ③, ①
      }
      repos.findings.resolve(toResolve, now);
      confirmRepoStatuses(scanId, collected.outcomes, newByRepo);

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
    failProgress(scan.id, result.error ?? "");
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
    feedContext: FeedContext | null,
  ): Promise<Scan> {
    let finished: Scan;
    let sendMail = false;
    try {
      const collected = await collect(scan.id, org, client, snapshot, feedContext);
      ({ scan: finished, sendMail } = finalize(scan.id, org, snapshot, collected, feedContext?.index ?? null));
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

    // lock 이 없는데 running 인 행은 종료 트랜잭션과 failed 기록이 모두 실패하고 남은 것이다(S-16).
    const now = toIso(clock.now());
    const abandoned = repos.scans.failRunning(ABANDONED, now);
    if (abandoned > 0) {
      logger.warn(`running 으로 남은 스캔 ${abandoned}건을 failed(${ABANDONED})로 기록했습니다`);
    }

    const snapshot = repos.blacklist.listActive(todayKst(clock));
    const scan = repos.scans.insertRunning(trigger, now);
    // 외부 목록은 스캔이 시작될 때의 것으로 대조한다(동기화가 도중에 바꿔도 이 스캔은 같은 목록을 본다).
    const feedIndex = feed?.getIndex() ?? null;
    const feedContext = feedIndex ? { index: feedIndex, blocked: repos.blacklist.allKeys() } : null;
    // lock 은 메일 발송까지 끝난 뒤 finally 에서 푼다.
    const done = execute(scan, org, github, snapshot, feedContext).finally(() => {
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
    listRepos(id, query) {
      if (!repos.scans.get(id)) throw new AppError("NOT_FOUND", "스캔을 찾을 수 없습니다");
      return repos.scanRepos.list(id, parseInput(scanReposQuerySchema, query));
    },
  };
}
