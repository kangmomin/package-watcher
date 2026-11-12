import { notImplemented } from "../notImplemented.ts";
import type { Db } from "./index.ts";

/**
 * `CREATE TABLE IF NOT EXISTS` 4개: `blacklist_entries`, `findings`, `scans`, `settings`.
 * Spec "DB 변경" + `findings.reason`, `findings.html_url`.
 * `blacklist_entries.version_range` 는 `NOT NULL DEFAULT ''` (API 경계에서 `''` ↔ `null`).
 */
export function applySchema(db: Db): void {
  notImplemented(db);
}
