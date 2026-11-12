import type { LockfileKind } from "./lockfiles/index.ts";
import { notImplemented } from "./notImplemented.ts";

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
  return notImplemented(kind, sources);
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
  return notImplemented(packageJsonPaths, lockfiles);
}
