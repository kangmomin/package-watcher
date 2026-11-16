import { extractCommandPackages } from "./commands.ts";
import type { CommandPackage } from "./types.ts";

const RUN = /^(?:ONBUILD\s+)?RUN\s+([\s\S]*)$/i;
const HEREDOC = /<<-?\s*(["']?)([A-Za-z_][\w-]*)\1/;
const MOUNT_FLAGS = /^(?:--[\w-]+(?:=\S+)?\s+)+/;
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

/** Dockerfile 의 `RUN` (shell 형식, JSON 배열 형식, heredoc, ONBUILD RUN)에서 명령 패키지를 모은다. */
export function extractDockerfileCommands(content: string): CommandPackage[] {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  const found: CommandPackage[] = [];
  const add = (text: string): void => {
    for (const pkg of extractCommandPackages(text)) found.push(pkg);
  };
  let at = 0;
  for (;;) {
    const instruction = nextInstruction(lines, at);
    if (!instruction) break;
    at = instruction.next;
    const run = RUN.exec(instruction.text);
    if (!run) continue;
    const body = (run[1] as string).replace(MOUNT_FLAGS, "").trim();
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
