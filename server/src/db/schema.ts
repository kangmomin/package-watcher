import type { Db } from "./index.ts";

// 시각은 모두 ISO 8601 UTC 문자열(`Date#toISOString`)로 저장한다. 문자열 정렬 = 시간 순서.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS blacklist_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  version_range TEXT NOT NULL DEFAULT '',
  reason        TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (name, version_range)
);

CREATE TABLE IF NOT EXISTS findings (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  repo               TEXT NOT NULL,
  file_path          TEXT NOT NULL,
  package_name       TEXT NOT NULL,
  version            TEXT NOT NULL,
  dependency_type    TEXT NOT NULL CHECK (dependency_type IN ('direct', 'transitive')),
  blacklist_entry_id INTEGER NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'ignored')),
  reason             TEXT NOT NULL,
  html_url           TEXT NOT NULL,
  first_seen_at      TEXT NOT NULL,
  last_seen_at       TEXT NOT NULL,
  resolved_at        TEXT,
  notified_at        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS findings_active_key
  ON findings (repo, file_path, package_name, version, blacklist_entry_id)
  WHERE status IN ('open', 'ignored');
CREATE INDEX IF NOT EXISTS findings_status ON findings (status);
CREATE INDEX IF NOT EXISTS findings_entry ON findings (blacklist_entry_id);
CREATE INDEX IF NOT EXISTS findings_order ON findings (first_seen_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS scans (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  "trigger"         TEXT NOT NULL CHECK ("trigger" IN ('scheduled', 'manual')),
  status            TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed')),
  started_at        TEXT NOT NULL,
  finished_at       TEXT,
  repo_count        INTEGER NOT NULL DEFAULT 0,
  new_finding_count INTEGER NOT NULL DEFAULT 0,
  failed_repos      TEXT NOT NULL DEFAULT '[]',
  error             TEXT
);
CREATE INDEX IF NOT EXISTS scans_order ON scans (started_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/**
 * `CREATE TABLE IF NOT EXISTS` 4개: `blacklist_entries`, `findings`, `scans`, `settings`.
 * Spec "DB 변경" + `findings.reason`, `findings.html_url`.
 * `blacklist_entries.version_range` 는 `NOT NULL DEFAULT ''` (API 경계에서 `''` ↔ `null`).
 */
export function applySchema(db: Db): void {
  db.exec(SCHEMA);
}
