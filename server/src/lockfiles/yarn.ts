import { parse as parseYaml } from "yaml";
import {
  errorMessage,
  isPlainObject,
  LockfileParseError,
  requireContent,
  splitNameAndRest,
  unwrapNpmAlias,
} from "./common.ts";
import type { LockPackage } from "./index.ts";

const CLASSIC_MARKER = /^# yarn lockfile v1[ \t]*$/m;
/** 블록 바로 아래(들여쓰기 2칸)의 version 줄. 4칸 들여쓰기는 dependencies 하위 항목이다. */
const CLASSIC_VERSION = /^ {2}version:? +"?([^"\s]+)"?[ \t]*$/;

/**
 * `yarn.lock` (classic 와 berry 를 형식 표지로 구분).
 * - classic: 표지 `# yarn lockfile v1`. 한 블록의 여러 spec 은 같은 버전.
 *   이름 = spec 이 `@` 로 시작하면 두 번째 `@` 앞, 아니면 첫 `@` 앞. `a@npm:real@^1` → `real`.
 * - berry: 표지 `__metadata`(제외). 이름 = `resolution` 에서 추출. `workspace:` 제외. `patch:` 는 기본 패키지 이름.
 * 공통: UTF-8 BOM 제거, CRLF → LF. 파싱 실패·빈 입력·형식 표지 없는 입력은 예외.
 */
export function parseYarnLock(content: string): LockPackage[] {
  const text = requireContent(content, "yarn.lock");
  if (CLASSIC_MARKER.test(text)) return parseClassic(text);

  let data: unknown;
  try {
    data = parseYaml(text);
  } catch (error) {
    throw new LockfileParseError(`yarn.lock 을 해석할 수 없습니다: ${errorMessage(error)}`);
  }
  if (isPlainObject(data) && "__metadata" in data) return parseBerry(data);
  throw new LockfileParseError("yarn.lock 에 형식 표지(# yarn lockfile v1 / __metadata)가 없습니다");
}

function parseClassic(text: string): LockPackage[] {
  const packages: LockPackage[] = [];
  let pending: { header: string; names: string[] } | null = null;

  for (const line of text.split("\n")) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      if (pending) throw new LockfileParseError(`yarn.lock 항목에 version 이 없습니다: ${pending.header}`);
      const header = line.trimEnd();
      if (!header.endsWith(":")) {
        throw new LockfileParseError(`yarn.lock 을 해석할 수 없습니다: ${header}`);
      }
      const specs = header
        .slice(0, -1)
        .split(",")
        .map((spec) => unquote(spec.trim()))
        .filter((spec) => spec !== "");
      pending = { header, names: [...new Set(specs.map(classicSpecName))] };
      continue;
    }
    const match = CLASSIC_VERSION.exec(line);
    if (match?.[1] && pending) {
      for (const name of pending.names) packages.push({ name, version: match[1] });
      pending = null;
    }
  }
  if (pending) throw new LockfileParseError(`yarn.lock 항목에 version 이 없습니다: ${pending.header}`);
  return packages;
}

function classicSpecName(spec: string): string {
  const { name, rest } = splitNameAndRest(spec);
  return rest === null ? name : unwrapNpmAlias(name, rest).name;
}

function unquote(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

function parseBerry(data: Record<string, unknown>): LockPackage[] {
  const packages: LockPackage[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (key === "__metadata" || !isPlainObject(value)) continue;
    if (typeof value.resolution !== "string") continue;
    const { name, rest } = splitNameAndRest(value.resolution);
    if (rest === null || rest.startsWith("workspace:")) continue;
    const version = value.version;
    if (typeof version !== "string" && typeof version !== "number") continue;
    packages.push({ name, version: String(version) });
  }
  return packages;
}
