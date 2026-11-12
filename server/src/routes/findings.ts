import { Hono } from "hono";
import type { AppServices } from "../services/index.ts";
import { parseId, readJsonBody } from "./errors.ts";

/** `GET /api/summary`, `GET /api/findings`, `PATCH /api/findings/:id` */
export function createFindingRoutes(services: AppServices): Hono {
  const app = new Hono();

  app.get("/summary", (c) => c.json(services.findings.summary()));

  app.get("/findings", (c) => c.json(services.findings.list(c.req.query())));

  app.patch("/findings/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    // 존재 확인(404)이 본문 검증(400)보다 먼저다(S-6).
    services.findings.get(id);
    const body = await readJsonBody(c);
    return c.json(services.findings.setStatus(id, body));
  });

  return app;
}
