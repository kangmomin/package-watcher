import { normalizeText } from "../lockfiles/common.ts";
import { MAX_ITEMS } from "./limits.ts";
import type { TerraformModule } from "./types.ts";

const MODULE_HEADER = /^\s*module\s+"[^"\\]*"\s*\{(.*)$/;
const SOURCE_LINE = /^\s*source\s*=\s*"([^"\\]*)"/;
const VERSION_LINE = /^\s*version\s*=\s*"([^"\\]*)"/;
/** 한 줄 블록(`module "x" { source = "…" }`)의 속성 */
const INLINE_SOURCE = /(?:^|\s)source\s*=\s*"([^"\\]*)"/;
const INLINE_VERSION = /(?:^|\s)version\s*=\s*"([^"\\]*)"/;
const HEREDOC = /<<-?\s*([A-Za-z_]\w*)$/;
/** 정확한 버전이다 (`5.8.1`, `= 5.8.1`). `~> 5.0`, `>= 1` 같은 제약은 아니다. */
const EXACT = /^=?\s*(v?\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?)$/;
const MAX_REF = 100;

interface State {
  /** `{` 의 깊이 (문자열·주석·`${}` 안의 것은 세지 않는다) */
  depth: number;
  /** 블록 주석 안이다 */
  block: boolean;
  /** heredoc 의 끝 표지. heredoc 안의 줄은 읽지 않는다 */
  heredoc: string | null;
}

/** 한 줄의 중괄호 깊이를 센다. 문자열은 줄을 넘지 않으므로 줄마다 스택을 새로 만든다. 문자 단위의 선형 스캔이다. */
function scanLine(line: string, state: State): void {
  const stack: ("string" | "interpolation")[] = [];
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] as string;
    const top = stack[stack.length - 1];
    if (top === "string") {
      if (char === "\\") {
        index += 1;
      } else if (char === '"') {
        stack.pop();
      } else if ((char === "$" || char === "%") && line[index + 1] === "{") {
        stack.push("interpolation");
        index += 1;
      } else if ((char === "$" || char === "%") && line[index + 1] === char && line[index + 2] === "{") {
        index += 2; // `$${` 는 글자 그대로의 `${`
      }
      continue;
    }
    if (char === '"') {
      stack.push("string");
    } else if (char === "{") {
      if (top === "interpolation") stack.push("interpolation");
      else state.depth += 1;
    } else if (char === "}") {
      if (top === "interpolation") stack.pop();
      else state.depth = Math.max(0, state.depth - 1);
    } else if (top === undefined) {
      if (char === "#" || (char === "/" && line[index + 1] === "/")) return;
      if (char === "/" && line[index + 1] === "*") {
        const end = line.indexOf("*/", index + 2);
        if (end === -1) {
          state.block = true;
          return;
        }
        index = end + 1;
      }
    }
  }
  if (stack.length === 0) {
    const match = HEREDOC.exec(line.trimEnd());
    if (match) state.heredoc = match[1] as string;
  }
}

/**
 * source 를 같은 module 의 다른 표기가 같은 이름이 되게 정규화한다: `git::` 접두, 스킴, `git@host:`, userinfo, 끝의 `.git`,
 * `//하위경로`, `?쿼리` 를 떼고 소문자로 만든다(`git::https://GitHub.com/o/r.git//sub?ref=v1` → `github.com/o/r`).
 * 항목의 이름과 module 의 source 양쪽에 쓴다. 문자열 연산뿐이라 선형이다.
 */
export function normalizeTerraformSource(source: string): string {
  let text = source.trim();
  const query = text.indexOf("?");
  if (query !== -1) text = text.slice(0, query);
  if (text.toLowerCase().startsWith("git::")) text = text.slice(5);
  const scheme = text.indexOf("://");
  if (scheme !== -1 && /^[A-Za-z][A-Za-z0-9+.-]*$/.test(text.slice(0, scheme))) {
    text = text.slice(scheme + 3);
    const slash = text.indexOf("/");
    const authority = slash === -1 ? text : text.slice(0, slash);
    const at = authority.lastIndexOf("@");
    if (at !== -1) text = text.slice(at + 1);
  } else {
    // `git@github.com:org/repo` (scp 형식)
    const scp = /^[^\s/@:]+@([^\s/:]+):(.*)$/.exec(text);
    if (scp) text = `${scp[1]}/${scp[2]}`;
  }
  const subdir = text.indexOf("//");
  if (subdir !== -1) text = text.slice(0, subdir);
  if (text.endsWith(".git")) text = text.slice(0, -4);
  return text.toLowerCase();
}

/** source 에서 이름과 `?ref=` 를 뽑는다. 로컬 경로와 보간(`${}`)이 든 값은 null. */
function splitSource(source: string): { name: string; ref: string } | null {
  if (source === "" || source.startsWith("./") || source.startsWith("../") || source.includes("${")) return null;
  const query = source.indexOf("?");
  const queryText = query === -1 ? "" : source.slice(query + 1);
  const name = normalizeTerraformSource(source);
  const ref = /(?:^|&)ref=([^&]*)/.exec(queryText)?.[1] ?? "";
  return name === "" ? null : { name, ref: ref.length <= MAX_REF ? ref : "" };
}

/**
 * `*.tf` 의 `module "x" { source = "…" version = "…" }`. HCL 을 파싱하지 않고 줄 단위로 최상위의 module 블록을 찾는다.
 * 블록의 끝은 중괄호의 깊이로 판정하고 그 블록의 최상위(깊이 1)에서만 source·version 을 읽는다.
 * 로컬 경로는 건너뛰고, 버전이 제약이면 "" 이다. 닫히지 않은 블록은 버린다.
 */
export function extractTerraform(content: string): TerraformModule[] {
  const state: State = { depth: 0, block: false, heredoc: null };
  const modules: TerraformModule[] = [];
  let current: { source: string | null; version: string | null } | null = null;

  for (let line of normalizeText(content).split("\n")) {
    if (modules.length >= MAX_ITEMS) break;
    if (state.heredoc !== null) {
      if (line.trim() === state.heredoc) state.heredoc = null;
      continue;
    }
    if (state.block) {
      const end = line.indexOf("*/");
      if (end === -1) continue;
      state.block = false;
      line = line.slice(end + 2);
    }
    if (current === null && state.depth === 0) {
      const header = MODULE_HEADER.exec(line);
      if (header) {
        current = {
          source: INLINE_SOURCE.exec(header[1] as string)?.[1] ?? null,
          version: INLINE_VERSION.exec(header[1] as string)?.[1] ?? null,
        };
      }
    } else if (current !== null && state.depth === 1) {
      current.source ??= SOURCE_LINE.exec(line)?.[1] ?? null;
      current.version ??= VERSION_LINE.exec(line)?.[1] ?? null;
    }
    scanLine(line, state);
    if (current !== null && state.depth === 0) {
      const split = current.source === null ? null : splitSource(current.source);
      if (split !== null && current.source !== null) {
        const exact = current.version === null ? null : (EXACT.exec(current.version.trim())?.[1] ?? null);
        // version 이 없으면 git 의 ?ref 를 쓴다. version 이 제약이면 정확한 버전을 알 수 없다.
        const version = exact ?? (current.version === null ? split.ref : "");
        modules.push({ name: split.name, version, raw: current.source });
      }
      current = null;
    }
  }
  return modules;
}
