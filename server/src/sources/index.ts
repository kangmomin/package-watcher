import { isExcludedPath } from "../ecosystems/index.ts";
import { extractDockerfileCommands } from "./dockerfile.ts";
import { extractMcpCommands } from "./mcpConfig.ts";
import { extractWorkflowCommands } from "./workflow.ts";
import type { SourceFacts, SourceKind } from "./types.ts";

export type { CommandPackage, SourceFacts, SourceKind } from "./types.ts";

const WORKFLOW_DIR = ".github/workflows/";
const COMPOSE = /^(?:docker-compose|compose)[^/]*\.ya?ml$/i;

const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** 경로가 보조 파일(여러 종류의 결과를 내는 파일)이면 그 종류. 제외 폴더 안은 아니다. */
export function sourceKindOf(path: string): SourceKind | null {
  if (isExcludedPath(path)) return null;
  const rest = path.startsWith(WORKFLOW_DIR) ? path.slice(WORKFLOW_DIR.length) : null;
  if (rest !== null && !rest.includes("/") && /\.ya?ml$/.test(rest)) return "workflow";

  const name = baseName(path);
  const lower = name.toLowerCase();
  if (
    lower === "dockerfile" ||
    lower === "containerfile" ||
    lower.startsWith("dockerfile.") ||
    lower.endsWith(".dockerfile")
  ) {
    return "dockerfile";
  }
  if (COMPOSE.test(name)) return "compose";
  if (name === ".mcp.json" || name === "mcp.json") return "mcp";
  return null;
}

/** 보조 파일에서 사실을 뽑는다. 파일 형식이 깨졌으면 throw 한다(호출 쪽이 그 파일만 건너뛴다). */
export function extractSource(kind: SourceKind, path: string, content: string): SourceFacts {
  switch (kind) {
    case "workflow":
      return { path, kind, commands: extractWorkflowCommands(content) };
    case "dockerfile":
      return { path, kind, commands: extractDockerfileCommands(content) };
    case "mcp":
      return { path, kind, commands: extractMcpCommands(content) };
    case "compose":
      // 이미지는 묶음 B 가 읽는다.
      return { path, kind, commands: [] };
  }
}
