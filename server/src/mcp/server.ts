import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  BLACKLIST_FILE_FORMATS,
  BLACKLIST_FILE_VERSION,
  BULK_ACTIONS,
  BULK_MAX_IDS,
  ECOSYSTEMS,
  ENTRY_STATUSES,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  ECOSYSTEM_RULES,
  FINDING_STATUSES,
  FINDINGS_DEFAULT_LIMIT,
  FINDINGS_MAX_LIMIT,
  SCANS_DEFAULT_LIMIT,
  SCANS_MAX_LIMIT,
  SEVERITIES,
  SUPPORTED_ECOSYSTEMS,
  type EcosystemRule,
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
  ecosystem: field({ type: "string", enum: ECOSYSTEMS, description: "정확히 일치하는 종류만. 생략하면 모든 종류" }),
  severity: field({
    type: "string",
    enum: SEVERITIES,
    description: "정확히 일치하는 심각도만(이상이 아니다). 생략하면 모든 심각도",
  }),
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
const perEcosystem = (pick: (rule: EcosystemRule) => string): string =>
  SUPPORTED_ECOSYSTEMS.map((ecosystem) => `${ecosystem}: ${pick(ECOSYSTEM_RULES[ecosystem])}`).join(" / ");
const NAME = field({
  type: "string",
  description:
    "패키지 이름. 종류의 규칙을 따른다 (예: " +
    perEcosystem((rule) => rule.nameExample) +
    "). `*` 가 있으면 패턴. pypi 는 PEP 503, nuget 은 소문자로 정규화해서 저장·비교하고 그 외는 대소문자를 구분한다",
});
const REASON = field({ type: "string", description: "사유 (1~500자)" });
const VERSION_RANGE = field({
  type: ["string", "null"],
  description:
    "종류의 버전 범위 문법 (예: " +
    perEcosystem((rule) => rule.rangeExample) +
    "). null 또는 빈 문자열 = 모든 버전",
});
const ECOSYSTEM = field({
  type: "string",
  enum: SUPPORTED_ECOSYSTEMS,
  description: "패키지 종류. 기본 npm. 등록한 뒤에는 바꿀 수 없다 (바꾸려면 새 항목으로 등록)",
});
const SEVERITY = field({ type: "string", enum: SEVERITIES, description: "심각도. 기본 medium" });
const ENABLED = field({ type: "boolean", description: "켜기. 기본 true" });
const EXPIRES_AT = field({
  type: ["string", "null"],
  description: "만료일 YYYY-MM-DD(KST, 오늘 이후). null 또는 빈 문자열 = 만료 없음",
});
const BLACKLIST_QUERY = loose({
  ecosystem: field({ type: "string", enum: ECOSYSTEMS, description: "정확히 일치하는 종류만" }),
  enabled: field({ type: "boolean", description: "사용자가 정한 켜기 값으로 거른다" }),
  q: field({ type: "string", description: "이름 부분 일치(대소문자 무시)" }),
  status: field({
    type: "string",
    enum: ENTRY_STATUSES,
    description: "active(켜짐 + 만료 안 됨) / disabled(꺼짐 + 만료 안 됨) / expired(만료, 꺼짐 여부와 무관)",
  }),
});
const FILE_FORMAT = field({ type: "string", enum: BLACKLIST_FILE_FORMATS, description: "파일 형식" });
const BULK_UPDATE = loose(
  {
    action: field({ type: "string", enum: BULK_ACTIONS, description: "enable(켜기) / disable(끄기) / delete(삭제)" }),
    ids: field({
      type: "array",
      items: { type: "integer", minimum: 1 },
      minItems: 1,
      maxItems: BULK_MAX_IDS,
      description: `대상 항목 ID (1~${BULK_MAX_IDS}개, 중복은 1개로 센다)`,
    }),
  },
  ["action", "ids"],
);
const BLACKLIST_IMPORT = loose({
  items: field({
    type: "array",
    items: { type: "object" },
    description:
      "항목 배열 ({ version: 1, items } JSON 파일의 items 와 같다). name·reason 만 필수이고 나머지는 생략하면 기본값. " +
      "format + content 와 함께 쓸 수 없다",
  }),
  format: FILE_FORMAT,
  content: field({
    type: "string",
    description: "파일 내용 (format 과 함께). items 와 함께 쓸 수 없다",
  }),
  dryRun: field({ type: "boolean", description: "기본 true = 미리 보기(저장하지 않는다). 적용하려면 false" }),
});
const BLACKLIST_EXPORT = loose(
  {
    format: FILE_FORMAT,
    ecosystem: field({ type: "string", enum: ECOSYSTEMS, description: "정확히 일치하는 종류만" }),
    enabled: field({ type: "boolean", description: "사용자가 정한 켜기 값으로 거른다" }),
    q: field({ type: "string", description: "이름 부분 일치(대소문자 무시)" }),
    status: field({ type: "string", enum: ENTRY_STATUSES, description: "list_blacklist 의 status 와 같다" }),
  },
  ["format"],
);
const NO_INPUT = loose({});
const ID_ONLY = loose({ id: ID }, ["id"]);
const FINDING_STATUS_INPUT = loose(
  { id: ID, status: field({ type: "string", enum: ["ignored", "open"] }) },
  ["id", "status"],
);
const NEW_FIELDS = { ecosystem: ECOSYSTEM, severity: SEVERITY, enabled: ENABLED, expiresAt: EXPIRES_AT };
const BLACKLIST_CREATE = loose(
  { name: NAME, versionRange: VERSION_RANGE, reason: REASON, ...NEW_FIELDS },
  ["name", "reason"],
);
const BLACKLIST_UPDATE = loose(
  { id: ID, name: NAME, versionRange: VERSION_RANGE, reason: REASON, ...NEW_FIELDS },
  ["id", "name", "versionRange", "reason"],
);

