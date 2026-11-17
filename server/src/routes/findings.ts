import { Hono } from "hono";
import type { AppServices } from "../services/index.ts";
import { parseId, readJsonBody } from "./errors.ts";

/** `GET /api/summary`, `GET /api/findings`, `PATCH /api/findings/:id` */
export function createFindingRoutes(services: AppServices): Hono {
  const app = new Hono();

  app.get("/summary", (c) => c.json(services.findings.summary()));

  // 취약점(source = cve)의 패키지별 묶음. "/vulnerabilities/detail" 은 이름이 `/` 를 가질 수 있어 query 로 받는다.
  app.get("/vulnerabilities", (c) => c.json(services.findings.listVulnerabilities(c.req.query())));

  app.get("/vulnerabilities/detail", (c) => c.json(services.findings.vulnerabilityDetail(c.req.query())));

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
