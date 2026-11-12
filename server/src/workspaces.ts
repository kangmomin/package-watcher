import picomatch from "picomatch";
import { parse as parseYaml } from "yaml";
import { isPlainObject } from "./lockfiles/common.ts";
import type { LockfileKind } from "./lockfiles/index.ts";

/**
 * lockfile 디렉터리의 workspace glob.
 * - `pnpm`: 그 디렉터리의 `pnpm-workspace.yaml` 의 `packages` 만 읽는다.
 * - 그 외 3종: 그 디렉터리의 `package.json` 의 `workspaces`(배열 또는 `.packages`)만 읽는다.
 * 파일이 없거나 비어 있거나 형식이 맞지 않으면 `[]` (예외 없음).
 */
export function readWorkspaceGlobs(
  kind: LockfileKind,
  sources: {
    /** 그 디렉터리의 `package.json` 을 JSON.parse 한 값 */
    packageJson?: unknown;
    /** 그 디렉터리의 `pnpm-workspace.yaml` 원문 */
    pnpmWorkspaceYaml?: string | null;
  },
): string[] {
  if (kind === "pnpm") {
    if (!sources.pnpmWorkspaceYaml) return [];
    let data: unknown;
    try {
      data = parseYaml(sources.pnpmWorkspaceYaml);
    } catch {
      return [];
    }
    return isPlainObject(data) ? stringArray(data.packages) : [];
  }
  if (!isPlainObject(sources.packageJson)) return [];
  const workspaces = sources.packageJson.workspaces;
  if (Array.isArray(workspaces)) return stringArray(workspaces);
  if (isPlainObject(workspaces)) return stringArray(workspaces.packages);
  return [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export interface LockfileInput {
  /** repo 루트 기준 경로 (예: `apps/web/yarn.lock`) */
  path: string;
  /** lockfile 디렉터리 기준 상대 glob. `!` 부정 패턴 포함 */
  globs: string[];
}

export interface LockfileAssignment {
  /** lockfile 경로 → 담당 `package.json` 경로 목록 */
  byLockfile: Map<string, string[]>;
  /** `package.json` 경로 → 담당 lockfile 경로 목록 (없으면 빈 배열) */
  byPackageJson: Map<string, string[]>;
}

/** repo 루트 기준 디렉터리. 루트는 "" */
export function dirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

interface LockfileScope {
  path: string;
  dir: string;
  matches: (relativeDir: string) => boolean;
}

/**
 * lockfile 귀속 (A-1).
 * - 담당 = 같은 디렉터리의 `package.json` + 그 디렉터리의 workspace glob(디렉터리에 매칭, `./` 접두와 끝 `/` 정규화)에 맞는 것.
 * - 여러 디렉터리의 lockfile 에 맞으면 같은 디렉터리를 우선하고, 그다음 가장 가까운 디렉터리 1곳에만 귀속한다.
 * - 같은 디렉터리에 lockfile 이 2종 이상이면 모두 담당 lockfile 이다.
 */
export function assignLockfiles(
  packageJsonPaths: string[],
  lockfiles: LockfileInput[],
): LockfileAssignment {
  const scopes = lockfiles.map(toScope);
  const byLockfile = new Map<string, string[]>(lockfiles.map((lockfile) => [lockfile.path, []]));
  const byPackageJson = new Map<string, string[]>();

  for (const packageJson of packageJsonPaths) {
    const dir = dirOf(packageJson);
    const sameDir = scopes.filter((scope) => scope.dir === dir);
    let owners = sameDir;
    if (owners.length === 0) {
      const declared = scopes.filter((scope) => {
        const relative = relativeDir(scope.dir, dir);
        return relative !== null && scope.matches(relative);
      });
      // 가장 가까운(가장 깊은) 디렉터리 1곳에만 귀속한다.
      const closest = Math.max(-1, ...declared.map((scope) => depthOf(scope.dir)));
      owners = declared.filter((scope) => depthOf(scope.dir) === closest);
    }
    byPackageJson.set(
      packageJson,
      owners.map((scope) => scope.path),
    );
    for (const scope of owners) byLockfile.get(scope.path)?.push(packageJson);
  }
  return { byLockfile, byPackageJson };
}

function toScope(lockfile: LockfileInput): LockfileScope {
  const positive: string[] = [];
  const negative: string[] = [];
  for (const raw of lockfile.globs) {
    const negated = raw.trim().startsWith("!");
    const pattern = normalizeGlob(negated ? raw.trim().slice(1) : raw);
    if (pattern === "") continue;
    (negated ? negative : positive).push(pattern);
  }
  const include = positive.length > 0 ? picomatch(positive) : () => false;
  const exclude = negative.length > 0 ? picomatch(negative) : () => false;
  return {
    path: lockfile.path,
    dir: dirOf(lockfile.path),
    matches: (relative) => include(relative) && !exclude(relative),
  };
}

function normalizeGlob(glob: string): string {
  let pattern = glob.trim();
  while (pattern.startsWith("./")) pattern = pattern.slice(2);
  while (pattern.endsWith("/")) pattern = pattern.slice(0, -1);
  return pattern === "." ? "" : pattern;
}

/** `base` 아래에 있는 `dir` 의 상대 경로. 아래가 아니거나 같은 디렉터리면 null */
function relativeDir(base: string, dir: string): string | null {
  if (base === "") return dir === "" ? null : dir;
  return dir.startsWith(`${base}/`) ? dir.slice(base.length + 1) : null;
}

function depthOf(dir: string): number {
  return dir === "" ? 0 : dir.split("/").length;
}