type ToolArgs = Record<string, unknown>;

/** JSON 으로 다시 감싸지 않고 그대로 돌려줄 파일 내용 */
class FileText {
  constructor(readonly text: string) {}
}

function jsonResult(value: unknown): CallToolResult {
  if (value instanceof FileText) return { content: [{ type: "text", text: value.text }] };
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

/** 예외 → MCP 오류 결과. AppError 가 아니면 INTERNAL_ERROR(원인 로그는 호출 쪽). */
function errorResult(error: unknown): CallToolResult {
  const body = toApiError(toAppError(error)).error;
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] };
}

/**
 * REST 의 `:id` 와 같은 규칙(`parseId`): 양의 정수가 아니면 NOT_FOUND.
 * 숫자 문자열("5")도 id 로 받는다 — 근거: 계약은 형식 오류를 NOT_FOUND 로만 정하고 REST 경로 값도 문자열이다.
 */
function toId(value: unknown): number {
  return parseId(typeof value === "number" || typeof value === "string" ? String(value).trim() : "");
}

/**
 * tool 13개(`list_findings`, `set_finding_status`, `list_blacklist`, `add_blacklist_entry`,
 * `update_blacklist_entry`, `remove_blacklist_entry`, `trigger_scan`, `list_scans`, `get_scan`, `get_settings`,
 * `bulk_update_blacklist`, `import_blacklist`, `export_blacklist`)를 등록한다.
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
    "블랙리스트 항목 목록을 조회한다 (GET /api/blacklist). ecosystem·enabled·q·status 로 거른다. " +
      "enabled=true 에는 만료된 항목도 포함된다(사용자가 켠 항목 전부). 결과: { items: BlacklistEntry[] }",
    BLACKLIST_QUERY,
    (args) => services.blacklist.list(args),
  );
  register(
    "add_blacklist_entry",
    "블랙리스트 항목을 추가한다 (POST /api/blacklist). versionRange 를 생략하면 모든 버전. name 에 * 를 넣으면 패턴이다. " +
      "severity 기본값은 medium. 즉시 메일 기준은 get_settings 의 notifyMinSeverity. " +
      "expiresAt: null 은 만료 해제다. 유지하려면 키를 생략한다. 결과: BlacklistEntry",
    BLACKLIST_CREATE,
    (args) => services.blacklist.create(args),
  );
  register(
    "update_blacklist_entry",
    "블랙리스트 항목을 수정한다 (PUT /api/blacklist/:id). name·versionRange·reason 은 전체 교체, 새 필드는 생략하면 유지. " +
      "versionRange 는 필수(null = 모든 버전). expiresAt: null 은 만료 해제다. 유지하려면 키를 생략한다. 결과: BlacklistEntry",
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
    "bulk_update_blacklist",
    "블랙리스트 항목 여러 개를 한 번에 켜거나(enable) 끄거나(disable) 삭제한다(delete) (POST /api/blacklist/bulk). " +
      "없는 id 가 1개라도 있으면 NOT_FOUND 이고 아무것도 바꾸지 않는다. 끄기·삭제는 그 항목의 활성 검출을 resolved 로 바꾼다. " +
      "결과: { action, count }",
    BULK_UPDATE,
    (args) => services.blacklist.bulk(args),
  );
  register(
    "import_blacklist",
    "블랙리스트를 파일 형식으로 가져온다 (POST /api/blacklist/import). items 배열 또는 format + content 중 하나를 준다. " +
      "dryRun 을 생략하면 미리 보기(저장하지 않음)이고, 적용하려면 dryRun: false 를 준다. " +
      "같은 키(종류·이름·버전 범위)의 기존 항목은 갱신하고 파일에 없는 항목은 그대로 둔다. 행 오류가 1건이라도 있으면 저장하지 않는다. " +
      `최대 ${IMPORT_MAX_BYTES / (1024 * 1024)} MB·${IMPORT_MAX_ROWS}행. 결과: { applied, created, updated, unchanged, errors: [{ row, field, message }] }`,
    BLACKLIST_IMPORT,
    (args) => {
      const { items, format, content, dryRun } = args;
      const hasFile = format !== undefined || content !== undefined;
      if ((items !== undefined) === hasFile) {
        throw new AppError("VALIDATION_ERROR", "items 또는 format + content 중 하나만 지정하십시오");
      }
      if (items === undefined) return services.blacklist.importEntries({ format, content, dryRun });
      if (!Array.isArray(items)) throw new AppError("VALIDATION_ERROR", "items 는 배열입니다");
      // 파일(JSON)과 같은 경로로 처리해서 검증·한도·결과가 같다.
      return services.blacklist.importEntries({
        format: "json",
        content: JSON.stringify({ version: BLACKLIST_FILE_VERSION, items }),
        dryRun,
      });
    },
  );
  register(
    "export_blacklist",
    "블랙리스트를 파일 형식으로 내보낸다 (GET /api/blacklist/export). format 은 json 또는 csv, 필터는 list_blacklist 와 같다. " +
      "결과: 파일 내용 문자열 (JSON 으로 감싸지 않는다. CSV 는 BOM 으로 시작한다)",
    BLACKLIST_EXPORT,
    (args) => new FileText(services.blacklist.exportEntries(args).content),
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
  // POST 가 아닌 모든 메서드에 405 — 근거: 계약은 `GET /mcp` 405 만 정한다.
  app.all("/mcp", (c) =>
    c.json(
      { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null },
      405,
      { Allow: "POST" },
    ),
  );

  return app;
}
