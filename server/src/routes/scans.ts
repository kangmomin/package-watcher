import type { Hono } from "hono";
import { notImplemented } from "../notImplemented.ts";
import type { AppServices } from "../services/index.ts";

/** `GET/POST /api/scans`, `GET /api/scans/:id` */
export function createScanRoutes(services: AppServices): Hono {
  return notImplemented(services);
}
