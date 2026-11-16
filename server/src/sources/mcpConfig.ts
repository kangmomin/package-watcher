import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { isPlainObject, normalizeText } from "../lockfiles/common.ts";
import { extractCommandPackages } from "./commands.ts";
import { quoteIfNeeded } from "./dockerfile.ts";
import type { CommandPackage } from "./types.ts";

const SERVER_KEYS = ["mcpServers", "servers"] as const;
const SHELLS = new Set(["sh", "bash", "zsh"]);

/** `/usr/bin/npx`, `npx.cmd` → `npx` */
function commandName(command: string): string {
  const base = command.slice(Math.max(command.lastIndexOf("/"), command.lastIndexOf("\\")) + 1);
  return base.replace(/\.(?:cmd|exe|bat)$/i, "");
}

/** 서버 1개의 command + args 를 셸 명령 문자열 1개로 만든다. `cmd /c`·`sh -c` 형태는 감싼 명령을 꺼낸다. */
function commandLine(command: string, args: string[]): string {
  const name = commandName(command);
  const [flag, script] = args;
  if (name.toLowerCase() === "cmd" && flag?.toLowerCase() === "/c") {
    return args.length === 2 ? (script as string) : args.slice(1).map(quoteIfNeeded).join(" ");
  }
  if (SHELLS.has(name) && flag === "-c" && script !== undefined) return script;
  return [name, ...args].map(quoteIfNeeded).join(" ");
}

/** MCP 설정(JSONC 허용)의 `mcpServers`·`servers` 에서 명령 패키지를 모은다. JSON 문법 오류는 throw 한다. */
export function extractMcpCommands(content: string): CommandPackage[] {
  const errors: ParseError[] = [];
  const data: unknown = parseJsonc(normalizeText(content), errors, { allowTrailingComma: true });
  if (errors.length > 0) throw new Error("MCP 설정을 JSON 으로 읽을 수 없습니다");
  if (!isPlainObject(data)) return [];
  const found: CommandPackage[] = [];
  for (const key of SERVER_KEYS) {
    const servers = data[key];
    if (!isPlainObject(servers)) continue;
    for (const server of Object.values(servers)) {
      if (!isPlainObject(server) || typeof server.command !== "string") continue;
      const args = Array.isArray(server.args)
        ? server.args.filter((arg): arg is string => typeof arg === "string")
        : [];
      found.push(...extractCommandPackages(commandLine(server.command, args)));
    }
  }
  return found;
}
