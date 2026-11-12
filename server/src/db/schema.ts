import type { Db } from "./index.ts";

export const LATEST_VERSION = 2;

// 시각은 모두 ISO 8601 UTC 문자열(`Date#toISOString`)로 저장한다. 문자열 정렬 = 시간 순서.
// v1 스키마다. 새 DB 도 이것을 먼저 만든 뒤 v2 단계를 실행한다(마이그레이션 SQL 이 한 벌이다).
const V1_SCHEMA = `
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

// 값 목록은 SQL 리터럴로 고정한다. 한 번 배포한 마이그레이션 SQL 은 바뀌면 안 되므로 shared 상수를 끼워 넣지 않는다.
// 종류 7개를 지금 넣어 두면 이후 묶음이 DB 를 바꾸지 않아도 된다.
const ECOSYSTEM_CHECK = "ecosystem IN ('npm', 'go', 'pypi', 'nuget', 'cargo', 'pub', 'maven')";
const SEVERITY_CHECK = "severity IN ('critical', 'high', 'medium', 'low')";

const V2_FINDINGS = `
ALTER TABLE findings ADD COLUMN ecosystem TEXT NOT NULL DEFAULT 'npm' CHECK (${ECOSYSTEM_CHECK});
ALTER TABLE findings ADD COLUMN severity TEXT NOT NULL DEFAULT 'medium' CHECK (${SEVERITY_CHECK});
`;

// unique 제약을 바꾸려면 테이블을 다시 만들어야 한다.
const V2_BLACKLIST_REBUILD = `
CREATE TABLE blacklist_entries_v2 (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ecosystem     TEXT NOT NULL DEFAULT 'npm' CHECK (${ECOSYSTEM_CHECK}),
  name          TEXT NOT NULL,
  version_range TEXT NOT NULL DEFAULT '',
  reason        TEXT NOT NULL,
  severity      TEXT NOT NULL DEFAULT 'medium' CHECK (${SEVERITY_CHECK}),
  enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  expires_at    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (ecosystem, name, version_range)
);
INSERT INTO blacklist_entries_v2 (id, name, version_range, reason, created_at, updated_at)
  SELECT id, name, version_range, reason, created_at, updated_at FROM blacklist_entries;
DROP TABLE blacklist_entries;
ALTER TABLE blacklist_entries_v2 RENAME TO blacklist_entries;
`;

/**
 * 호출자가 연 트랜잭션 안에서 v2 로 올린다. 어느 단계든 실패하면 호출자가 롤백한다.
 * v1 SCHEMA 를 먼저 실행하는 이유: `blacklist_entries` 만 있고 `findings` 가 빠진 DB 가 `ALTER TABLE` 에서 영원히 실패하는 것을 막는다.
 */
export function migrateToV2(db: Db): void {
  db.exec(V1_SCHEMA);
  db.exec(V2_FINDINGS);
  // 삭제된 항목의 id 가 다시 쓰이면 옛 resolved 검출이 새 항목의 것으로 보이므로 AUTOINCREMENT 순번을 보존한다.
  const previousSeq =
    db
      .prepare<[], { seq: number }>("SELECT seq FROM sqlite_sequence WHERE name = 'blacklist_entries'")
      .get()?.seq ?? 0;
  db.exec(V2_BLACKLIST_REBUILD);
  const maxId =
    db.prepare<[], { max: number | null }>("SELECT max(id) AS max FROM blacklist_entries").get()?.max ?? 0;
  // 항목이 0개면 sqlite_sequence 에 행이 없어서 UPDATE 로는 되돌릴 수 없다.
  db.exec("DELETE FROM sqlite_sequence WHERE name = 'blacklist_entries'");
  db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('blacklist_entries', ?)").run(
    Math.max(previousSeq, maxId),
  );
}
