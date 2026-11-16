/** 한 줄의 최대 길이. 이보다 긴 줄은 앞부분만 본다 (입력은 신뢰할 수 없다) */
const MAX_LINE_LENGTH = 8192;
/** `$(` 앞에서 `sh -c` 를 찾는 구간 */
const LOOKBEHIND = 64;
/** `<(` 안에서 curl·wget 을 찾는 구간 */
const LOOKAHEAD = 200;

const SHELLS = new Set(["sh", "bash", "zsh"]);
const DOWNLOADERS = new Set(["curl", "wget"]);
const SPLIT = /\s+/;

const baseOf = (token: string): string => token.slice(token.lastIndexOf("/") + 1);
const LEADING = new Set(['"', "'", "`", "(", "{", "$"]);
const TRAILING = new Set(['"', "'", "`", ")", "}"]);

/** 앞뒤의 따옴표·괄호·`$` 를 벗긴 명령 이름 (정규식 없이 양끝에서 한 번씩 훑는다) */
function bare(token: string): string {
  let start = 0;
  let end = token.length;
  while (start < end && LEADING.has(token[start] as string)) start += 1;
  while (end > start && TRAILING.has(token[end - 1] as string)) end -= 1;
  return baseOf(token.slice(start, end));
}

const isShell = (token: string | undefined): boolean => token !== undefined && SHELLS.has(bare(token));
const isDownloader = (token: string | undefined): boolean => token !== undefined && DOWNLOADERS.has(bare(token));

/** 파이프 왼쪽 조각의 어느 토큰이든 curl·wget 이다 (`A && curl …`, `sudo curl …`) */
const hasDownloader = (segment: string): boolean => segment.split(SPLIT).some(isDownloader);

/** 파이프 오른쪽 조각의 첫 명령이 셸이다. `sudo`·`env`·`VAR=x`·플래그를 건너뛴다. */
function startsWithShell(segment: string): boolean {
  const tokens = segment.slice(0, LOOKAHEAD).trim().split(SPLIT);
  for (const token of tokens) {
    if (token === "" || token.startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
    const name = bare(token);
    if (name === "sudo" || name === "env" || name === "exec" || name === "command") continue;
    return SHELLS.has(name);
  }
  return false;
}

/** `|` (`||` 와 `|&` 의 `|` 는 제외)로 나눈다 */
function splitPipes(line: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] !== "|") continue;
    if (line[i + 1] === "|") {
      i += 1;
      continue;
    }
    parts.push(line.slice(start, i));
    start = i + 1;
  }
  parts.push(line.slice(start));
  return parts;
}

function pipedToShell(line: string): boolean {
  const parts = splitPipes(line);
  for (let i = 1; i < parts.length; i += 1) {
    if (hasDownloader(parts[i - 1] as string) && startsWithShell(parts[i] as string)) return true;
  }
  return false;
}

/** `bash <(curl …)` */
function processSubstitution(line: string): boolean {
  for (let at = line.indexOf("<("); at !== -1; at = line.indexOf("<(", at + 2)) {
    const before = line.slice(Math.max(0, at - LOOKBEHIND), at).trimEnd().split(SPLIT);
    if (!isShell(before[before.length - 1])) continue;
    const inside = line.slice(at + 2, at + 2 + LOOKAHEAD).trimStart().split(SPLIT)[0];
    if (isDownloader(inside)) return true;
  }
  return false;
}

/** `sh -c "$(curl …)"` */
function commandSubstitution(line: string): boolean {
  for (let at = line.indexOf("$("); at !== -1; at = line.indexOf("$(", at + 2)) {
    const inside = line.slice(at + 2, at + 2 + LOOKAHEAD).trimStart().split(SPLIT)[0];
    if (!isDownloader(inside)) continue;
    const before = line.slice(Math.max(0, at - LOOKBEHIND), at).split(SPLIT).filter((token) => !/^["']*$/.test(token));
    const flag = before[before.length - 1]?.replace(/["']+$/, "");
    if (flag !== undefined && /^-[A-Za-z]*c[A-Za-z]*$/.test(flag) && isShell(before[before.length - 2])) return true;
  }
  return false;
}

/**
 * 셸 스크립트에 "내려받은 내용을 바로 셸에 넘기는" 줄이 있는가: `curl … | sh`, `bash <(curl …)`, `sh -c "$(curl …)"`.
 * 줄 단위로(`\` 로 이어진 줄은 합친다) 보고 길이 상한이 있어서 입력의 크기에 선형이다. 예외를 던지지 않는다.
 */
export function hasCurlPipeShell(text: string): boolean {
  if (!/curl|wget/.test(text)) return false;
  for (const raw of text.replace(/\\\r?\n/g, " ").split(/\r?\n/)) {
    const line = raw.length > MAX_LINE_LENGTH ? raw.slice(0, MAX_LINE_LENGTH) : raw;
    if (!/curl|wget/.test(line)) continue;
    if (pipedToShell(line) || processSubstitution(line) || commandSubstitution(line)) return true;
  }
  return false;
}
