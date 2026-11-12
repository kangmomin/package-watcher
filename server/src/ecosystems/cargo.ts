import { asString, asTable, baseName, fail, isPlainObject, readToml } from "./common.ts";
import type { DeclaredDependency, EcosystemSupport, LockedPackage } from "./types.ts";

const DEPENDENCY_TABLES = ["dependencies", "dev-dependencies", "build-dependencies"] as const;

function fromTable(table: Record<string, unknown> | null, deps: DeclaredDependency[]): void {
  for (const [alias, value] of Object.entries(table ?? {})) {
    const spec = asString(value) ?? asString(asTable(value)?.version);
    // path·git 만 있는 것과 workspace = true 는 버전이 없어 건너뛴다 (workspace 의 버전은 workspace.dependencies 가 가진다).
    if (spec === null) continue;
    // package = "실제이름" 이면 alias 가 아니라 그 이름이 crate 이다.
    const name = asString(asTable(value)?.package) ?? alias;
    deps.push({ name, spec: spec.trim(), dependencyType: "direct" });
  }
}

export function parseCargoToml(content: string, file = "Cargo.toml"): DeclaredDependency[] {
  const data = readToml(content, file);
  const deps: DeclaredDependency[] = [];
  for (const key of DEPENDENCY_TABLES) fromTable(asTable(data[key]), deps);
  for (const target of Object.values(asTable(data.target) ?? {})) {
    for (const key of DEPENDENCY_TABLES) fromTable(asTable(asTable(target)?.[key]), deps);
  }
  fromTable(asTable(asTable(data.workspace)?.dependencies), deps);
  return deps;
}

/** registry·git 에서 온 패키지만. source 가 없는 것은 워크스페이스 멤버(자기 코드)다. */
export function parseCargoLock(content: string, file = "Cargo.lock"): LockedPackage[] {
  const data = readToml(content, file);
  if (!Array.isArray(data.package) && !("version" in data) && !("metadata" in data)) {
    fail(file, "Cargo.lock 형식이 아닙니다");
  }
  const result: LockedPackage[] = [];
  for (const item of Array.isArray(data.package) ? data.package : []) {
    if (!isPlainObject(item) || item.source === undefined) continue;
    if (typeof item.name === "string" && typeof item.version === "string") {
      result.push({ name: item.name, version: item.version });
    }
  }
  return result;
}

export const cargoSupport: EcosystemSupport = {
  ecosystem: "cargo",
  roleOf(path) {
    const name = baseName(path);
    if (name === "Cargo.toml") return "manifest";
    return name === "Cargo.lock" ? "lock" : null;
  },
  parseManifest: (path, content) => parseCargoToml(content, path),
  parseLock: (path, content) => parseCargoLock(content, path),
};
