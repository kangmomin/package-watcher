import { ECOSYSTEM_RULES, type CiEcosystem, type DependencyType } from "@pw/shared";
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
  ecosystem: FileEcosystem | CiEcosystem,
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
      // lock 이 직접 여부를 알려 주지 않는 종류(go.sum)는 선언이 direct 인 이름만 direct 다(go.mod 의 // indirect 제외).
      for (const dep of manifest.deps) {
        if (dep.dependencyType === "direct") names.add(normalize(dep.name));
      }
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
  // 단, 선언의 고정 버전이 담당 lock 의 같은 이름의 어느 버전과도 다르면 선언 파일의 것도 따로 검사한다.
  const lockedVersions = new Map<string, Map<string, Set<string>>>();
  for (const lock of locks) {
    const byName = new Map<string, Set<string>>();
    for (const pkg of lock.packages) {
      const key = normalize(pkg.name);
      byName.set(key, (byName.get(key) ?? new Set<string>()).add(pkg.version.trim()));
    }
    lockedVersions.set(lock.path, byName);
  }
  for (const manifest of manifests) {
    const owners = ownersByManifest.get(manifest.path) ?? [];
    for (const dep of manifest.deps) {
      const name = normalize(dep.name);
      // 고정 버전은 정확한 버전으로 비교하고, 범위 spec 은 범위가 null 인 항목에만 일치한다.
      const exact = rule.exactVersionOf(dep.spec);
      const locked = owners.flatMap((owner) => {
        const versions = lockedVersions.get(owner.path)?.get(name);
        return versions ? [versions] : [];
      });
      if (locked.length > 0 && (exact === null || locked.some((versions) => versions.has(exact.trim())))) {
        continue;
      }
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
