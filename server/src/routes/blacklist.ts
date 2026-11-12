import { Hono } from "hono";
import type { AppServices } from "../services/index.ts";
import { parseId, readJsonBody } from "./errors.ts";

/** `GET/POST /api/blacklist`, `PUT/DELETE /api/blacklist/:id` */
export function createBlacklistRoutes(services: AppServices): Hono {
  const app = new Hono();

  app.get("/blacklist", (c) => c.json(services.blacklist.list()));

  app.post("/blacklist", async (c) => {
    const body = await readJsonBody(c);
    return c.json(services.blacklist.create(body), 201);
  });

  app.put("/blacklist/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    // 존재 확인(404)이 본문 검증(400)보다 먼저다(S-6).
    services.blacklist.get(id);
    const body = await readJsonBody(c);
    return c.json(services.blacklist.update(id, body));
  });

  app.delete("/blacklist/:id", (c) => {
    services.blacklist.remove(parseId(c.req.param("id")));
    return c.body(null, 204);
  });

  return app;
}
