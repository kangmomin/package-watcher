// Phase 6.0 스모크용 최소 서버. Phase 6.2 에서 실제 조립 코드로 바꾼다.
import { serve } from "@hono/node-server";
import { ERROR_CODES } from "@pw/shared";
import { Hono } from "hono";

const app = new Hono();
app.get("/api/health", (c) => c.json({ ok: true, errorCodes: ERROR_CODES.length }));

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? "127.0.0.1";
serve({ fetch: app.fetch, port, hostname }, () => {
  console.log(`package-watcher listening on http://${hostname}:${port}`);
});
