import { Hono } from "hono";
import type { AppServices } from "../services/index.ts";
import { parseId } from "./errors.ts";

/** `GET/POST /api/scans`, `GET /api/scans/:id`, `GET /api/scans/:id/repos` */
export function createScanRoutes(services: AppServices): Hono {
  const app = new Hono();

  app.get("/scans", (c) => c.json(services.scans.list(c.req.query())));

  app.get("/scans/:id", (c) => c.json(services.scans.get(parseId(c.req.param("id")))));

  app.get("/scans/:id/repos", (c) =>
    c.json(services.scans.listRepos(parseId(c.req.param("id")), c.req.query())),
  );

  // 본문은 읽지 않는다(계약: 본문 없음).
  app.post("/scans", (c) => c.json(services.scans.start("manual"), 202));

  return app;
}
