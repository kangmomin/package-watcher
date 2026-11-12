import type { Hono } from "hono";
import { notImplemented } from "../notImplemented.ts";
import type { AppServices } from "../services/index.ts";

/** `GET/POST /api/blacklist`, `PUT/DELETE /api/blacklist/:id` */
export function createBlacklistRoutes(services: AppServices): Hono {
  return notImplemented(services);
}
