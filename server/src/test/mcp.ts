import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import type { TestApp } from "./testApp.ts";

/** SDK 클라이언트를 `app.request()` 로 연결한다 (실제 네트워크 없음). */
export async function connectMcp(t: TestApp): Promise<Client> {
  const client = new Client({ name: "pw-server-test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: async (url, init) => t.instance.app.request(String(url), init),
  });
  await client.connect(transport);
  return client;
}

const toolResultSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  isError: z.boolean().optional(),
});

export interface ToolOutput {
  isError: boolean;
  /** 첫 text content 를 JSON.parse 한 값 */
  json: unknown;
  text: string;
}

/** tool 결과의 text content 를 JSON 으로 읽는다 (계약: 결과·오류 모두 JSON text). */
export function readToolOutput(result: unknown): ToolOutput {
  const parsed = toolResultSchema.parse(result);
  const text = parsed.content.find((item) => item.type === "text")?.text ?? "";
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { isError: parsed.isError === true, json, text };
}
