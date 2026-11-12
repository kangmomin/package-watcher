import { Hono } from "hono";
import type { AppServices } from "../services/index.ts";
import { readJsonBody } from "./errors.ts";

/** `GET/PUT /api/settings`, `POST /api/settings/test-email` */
export function createSettingsRoutes(services: AppServices): Hono {
  const app = new Hono();

  app.get("/settings", (c) => c.json(services.settings.get()));

  app.put("/settings", async (c) => {
    const body = await readJsonBody(c);
    return c.json(services.settings.update(body));
  });

  // 본문 없음. 저장된 수신자에게 보낸다.
  app.post("/settings/test-email", async (c) => c.json(await services.notifier.sendTestEmail()));

  return app;
}
