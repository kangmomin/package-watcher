import { ECOSYSTEM_RULES, type BlacklistEntry, type DependencyType } from "@pw/shared";
import { detectEcosystem } from "../ecosystems/detect.ts";
import type { DeclaredDependency } from "../ecosystems/types.ts";
import type { GitHubClient, RepoInfo, TreeEntry } from "../github/client.ts";
import { errorMessage } from "../lockfiles/common.ts";
import type { Logger } from "../logger.ts";
import { matchExact, type EntryIndex } from "../matcher.ts";
import {
  extractSource,
  sourceKindOf,
  type ActionRef,
  type CommandPackage,
  type ImageRef,
  type SourceFacts,
  type SourceKind,
} from "../sources/index.ts";
import { cleanVersion, mapWithConcurrency, printable } from "./common.ts";
import { policyNeedsSourceKind } from "./scanPolicy.ts";

/** repo 1개 안의 파일 동시 조회 수 */
const FILE_CONCURRENCY = 4;
/** 이보다 큰 보조 파일은 추출하지 않는다 (문자 수) */
const MAX_SOURCE_LENGTH = 1_048_576;
/** 파일 1개에서 검출에 쓰는 명령 수의 상한 */
const MAX_COMMANDS_PER_FILE = 5000;
/** 파일 1개에서 검출에 쓰는 action·이미지 수의 상한(각각) */
const MAX_REFS_PER_FILE = 5000;
export interface SourceFile extends TreeEntry {
  kind: SourceKind;
}

export interface SourceMatch {
  repo: string;
  filePath: string;
  packageName: string;
  version: string;
  dependencyType: DependencyType;
  blacklistEntryId: number;
}

/** 트리의 파일이 보조 파일이면 그 종류. 분류 판정은 sources/ 가 한다. */
export const sourceFileOf = (entry: TreeEntry): SourceFile | null => {
  const kind = sourceKindOf(entry.path);
  return kind ? { ...entry, kind } : null;
};

/**
 * 파일 종류마다 그 파일에서 나오는 결과의 종류(명령은 npm·pypi, action, 이미지)의 활성 항목이 있을 때만 받는다.
 * content(문자열 찾기)는 받은 모든 파일의 내용을 보므로 어느 종류든 받는다.
 */
const KIND_ECOSYSTEMS: Record<SourceKind, readonly string[]> = {
  workflow: ["npm", "pypi", "actions", "docker", "content"],
  action: ["npm", "pypi", "actions", "docker", "content"],
  dockerfile: ["npm", "pypi", "docker", "content"],
  compose: ["docker", "content"],
  mcp: ["npm", "pypi", "content"],
};

/**
 * 이 종류의 보조 파일을 받아야 하는가 (GitHub 요청을 늘리지 않는다).
 * 활성 policy 검사(`activePolicyChecks`)가 필요로 하는 종류도 받는다. 활성 검사가 없으면 이전과 같다.
 */
export function needsSourceKind(
  kind: SourceKind,
  activeEcosystems: ReadonlySet<string>,
  activePolicyChecks: ReadonlySet<string> = NO_CHECKS,
): boolean {
  return (
    KIND_ECOSYSTEMS[kind].some((ecosystem) => activeEcosystems.has(ecosystem)) ||
    policyNeedsSourceKind(kind, activePolicyChecks)
  );
}

const NO_CHECKS: ReadonlySet<string> = new Set();

/** 보조 파일을 하나라도 받아야 하는가 */
export function needsSources(
  activeEcosystems: ReadonlySet<string>,
  activePolicyChecks: ReadonlySet<string> = NO_CHECKS,
): boolean {
  return (Object.keys(KIND_ECOSYSTEMS) as SourceKind[]).some((kind) =>
    needsSourceKind(kind, activeEcosystems, activePolicyChecks),
  );
}

/** 검출에 남기는 버전: 정확한 버전이거나 원문의 버전 부분(`latest`, `^1.0` 등), 없으면 "" */
function npmVersionOf(pkg: CommandPackage): string {
  if (pkg.version !== "") return pkg.version;
  const at = pkg.raw.lastIndexOf("@");
  return at > 0 ? pkg.raw.slice(at + 1) : "";
}

function detectCommands(
  repo: string,
  path: string,
  commands: CommandPackage[],
  entryIndex: EntryIndex<BlacklistEntry>,
): SourceMatch[] {
  const matches: SourceMatch[] = [];
  const seen = new Set<string>();
  // dedupe 키의 버전은 정확한 버전 또는 "" 라서 `evil`, `evil@latest` 는 1건으로 합쳐진다.
  const add = (found: Omit<SourceMatch, "repo">, keyVersion: string): void => {
    const key = [found.packageName, keyVersion, found.blacklistEntryId].join("\u0000");
    if (seen.has(key)) return;
    seen.add(key);
    matches.push({ repo, ...found, version: cleanVersion(found.version) });
  };

  const pypiDeps: DeclaredDependency[] = [];
  for (const pkg of commands) {
    if (pkg.ecosystem === "pypi") {
      pypiDeps.push({
        name: pkg.name,
        spec: pkg.version === "" ? "" : `==${pkg.version}`,
        dependencyType: "direct",
      });
      continue;
    }
    for (const entry of entryIndex.match("npm", pkg.name)) {
      // 버전 없는 실행은 어느 버전을 받을지 알 수 없으므로 범위가 없는 항목에만 일치한다.
      if (entry.versionRange !== null && (pkg.version === "" || !matchExact(pkg.version, entry.versionRange))) {
        continue;
      }
      add(
        {
          filePath: path,
          packageName: pkg.name,
          version: npmVersionOf(pkg),
          dependencyType: "direct",
          blacklistEntryId: entry.id,
        },
        pkg.version,
      );
    }
  }
  if (pypiDeps.length > 0) {
    for (const found of detectEcosystem("pypi", [{ path, deps: pypiDeps }], [], entryIndex)) add(found, found.version);
  }
  return matches;
}

