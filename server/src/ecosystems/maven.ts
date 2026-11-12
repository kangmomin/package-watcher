import { asString, asTable, baseName, normalizeText, readToml, scalarText } from "./common.ts";
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
  const data = readToml(content, file);
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

/** 줄 주석과 블록 주석을 지운다. 문자열 안의 // 는 주석이 아니다(예: URL). */
function stripComments(text: string): string {
  const withoutBlocks = text.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlocks
    .split("\n")
    .map((line) => {
      let quote: string | null = null;
      for (let i = 0; i < line.length; i += 1) {
        const char = line[i] as string;
        if (quote !== null) {
          if (char === "\\") i += 1;
          else if (char === quote) quote = null;
        } else if (char === '"' || char === "'") quote = char;
        else if (char === "/" && line[i + 1] === "/") return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

const COORDINATE = /^([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):([A-Za-z0-9_.+[\](),-]+)(?::[^"']*)?(?:@[A-Za-z0-9]+)?$/;

/**
 * build.gradle(.kts) 의 따옴표 안 "group:name:version" 문자열.
 * 변수($)가 든 것, 버전이 없는 것, 변수로 조립하는 선언은 읽을 수 없어 그 선언만 건너뛴다.
 * 문법 표지가 없는 스크립트라 빈 파일도 정상으로 본다.
 */
export function parseGradle(content: string): DeclaredDependency[] {
  const text = stripComments(normalizeText(content));
  const deps: DeclaredDependency[] = [];
  for (const match of text.matchAll(/(["'])([^"'\n]*)\1/g)) {
    const literal = match[2] as string;
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
    baseName(path) === "libs.versions.toml" ? parseVersionCatalog(content, path) : parseGradle(content),
  parseLock: () => [],
};
