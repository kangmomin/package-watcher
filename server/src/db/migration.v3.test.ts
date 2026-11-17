import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupTestApps,
  createTempDbPath,
  createTestApp,
  getScan,
  listScans,
} from "../test/testApp.ts";
import { createV1Database } from "../test/v1Schema.ts";
import { columnsOf, countRows, openDatabaseForTest, userVersionOf } from "../test/v2.ts";
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

/** v2 서버가 만든 DB 파일: v1 DB 에 v2 단계를 적용하고 user_version = 2 */
function createV2Database(path: string): void {
  createV1Database(path);
  const db = new Database(path);
  try {
    db.transaction(() => {
      migrateToV2(db);
      db.pragma("user_version = 2");
    })();
  } finally {
    db.close();
  }
}

function inspect<T>(path: string, read: (db: Db) => T): T {
  const db = new Database(path, { fileMustExist: true });
  try {
    return read(db);
  } finally {
    db.close();
  }
}

const tableExists = (db: Db, name: string): boolean =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;

const backupFilesIn = (dbPath: string): string[] =>
  readdirSync(dirname(dbPath))
    .filter((name) => name.includes("backup"))
    .sort();

describe("DB 마이그레이션 v3(최신은 v4) (scan_repos)", () => {
  it("[SP-08] v2 DB → v3: 행 보존, 백업 v2-backup(v2 상태 그대로), 예전 스캔의 repoStats 는 null", async () => {
    const path = createTempDbPath();
    createV2Database(path);

    const { db, migratedFrom, backupPath } = open(path);

    expect(userVersionOf(db)).toBe(6);
    expect(migratedFrom).toBe(2);
    expect(backupPath).toBe(`${path}.v2-backup`);
    expect(backupFilesIn(path)).toEqual(["package-watcher.db.v2-backup"]);
    expect(countRows(db, "blacklist_entries")).toBe(3);
    expect(countRows(db, "findings")).toBe(3);
    expect(countRows(db, "scans")).toBe(1);
    expect(countRows(db, "settings")).toBe(3);
    expect(columnsOf(db, "scans")).toContain("repo_stats");
    expect(columnsOf(db, "scan_repos")).toEqual([
      "scan_id",
      "repo",
      "status",
      "open_finding_count",
      "new_finding_count",
      "file_count",
      "error",
      "started_at",
      "finished_at",
      "branch_count", // v5 가 추가한다
    ]);
    const backup = inspect(`${path}.v2-backup`, (old) => ({
      version: userVersionOf(old),
      scanColumns: columnsOf(old, "scans"),
      hasScanRepos: tableExists(old, "scan_repos"),
    }));
    expect(backup.version).toBe(2);
    expect(backup.scanColumns).not.toContain("repo_stats");
    expect(backup.hasScanRepos).toBe(false);
    db.close();

    const t = createTestApp({ dbPath: path });
    expect((await getScan(t, 1)).repoStats).toBeNull();
    expect((await listScans(t)).items.map((scan) => scan.repoStats)).toEqual([null]);
  });

  it("[SP-08] v0(v1) DB → 최신: 한 번에 최신으로 올라가고 백업은 v0-backup", () => {
    const path = createTempDbPath();
    createV1Database(path);

    const { db, migratedFrom, backupPath } = open(path);

    expect(userVersionOf(db)).toBe(6);
    expect(migratedFrom).toBe(0);
    expect(backupPath).toBe(`${path}.v0-backup`);
    expect(backupFilesIn(path)).toEqual(["package-watcher.db.v0-backup"]);
    expect(columnsOf(db, "blacklist_entries")).toContain("ecosystem");
    expect(columnsOf(db, "scans")).toContain("repo_stats");
    expect(tableExists(db, "scan_repos")).toBe(true);
    expect(countRows(db, "scans")).toBe(1);
  });

  it("[SP-08] 새 DB → 최신: 백업 없음, 테이블·인덱스·제약이 있다", () => {
    const path = createTempDbPath();

    const { db, migratedFrom, backupPath } = open(path);

    expect(userVersionOf(db)).toBe(6);
    expect(migratedFrom).toBeNull();
    expect(backupPath).toBeNull();
    expect(backupFilesIn(path)).toEqual([]);
    const indexes = db
      .prepare<[], { name: string }>("SELECT name FROM pragma_index_list('scan_repos')")
      .all();
    expect(indexes.length).toBeGreaterThanOrEqual(2); // PK 의 자동 인덱스 + (scan_id, status)
    const insert = (scanId: number, repo: string, status: string) =>
      db.prepare("INSERT INTO scan_repos (scan_id, repo, status) VALUES (?, ?, ?)").run(scanId, repo, status);
    insert(1, "a", "pending");
    expect(() => insert(1, "a", "pending")).toThrow(); // PRIMARY KEY (scan_id, repo)
    expect(() => insert(1, "b", "bogus")).toThrow(); // CHECK
    expect(
      db.prepare("SELECT open_finding_count, new_finding_count, file_count, error FROM scan_repos").get(),
    ).toEqual({ open_finding_count: 0, new_finding_count: 0, file_count: 0, error: null });
  });

  it("[SP-08] 마이그레이션이 실패하면 전체가 롤백되고 user_version 은 그대로, 백업은 v2-backup", () => {
    const path = createTempDbPath();
    createV2Database(path);
    // scan_repos 가 이미 있으면 v3 단계의 CREATE TABLE 이 실패한다.
    const seeded = new Database(path);
    seeded.exec("CREATE TABLE scan_repos (x INTEGER)");
    seeded.close();

    expect(() => open(path)).toThrow();

    const after = inspect(path, (check) => ({
      version: userVersionOf(check),
      scanColumns: columnsOf(check, "scans"),
    }));
    expect(after.version).toBe(2);
    expect(after.scanColumns).not.toContain("repo_stats");
    expect(backupFilesIn(path)).toEqual(["package-watcher.db.v2-backup"]);
  });

  it("[SP-08] v3 DB 를 다시 시작해도 다시 마이그레이션하지 않는다", () => {
    const path = createTempDbPath();
    createV2Database(path);
    open(path).db.close();

    const second = open(path);

    expect(userVersionOf(second.db)).toBe(6);
    expect(second.migratedFrom).toBeNull();
    expect(second.backupPath).toBeNull();
  });
});
