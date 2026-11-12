import { asString, asTable, baseName, readText, readToml, scalarText } from "./common.ts";
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

export const mavenSupport: EcosystemSupport = {
  ecosystem: "maven",
  roleOf(path) {
    const name = baseName(path);
    if (name === "build.gradle" || name === "build.gradle.kts") return "manifest";
    return path === "gradle/libs.versions.toml" || path.endsWith("/gradle/libs.versions.toml")
      ? "manifest"
      : null;
  },
  parseManifest: (path, content) =>
    baseName(path) === "libs.versions.toml" ? parseVersionCatalog(content, path) : parseGradle(content, path),
  parseLock: () => [],
};
