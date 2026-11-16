import { extractCommandPackages } from "./commands.ts";
import type { CommandPackage } from "./types.ts";

const RUN = /^RUN\s+(.*)$/is;
const HEREDOC = /^<<-?\s*(["']?)([A-Za-z_][\w-]*)\1/;
const MOUNT_FLAGS = /^(?:--[\w-]+(?:=\S+)?\s+)+/;

/** 줄 끝 `\` 로 이어진 줄을 합친다. 이어지는 줄 사이의 주석 줄은 버린다. */
function nextInstruction(lines: string[], from: number): { text: string; next: number } | null {
  let i = from;
  while (i < lines.length && (lines[i]?.trim() === "" || lines[i]?.trim().startsWith("#"))) i += 1;
  if (i >= lines.length) return null;
  let text = (lines[i] as string).trim();
  i += 1;
  while (text.endsWith("\\") && i < lines.length) {
    const line = (lines[i] as string).trim();
    i += 1;
    if (line.startsWith("#")) continue;
    text = `${text.slice(0, -1).trimEnd()} ${line}`;
  }
  return { text: text.endsWith("\\") ? text.slice(0, -1) : text, next: i };
}

/** Dockerfile 의 `RUN` (shell 형식, JSON 배열 형식, heredoc)에서 명령 패키지를 모은다. */
export function extractDockerfileCommands(content: string): CommandPackage[] {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  const found: CommandPackage[] = [];
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
      found.push(...extractCommandPackages(bodyLines.join("\n")));
      continue;
    }
    if (body.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(body);
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
          found.push(...extractCommandPackages(parsed.map(quoteIfNeeded).join(" ")));
          continue;
        }
      } catch {
        // JSON 이 아니면 shell 형식으로 읽는다.
      }
    }
    found.push(...extractCommandPackages(body));
  }
  return found;
}

export function quoteIfNeeded(token: string): string {
  return /[\s'"]/.test(token) ? `'${token.replaceAll("'", "'\\''")}'` : token;
}
