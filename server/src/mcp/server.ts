import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  FINDING_STATUSES,
  FINDINGS_DEFAULT_LIMIT,
  FINDINGS_MAX_LIMIT,
  SCANS_DEFAULT_LIMIT,
  SCANS_MAX_LIMIT,
} from "@pw/shared";
import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../errors.ts";
import { consoleLogger, type Logger } from "../logger.ts";
import { parseId, toApiError, toAppError } from "../routes/errors.ts";
import type { AppServices } from "../services/index.ts";

const SERVER_INFO = { name: "package-watcher", version: "0.1.0" };

/*
 * SDK 의 inputSchema 검증 실패는 JSON 이 아닌 문장으로 나간다(CT-11 위반).
 * 그래서 필드는 모두 z.unknown().optional() 로 두어 SDK 검증을 통과시키고, 실제 검증은 서비스(shared zod)에서 한다.
 * tools/list 의 JSON Schema 에는 `.meta()` 로 타입·필수 여부를 적어 클라이언트에 알려 준다.
 */
const field = (meta: Record<string, unknown>) => z.unknown().optional().meta(meta);
const loose = (shape: Record<string, z.ZodType>, required: string[] = []) =>
  z.object(shape).meta(required.length > 0 ? { required } : {});

const ID = field({ type: "integer", minimum: 1, description: "대상 ID" });
const FINDINGS_QUERY = loose({
  status: field({ type: "string", enum: FINDING_STATUSES, description: "생략하면 모든 상태" }),
  repo: field({ type: "string", description: "repo 이름 부분 일치(대소문자 무시)" }),
  package: field({ type: "string", description: "패키지 이름 부분 일치(대소문자 무시)" }),
  page: field({ type: "integer", minimum: 1, description: "기본 1" }),
  limit: field({
    type: "integer",
    minimum: 1,
    maximum: FINDINGS_MAX_LIMIT,
    description: `기본 ${FINDINGS_DEFAULT_LIMIT}, 최대 ${FINDINGS_MAX_LIMIT}`,
  }),
});
const SCANS_QUERY = loose({
  page: field({ type: "integer", minimum: 1, description: "기본 1" }),
  limit: field({
    type: "integer",
    minimum: 1,
    maximum: SCANS_MAX_LIMIT,
    description: `기본 ${SCANS_DEFAULT_LIMIT}, 최대 ${SCANS_MAX_LIMIT}`,
  }),
});
const NAME = field({ type: "string", description: "npm 패키지 이름(스코프 포함, 대소문자 구분)" });
const REASON = field({ type: "string", description: "사유 (1~500자)" });
const VERSION_RANGE = field({
  type: ["string", "null"],
  description: "semver range. null 또는 빈 문자열 = 모든 버전",
});
const NO_INPUT = loose({});
const ID_ONLY = loose({ id: ID }, ["id"]);
const FINDING_STATUS_INPUT = loose(
  { id: ID, status: field({ type: "string", enum: ["ignored", "open"] }) },
  ["id", "status"],
);
const BLACKLIST_CREATE = loose({ name: NAME, versionRange: VERSION_RANGE, reason: REASON }, [
  "name",
  "reason",
]);
const BLACKLIST_UPDATE = loose({ id: ID, name: NAME, versionRange: VERSION_RANGE, reason: REASON }, [
  "id",
  "name",
  "versionRange",
  "reason",
]);

type ToolArgs = Record<string, unknown>;

function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

/** 예외 → MCP 오류 결과. AppError 가 아니면 INTERNAL_ERROR(원인 로그는 호출 쪽). */
function errorResult(error: unknown): CallToolResult {
  const body = toApiError(toAppError(error)).error;
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] };
}

/**
 * REST 의 `:id` 와 같은 규칙(`parseId`): 양의 정수가 아니면 NOT_FOUND.
 * [Assumption] 숫자 문자열("5")도 id 로 받는다 — 근거: 계약은 형식 오류를 NOT_FOUND 로만 정하고 REST 경로 값도 문자열이다.
 */
function toId(value: unknown): number {
  return parseId(typeof value === "number" || typeof value === "string" ? String(value).trim() : "");
}

/**
 * tool 10개(`list_findings`, `set_finding_status`, `list_blacklist`, `add_blacklist_entry`,
 * `update_blacklist_entry`, `remove_blacklist_entry`, `trigger_scan`, `list_scans`, `get_scan`, `get_settings`)를 등록한다.
 * 각 tool 은 대응 REST 와 같은 서비스 함수를 호출하고 결과 JSON 을 text content 로 반환한다.
 * 오류(검증 실패 포함)는 `isError: true` + `{code, message, details?}` JSON.
 * 주의: SDK 의 inputSchema 검증 실패는 JSON 이 아닌 문장으로 나가므로 검증은 서비스에서 한다.
 */
