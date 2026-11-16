import { extractCommandPackages } from "./commands.ts";
import { MAX_REF_LENGTH, parseImageRef } from "./images.ts";
import type { ImageRef, SourceRefs } from "./types.ts";

const RUN = /^(?:ONBUILD\s+)?RUN\s+([\s\S]*)$/i;
const HEREDOC = /<<-?\s*(["']?)([A-Za-z_][\w-]*)\1/;
const MOUNT_FLAGS = /^(?:--[\w-]+(?:=\S+)?\s+)+/;
const FROM = /^FROM\s+((?:--\S+\s+)*)(\S+)(?:\s+AS\s+(\S+))?\s*$/i;
const ARG = /^ARG\s+([\s\S]+)$/i;
const COPY_FROM = /^COPY\s+(?:--\S+\s+)*?--from=(\S+)/i;
const VARIABLE = /\$\{([A-Za-z_]\w*)(?::?-([^}]{0,256}))?\}|\$([A-Za-z_]\w*)/g;
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ash"]);

/** 줄 끝 `\` 로 이어진 줄을 합친다(조각을 모아 1번만 잇는다). 이어지는 줄 사이의 주석 줄은 버린다. */
function nextInstruction(lines: string[], from: number): { text: string; next: number } | null {
  let i = from;
  while (i < lines.length && (lines[i]?.trim() === "" || lines[i]?.trim().startsWith("#"))) i += 1;
  if (i >= lines.length) return null;
  const parts: string[] = [];
  for (;;) {
    const line = (lines[i] as string).trim();
    i += 1;
    if (line.startsWith("#") && parts.length > 0) {
      if (i >= lines.length) break;
      continue;
    }
    const continued = line.endsWith("\\");
    parts.push(continued ? line.slice(0, -1).trimEnd() : line);
    if (!continued || i >= lines.length) break;
  }
  return { text: parts.join(" "), next: i };
}

/** heredoc 앞의 인터프리터가 없거나 셸이면 본문은 셸 명령이다 (`python - <<EOF` 의 본문은 아니다). */
function isShellInterpreter(before: string): boolean {
  const first = before.trim().split(/\s+/)[0] ?? "";
  return first === "" || SHELLS.has(first.slice(first.lastIndexOf("/") + 1));
}

/** `$VAR`·`${VAR}`·`${VAR:-기본값}` 을 ARG 의 기본값으로 푼다. 풀 수 없는 변수가 있으면 null. */
function substitute(text: string, args: Map<string, string>): string | null {
  let unresolved = false;
  const out = text.replace(
    VARIABLE,
    (_match, braced: string | undefined, fallback: string | undefined, bare: string | undefined) => {
      const value = args.get((braced ?? bare) as string) ?? fallback;
      if (value === undefined || value === "") unresolved = true;
      return value ?? "";
    },
  );
  return unresolved ? null : out;
}

/** ARG 줄의 길이 상한(이보다 길면 건너뛴다) */
const MAX_ARG_LENGTH = 4096;

/** `ARG A=1 B="x y"` 의 기본값이 있는 인자들. 공백(따옴표 밖)으로 토큰을 나눈 뒤 토큰마다 앵커로 읽는다. */
function parseArgs(text: string, args: Map<string, string>): void {
  if (text.length > MAX_ARG_LENGTH) return;
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i] as string)) i += 1;
    let token = "";
    let quote = "";
    while (i < text.length && (quote !== "" || !/\s/.test(text[i] as string))) {
      const char = text[i] as string;
      if (quote === "" && (char === '"' || char === "'")) quote = char;
      else if (char === quote) quote = "";
      else token += char;
      i += 1;
    }
    const match = /^([A-Za-z_]\w*)=(.*)$/s.exec(token);
    if (match) args.set(match[1] as string, match[2] as string);
  }
}

/**
 * Dockerfile 에서 `RUN` (shell 형식, JSON 배열 형식, heredoc, ONBUILD RUN)의 명령 패키지와
 * `FROM`·`COPY --from` 의 이미지를 모은다. 앞의 stage 를 가리키는 것과 `scratch` 는 건너뛴다.
 */
export function extractDockerfile(content: string): SourceRefs {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  const found: SourceRefs = { commands: [], actions: [], images: [] };
  // FROM 의 치환에는 첫 FROM 앞의 ARG(전역)만 쓴다. stage 안의 ARG 는 그 stage 의 COPY 에만 보인다.
  const globalArgs = new Map<string, string>();
  const stageArgs = new Map<string, string>();
  let inStage = false;
  const stages = new Set<string>();
  const addImage = (text: string, args: Map<string, string>): void => {
    if (text.length > MAX_REF_LENGTH) return;
    const resolved = substitute(text, args);
    const image: ImageRef | null = resolved === null ? null : parseImageRef(resolved);
    if (image && image.name !== "scratch") found.images.push(image);
  };
  const add = (text: string): void => {
    for (const pkg of extractCommandPackages(text)) found.commands.push(pkg);
  };
  let at = 0;
  for (;;) {
    const instruction = nextInstruction(lines, at);
    if (!instruction) break;
    at = instruction.next;
    const run = RUN.exec(instruction.text);
    if (!run) {
      const arg = ARG.exec(instruction.text);
      if (arg) parseArgs(arg[1] as string, inStage ? stageArgs : globalArgs);
      const from = FROM.exec(instruction.text);
      if (from) {
        inStage = true;
        stageArgs.clear();
        const image = from[2] as string;
        if (!stages.has(image.toLowerCase())) addImage(image, globalArgs);
        if (from[3]) stages.add(from[3].toLowerCase());
      }
      const copy = COPY_FROM.exec(instruction.text);
      const source = copy?.[1] as string | undefined;
      if (source !== undefined && !/^\d+$/.test(source) && !stages.has(source.toLowerCase())) {
        addImage(source, new Map([...globalArgs, ...stageArgs]));
      }
      continue;
    }
    const flags = MOUNT_FLAGS.exec(run[1] as string)?.[0] ?? "";
    for (const mount of flags.matchAll(/--mount=(\S+)/g)) {
      const source = (mount[1] as string).split(",").find((part) => part.startsWith("from="))?.slice(5);
      if (source && !/^\d+$/.test(source) && !stages.has(source.toLowerCase())) addImage(source, globalArgs);
    }
    const body = (run[1] as string).slice(flags.length).trim();
    const heredoc = HEREDOC.exec(body);
    if (heredoc) {
      const delimiter = heredoc[2] as string;
      const bodyLines: string[] = [];
      while (at < lines.length && (lines[at] as string).trim() !== delimiter) {
        bodyLines.push(lines[at] as string);
        at += 1;
      }
      at += 1;
      const before = body.slice(0, heredoc.index);
      add(before);
      if (isShellInterpreter(before)) add(bodyLines.join("\n"));
      continue;
    }
    if (body.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(body);
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
          add(parsed.map(quoteIfNeeded).join(" "));
          continue;
        }
      } catch {
        // JSON 이 아니면 shell 형식으로 읽는다.
      }
    }
    add(body);
  }
  return found;
}

/** 셸 메타문자·공백·따옴표가 든 인자는 홑따옴표로 감싸서 명령 구문으로 읽히지 않게 한다. */
export function quoteIfNeeded(token: string): string {
  return /[\s'"$`;&|<>()\\]/.test(token) ? `'${token.replaceAll("'", "'\\''")}'` : token;
}
