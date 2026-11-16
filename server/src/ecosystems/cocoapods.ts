import { parse as parseYaml } from "yaml";
import { errorMessage } from "../lockfiles/common.ts";
import { asTable, baseName, fail, readText, requireText } from "./common.ts";
import { MAX_ITEMS, logicalLines, readCalls } from "./rubyArgs.ts";
import type { DeclaredDependency, EcosystemSupport, LockedPackage } from "./types.ts";

/** `Name (1.2.3)` → 이름과 괄호 안의 값 */
const NAME_AND_VERSION = /^(\S+) \(([^)]*)\)$/;

/** PODS 의 항목: 문자열 또는 `{ "Name (1.2.3)": [의존성…] }` */
function podLabel(item: unknown): string | null {
  if (typeof item === "string") return item;
  const table = asTable(item);
  const key = table ? Object.keys(table)[0] : undefined;
  return key ?? null;
}

/** Podfile.lock(YAML): PODS 의 이름·버전, DEPENDENCIES 의 이름으로 direct. SPEC CHECKSUMS 는 읽지 않는다. */
export function parsePodfileLock(content: string, file = "Podfile.lock"): LockedPackage[] {
  const text = requireText(content, file);
  let data: unknown;
  try {
    data = parseYaml(text, { logLevel: "error" });
  } catch (error) {
    return fail(file, errorMessage(error).split("\n")[0] ?? "YAML 문법 오류");
  }
  const table = asTable(data);
  if (!table || (!Array.isArray(table.PODS) && !Array.isArray(table.DEPENDENCIES) && !("COCOAPODS" in table))) {
    return fail(file, "Podfile.lock 형식이 아닙니다");
  }
  const direct = new Set<string>();
  for (const item of Array.isArray(table.DEPENDENCIES) ? table.DEPENDENCIES : []) {
    const label = podLabel(item);
    if (label !== null) direct.add(label.split(" ")[0] as string);
  }
  const result: LockedPackage[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(table.PODS) ? table.PODS : []) {
    const match = NAME_AND_VERSION.exec(podLabel(item) ?? "");
    if (!match || result.length >= MAX_ITEMS) continue;
    const key = `${match[1]}@${match[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ name: match[1] as string, version: match[2] as string, direct: direct.has(match[1] as string) });
  }
  return result;
}

const POD_CALL = /^\s*pod[ \t(]+/;
const POD_SKIP = ["git", "path", "podspec", "http", "svn", "hg", "source"] as const;

/** Podfile: 줄 단위로 `pod 'Name', '요구식'` 을 읽는다. :git·:path·:podspec 는 trunk 의 패키지가 아니므로 건너뛴다. */
export function parsePodfile(content: string, file = "Podfile"): DeclaredDependency[] {
  const lines = logicalLines(readText(content, file));
  return readCalls(lines, { call: POD_CALL, skipOptions: POD_SKIP }, () => false);
}

export const cocoapodsSupport: EcosystemSupport = {
  ecosystem: "cocoapods",
  roleOf(path) {
    const name = baseName(path);
    if (name === "Podfile") return "manifest";
    return name === "Podfile.lock" ? "lock" : null;
  },
  parseManifest: (path, content) => parsePodfile(content, path),
  parseLock: (path, content) => parsePodfileLock(content, path),
};
