import type { BlacklistEntry, DependencyType } from "@pw/shared";
import { detectEcosystem } from "../ecosystems/detect.ts";
import type { DeclaredDependency } from "../ecosystems/types.ts";
import type { GitHubClient, RepoInfo, TreeEntry } from "../github/client.ts";
import { errorMessage } from "../lockfiles/common.ts";
import type { Logger } from "../logger.ts";
import { matchExact, type EntryIndex } from "../matcher.ts";
import { extractSource, sourceKindOf, type CommandPackage, type SourceKind } from "../sources/index.ts";
import { mapWithConcurrency } from "./common.ts";

/** repo 1개 안의 파일 동시 조회 수 */
const FILE_CONCURRENCY = 4;
/** 이보다 큰 보조 파일은 추출하지 않는다 (문자 수) */
const MAX_SOURCE_LENGTH = 1_048_576;
/** 파일 1개에서 검출에 쓰는 명령 수의 상한 */
const MAX_COMMANDS_PER_FILE = 5000;
/** 검출에 남기는 버전의 최대 길이 */
const MAX_VERSION_LENGTH = 128;

/** 제어 문자를 빼고 128자로 자른다 (원문이 그대로 DB·화면·메일에 간다). */
function cleanVersion(version: string): string {
  let out = "";
  for (const char of version) {
    const code = char.charCodeAt(0);
    if (code >= 0x20 && code !== 0x7f) out += char;
    if (out.length >= MAX_VERSION_LENGTH) break;
  }
  return out;
}

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
 * 보조 파일을 받아야 하는가: 그 파일에서 나오는 종류(명령의 npm·pypi)의 활성 항목이 있을 때만.
 * 이후 묶음이 이미지·내용 검색·설정 검사를 이 조건에 더한다.
 */
export function needsSources(activeEcosystems: ReadonlySet<string>): boolean {
  return activeEcosystems.has("npm") || activeEcosystems.has("pypi");
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

/**
 * 보조 파일(workflow, Dockerfile, MCP 설정)을 받아 명령의 패키지를 검출한다.
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
): Promise<{ matches: SourceMatch[]; fileCount: number }> {
  // compose 는 이미지를 읽는 묶음 전까지 받지 않는다.
  const fetchable = files.filter((file) => file.kind !== "compose");
  const contents = await mapWithConcurrency(fetchable, FILE_CONCURRENCY, (file) =>
    client.getFile(org, repo.name, file.sha),
  );
  const matches: SourceMatch[] = [];
  fetchable.forEach((file, index) => {
    const where = `${org}/${repo.name}/${file.path}`;
    const content = contents[index] ?? "";
    if (content.length > MAX_SOURCE_LENGTH) {
      logger.warn(`보조 파일이 너무 커서 건너뜁니다: ${where}`);
      return;
    }
    try {
      let commands = extractSource(file.kind, file.path, content).commands;
      if (commands.length > MAX_COMMANDS_PER_FILE) {
        logger.warn(`보조 파일의 명령이 ${MAX_COMMANDS_PER_FILE}개를 넘어 앞의 것만 검사합니다: ${where}`);
        commands = commands.slice(0, MAX_COMMANDS_PER_FILE);
      }
      for (const match of detectCommands(repo.name, file.path, commands, entryIndex)) matches.push(match);
    } catch (error) {
      logger.warn(`보조 파일을 해석하지 못해 건너뜁니다: ${where}: ${errorMessage(error)}`);
    }
  });
  return { matches, fileCount: fetchable.length };
}
