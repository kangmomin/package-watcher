import { asString, asTable, baseName, fail, readYaml, scalarText } from "./common.ts";
import type { DeclaredDependency, EcosystemSupport, LockedPackage } from "./types.ts";

const SECTIONS = ["dependencies", "dev_dependencies", "dependency_overrides"] as const;

export function parsePubspecYaml(content: string, file = "pubspec.yaml"): DeclaredDependency[] {
  const data = readYaml(content, file);
  const deps: DeclaredDependency[] = [];
  for (const section of SECTIONS) {
    for (const [name, value] of Object.entries(asTable(data[section]) ?? {})) {
      let spec: string | null;
      if (value === null || value === undefined) {
        spec = "any"; // `foo:` 처럼 제약을 적지 않으면 any
      } else if (asTable(value)) {
        // sdk·path·git 은 pub.dev 의 버전이 아니다. hosted 는 version 을 가진다.
        spec = scalarText(asTable(value)?.version);
      } else {
        spec = scalarText(value);
      }
      if (spec !== null) deps.push({ name, spec: spec.trim(), dependencyType: "direct" });
    }
  }
  return deps;
}

export function parsePubspecLock(content: string, file = "pubspec.lock"): LockedPackage[] {
  const data = readYaml(content, file);
  const packages = asTable(data.packages);
  if (!packages) return fail(file, "packages 가 없습니다");
  const result: LockedPackage[] = [];
  for (const [name, value] of Object.entries(packages)) {
    const info = asTable(value);
    const version = scalarText(info?.version);
    const source = asString(info?.source);
    // sdk(flutter 등)와 path 패키지는 pub.dev 패키지가 아니다.
    if (!info || version === null || source === "sdk" || source === "path") continue;
    result.push({ name, version, direct: (asString(info.dependency) ?? "").startsWith("direct") });
  }
  return result;
}

export const pubSupport: EcosystemSupport = {
  ecosystem: "pub",
  roleOf(path) {
    const name = baseName(path);
    if (name === "pubspec.yaml") return "manifest";
    return name === "pubspec.lock" ? "lock" : null;
  },
  parseManifest: (path, content) => parsePubspecYaml(content, path),
  parseLock: (path, content) => parsePubspecLock(content, path),
};
