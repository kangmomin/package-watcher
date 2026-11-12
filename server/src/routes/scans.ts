import { Hono } from "hono";
import type { AppServices } from "../services/index.ts";
import { parseId } from "./errors.ts";

/** `GET/POST /api/scans`, `GET /api/scans/:id` */
export function createScanRoutes(services: AppServices): Hono {
  const app = new Hono();

  app.get("/scans", (c) => c.json(services.scans.list(c.req.query())));

  app.get("/scans/:id", (c) => c.json(services.scans.get(parseId(c.req.param("id")))));

  // 본문은 읽지 않는다(계약: 본문 없음).
  app.post("/scans", (c) => c.json(services.scans.start("manual"), 202));

  return app;
}