export function createMcpServer(services: AppServices, logger: Logger = consoleLogger): McpServer {
  const server = new McpServer(SERVER_INFO);

  const register = (
    name: string,
    description: string,
    inputSchema: z.ZodObject,
    run: (args: ToolArgs) => unknown,
  ): void => {
    server.registerTool(name, { description, inputSchema }, async (args: ToolArgs) => {
      try {
        return jsonResult(await run(args));
      } catch (error) {
        if (!(error instanceof AppError)) logger.error(`MCP tool ${name} 처리 중 예외`, error);
        return errorResult(error);
      }
    });
  };

  register(
    "list_findings",
    "검출 목록을 조회한다 (GET /api/findings). 결과: Page<Finding>",
    FINDINGS_QUERY,
    (args) => services.findings.list(args),
  );
  register(
    "set_finding_status",
    "검출 상태를 ignored 또는 open 으로 바꾼다 (PATCH /api/findings/:id). resolved 검출은 바꿀 수 없다. 결과: Finding",
    FINDING_STATUS_INPUT,
    (args) => services.findings.setStatus(toId(args.id), { status: args.status }),
  );
  register(
    "list_blacklist",
    "블랙리스트 항목 목록을 조회한다 (GET /api/blacklist). 결과: { items: BlacklistEntry[] }",
    NO_INPUT,
    () => services.blacklist.list(),
  );
  register(
    "add_blacklist_entry",
    "블랙리스트 항목을 추가한다 (POST /api/blacklist). versionRange 를 생략하면 모든 버전. 결과: BlacklistEntry",
    BLACKLIST_CREATE,
    (args) => services.blacklist.create(args),
  );
  register(
    "update_blacklist_entry",
    "블랙리스트 항목을 전체 교체한다 (PUT /api/blacklist/:id). versionRange 는 필수(null = 모든 버전). 결과: BlacklistEntry",
    BLACKLIST_UPDATE,
    (args) => {
      const { id: rawId, ...input } = args;
      return services.blacklist.update(toId(rawId), input);
    },
  );
  register(
    "remove_blacklist_entry",
    "블랙리스트 항목을 삭제한다 (DELETE /api/blacklist/:id). 그 항목의 활성 검출은 resolved 가 된다. 결과: { ok: true, id }",
    ID_ONLY,
    (args) => {
      const id = toId(args.id);
      services.blacklist.remove(id);
      return { ok: true, id };
    },
  );
  register(
    "trigger_scan",
    "수동 스캔을 시작한다 (POST /api/scans). 완료를 기다리지 않는다. 결과: Scan(status=running)",
    NO_INPUT,
    () => services.scans.start("manual"),
  );
  register(
    "list_scans",
    "스캔 이력을 최신 순으로 조회한다 (GET /api/scans). 결과: Page<Scan>",
    SCANS_QUERY,
    (args) => services.scans.list(args),
  );
  register(
    "get_scan",
    "스캔 1건과 실패한 repo 목록을 조회한다 (GET /api/scans/:id). 결과: Scan",
    ID_ONLY,
    (args) => services.scans.get(toId(args.id)),
  );
  register(
    "get_settings",
    "설정과 연결 상태를 조회한다 (GET /api/settings, 읽기 전용). 결과: Settings",
    NO_INPUT,
    () => services.settings.get(),
  );

  return server;
}

/** `/mcp` (Streamable HTTP, stateless). 요청마다 서버와 transport 를 새로 만들고 응답 후 닫는다. `GET /mcp` → 405 */
export function createMcpRoutes(services: AppServices, logger: Logger = consoleLogger): Hono {
  const app = new Hono();

  app.post("/mcp", async (c) => {
    const server = createMcpServer(services, logger);
    // stateless: 세션 ID 없음. JSON 응답 모드라서 handleRequest 가 끝나면 응답이 완성된다.
    const transport = new StreamableHTTPTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      return (await transport.handleRequest(c)) ?? c.body(null, 500);
    } finally {
      await server.close().catch((error: unknown) => logger.error("MCP 서버 정리 중 오류", error));
    }
  });

  // stateless 라서 SSE 스트림(GET)과 세션 종료(DELETE)를 지원하지 않는다.
  // [Assumption] POST 가 아닌 모든 메서드에 405 — 근거: 계약은 `GET /mcp` 405 만 정한다.
  app.all("/mcp", (c) =>
    c.json(
      { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null },
      405,
      { Allow: "POST" },
    ),
  );

  return app;
}
