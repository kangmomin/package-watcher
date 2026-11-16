import { asString, asTable, baseName, fail, isPlainObject, readJson } from "./common.ts";
import { MAX_ITEMS } from "./rubyArgs.ts";
import type { DeclaredDependency, EcosystemSupport, LockedPackage } from "./types.ts";

/** composer.lock: `packages` 와 `packages-dev`. `dev-main` 같은 브랜치 버전도 그대로 담는다 (v 접두와 비교는 shared 의 규칙이 처리한다). */
export function parseComposerLock(content: string, file = "composer.lock"): LockedPackage[] {
  const data = readJson(content, file);
  if (!Array.isArray(data.packages) && !Array.isArray(data["packages-dev"])) fail(file, "composer.lock 형식이 아닙니다");
  const result: LockedPackage[] = [];
  for (const key of ["packages", "packages-dev"] as const) {
    const list = data[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!isPlainObject(item) || result.length >= MAX_ITEMS) continue;
      const name = asString(item.name);
      const version = asString(item.version);
      if (name === null || version === null) continue;
      result.push({ name, version });
    }
  }
  return result;
}

/** composer.json: `require`·`require-dev`. `/` 가 없는 이름(php, ext-json, lib-*)은 플랫폼이라 건너뛴다. */
export function parseComposerJson(content: string, file = "composer.json"): DeclaredDependency[] {
  const data = readJson(content, file);
  const deps: DeclaredDependency[] = [];
  for (const key of ["require", "require-dev"] as const) {
    for (const [name, value] of Object.entries(asTable(data[key]) ?? {})) {
      if (!name.includes("/") || typeof value !== "string" || deps.length >= MAX_ITEMS) continue;
      deps.push({ name, spec: value.trim(), dependencyType: "direct" });
    }
  }
  return deps;
}

export const composerSupport: EcosystemSupport = {
  ecosystem: "composer",
  roleOf(path) {
    const name = baseName(path);
    if (name === "composer.json") return "manifest";
    return name === "composer.lock" ? "lock" : null;
  },
  parseManifest: (path, content) => parseComposerJson(content, path),
  parseLock: (path, content) => parseComposerLock(content, path),
};
