import type { Hono } from "hono";
import { notImplemented } from "../notImplemented.ts";
import type { AppServices } from "../services/index.ts";

/** `GET /api/summary`, `GET /api/findings`, `PATCH /api/findings/:id` */
export function createFindingRoutes(services: AppServices): Hono {
  return notImplemented(services);
}
