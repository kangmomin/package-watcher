import { parseBunLock } from "./bun.ts";
import { parseNpmLock } from "./npm.ts";
import { parsePnpmLock } from "./pnpm.ts";
import { parseYarnLock } from "./yarn.ts";

export type LockfileKind = "npm" | "yarn" | "pnpm" | "bun";

/** 파서 출력. `name` 은 실제 패키지 이름(별칭 분해). */
export interface LockPackage {
  name: string;
  version: string;
}

const KIND_BY_FILE_NAME = new Map<string, LockfileKind>([
  ["package-lock.json", "npm"],
  ["yarn.lock", "yarn"],
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lock", "bun"],
]);

const PARSERS: Record<LockfileKind, (content: string) => LockPackage[]> = {
  npm: parseNpmLock,
  yarn: parseYarnLock,
  pnpm: parsePnpmLock,
  bun: parseBunLock,
};

/**
 * 파일 이름으로 lockfile 종류를 정한다: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`.
 * 그 외(`bun.lockb` 포함)는 null.
 */
export function lockfileKindOf(path: string): LockfileKind | null {
  return KIND_BY_FILE_NAME.get(path.slice(path.lastIndexOf("/") + 1)) ?? null;
}

/** 종류별 파서로 보낸다. 파싱 실패, 빈 입력, 형식 표지 없는 입력은 예외. */
export function parseLockfile(kind: LockfileKind, content: string): LockPackage[] {
  return PARSERS[kind](content);
}
