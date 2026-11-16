import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTestApps, createTempDbPath } from "../test/testApp.ts";
import { createV1Database } from "../test/v1Schema.ts";
import { columnsOf, openDatabaseForTest, userVersionOf } from "../test/v2.ts";
import type { Db } from "./index.ts";
import { LATEST_VERSION, migrateToV2, migrateToV3, migrateToV4 } from "./schema.ts";

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

/** v4 서버가 만든 DB: 항목 3개(마지막 id 3 삭제), 검출 open/resolved(마지막 id 3 삭제) */
function createV4Database(path: string): void {
  createV1Database(path);
  const db = new Database(path);
  try {
    db.transaction(() => {
      migrateToV2(db);
      migrateToV3(db);
      migrateToV4(db);
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
      db.pragma("user_version = 4");
    })();
  } finally {
    db.close();
  }
}

const insertFinding = (db: Db, status: string, ref: string | null = null, version = "v1") =>
  ref === null
    ? db
        .prepare(
          `INSERT INTO findings (repo, file_path, package_name, version, dependency_type, blacklist_entry_id,
             status, reason, html_url, first_seen_at, last_seen_at)
           VALUES ('r', 'wf.yml', 'a', ?, 'direct', 1, ?, 'r', 'u', 't', 't')`,
        )
        .run(version, status)
    : db
        .prepare(
          `INSERT INTO findings (repo, file_path, package_name, version, dependency_type, blacklist_entry_id,
             status, reason, html_url, first_seen_at, last_seen_at, ref)
           VALUES ('r', 'wf.yml', 'a', ?, 'direct', 1, ?, 'r', 'u', 't', 't', ?)`,
        )
        .run(version, status, ref);

describe("DB 마이그레이션 v5 (외부 목록, 브랜치·작성자의 준비)", () => {
  it("[SE-10] v4 DB → v5: 행과 순번 보존, 항목은 source=manual, 검출은 ref='', user_version 5, 백업은 v4-backup", () => {
    const path = createTempDbPath();
    createV4Database(path);
    const before = new Database(path);
    const entriesBefore = before.prepare("SELECT * FROM blacklist_entries ORDER BY id").all();
    const findingsBefore = before.prepare("SELECT * FROM findings ORDER BY id").all();
    before.close();

    const { db, migratedFrom, backupPath } = open(path);

    expect(LATEST_VERSION).toBe(5);
    expect(userVersionOf(db)).toBe(5);
    expect(migratedFrom).toBe(4);
    expect(backupPath).toBe(`${path}.v4-backup`);
    expect(readdirSync(dirname(path)).filter((name) => name.includes("backup"))).toEqual([
      "package-watcher.db.v4-backup",
    ]);
    const entries = db.prepare<[], Record<string, unknown>>("SELECT * FROM blacklist_entries ORDER BY id").all();
    expect(entries).toHaveLength(entriesBefore.length);
    for (const [index, row] of entries.entries()) {
      expect(row).toMatchObject({ ...(entriesBefore[index] as object), source: "manual", external_id: null });
    }
    const findings = db.prepare<[], Record<string, unknown>>("SELECT * FROM findings ORDER BY id").all();
    expect(findings).toHaveLength(findingsBefore.length);
    for (const [index, row] of findings.entries()) {
      expect(row).toMatchObject({ ...(findingsBefore[index] as object), ref: "" });
    }
  });

  it("[SE-11] 삭제된 최대 id(항목·검출)가 다시 쓰이지 않는다", () => {
    const path = createTempDbPath();
    createV4Database(path);
    const { db } = open(path);

    const entry = db
      .prepare(
        "INSERT INTO blacklist_entries (ecosystem, name, reason, created_at, updated_at) VALUES ('npm', 'x', 'r', 't', 't')",
      )
      .run();
    expect(Number(entry.lastInsertRowid)).toBe(5);
    expect(Number(insertFinding(db, "open").lastInsertRowid)).toBe(5);
  });

  it("[SE-12] 새 열·테이블의 모양: feed_entries, repo_authors, findings.ref", () => {
    const path = createTempDbPath();
    createV4Database(path);
    const { db } = open(path);

    expect(columnsOf(db, "feed_entries")).toEqual([
      "id",
      "external_id",
      "ecosystem",
      "name",
      "version_range",
      "raw_range",
      "severity",
      "summary",
      "url",
      "updated_at",
      "seen_run",
    ]);
    expect(columnsOf(db, "repo_authors")).toEqual(["repo", "author", "first_seen_at"]);
    expect(columnsOf(db, "blacklist_entries")).toEqual(expect.arrayContaining(["source", "external_id"]));
    expect(columnsOf(db, "findings")).toContain("ref");
  });

  it("[SE-13] 검출의 부분 unique index 는 ref 를 포함한다: ref 가 다르면 같은 키도 허용, 같으면 거부, resolved 는 허용", () => {
    const path = createTempDbPath();
    createV4Database(path);
    const { db } = open(path);

    insertFinding(db, "open", "", "v9");
    expect(() => insertFinding(db, "open", "", "v9")).toThrow(/UNIQUE/);
    expect(() => insertFinding(db, "open", "feature-x", "v9")).not.toThrow();
    expect(() => insertFinding(db, "ignored", "feature-x", "v9")).toThrow(/UNIQUE/);
    expect(() => insertFinding(db, "resolved", "", "v9")).not.toThrow();
    expect(() => insertFinding(db, "resolved", "", "v9")).not.toThrow();
    const index = db
      .prepare<[], { sql: string }>("SELECT sql FROM sqlite_master WHERE name = 'findings_active_key'")
      .get();
    expect(index?.sql).toMatch(/repo, ref, file_path/);
  });

  it("[SE-14] feed_entries 의 UNIQUE (external_id, ecosystem, name, version_range)", () => {
    const path = createTempDbPath();
    createV4Database(path);
    const { db } = open(path);
    const insert = (range: string) =>
      db
        .prepare(
          `INSERT INTO feed_entries (external_id, ecosystem, name, version_range, raw_range, severity, summary, url, updated_at)
           VALUES ('GHSA-1', 'npm', 'evil', ?, '= 1', 'high', 's', 'u', 't')`,
        )
        .run(range);

    insert("1.0.0");
    insert("2.0.0");
    expect(() => insert("1.0.0")).toThrow(/UNIQUE/);
    expect(db.prepare("SELECT version_range FROM feed_entries ORDER BY id").all()).toHaveLength(2);
  });

  it("[SE-15] 새 DB 도 같은 스키마이고 마이그레이션 기록이 없다", () => {
    const fresh = createTempDbPath();
    const { db: freshDb, migratedFrom } = open(fresh);
    const old = createTempDbPath();
    createV4Database(old);
    const { db: oldDb } = open(old);

    expect(userVersionOf(freshDb)).toBe(5);
    expect(migratedFrom).toBeNull();
    const tables = (db: Db) =>
      db
        .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all()
        .map((row) => row.name);
    expect(tables(freshDb)).toEqual(tables(oldDb));
    for (const table of tables(freshDb)) expect(columnsOf(freshDb, table)).toEqual(columnsOf(oldDb, table));
  });
});
