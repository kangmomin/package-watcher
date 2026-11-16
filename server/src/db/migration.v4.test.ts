import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTestApps, createTempDbPath } from "../test/testApp.ts";
import { createV1Database } from "../test/v1Schema.ts";
import { countRows, openDatabaseForTest, userVersionOf } from "../test/v2.ts";
import type { Db } from "./index.ts";
import { migrateToV2 } from "./schema.ts";

const handles: Db[] = [];

function open(path: string) {
  const opened = openDatabaseForTest(path);
  handles.push(opened.db);
  return opened;
}

afterEach(async () => {
  for (const db of handles.splice(0)) {
    if (db.open) db.close();
  }
  await cleanupTestApps();
});

// v3 가 만드는 scan_repos 는 v4 가 건드리지 않으므로 v3 단계의 SQL 을 그대로 복사해서 고정한다.
const V3_SQL = `
CREATE TABLE scan_repos (
  scan_id INTEGER NOT NULL, repo TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'passed', 'issue', 'failed', 'skipped')),
  open_finding_count INTEGER NOT NULL DEFAULT 0, new_finding_count INTEGER NOT NULL DEFAULT 0,
  file_count INTEGER NOT NULL DEFAULT 0, error TEXT, started_at TEXT, finished_at TEXT,
  PRIMARY KEY (scan_id, repo)
);
ALTER TABLE scans ADD COLUMN repo_stats TEXT;
`;

/** v3 서버가 만든 DB: 항목 4개(마지막 id 4 삭제), 검출 open/resolved/ignored(마지막 id 4 삭제) */
function createV3Database(path: string): void {
  createV1Database(path);
  const db = new Database(path);
  try {
    db.transaction(() => {
      migrateToV2(db);
      db.exec(V3_SQL);
      db.prepare(
        "INSERT INTO blacklist_entries (ecosystem, name, version_range, reason, created_at, updated_at) VALUES ('go', 'github.com/x/y', '<v1.0.0', 'r', 't', 't')",
      ).run();
      db.prepare("DELETE FROM blacklist_entries WHERE id = 4").run();
      db.prepare(
        `INSERT INTO findings (repo, file_path, package_name, version, dependency_type, blacklist_entry_id,
           status, reason, html_url, first_seen_at, last_seen_at, ecosystem, severity)
         VALUES ('r', 'go.mod', 'x', 'v1', 'direct', 4, 'open', 'r', 'u', 't', 't', 'go', 'high')`,
      ).run();
      db.prepare("DELETE FROM findings WHERE id = 4").run();
      db.pragma("user_version = 3");
    })();
  } finally {
    db.close();
  }
}

const insertEntry = (db: Db, ecosystem: string, name: string, range = "") =>
  Number(
    db
      .prepare(
        "INSERT INTO blacklist_entries (ecosystem, name, version_range, reason, created_at, updated_at) VALUES (?, ?, ?, 'r', 't', 't')",
      )
      .run(ecosystem, name, range).lastInsertRowid,
  );

const insertFinding = (db: Db, ecosystem: string, status: string, version = "v1") =>
  db
    .prepare(
      `INSERT INTO findings (repo, file_path, package_name, version, dependency_type, blacklist_entry_id,
         status, reason, html_url, first_seen_at, last_seen_at, ecosystem)
       VALUES ('r', 'wf.yml', 'a/b', ?, 'direct', 1, ?, 'r', 'u', 't', 't', ?)`,
    )
    .run(version, status, ecosystem);

describe("DB 마이그레이션 v4 (종류의 CHECK 제거)", () => {
  it("[SB-10] v3 DB → v4: 행이 그대로이고 user_version 4, 백업은 v3-backup", () => {
    const path = createTempDbPath();
    createV3Database(path);
    const before = new Database(path);
    const entriesBefore = before.prepare("SELECT * FROM blacklist_entries ORDER BY id").all();
    const findingsBefore = before.prepare("SELECT * FROM findings ORDER BY id").all();
    before.close();

    const { db, migratedFrom, backupPath } = open(path);

    expect(userVersionOf(db)).toBe(5);
    expect(migratedFrom).toBe(3);
    expect(backupPath).toBe(`${path}.v3-backup`);
    expect(readdirSync(dirname(path)).filter((name) => name.includes("backup"))).toEqual([
      "package-watcher.db.v3-backup",
    ]);
    // v5 가 열(source, external_id, ref)을 더하므로 v4 의 열 값만 비교한다.
    const subset = (rows: unknown[]) => rows.map((row) => expect.objectContaining(row as object));
    expect(db.prepare("SELECT * FROM blacklist_entries ORDER BY id").all()).toEqual(subset(entriesBefore));
    expect(db.prepare("SELECT * FROM findings ORDER BY id").all()).toEqual(subset(findingsBefore));
    expect(countRows(db, "findings")).toBe(3);
  });

  it("[SB-11] 삭제된 최대 id(항목·검출)가 다시 쓰이지 않는다", () => {
    const path = createTempDbPath();
    createV3Database(path);

    const { db } = open(path);

    expect(insertEntry(db, "actions", "evil/action")).toBe(5);
    expect(Number(insertFinding(db, "actions", "open").lastInsertRowid)).toBe(5);
  });

  it("[SB-12] 새 종류(actions, docker)를 저장할 수 있고 UNIQUE 는 종류별로 구분한다", () => {
    const path = createTempDbPath();
    createV3Database(path);
    const { db } = open(path);

    insertEntry(db, "actions", "a/b", "v1");
    insertEntry(db, "docker", "a/b", "v1");
    expect(() => insertEntry(db, "actions", "a/b", "v1")).toThrow(/UNIQUE/);
    expect(() => insertFinding(db, "docker", "open")).not.toThrow();
  });

  it("[SB-13] 부분 unique index 가 동작한다 (open·ignored 만 중복 불가, resolved 는 허용)", () => {
    const path = createTempDbPath();
    createV3Database(path);
    const { db } = open(path);

    insertFinding(db, "actions", "open", "v9");
    expect(() => insertFinding(db, "actions", "open", "v9")).toThrow(/UNIQUE/);
    insertFinding(db, "actions", "resolved", "v8");
    expect(() => insertFinding(db, "actions", "resolved", "v8")).not.toThrow();
    const indexes = db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'findings'")
      .all()
      .map((row) => row.name);
    expect(indexes).toEqual(expect.arrayContaining(["findings_active_key", "findings_status", "findings_entry", "findings_order"]));
  });

  it("[SB-14] 심각도·상태의 CHECK 는 남아 있다", () => {
    const path = createTempDbPath();
    createV3Database(path);
    const { db } = open(path);

    expect(() => insertFinding(db, "actions", "bogus")).toThrow(/CHECK/);
    expect(() => db.prepare("UPDATE blacklist_entries SET severity = 'x' WHERE id = 1").run()).toThrow(/CHECK/);
  });

  it("[SB-15] 새 DB(v0)도 같은 결과: 최신 버전이고 새 종류를 저장할 수 있다", () => {
    const path = createTempDbPath();

    const { db, migratedFrom } = open(path);

    expect(userVersionOf(db)).toBe(5);
    expect(migratedFrom).toBeNull();
    expect(() => insertEntry(db, "docker", "node", "20")).not.toThrow();
  });
});
