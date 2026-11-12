import { ECOSYSTEM_RULES, type DependencyType } from "@pw/shared";
import type { EntryIndex } from "../matcher.ts";
import { dirOf } from "../workspaces.ts";
import type { FileEcosystem } from "./index.ts";
import type { DeclaredDependency, LockedPackage } from "./types.ts";

export interface ParsedManifest {
  path: string;
  deps: DeclaredDependency[];
}

export interface ParsedLock {
  path: string;
  packages: LockedPackage[];
}

export interface Detection {
  filePath: string;
  packageName: string;
  version: string;
  dependencyType: DependencyType;
  blacklistEntryId: number;
}

interface IndexedEntry {
  id: number;
  name: string;
  ecosystem: string;
  versionRange: string | null;
}

/**
 * npm 을 뺀 종류의 검출.
 *
 * lock 의 담당 범위(D-23): 선언 파일에서 같은 폴더부터 위로 올라가며 처음 만나는 같은 종류의 lock 이 담당한다.
 * 같은 폴더에 lock 이 여럿(uv.lock 과 poetry.lock)이면 모두 담당한다. 그래서 같은 폴더와
 * lock 이 없는 하위 폴더가 담당 범위이고, 하위 폴더에 자기 lock 이 있으면 그 lock 이 담당한다.
 */
export function detectEcosystem(
  ecosystem: FileEcosystem,
  manifests: ParsedManifest[],
  locks: ParsedLock[],
  index: EntryIndex<IndexedEntry>,
): Detection[] {
  const rule = ECOSYSTEM_RULES[ecosystem];
  const normalize = rule.normalizeName;
  const detections: Detection[] = [];

  const locksByDir = new Map<string, ParsedLock[]>();
  for (const lock of locks) {
    const dir = dirOf(lock.path);
    locksByDir.set(dir, [...(locksByDir.get(dir) ?? []), lock]);
  }
  const ownersOf = (manifestPath: string): ParsedLock[] => {
    let dir = dirOf(manifestPath);
    for (;;) {
      const found = locksByDir.get(dir);
      if (found) return found;
      if (dir === "") return [];
      dir = dirOf(dir);
    }
  };

  const ownersByManifest = new Map(manifests.map((manifest) => [manifest.path, ownersOf(manifest.path)]));
  const directNamesByLock = new Map<string, Set<string>>();
  for (const manifest of manifests) {
    for (const owner of ownersByManifest.get(manifest.path) ?? []) {
      const names = directNamesByLock.get(owner.path) ?? new Set<string>();
      for (const dep of manifest.deps) names.add(normalize(dep.name));
      directNamesByLock.set(owner.path, names);
    }
  }

  // lock 의 정확한 버전으로 검출한다.
  for (const lock of locks) {
    const directNames = directNamesByLock.get(lock.path) ?? new Set<string>();
    for (const pkg of lock.packages) {
      for (const entry of index.match(ecosystem, pkg.name)) {
        if (entry.versionRange !== null && !rule.satisfies(pkg.version, entry.versionRange)) continue;
        const direct = pkg.direct ?? directNames.has(normalize(pkg.name));
        detections.push({
          filePath: lock.path,
          packageName: pkg.name,
          version: pkg.version,
          dependencyType: direct ? "direct" : "transitive",
          blacklistEntryId: entry.id,
        });
      }
    }
  }

  // 담당 lock 이 없거나 담당 lock 모두에 없는 선언만 선언 파일에서 검출한다.
  const lockedNames = new Map(
    locks.map((lock) => [lock.path, new Set(lock.packages.map((pkg) => normalize(pkg.name)))]),
  );
  for (const manifest of manifests) {
    const owners = ownersByManifest.get(manifest.path) ?? [];
    for (const dep of manifest.deps) {
      const name = normalize(dep.name);
      if (owners.some((owner) => lockedNames.get(owner.path)?.has(name))) continue;
      // 고정 버전은 정확한 버전으로 비교하고, 범위 spec 은 범위가 null 인 항목에만 일치한다.
      const exact = rule.exactVersionOf(dep.spec);
      for (const entry of index.match(ecosystem, dep.name)) {
        if (entry.versionRange !== null) {
          if (exact === null || !rule.satisfies(exact, entry.versionRange)) continue;
        }
        detections.push({
          filePath: manifest.path,
          packageName: dep.name,
          version: exact ?? dep.spec,
          dependencyType: dep.dependencyType,
          blacklistEntryId: entry.id,
        });
      }
    }
  }
  return detections;
}
