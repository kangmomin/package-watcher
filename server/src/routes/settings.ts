import type { Hono } from "hono";
import { notImplemented } from "../notImplemented.ts";
import type { AppServices } from "../services/index.ts";

/** `GET/PUT /api/settings`, `POST /api/settings/test-email` */
export function createSettingsRoutes(services: AppServices): Hono {
  return notImplemented(services);
}
