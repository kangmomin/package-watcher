import { Hono } from "hono";
import type { AppServices } from "../services/index.ts";
import { parseId, readJsonBody } from "./errors.ts";

/** 가져오기의 본문 한도: 파일 1 MB + JSON 이스케이프(따옴표·줄바꿈)에 필요한 여유 */
const IMPORT_BODY_MAX_BYTES = 4 * 1024 * 1024;

/** `GET/POST /api/blacklist`, `PUT/DELETE /api/blacklist/:id`, `POST /bulk`, `POST /import`, `GET /export` */
export function createBlacklistRoutes(services: AppServices): Hono {
  const app = new Hono();

  app.get("/blacklist", (c) => c.json(services.blacklist.list(c.req.query())));

  // 고정 경로는 `/:id` 보다 먼저 등록한다 (`export` 가 id 로 읽히지 않게). PUT/DELETE 는 지금처럼 404 다.
  app.get("/blacklist/export", (c) => {
    const file = services.blacklist.exportEntries(c.req.query());
    return c.body(file.content, 200, {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
    });
  });

  app.post("/blacklist/bulk", async (c) => c.json(services.blacklist.bulk(await readJsonBody(c))));

  app.post("/blacklist/import", async (c) =>
    c.json(services.blacklist.importEntries(await readJsonBody(c, IMPORT_BODY_MAX_BYTES))),
  );

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