function detectActions(
  repo: string,
  path: string,
  actions: ActionRef[],
  entryIndex: EntryIndex<BlacklistEntry>,
): SourceMatch[] {
  const deps: DeclaredDependency[] = actions.map((action) => ({
    name: action.name,
    spec: action.ref,
    dependencyType: "direct",
  }));
  const seen = new Set<string>();
  const matches: SourceMatch[] = [];
  for (const found of detectEcosystem("actions", [{ path, deps }], [], entryIndex)) {
    const key = [found.packageName, found.version, found.blacklistEntryId].join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({ repo, ...found, version: cleanVersion(found.version) });
  }
  return matches;
}

/** tag 와 digest 를 둘 다 비교한다. 둘 다 일치해도 이미지 1개당 1건(tag 우선). 범위가 없으면 이름만으로 일치한다. */
function detectImages(
  repo: string,
  path: string,
  images: ImageRef[],
  entryIndex: EntryIndex<BlacklistEntry>,
): SourceMatch[] {
  const satisfies = ECOSYSTEM_RULES.docker.satisfies;
  const seen = new Set<string>();
  const matches: SourceMatch[] = [];
  for (const image of images) {
    for (const entry of entryIndex.match("docker", image.name)) {
      let version: string | null;
      if (entry.versionRange === null) version = image.tag || image.digest;
      else if (image.tag !== "" && satisfies(image.tag, entry.versionRange)) version = image.tag;
      else if (image.digest !== "" && satisfies(image.digest, entry.versionRange)) version = image.digest;
      else version = null;
      if (version === null) continue;
      const key = [image.name, version, entry.id].join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        repo,
        filePath: path,
        packageName: image.name,
        version: cleanVersion(version),
        dependencyType: "direct",
        blacklistEntryId: entry.id,
      });
    }
  }
  return matches;
}

/**
 * 보조 파일(workflow, action.yml, Dockerfile, compose, MCP 설정)을 받아 명령의 패키지를 검출한다.
 * 조회 실패는 throw(repo 실패)지만 파싱 실패는 그 파일만 건너뛰고 경고한다 — workflow 의 YAML 오류 1개로
 * 그 repo 의 패키지 검사가 사라지면 안 된다.
 */
export async function scanSources(
  org: string,
  client: GitHubClient,
  repo: RepoInfo,
  entryIndex: EntryIndex<BlacklistEntry>,
  files: SourceFile[],
  logger: Logger,
  activeEcosystems?: ReadonlySet<string>,
  /** 받은 파일의 (경로 → 내용)을 담는다 (content 검사용, 같은 파일을 다시 받지 않게) */
  received?: Map<string, string>,
  /** policy 검사용: 해석에 성공한 파일의 사실을 담는다 (크기·형식 때문에 건너뛴 파일은 없다) */
  facts?: SourceFacts[],
): Promise<{ matches: SourceMatch[]; fileCount: number }> {
  // 호출자가 활성 종류를 주면 그 종류에서 쓸 수 있는 파일만 받는다.
  const fetchable = activeEcosystems ? files.filter((file) => needsSourceKind(file.kind, activeEcosystems)) : files;
  const contents = await mapWithConcurrency(fetchable, FILE_CONCURRENCY, (file) =>
    client.getFile(org, repo.name, file.sha),
  );
  const matches: SourceMatch[] = [];
  fetchable.forEach((file, index) => {
    const where = printable(`${org}/${repo.name}/${file.path}`);
    const content = contents[index] ?? "";
    received?.set(file.path, content);
    if (content.length > MAX_SOURCE_LENGTH) {
      logger.warn(`보조 파일이 너무 커서 건너뜁니다: ${where}`);
      return;
    }
    try {
      const extracted = extractSource(file.kind, file.path, content);
      const limit = <T>(items: T[], max: number, label: string): T[] => {
        if (items.length <= max) return items;
        logger.warn(`보조 파일의 ${label}이(가) ${max}개를 넘어 앞의 것만 검사합니다: ${where}`);
        return items.slice(0, max);
      };
      const commands = limit(extracted.commands, MAX_COMMANDS_PER_FILE, "명령");
      const actions = limit(extracted.actions, MAX_REFS_PER_FILE, "action");
      const images = limit(extracted.images, MAX_REFS_PER_FILE, "이미지");
      facts?.push({ ...extracted, commands, actions, images });
      for (const match of detectCommands(repo.name, file.path, commands, entryIndex)) matches.push(match);
      for (const match of detectActions(repo.name, file.path, actions, entryIndex)) matches.push(match);
      for (const match of detectImages(repo.name, file.path, images, entryIndex)) matches.push(match);
    } catch (error) {
      logger.warn(`보조 파일을 해석하지 못해 건너뜁니다: ${where}: ${errorMessage(error)}`);
    }
  });
  return { matches, fileCount: fetchable.length };
}
