import { baseName, fail, readText, requireText } from "./common.ts";
import { MAX_ITEMS, blockedLines, logicalLines, readCalls } from "./rubyArgs.ts";
import type { DeclaredDependency, EcosystemSupport, LockedPackage } from "./types.ts";

const SECTION = /^[A-Z][A-Z ]*$/;
const LOCKED_SPEC = /^ {4}([^\s(]+) \(([^)\s]+)\)$/;
/** 버전 뒤의 플랫폼 접미(`1.15.5-x86_64-linux`). `1.0.0-beta` 같은 값은 건드리지 않는다 */
const PLATFORM_SUFFIX = /-(?:x86_64|x86|x64|arm64|aarch64|arm|java|universal|mingw|mswin)[\w.-]*$/;
const DEPENDENCY_NAME = /^ {2}([^\s(!]+)/;
/** Gemfile.lock 의 형식 표지: 이 구역 중 하나는 있다 */
const LOCK_SECTIONS = new Set(["GEM", "DEPENDENCIES", "PLATFORMS", "PATH", "GIT"]);

/**
 * Gemfile.lock: `GEM` 구역의 `specs:` 아래 4칸 줄만 읽는다 (6칸 이상은 그 gem 의 의존성, PATH·GIT 은 registry 가 아니다).
 * DEPENDENCIES 에 이름이 있으면 direct. 버전의 플랫폼 접미(`1.15.5-x86_64-linux`)는 뗀다.
 */
export function parseGemfileLock(content: string, file = "Gemfile.lock"): LockedPackage[] {
  const text = requireText(content, file);
  const specs: { name: string; version: string }[] = [];
  const direct = new Set<string>();
  const seenSections = new Set<string>();
  let section = "";
  let inSpecs = false;
  for (const line of text.split("\n")) {
    if (line === "") continue;
    if (!line.startsWith(" ")) {
      section = line.trimEnd();
      inSpecs = false;
      if (SECTION.test(section)) seenSections.add(section);
      continue;
    }
    if (section === "GEM") {
      if (line.trim() === "specs:") {
        inSpecs = true;
        continue;
      }
      const match = inSpecs ? LOCKED_SPEC.exec(line) : null;
      if (match && specs.length < MAX_ITEMS) {
        specs.push({ name: match[1] as string, version: (match[2] as string).replace(PLATFORM_SUFFIX, "") });
      }
    } else if (section === "DEPENDENCIES") {
      const match = DEPENDENCY_NAME.exec(line);
      if (match && line[2] !== " ") direct.add(match[1] as string);
    }
  }
  if (![...seenSections].some((name) => LOCK_SECTIONS.has(name))) fail(file, "Gemfile.lock 형식이 아닙니다");
  return specs.map((spec) => ({ ...spec, direct: direct.has(spec.name) }));
}

const GEM_CALL = /^\s*gem[ \t(]+/;
const GEM_SKIP = ["git", "github", "path", "gist", "bitbucket", "source"] as const;
const SOURCE_LINE = /^\s*source\s*\(?\s*['"]([^'"]*)['"]/;
const OFFICIAL_SOURCE = /^https?:\/\/(?:www\.)?rubygems\.org\/?$/i;

/** `git`·`path`·`github` 블록과 rubygems.org 가 아닌 `source` 블록은 registry 의 gem 이 아니다 */
function isForeignBlock(opener: string): boolean {
  if (/^(?:git|path|github)[\s(]/.test(opener)) return true;
  const source = SOURCE_LINE.exec(opener)?.[1];
  return source !== undefined && !OFFICIAL_SOURCE.test(source);
}

/**
 * Gemfile: 줄 단위로 `gem "이름", "요구식"…` 을 읽는다. git·path·github 옵션과 블록의 gem 은 registry 에서 받지 않으므로 건너뛴다.
 * 최상위 `source` 가 rubygems.org 가 아닌 것뿐이면 그 Gemfile 의 gem 은 모두 사설 registry 의 것이라 건너뛴다.
 */
export function parseGemfile(content: string, file = "Gemfile"): DeclaredDependency[] {
  const lines = logicalLines(readText(content, file));
  const { blocked, topLevel } = blockedLines(lines, isForeignBlock);
  const sources = lines.flatMap((line, index) =>
    topLevel[index] === true && !/\bdo\b/.test(line) ? [SOURCE_LINE.exec(line)?.[1]].filter((v): v is string => v !== undefined) : [],
  );
  if (sources.length > 0 && !sources.some((source) => OFFICIAL_SOURCE.test(source))) return [];
  return readCalls(lines, { call: GEM_CALL, skipOptions: GEM_SKIP }, (index) => blocked[index] === true);
}

const SPEC_CALL = /^\s*[A-Za-z_]\w*\.add_(?:runtime_|development_)?dependency[ \t(]+/;

/** *.gemspec: add_dependency·add_runtime_dependency·add_development_dependency */
export function parseGemspec(content: string, file = "x.gemspec"): DeclaredDependency[] {
  const lines = logicalLines(readText(content, file));
  return readCalls(lines, { call: SPEC_CALL, skipOptions: [] }, () => false);
}

export const rubygemsSupport: EcosystemSupport = {
  ecosystem: "rubygems",
  roleOf(path) {
    const name = baseName(path);
    if (name === "Gemfile" || name.endsWith(".gemspec")) return "manifest";
    return name === "Gemfile.lock" ? "lock" : null;
  },
  parseManifest: (path, content) =>
    baseName(path) === "Gemfile" ? parseGemfile(content, path) : parseGemspec(content, path),
  parseLock: (path, content) => parseGemfileLock(content, path),
};
