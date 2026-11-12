import { asString, asTable, baseName, fail, isPlainObject, readText, readToml } from "./common.ts";
import type { DeclaredDependency, EcosystemSupport, LockedPackage } from "./types.ts";

const REQUIREMENT = /^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\s*(?:\[[^\]]*\])?\s*(.*)$/;

/** PEP 508 한 줄 → 이름과 버전 spec. 환경 표지(; …)와 --hash 같은 옵션은 버린다. URL·경로 줄은 null. */
function parseRequirement(line: string): { name: string; spec: string } | null {
  let text = line.split(";")[0] as string;
  const option = text.search(/\s--?[A-Za-z]/);
  if (option !== -1) text = text.slice(0, option);
  text = text.trim();
  if (text === "" || text.startsWith("-") || /^(\.|\/|~)/.test(text) || /^[a-z+]+:\/\//i.test(text)) {
    return null;
  }
  const match = REQUIREMENT.exec(text);
  if (!match) return null;
  // 옛 형식의 괄호(pkg (>=1.0))는 벗긴다.
  const spec = (match[2] as string).trim().replace(/^\((.*)\)$/, "$1");
  return { name: match[1] as string, spec };
}

const direct = (name: string, spec: string): DeclaredDependency => ({ name, spec, dependencyType: "direct" });

/**
 * requirements*.txt. -r·-e·옵션 줄과 URL·경로 줄은 읽지 않는다.
 * 형식 표지가 없는 평문이라 빈 파일도 의존성이 없는 정상 파일로 본다.
 */
export function parseRequirements(content: string, file = "requirements.txt"): DeclaredDependency[] {
  const deps: DeclaredDependency[] = [];
  // 줄 끝의 \ 는 다음 줄과 한 줄이다 (--hash 를 여러 줄로 적는다).
  const joined = readText(content, file).replace(/\\\n/g, " ");
  for (const raw of joined.split("\n")) {
    const line = raw.replace(/(^|\s)#.*$/, "").trim();
    if (line === "") continue;
    const parsed = parseRequirement(line);
    if (parsed) deps.push(direct(parsed.name, parsed.spec));
  }
  return deps;
}

/** poetry 의 버전: 연산자 없는 값(1.2.3)은 정확한 버전이다. */
function poetrySpec(value: string): string {
  return /^\d[0-9A-Za-z.!+_-]*$/.test(value) ? `==${value}` : value;
}

function fromPoetryTable(table: Record<string, unknown>, deps: DeclaredDependency[]): void {
  for (const [name, value] of Object.entries(table)) {
    if (name.toLowerCase() === "python") continue;
    const candidates = Array.isArray(value) ? value : [value];
    for (const candidate of candidates) {
      const spec = asString(candidate) ?? asString(asTable(candidate)?.version);
      // path·git 만 있는 의존성은 버전이 없어 건너뛴다.
      if (spec !== null) deps.push(direct(name, poetrySpec(spec.trim())));
    }
  }
}

function fromPep508List(list: unknown, deps: DeclaredDependency[]): void {
  if (!Array.isArray(list)) return;
  for (const item of list) {
    // { include-group = "dev" } 같은 표는 다른 그룹을 가리킬 뿐이다.
    const parsed = typeof item === "string" ? parseRequirement(item) : null;
    if (parsed) deps.push(direct(parsed.name, parsed.spec));
  }
}

/** pyproject.toml: PEP 621, PEP 735(dependency-groups), poetry. */
export function parsePyproject(content: string, file = "pyproject.toml"): DeclaredDependency[] {
  // 빈 pyproject.toml 은 정상적인 사용이다(도구 설정만 쓰거나 아직 비어 있는 프로젝트).
  const data = readToml(content, file, { allowEmpty: true });
  const deps: DeclaredDependency[] = [];

  const project = asTable(data.project);
  fromPep508List(project?.dependencies, deps);
  for (const group of Object.values(asTable(project?.["optional-dependencies"]) ?? {})) {
    fromPep508List(group, deps);
  }
  for (const group of Object.values(asTable(data["dependency-groups"]) ?? {})) {
    fromPep508List(group, deps);
  }

  const poetry = asTable(asTable(data.tool)?.poetry);
  for (const key of ["dependencies", "dev-dependencies"]) {
    const table = asTable(poetry?.[key]);
    if (table) fromPoetryTable(table, deps);
  }
  for (const group of Object.values(asTable(poetry?.group) ?? {})) {
    const table = asTable(asTable(group)?.dependencies);
    if (table) fromPoetryTable(table, deps);
  }
  return deps;
}

/** [[package]] 의 name·version. 프로젝트 자신(virtual·editable 소스)은 뺀다. */
function readPackageTables(data: Record<string, unknown>): LockedPackage[] {
  const packages = Array.isArray(data.package) ? data.package : [];
  const result: LockedPackage[] = [];
  for (const item of packages) {
    if (!isPlainObject(item)) continue;
    const source = asTable(item.source);
    if (source && ("virtual" in source || "editable" in source)) continue;
    if (typeof item.name === "string" && typeof item.version === "string") {
      result.push({ name: item.name, version: item.version });
    }
  }
  return result;
}

export function parseUvLock(content: string, file = "uv.lock"): LockedPackage[] {
  const data = readToml(content, file);
  if (!Array.isArray(data.package) && !("version" in data)) fail(file, "uv.lock 형식이 아닙니다");
  return readPackageTables(data);
}

export function parsePoetryLock(content: string, file = "poetry.lock"): LockedPackage[] {
  const data = readToml(content, file);
  if (!Array.isArray(data.package) && !("metadata" in data)) fail(file, "poetry.lock 형식이 아닙니다");
  return readPackageTables(data);
}

export const pypiSupport: EcosystemSupport = {
  ecosystem: "pypi",
  roleOf(path) {
    const name = baseName(path);
    if (name === "pyproject.toml" || /^requirements.*\.txt$/.test(name)) return "manifest";
    return name === "uv.lock" || name === "poetry.lock" ? "lock" : null;
  },
  parseManifest: (path, content) =>
    baseName(path) === "pyproject.toml" ? parsePyproject(content, path) : parseRequirements(content, path),
  parseLock: (path, content) =>
    baseName(path) === "uv.lock" ? parseUvLock(content, path) : parsePoetryLock(content, path),
};
