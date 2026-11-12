import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Hono } from "hono";
import { notImplemented } from "../notImplemented.ts";
import type { AppServices } from "../services/index.ts";

/**
 * tool 10개(`list_findings`, `set_finding_status`, `list_blacklist`, `add_blacklist_entry`,
 * `update_blacklist_entry`, `remove_blacklist_entry`, `trigger_scan`, `list_scans`, `get_scan`, `get_settings`)를 등록한다.
 * 각 tool 은 대응 REST 와 같은 서비스 함수를 호출하고 결과 JSON 을 text content 로 반환한다.
 * 오류(검증 실패 포함)는 `isError: true` + `{code, message, details?}` JSON.
 * 주의: SDK 의 inputSchema 검증 실패는 JSON 이 아닌 문장으로 나가므로 검증은 서비스에서 한다.
 */
export function createMcpServer(services: AppServices): McpServer {
  return notImplemented(services);
}

/** `/mcp` (Streamable HTTP, stateless). 요청마다 서버와 transport 를 새로 만들고 응답 후 닫는다. `GET /mcp` → 405 */
export function createMcpRoutes(services: AppServices): Hono {
  return notImplemented(services);
}
