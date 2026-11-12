import type { Ecosystem } from "@pw/shared";
import { cargoSupport } from "./cargo.ts";
import { goSupport } from "./go.ts";
import { mavenSupport } from "./maven.ts";
import { nugetSupport } from "./nuget.ts";
import { pubSupport } from "./pub.ts";
import { pypiSupport } from "./pypi.ts";
import type { EcosystemSupport, FileRole } from "./types.ts";

export type { DeclaredDependency, EcosystemSupport, FileRole, LockedPackage } from "./types.ts";

export type FileEcosystem = Exclude<Ecosystem, "npm">;

/** npm 은 lockfiles/ 와 scanService 가 그대로 처리한다. */
export const ECOSYSTEM_SUPPORT: Record<FileEcosystem, EcosystemSupport> = {
  go: goSupport,
  pypi: pypiSupport,
  nuget: nugetSupport,
  cargo: cargoSupport,
  pub: pubSupport,
  maven: mavenSupport,
};

const SUPPORTS = Object.values(ECOSYSTEM_SUPPORT);

/** 저장소에 복사해 넣은 외부 코드나 도구가 만든 폴더. 그 안의 선언 파일은 이 repo 의 의존성이 아니다. */
const EXCLUDED_DIRS = new Set([
  "node_modules",
  "vendor",
  ".venv",
  "venv",
  "site-packages",
  ".dart_tool",
  "Pods",
]);

/** 경로의 폴더 중 제외 폴더가 있는가 (파일 이름은 보지 않는다). */
export function isExcludedPath(path: string): boolean {
  return path.split("/").slice(0, -1).some((part) => EXCLUDED_DIRS.has(part));
}

/** 경로가 npm 을 뺀 종류의 선언 파일이나 lock 파일이면 그 종류와 역할. 아니면 null. */
export function classifyFile(path: string): { ecosystem: FileEcosystem; role: FileRole } | null {
  for (const support of SUPPORTS) {
    const role = support.roleOf(path);
    if (role) return { ecosystem: support.ecosystem, role };
  }
  return null;
}
