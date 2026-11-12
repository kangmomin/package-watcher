import { asString, asTable, baseName, fail, isPlainObject, readJson, readXml } from "./common.ts";
import type { DeclaredDependency, EcosystemSupport, LockedPackage } from "./types.ts";

type Obj = Record<string, unknown>;

/** 문서 안의 모든 요소 중 이름이 `tags` 에 드는 것을 모은다 (ItemGroup 의 깊이와 개수에 상관없이). */
function collectElements(node: unknown, tags: ReadonlySet<string>, out: Obj[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectElements(item, tags, out);
    return;
  }
  if (!isPlainObject(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (tags.has(key)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        // 자식 없는 요소(<X Include="a" />)는 속성 표이고, 속성이 없으면 문자열이다.
        if (isPlainObject(item)) out.push(item);
      }
    } else {
      collectElements(value, tags, out);
    }
  }
}

/** Include 또는 Update 의 이름과, Version 속성 · VersionOverride · 자식 <Version> 순으로 찾은 버전 */
function toDeclared(element: Obj): DeclaredDependency | null {
  const name = asString(element["@_Include"]) ?? asString(element["@_Update"]);
  if (name === null || name.trim() === "") return null;
  const version =
    asString(element["@_Version"]) ?? asString(element["@_VersionOverride"]) ?? asString(element.Version) ?? "";
  return { name: name.trim(), spec: version.trim(), dependencyType: "direct" };
}

function readProject(content: string, file: string, tags: string[]): DeclaredDependency[] {
  const doc = readXml(content, file);
  if (!("Project" in doc)) fail(file, "Project 요소가 없습니다");
  const elements: Obj[] = [];
  collectElements(doc.Project, new Set(tags), elements);
  return elements.flatMap((element) => toDeclared(element) ?? []);
}

/** *.csproj 의 PackageReference. 버전이 없는 참조(중앙 관리)는 spec "" 로 낸다. */
export function parseCsproj(content: string, file = "*.csproj"): DeclaredDependency[] {
  return readProject(content, file, ["PackageReference"]);
}

/** Directory.Packages.props 의 PackageVersion 과 GlobalPackageReference */
export function parseDirectoryPackagesProps(
  content: string,
  file = "Directory.Packages.props",
): DeclaredDependency[] {
  return readProject(content, file, ["PackageVersion", "GlobalPackageReference"]);
}

export function parsePackagesConfig(content: string, file = "packages.config"): DeclaredDependency[] {
  const doc = readXml(content, file);
  if (!("packages" in doc)) fail(file, "packages 요소가 없습니다");
  const elements: Obj[] = [];
  collectElements(doc.packages, new Set(["package"]), elements);
  return elements.flatMap((element) => {
    const id = asString(element["@_id"]);
    if (id === null || id.trim() === "") return [];
    return [{ name: id.trim(), spec: (asString(element["@_version"]) ?? "").trim(), dependencyType: "direct" as const }];
  });
}

/** packages.lock.json: framework 마다 resolved 를 가진 패키지. type 으로 직접 여부를 안다. */
export function parsePackagesLockJson(content: string, file = "packages.lock.json"): LockedPackage[] {
  const data = readJson(content, file);
  const frameworks = asTable(data.dependencies);
  if (!frameworks) return fail(file, "dependencies 가 없습니다");
  const found = new Map<string, LockedPackage>();
  for (const packages of Object.values(frameworks)) {
    for (const [name, value] of Object.entries(asTable(packages) ?? {})) {
      const info = asTable(value);
      const version = asString(info?.resolved);
      // Project 참조는 resolved 가 없다.
      if (!info || version === null) continue;
      const direct = info.type === "Direct";
      const key = `${name}\u0000${version}`;
      const existing = found.get(key);
      found.set(key, { name, version, direct: direct || existing?.direct === true });
    }
  }
  return [...found.values()];
}

export const nugetSupport: EcosystemSupport = {
  ecosystem: "nuget",
  roleOf(path) {
    const name = baseName(path);
    if (name.endsWith(".csproj") || name === "packages.config" || name === "Directory.Packages.props") {
      return "manifest";
    }
    return name === "packages.lock.json" ? "lock" : null;
  },
  parseManifest(path, content) {
    const name = baseName(path);
    if (name === "packages.config") return parsePackagesConfig(content, path);
    if (name === "Directory.Packages.props") return parseDirectoryPackagesProps(content, path);
    return parseCsproj(content, path);
  },
  parseLock: (path, content) => parsePackagesLockJson(content, path),
};
