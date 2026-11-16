import { asString, asTable, baseName, fail, readText, readToml, readXml, scalarText } from "./common.ts";
import type { DeclaredDependency, EcosystemSupport } from "./types.ts";

const direct = (name: string, spec: string): DeclaredDependency => ({ name, spec, dependencyType: "direct" });

/** 버전 카탈로그의 버전: 문자열, 또는 { strictly | require | prefer } 표 */
function versionText(value: unknown): string | null {
  const text = scalarText(value);
  if (text !== null) return text;
  const table = asTable(value);
  if (!table) return null;
  return scalarText(table.strictly) ?? scalarText(table.require) ?? scalarText(table.prefer);
}

/** gradle/libs.versions.toml. 버전이 없는 라이브러리(BOM 이 관리)와 version.ref 가 가리키는 곳이 없는 것은 건너뛴다. */
export function parseVersionCatalog(content: string, file = "libs.versions.toml"): DeclaredDependency[] {
  const data = readToml(content, file, { allowEmpty: true });
  const versions = asTable(data.versions) ?? {};
  const deps: DeclaredDependency[] = [];

  for (const value of Object.values(asTable(data.libraries) ?? {})) {
    const inline = asString(value);
    if (inline !== null) {
      const parts = inline.split(":");
      if (parts.length >= 3) deps.push(direct(`${parts[0]}:${parts[1]}`, parts.slice(2).join(":")));
      continue;
    }
    const table = asTable(value);
    if (!table) continue;
    const module =
      asString(table.module) ??
      (typeof table.group === "string" && typeof table.name === "string"
        ? `${table.group}:${table.name}`
        : null);
    if (module === null) continue;
    const version = asTable(table.version);
    const spec =
      version && typeof version.ref === "string" ? versionText(versions[version.ref]) : versionText(table.version);
    if (spec !== null) deps.push(direct(module, spec.trim()));
  }
  return deps;
}

/**
 * 한 번 훑으며 주석 밖의 문자열 리터럴 내용만 모은다. 문자열 안의 주석 기호(https:// 의 //, 'lib/*' 의 /*)는
 * 주석이 아니고, 닫히지 않은 블록 주석은 파일 끝까지 주석이다.
 */
function stringLiterals(text: string): string[] {
  const literals: string[] = [];
  let i = 0;
  while (i < text.length) {
    const char = text[i] as string;
    if (char === "/" && text[i + 1] === "/") {
      const lineEnd = text.indexOf("\n", i);
      if (lineEnd === -1) break;
      i = lineEnd;
    } else if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end === -1) break;
      i = end + 2;
    } else if (char === '"' || char === "'") {
      const quote = text.startsWith(char.repeat(3), i) ? char.repeat(3) : char;
      i += quote.length;
      const start = i;
      while (i < text.length && !text.startsWith(quote, i)) {
        if (text[i] === "\\") i += 1;
        else if (quote.length === 1 && text[i] === "\n") break;
        i += 1;
      }
      literals.push(text.slice(start, i));
      if (text.startsWith(quote, i)) i += quote.length;
    } else {
      i += 1;
    }
  }
  return literals;
}

const COORDINATE = /^([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):([A-Za-z0-9_.+[\](),-]+)(?::[^"']*)?(?:@[A-Za-z0-9]+)?$/;

/**
 * build.gradle(.kts) 의 따옴표 안 "group:name:version" 문자열.
 * 변수($)가 든 것, 버전이 없는 것, 변수로 조립하는 선언은 읽을 수 없어 그 선언만 건너뛴다.
 * 문법 표지가 없는 스크립트라 빈 파일도 정상으로 본다.
 */
export function parseGradle(content: string, file = "build.gradle"): DeclaredDependency[] {
  const deps: DeclaredDependency[] = [];
  for (const literal of stringLiterals(readText(content, file))) {
    if (literal.includes("$")) continue;
    const parsed = COORDINATE.exec(literal);
    if (parsed) deps.push(direct(`${parsed[1]}:${parsed[2]}`, parsed[3] as string));
  }
  return deps;
}

/** 확장 도중 이 길이를 넘으면 풀 수 없는 속성으로 본다 */
const MAX_VERSION_LENGTH = 1024;

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]);

/** `${prop}` 을 properties 와 project.version 으로 푼다. 풀 수 없으면 null */
function resolveVersion(version: string, properties: Map<string, string>): string | null {
  let text = version;
  for (let round = 0; round < 5 && text.includes("${"); round += 1) {
    text = text.replace(/\$\{([^}]*)\}/g, (whole, key: string) => properties.get(key.trim()) ?? whole);
    // 속성이 서로를 여러 번 가리키면 길이가 지수로 커진다.
    if (text.length > MAX_VERSION_LENGTH) return null;
  }
  return text.includes("${") ? null : text;
}

/**
 * pom.xml 의 `<project><dependencies>`. dependencyManagement 와 build/plugins 는 읽지 않는다(실제 의존성이 아니다).
 * 버전이 없거나 풀 수 없는 속성이면 spec "" (범위 없는 선언).
 */
export function parsePomXml(content: string, file = "pom.xml"): DeclaredDependency[] {
  const doc = readXml(content, file);
  const project = asTable(doc.project);
  if (!("project" in doc)) fail(file, "project 요소가 없습니다");
  if (!project) return [];

  const properties = new Map<string, string>();
  for (const [key, value] of Object.entries(asTable(project.properties) ?? {})) {
    const text = scalarText(value);
    if (text !== null) properties.set(key, text.trim());
  }
  const ownVersion = scalarText(project.version) ?? scalarText(asTable(project.parent)?.version);
  if (ownVersion !== null) {
    properties.set("project.version", ownVersion.trim());
    properties.set("pom.version", ownVersion.trim());
  }

  const deps: DeclaredDependency[] = [];
  for (const item of asList(asTable(project.dependencies)?.dependency)) {
    const dep = asTable(item);
    const group = dep ? scalarText(dep.groupId)?.trim() : undefined;
    const artifact = dep ? scalarText(dep.artifactId)?.trim() : undefined;
    if (!dep || !group || !artifact) continue;
    const version = scalarText(dep.version)?.trim() ?? "";
    deps.push(direct(`${group}:${artifact}`, version === "" ? "" : (resolveVersion(version, properties) ?? "")));
  }
  return deps;
}

export const mavenSupport: EcosystemSupport = {
  ecosystem: "maven",
  roleOf(path) {
    const name = baseName(path);
    if (name === "build.gradle" || name === "build.gradle.kts" || name === "pom.xml") return "manifest";
    return path === "gradle/libs.versions.toml" || path.endsWith("/gradle/libs.versions.toml")
      ? "manifest"
      : null;
  },
  parseManifest(path, content) {
    const name = baseName(path);
    if (name === "pom.xml") return parsePomXml(content, path);
    return name === "libs.versions.toml" ? parseVersionCatalog(content, path) : parseGradle(content, path);
  },
  parseLock: () => [],
};
