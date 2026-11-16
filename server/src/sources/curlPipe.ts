/** 한 줄의 최대 길이. 이보다 긴 줄은 앞부분만 본다 (입력은 신뢰할 수 없다) */
const MAX_LINE_LENGTH = 8192;
/** `$(`·`<(` 앞에서 셸을 찾는 구간 */
const LOOKBEHIND = 64;
/** `$(`·`<(` 안과 파이프 단계의 앞부분만 본다 */
const LOOKAHEAD = 200;

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "ash", "fish"]);
const DOWNLOADERS = new Set(["curl", "wget"]);
/** 뒤의 명령을 그대로 실행하는 접두와, 그 접두가 값을 받는 플래그 */
const PREFIXES = new Map<string, ReadonlySet<string>>([
  ["sudo", new Set(["-u", "-g", "-h", "-p", "-C", "-D", "-R", "-T", "-U", "-r", "-t"])],
  ["env", new Set(["-u", "-C", "-S"])],
  ["exec", new Set()],
  ["command", new Set()],
  ["time", new Set()],
  ["nohup", new Set()],
]);
const SPLIT = /\s+/;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const COMMAND_FLAG = /^-[A-Za-z]*c[A-Za-z]*$/;

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

/** `sudo -u user`, `env X=1`, `VAR=1` 같은 접두를 건너뛴 첫 명령의 위치 */
function commandStart(tokens: string[]): number {
  let at = 0;
  while (at < tokens.length) {
    const token = tokens[at] as string;
    if (token === "") {
      at += 1;
      continue;
    }
    const valueFlags = PREFIXES.get(bare(token));
    if (ASSIGNMENT.test(token)) at += 1;
    else if (valueFlags) {
      at += 1;
      while (at < tokens.length && (tokens[at] as string).startsWith("-")) {
        at += valueFlags.has(tokens[at] as string) ? 2 : 1;
      }
    } else break;
  }
  return at;
}

/** 파이프 오른쪽 조각의 첫 명령이 셸이다. `sh -c '…'` 는 표준 입력을 실행하지 않으므로 제외한다. */
function startsWithShell(segment: string): boolean {
  const tokens = segment.slice(0, LOOKAHEAD).trim().split(SPLIT);
  const at = commandStart(tokens);
  if (!isShell(tokens[at])) return false;
  for (let i = at + 1; i < tokens.length && (tokens[i] as string).startsWith("-"); i += 1) {
    if (COMMAND_FLAG.test(tokens[i] as string)) return false;
  }
  return true;
}

/** 조각의 마지막 명령(`A && B`, `A; B` 의 B)이 curl·wget 으로 시작한다. 따옴표 안의 curl 은 첫 토큰이 아니라서 제외된다. */
function endsWithDownloader(segment: string): boolean {
  const cut = Math.max(segment.lastIndexOf("&&") + 2, segment.lastIndexOf("||") + 2, segment.lastIndexOf(";") + 1);
  const command = segment.slice(cut > 1 ? cut : 0);
  const tokens = command.trim().split(SPLIT);
  return isDownloader(tokens[commandStart(tokens)]);
}

/** `|` (`||` 는 제외)로 나눈다 */
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

/** curl·wget 에서 시작한 파이프라인의 어느 뒤 단계든 셸이다 (`curl … | tee f | sh`) */
function pipedToShell(line: string): boolean {
  let downloading = false;
  for (const part of splitPipes(line)) {
    if (downloading && startsWithShell(part)) return true;
    if (endsWithDownloader(part)) downloading = true;
  }
  return false;
}

const SOURCING = new Set(["source", "."]);

/** `bash <(curl …)`, `source <(curl …)`, `. <(curl …)` */
function processSubstitution(line: string): boolean {
  for (let at = line.indexOf("<("); at !== -1; at = line.indexOf("<(", at + 2)) {
    const before = line.slice(Math.max(0, at - LOOKBEHIND), at).trimEnd().split(SPLIT);
    const last = before[before.length - 1];
    if (!isShell(last) && !(last !== undefined && SOURCING.has(last))) continue;
    const inside = line.slice(at + 2, at + 2 + LOOKAHEAD).trimStart().split(SPLIT)[0];
    if (isDownloader(inside)) return true;
  }
  return false;
}

/** `sh -c "$(curl …)"`, `eval "$(curl …)"` */
function commandSubstitution(line: string): boolean {
  for (let at = line.indexOf("$("); at !== -1; at = line.indexOf("$(", at + 2)) {
    const inside = line.slice(at + 2, at + 2 + LOOKAHEAD).trimStart().split(SPLIT)[0];
    if (!isDownloader(inside)) continue;
    const before = line.slice(Math.max(0, at - LOOKBEHIND), at).split(SPLIT).filter((token) => !/^["']*$/.test(token));
    const last = before[before.length - 1]?.replace(/["']+$/, "");
    if (last === "eval") return true;
    if (last !== undefined && COMMAND_FLAG.test(last) && isShell(before[before.length - 2])) return true;
  }
  return false;
}

/**
 * 셸 스크립트에 "내려받은 내용을 바로 셸에 넘기는" 줄이 있는가: `curl … | sh`, `bash <(curl …)`, `sh -c "$(curl …)"`.
 * 줄 단위로(`\` 로 이어진 줄은 합친다) 보고 `#` 주석 줄은 건너뛴다. 길이 상한이 있어서 입력의 크기에 선형이다.
 * 예외를 던지지 않는다.
 */
export function hasCurlPipeShell(text: string): boolean {
  if (!/curl|wget/.test(text)) return false;
  for (const raw of text.replace(/\\\r?\n/g, " ").split(/\r?\n/)) {
    const line = raw.length > MAX_LINE_LENGTH ? raw.slice(0, MAX_LINE_LENGTH) : raw;
    if (!/curl|wget/.test(line) || line.trimStart().startsWith("#")) continue;
    if (pipedToShell(line) || processSubstitution(line) || commandSubstitution(line)) return true;
  }
  return false;
}
