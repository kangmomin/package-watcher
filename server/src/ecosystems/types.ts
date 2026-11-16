import type { DependencyType, PackageEcosystem } from "@pw/shared";

/** 선언 파일(go.mod, requirements.txt, Cargo.toml 등)이 적은 의존성. `spec` 은 원문(없으면 ""). */
export interface DeclaredDependency {
  name: string;
  spec: string;
  dependencyType: DependencyType;
}

/** lock 파일이 고정한 패키지. lock 이 직접 여부를 알려 주면 `direct` 에 담는다. */
export interface LockedPackage {
  name: string;
  version: string;
  direct?: boolean;
}

export type FileRole = "manifest" | "lock";

/** npm 을 뺀 종류의 파일 판정과 파서 */
export interface EcosystemSupport {
  ecosystem: Exclude<PackageEcosystem, "npm">;
  /** 경로의 파일 이름으로 판정한다 */
  roleOf(path: string): FileRole | null;
  parseManifest(path: string, content: string): DeclaredDependency[];
  parseLock(path: string, content: string): LockedPackage[];
}
