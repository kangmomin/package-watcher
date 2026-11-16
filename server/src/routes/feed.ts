import { Hono } from "hono";
import type { AppServices } from "../services/index.ts";

/** `GET /api/feed`, `POST /api/feed/sync`, `GET /api/feed/entries` */
export function createFeedRoutes(services: AppServices): Hono {
  const app = new Hono();

  app.get("/feed", (c) => c.json(services.feed.getStatus()));

  // 시작만 하고 바로 응답한다(동기화는 백그라운드). 진행 상황은 GET /api/feed 의 syncing·syncedSoFar.
  app.post("/feed/sync", (c) => c.json(services.feed.startSync(), 202));

  app.get("/feed/entries", (c) => c.json(services.feed.entries(c.req.query())));

  return app;
}
