import type { DeclaredDependency } from "./types.ts";

/** 파일 1개에서 읽는 항목 수의 상한 */
export const MAX_ITEMS = 5000;
/** 한 줄(이어 붙인 줄 포함)이 이보다 길면 읽지 않는다 */
const MAX_LINE = 4000;

/**
 * Ruby 호출의 인자 목록(`"a", "b", key: value`)을 최상위 쉼표로 나눈다. 따옴표 안의 쉼표와 괄호 안의 쉼표는 나누지 않는다.
 * 닫히지 않은 따옴표가 있으면 null. 문자 단위의 선형 스캔이다(코드를 실행하지 않는다).
 */
export function splitArgs(text: string): string[] | null {
  const args: string[] = [];
  let current = "";
  let quote = "";
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    // 따옴표 밖의 후위 `if`·`unless` 는 조건이다 (단어의 시작에서만 본다).
    if (quote === "" && depth === 0 && /[iu]/.test(char) && (index === 0 || /\s/.test(text[index - 1] as string))) {
      const word = /^(?:if|unless)(?=[\s(])/.exec(text.slice(index, index + 8));
      if (word) break;
    }
    if (quote !== "") {
      current += char;
      if (char === "\\" && index + 1 < text.length) {
        index += 1;
        current += text[index] as string;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === "#") {
      break;
    } else if (char === "[" || char === "(" || char === "{") {
      depth += 1;
      current += char;
    } else if (char === "]" || char === ")" || char === "}") {
      // 호출 전체를 감싼 `gem(...)` 의 닫는 괄호는 인자가 아니다.
      if (depth === 0) break;
      depth -= 1;
      current += char;
    } else if (char === "," && depth === 0) {
      args.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (quote !== "") return null;
  if (current.trim() !== "") args.push(current.trim());
  return args;
}

const STRING_LITERAL = /^(?:'([^'\\]*)'|"([^"\\]*)")$/;

/** 따옴표 1쌍으로 된 문자열이면 그 안의 값, 아니면 null */
export function literalOf(arg: string): string | null {
  const match = STRING_LITERAL.exec(arg);
  return match ? (match[1] ?? match[2] ?? "") : null;
}

const REQUIREMENT = /^(?:=|!=|>=|<=|~>|>|<)?\s*\d[0-9A-Za-z.-]*$/;

/** gem·pod 의 요구식 문자열인가 (`~> 1.0`, `1.2.3`) */
export const isRequirement = (text: string): boolean => REQUIREMENT.test(text.trim());

/** 옵션의 키(`git:`, `:path =>`)가 이 이름들 중 하나인가 */
export function hasOption(args: string[], names: readonly string[]): boolean {
  return args.some((arg) => {
    const match = /^:?([A-Za-z_]+)\s*(?::(?!:)|=>)/.exec(arg);
    return match !== null && names.includes(match[1] as string);
  });
}

/** 줄 끝이 `,` 이면 다음 줄과 한 호출이다 (정규식 없이 끝 문자로 판정한다). */
export function logicalLines(text: string): string[] {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    let line = (lines[index] as string).trimEnd();
    while (line.length < MAX_LINE && line.endsWith(",") && index + 1 < lines.length) {
      index += 1;
      line = `${line} ${(lines[index] as string).trimEnd()}`;
    }
    out.push(line);
  }
  return out;
}

export interface CallOptions {
  /** 호출 이름 뒤에 오는 이름 정규식 조각 (예: `gem`) */
  call: RegExp;
  /** 이 옵션이 있으면 registry 의 패키지가 아니다 */
  skipOptions: readonly string[];
}

/**
 * `call` 로 시작하는 줄의 첫 문자열을 이름으로, 이어지는 요구식 문자열들을 spec 으로 읽는다.
 * 이름이 따옴표 문자열이 아니거나 skipOptions 가 있으면 건너뛴다. `blocked` 가 true 인 줄(git 블록 안)도 건너뛴다.
 */
export function readCalls(lines: string[], options: CallOptions, blocked: (index: number) => boolean): DeclaredDependency[] {
  const deps: DeclaredDependency[] = [];
  for (const [index, line] of lines.entries()) {
    if (deps.length >= MAX_ITEMS) break;
    if (line.length > MAX_LINE) continue;
    const match = options.call.exec(line);
    if (!match) continue;
    const args = splitArgs(line.slice(match[0].length));
    const name = args?.[0] === undefined ? null : literalOf(args[0]);
    if (args === null || name === null || name === "") continue;
    if (hasOption(args, options.skipOptions) || blocked(index)) continue;
    const requirements = args
      .slice(1)
      .map(literalOf)
      .filter((value): value is string => value !== null && isRequirement(value))
      .map((value) => value.trim());
    deps.push({ name, spec: requirements.join(", "), dependencyType: "direct" });
  }
  return deps;
}

export interface BlockInfo {
  /** 줄마다: 열린 블록 중 `isBlocked` 가 참인 것 안에 있다 */
  blocked: boolean[];
  /** 줄마다: 어떤 블록 안도 아니다 */
  topLevel: boolean[];
}

const BLOCK_OPENER = /\bdo(?:\s*\|[^|]*\|)?\s*(?:#.*)?$/;
const STATEMENT_OPENER = /^(?:if|unless|case|begin|def|while|until|for|class|module)\b/;

/**
 * `do … end` 블록의 안인가를 줄마다 계산한다. `if`·`case`·`begin`·`def` 등 `end` 로 닫는 문장도 깊이로 센다.
 * `isBlocked` 는 `do` 로 여는 줄을 받아 그 블록 안을 건너뛸지(git·path·사설 source) 정한다.
 */
export function blockedLines(lines: string[], isBlocked: (openerLine: string) => boolean): BlockInfo {
  const stack: boolean[] = [];
  let blockedCount = 0;
  const blocked: boolean[] = [];
  const topLevel: boolean[] = [];
  for (const line of lines) {
    blocked.push(blockedCount > 0);
    topLevel.push(stack.length === 0);
    // 긴 줄은 정규식을 돌리지 않는다(readCalls 도 읽지 않는 줄이다).
    if (line.length > MAX_LINE) continue;
    const trimmed = line.trim();
    if (BLOCK_OPENER.test(trimmed)) {
      const skip = isBlocked(trimmed);
      stack.push(skip);
      if (skip) blockedCount += 1;
    } else if (STATEMENT_OPENER.test(trimmed) && !/\bend$/.test(trimmed)) {
      stack.push(false);
    } else if (/^end\b/.test(trimmed) && stack.length > 0) {
      if (stack.pop()) blockedCount -= 1;
    }
  }
  return { blocked, topLevel };
}
