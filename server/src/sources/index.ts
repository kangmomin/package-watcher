import { isExcludedPath } from "../ecosystems/index.ts";
import { extractDockerfile } from "./dockerfile.ts";
import { extractMcpCommands } from "./mcpConfig.ts";
import { extractActionFile, extractComposeImages, extractWorkflowFacts } from "./workflow.ts";
import type { SourceFacts, SourceKind, SourceRefs } from "./types.ts";

export { isRunCommand } from "./commands.ts";
export type { ActionRef, CommandPackage, ImageRef, SourceFacts, SourceKind } from "./types.ts";

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
  if (name === "action.yml" || name === "action.yaml") return "action";
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
  const facts = (refs: SourceRefs, missingPermissions = false): SourceFacts => ({
    ...refs,
    path,
    kind,
    hasCurlPipeShell: refs.curlPipe === true,
    missingPermissions,
  });
  switch (kind) {
    case "workflow": {
      const { refs, missingPermissions } = extractWorkflowFacts(content);
      return facts(refs, missingPermissions);
    }
    case "action":
      return facts(extractActionFile(content));
    case "dockerfile":
      return facts(extractDockerfile(content));
    case "mcp":
      return facts({ commands: extractMcpCommands(content), actions: [], images: [] });
    case "compose":
      return facts(extractComposeImages(content));
  }
}
