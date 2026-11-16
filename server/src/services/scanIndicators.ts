import type { BlacklistEntry, DependencyType } from "@pw/shared";
import type { Logger } from "../logger.ts";
import { matchName } from "../matcher.ts";
import { printable } from "./common.ts";

/** repo 1개에서 항목 1개가 만드는 검출의 상한 (넓은 패턴이 repo 를 검출로 채우지 않게 한다) */
export const MAX_INDICATOR_MATCHES = 100;
/** 이보다 큰 파일은 content 검사를 건너뛴다 (문자 수) */
export const MAX_CONTENT_SCAN_LENGTH = 8 * 1024 * 1024;

export interface IndicatorMatch {
  repo: string;
  filePath: string;
  packageName: string;
  version: string;
  dependencyType: DependencyType;
  blacklistEntryId: number;
}

/** 이름이 정확한 항목은 Map, `*` 가 있는 항목은 목록. 일치 판정은 matchName(정규식 없음). */
interface NameIndex {
  exact: Map<string, BlacklistEntry[]>;
  patterns: BlacklistEntry[];
}

function indexByName(entries: BlacklistEntry[], keep: (entry: BlacklistEntry) => boolean = () => true): NameIndex {
  const exact = new Map<string, BlacklistEntry[]>();
  const patterns: BlacklistEntry[] = [];
  for (const entry of entries) {
    if (!keep(entry)) continue;
    if (entry.name.includes("*")) patterns.push(entry);
    else exact.set(entry.name, [...(exact.get(entry.name) ?? []), entry]);
  }
  return { exact, patterns };
}

function indicatorMatch(repo: string, filePath: string, entry: BlacklistEntry): IndicatorMatch {
  return { repo, filePath, packageName: entry.name, version: "", dependencyType: "direct", blacklistEntryId: entry.id };
}

/** 경로 이 개수마다 이벤트 루프에 양보한다 (큰 tree 가 HTTP 서버를 멈추지 않게) */
const YIELD_EVERY_PATHS = 2000;
const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** 패턴에서 `*` 사이의 가장 긴 리터럴 조각. 일치하려면 이 조각이 경로에 있어야 한다(필요조건). */
function longestLiteral(pattern: string): string {
  let best = "";
  for (const part of pattern.split("*")) if (part.length > best.length) best = part;
  return best;
}

/** 항목마다 검출 수를 세어 상한을 넘으면 버리고, 넘은 항목마다 경고를 1줄만 남긴다. */
function createLimiter(logger: Logger, where: string, label: string) {
  const counts = new Map<number, number>();
  return (entry: BlacklistEntry): boolean => {
    const count = (counts.get(entry.id) ?? 0) + 1;
    counts.set(entry.id, count);
    if (count === MAX_INDICATOR_MATCHES + 1) {
      logger.warn(
        printable(`${label} 검출이 ${MAX_INDICATOR_MATCHES}건을 넘어 나머지는 저장하지 않습니다: ${where} (${entry.name})`),
      );
    }
    return count <= MAX_INDICATOR_MATCHES;
  };
}

/** 활성 침해의 흔적 항목(종류별). 스냅샷에서 1번 만들어 repo 마다 쓴다. */
export interface IndicatorRules {
  hasPath: boolean;
  hasContent: boolean;
  hasBranch: boolean;
  /** repo 의 tree 전체의 경로에 일치하는 path 항목 */
  matchPaths(repo: string, where: string, treePaths: Iterable<string>, logger: Logger): Promise<IndicatorMatch[]>;
  /** 받은 파일(경로 → 내용)에서 content 문자열을 대소문자 무시로 찾는다 */
  matchContents(
    repo: string,
    where: string,
    files: ReadonlyMap<string, string>,
    logger: Logger,
  ): Promise<IndicatorMatch[]>;
  matchBranches(repo: string, where: string, branches: string[], logger: Logger): IndicatorMatch[];
}

export function createIndicatorRules(snapshot: BlacklistEntry[]): IndicatorRules {
  const pathEntries = snapshot.filter((entry) => entry.ecosystem === "path");
  const contentEntries = snapshot
    .filter((entry) => entry.ecosystem === "content")
    .map((entry) => ({ entry, needle: entry.name.toLowerCase() }));
  const branchEntries = snapshot.filter((entry) => entry.ecosystem === "branch");

  // path: `/` 가 없는 항목은 파일 이름과도 비교한다.
  const pathFull = indexByName(pathEntries);
  const pathBase = indexByName(pathEntries, (entry) => !entry.name.includes("/"));
  const branchIndex = indexByName(branchEntries);
  const pathPatterns = pathFull.patterns.map((entry) => ({
    entry,
    literal: longestLiteral(entry.name),
    baseToo: !entry.name.includes("/"),
  }));

  return {
    hasPath: pathEntries.length > 0,
    hasContent: contentEntries.length > 0,
    hasBranch: branchEntries.length > 0,

    async matchPaths(repo, where, treePaths, logger) {
      const allow = createLimiter(logger, where, "path");
      const matches: IndicatorMatch[] = [];
      // 정렬한 순서로 검사해야 상한(100건)에서 남는 경로가 입력 순서와 무관하다.
      const sorted = [...treePaths].sort();
      for (const [index, path] of sorted.entries()) {
        if (index > 0 && index % YIELD_EVERY_PATHS === 0) await yieldToLoop();
        const base = path.slice(path.lastIndexOf("/") + 1);
        const found = new Set<BlacklistEntry>(pathFull.exact.get(path));
        if (base !== path) for (const entry of pathBase.exact.get(base) ?? []) found.add(entry);
        for (const { entry, literal, baseToo } of pathPatterns) {
          if (literal !== "" && !path.includes(literal)) continue;
          if (matchName(entry.name, path) || (baseToo && matchName(entry.name, base))) found.add(entry);
        }
        for (const entry of found) if (allow(entry)) matches.push(indicatorMatch(repo, path, entry));
      }
      return matches;
    },

    async matchContents(repo, where, files, logger) {
      const allow = createLimiter(logger, where, "content");
      const matches: IndicatorMatch[] = [];
      // 받은 순서(다운로드 완료 순)가 아니라 경로 순으로 검사해서 상한에서 남는 파일이 항상 같다.
      for (const path of [...files.keys()].sort()) {
        const content = files.get(path) ?? "";
        await yieldToLoop();
        if (content.length > MAX_CONTENT_SCAN_LENGTH) {
          logger.warn(printable(`파일이 너무 커서 content 검사를 건너뜁니다: ${where}/${path}`));
          continue;
        }
        // 소문자 변환은 파일마다 1번만 한다 (항목이 수백 개여도 비용이 늘지 않게).
        const lower = content.toLowerCase();
        for (const { entry, needle } of contentEntries) {
          if (lower.includes(needle) && allow(entry)) matches.push(indicatorMatch(repo, path, entry));
        }
      }
      return matches;
    },

    matchBranches(repo, where, branches, logger) {
      const allow = createLimiter(logger, where, "branch");
      const matches: IndicatorMatch[] = [];
      for (const branch of [...branches].sort()) {
        const found = new Set<BlacklistEntry>(branchIndex.exact.get(branch));
        for (const entry of branchIndex.patterns) if (matchName(entry.name, branch)) found.add(entry);
        for (const entry of found) if (allow(entry)) matches.push(indicatorMatch(repo, `refs/heads/${branch}`, entry));
      }
      return matches;
    },
  };
}
