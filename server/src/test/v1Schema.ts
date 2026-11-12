import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

/**
 * v1(`master` 5c2263e)의 `server/src/db/schema.ts` 의 `SCHEMA` 문자열을 그대로 복사해서 고정한 것이다.
 * 이후 `schema.ts` 가 바뀌어도 마이그레이션 테스트(CT-22)가 v1 DB 파일을 재현할 수 있어야 하므로 고치지 않는다.
 */
export const V1_SCHEMA = `
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

export const V1_SEEDED_AT = "2026-11-01T00:00:00.000Z";

export type V1Database = Database.Database;

/**
 * v1 서버가 만든 것과 같은 DB 파일을 만든다(`journal_mode = WAL`, `user_version = 0`).
 * `prepare` 는 v1 스키마를 적용하기 전에 실행한다(깨진 v1 DB 를 재현할 때 쓴다).
 * `seed` 가 끝나면 연결을 닫는다 — 닫아야 WAL 이 본 파일에 합쳐지고 Windows 에서 파일을 지울 수 있다.
 */
export function createV1Database(
  path: string,
  seed: (db: V1Database) => void = seedV1Rows,
  prepare: (db: V1Database) => void = () => undefined,
): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  try {
    db.pragma("journal_mode = WAL");
    prepare(db);
    db.exec(V1_SCHEMA);
    seed(db);
  } finally {
    db.close();
  }
}

export function insertV1Entry(db: V1Database, name: string, versionRange = "", reason = "사유"): number {
  const result = db
    .prepare(
      "INSERT INTO blacklist_entries (name, version_range, reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(name, versionRange, reason, V1_SEEDED_AT, V1_SEEDED_AT);
  return Number(result.lastInsertRowid);
}

export interface V1FindingSeed {
  repo: string;
  packageName: string;
  version: string;
  blacklistEntryId: number;
  status: "open" | "resolved" | "ignored";
}

export function insertV1Finding(db: V1Database, finding: V1FindingSeed): number {
  const result = db
    .prepare(
      `INSERT INTO findings (repo, file_path, package_name, version, dependency_type, blacklist_entry_id,
         status, reason, html_url, first_seen_at, last_seen_at, resolved_at, notified_at)
       VALUES (?, 'package.json', ?, ?, 'direct', ?, ?, '사유', ?, ?, ?, ?, ?)`,
    )
    .run(
      finding.repo,
      finding.packageName,
      finding.version,
      finding.blacklistEntryId,
      finding.status,
      `https://github.com/my-org/${finding.repo}/blob/HEAD/package.json`,
      V1_SEEDED_AT,
      V1_SEEDED_AT,
      finding.status === "resolved" ? V1_SEEDED_AT : null,
      V1_SEEDED_AT,
    );
  return Number(result.lastInsertRowid);
}

/** 기본 seed: 항목 3개(id 1~3), 검출 3건(id 1~3: open, resolved, ignored), 설정 3개, 끝난 스캔 1건 */
export function seedV1Rows(db: V1Database): void {
  const lodash = insertV1Entry(db, "lodash", "<4.17.21", "취약점");
  const evil = insertV1Entry(db, "evil-pkg", "", "악성 코드");
  insertV1Entry(db, "left-pad", "", "공급망");
  insertV1Finding(db, { repo: "api", packageName: "evil-pkg", version: "^1.0.0", blacklistEntryId: evil, status: "open" });
  insertV1Finding(db, { repo: "web", packageName: "lodash", version: "4.17.20", blacklistEntryId: lodash, status: "resolved" });
  insertV1Finding(db, { repo: "web", packageName: "evil-pkg", version: "^1.0.0", blacklistEntryId: evil, status: "ignored" });
  const setSetting = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
  setSetting.run("org", "my-org");
  setSetting.run("scan_interval_hours", "6");
  setSetting.run("recipients", JSON.stringify(["a@example.com"]));
  db.prepare(
    `INSERT INTO scans ("trigger", status, started_at, finished_at, repo_count, new_finding_count)
     VALUES ('manual', 'success', ?, ?, 2, 3)`,
  ).run(V1_SEEDED_AT, V1_SEEDED_AT);
}
