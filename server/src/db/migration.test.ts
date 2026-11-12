import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  allFindings,
  cleanupTestApps,
  createTempDbPath,
  createTestApp,
  getScan,
  getSettings,
} from "../test/testApp.ts";
import {
  createV1Database,
  insertV1Entry,
  seedV1Rows,
  V1_SEEDED_AT,
  type V1Database,
} from "../test/v1Schema.ts";
import {
  columnsOf,
  countRows,
  listEntries,
  openDatabaseForTest,
  userVersionOf,
  type OpenedDatabase,
} from "../test/v2.ts";
import type { Db } from "./index.ts";

const LATEST_VERSION = 2;
const backupPathOf = (dbPath: string): string => `${dbPath}.v0-backup`;

const handles: Db[] = [];

/** `openDatabase` 로 연다. 연결은 afterEach 가 닫는다(Windows 는 열린 파일이 있으면 임시 폴더를 지우지 못한다). */
function open(path: string): OpenedDatabase {
  const opened = openDatabaseForTest(path);
  handles.push(opened.db);
  return opened;
}

/** 시작 거부를 기대할 때 쓴다. 거부하면 그 오류를, 열리면 null 을 반환한다. */
function openExpectingRefusal(path: string): Error | null {
  try {
    open(path);
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

/** 서버와 별개의 연결로 파일을 직접 확인하고 바로 닫는다. */
function inspect<T>(path: string, read: (db: V1Database) => T): T {
  const db = new Database(path, { fileMustExist: true });
  try {
    return read(db);
  } finally {
    db.close();
  }
}

function backupFilesIn(dbPath: string): string[] {
  return readdirSync(dirname(dbPath))
    .filter((name) => name.includes("backup"))
    .sort();
}

const entryIds = (db: Db): number[] =>
  db
    .prepare<[], { id: number }>("SELECT id FROM blacklist_entries ORDER BY id")
    .all()
    .map((row) => row.id);

const insertPlainEntry = (db: Db, name: string): number =>
  Number(
    db
      .prepare(
        "INSERT INTO blacklist_entries (name, version_range, reason, created_at, updated_at) VALUES (?, '', '새 항목', ?, ?)",
      )
      .run(name, V1_SEEDED_AT, V1_SEEDED_AT).lastInsertRowid,
  );

afterEach(async () => {
  for (const db of handles.splice(0)) {
    if (db.open) db.close();
  }
  await cleanupTestApps();
});

describe("DB 마이그레이션 v1 → v2 (CT-22)", () => {
  it("[v2-AC-08][CT-22] v1 DB(항목·검출·설정 있음)로 시작 → 행 수와 id 보존, 항목 = npm/medium/enabled, 검출 = npm/medium, user_version = 2", () => {
    const path = createTempDbPath();
    createV1Database(path);

    const { db, migratedFrom } = open(path);

    expect(userVersionOf(db)).toBe(LATEST_VERSION);
    expect(migratedFrom).toBe(0);
    const entries = db
      .prepare(
        `SELECT id, name, version_range, reason, ecosystem, severity, enabled, expires_at, created_at, updated_at
         FROM blacklist_entries ORDER BY id`,
      )
      .all();
    const common = {
      ecosystem: "npm",
      severity: "medium",
      enabled: 1,
      expires_at: null,
      created_at: V1_SEEDED_AT,
      updated_at: V1_SEEDED_AT,
    };
    expect(entries).toEqual([
      { id: 1, name: "lodash", version_range: "<4.17.21", reason: "취약점", ...common },
      { id: 2, name: "evil-pkg", version_range: "", reason: "악성 코드", ...common },
      { id: 3, name: "left-pad", version_range: "", reason: "공급망", ...common },
    ]);
    const findings = db
      .prepare(
        `SELECT id, repo, package_name, blacklist_entry_id, status, ecosystem, severity, resolved_at, notified_at
         FROM findings ORDER BY id`,
      )
      .all();
    const finding = { ecosystem: "npm", severity: "medium", notified_at: V1_SEEDED_AT };
    expect(findings).toEqual([
      { id: 1, repo: "api", package_name: "evil-pkg", blacklist_entry_id: 2, status: "open", resolved_at: null, ...finding },
      { id: 2, repo: "web", package_name: "lodash", blacklist_entry_id: 1, status: "resolved", resolved_at: V1_SEEDED_AT, ...finding },
      { id: 3, repo: "web", package_name: "evil-pkg", blacklist_entry_id: 2, status: "ignored", resolved_at: null, ...finding },
    ]);
    expect(countRows(db, "scans")).toBe(1);
    expect(countRows(db, "settings")).toBe(3);
  });

  it("[v2-AC-08][CT-22] v1 DB 로 서버를 시작하면 API 가 기존 항목·검출·설정을 같은 id 로, 새 필드의 기본값과 함께 반환한다", async () => {
    const path = createTempDbPath();
    createV1Database(path);

    const t = createTestApp({ dbPath: path });

    expect(userVersionOf(t.instance.db)).toBe(LATEST_VERSION);
    const entries = await listEntries(t);
    expect(entries.map((entry) => [entry.id, entry.name, entry.versionRange])).toEqual([
      [2, "evil-pkg", null],
      [3, "left-pad", null],
      [1, "lodash", "<4.17.21"],
    ]);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        ecosystem: "npm",
        severity: "medium",
        enabled: true,
        expiresAt: null,
        isExpired: false,
      });
    }
    const findings = await allFindings(t);
    expect(findings.map((item) => [item.id, item.status, item.ecosystem, item.severity]).sort()).toEqual([
      [1, "open", "npm", "medium"],
      [2, "resolved", "npm", "medium"],
      [3, "ignored", "npm", "medium"],
    ]);
    expect(await getSettings(t)).toMatchObject({
      org: "my-org",
      scanIntervalHours: 6,
      recipients: ["a@example.com"],
      notifyMinSeverity: "low",
    });
  });

  it("[CT-22] 마이그레이션 후 unique 는 (ecosystem, name, version_range) 다: 종류만 다른 행은 들어가고 3개 키가 같은 행은 실패한다", () => {
    const path = createTempDbPath();
    createV1Database(path);

    const { db } = open(path);

    expect(userVersionOf(db)).toBe(LATEST_VERSION);
    const insert = db.prepare(
      `INSERT INTO blacklist_entries (ecosystem, name, version_range, reason, created_at, updated_at)
       VALUES (?, ?, ?, '사유', '${V1_SEEDED_AT}', '${V1_SEEDED_AT}')`,
    );
    expect(() => insert.run("go", "lodash", "<4.17.21")).not.toThrow();
    expect(() => insert.run("pypi", "evil-pkg", "")).not.toThrow();
    expect(() => insert.run("npm", "lodash", "<4.17.21")).toThrow(/UNIQUE/);
    expect(() => insert.run("go", "lodash", "<4.17.21")).toThrow(/UNIQUE/);
    expect(() => insert.run("npm", "evil-pkg", "")).toThrow(/UNIQUE/);
    expect(() => insert.run("npm", "lodash", "<5")).not.toThrow();
    expect(countRows(db, "blacklist_entries")).toBe(6);
  });

  it("[CT-22] v1 에서 최대 id 항목을 삭제한 DB → 마이그레이션 후 새 항목의 id 는 삭제된 id 보다 크다", () => {
    const path = createTempDbPath();
    createV1Database(path, (db) => {
      seedV1Rows(db);
      db.prepare("DELETE FROM blacklist_entries WHERE id = 3").run();
    });

    const { db } = open(path);

    // 전제: 테이블을 다시 만드는 마이그레이션이 실행됐다.
    expect(userVersionOf(db)).toBe(LATEST_VERSION);
    expect(columnsOf(db, "blacklist_entries")).toContain("ecosystem");
    expect(entryIds(db)).toEqual([1, 2]);
    expect(insertPlainEntry(db, "new-pkg")).toBe(4);
  });

  it("[CT-22] 항목을 모두 지운 v1 DB(최대 id 5) → 마이그레이션 후 새 항목의 id 는 6 이다", () => {
    const path = createTempDbPath();
    createV1Database(path, (db) => {
      for (const name of ["a-pkg", "b-pkg", "c-pkg", "d-pkg", "e-pkg"]) insertV1Entry(db, name);
      db.prepare("DELETE FROM blacklist_entries").run();
    });

    const { db } = open(path);

    // 전제: 테이블을 다시 만드는 마이그레이션이 실행됐다.
    expect(userVersionOf(db)).toBe(LATEST_VERSION);
    expect(columnsOf(db, "blacklist_entries")).toContain("ecosystem");
    expect(entryIds(db)).toEqual([]);
    expect(insertPlainEntry(db, "new-pkg")).toBe(6);
  });

  it("[CT-22] 마이그레이션 후 findings 에 ecosystem = 'go' 는 들어가고 'foo' 는 CHECK 로 실패한다", () => {
    const path = createTempDbPath();
    createV1Database(path);

    const { db } = open(path);

    expect(userVersionOf(db)).toBe(LATEST_VERSION);
    const insert = db.prepare(
      `INSERT INTO findings (repo, file_path, package_name, version, dependency_type, blacklist_entry_id,
         status, reason, html_url, first_seen_at, last_seen_at, ecosystem)
       VALUES ('svc', 'go.mod', ?, 'v1.0.0', 'direct', 1, 'open', '사유', 'https://example.com', '${V1_SEEDED_AT}', '${V1_SEEDED_AT}', ?)`,
    );
    expect(() => insert.run("github.com/evil/tool", "go")).not.toThrow();
    expect(() => insert.run("github.com/evil/other", "foo")).toThrow(/CHECK/);
    expect(countRows(db, "findings")).toBe(4);
  });

  it("[CT-22] 마이그레이션 직전에 백업 파일 package-watcher.db.v0-backup 이 생긴다 (내용은 v1 상태, 기존 백업 파일은 새 내용으로 교체)", () => {
    const path = createTempDbPath();
    createV1Database(path);
    const backupPath = backupPathOf(path);
    writeFileSync(backupPath, "이전 백업 파일");

    const opened = open(path);

    expect(userVersionOf(opened.db)).toBe(LATEST_VERSION);
    expect(opened.backupPath).toBe(backupPath);
    expect(existsSync(backupPath)).toBe(true);
    expect(backupFilesIn(path)).toEqual(["package-watcher.db.v0-backup"]);
    const backup = inspect(backupPath, (db) => ({
      userVersion: userVersionOf(db),
      entryColumns: columnsOf(db, "blacklist_entries"),
      findingColumns: columnsOf(db, "findings"),
      entries: countRows(db, "blacklist_entries"),
      findings: countRows(db, "findings"),
      settings: countRows(db, "settings"),
      scans: countRows(db, "scans"),
    }));
    expect(backup).toMatchObject({ userVersion: 0, entries: 3, findings: 3, settings: 3, scans: 1 });
    expect(backup.entryColumns).toEqual(["id", "name", "version_range", "reason", "created_at", "updated_at"]);
    expect(backup.findingColumns).not.toContain("ecosystem");
  });

  it("[CT-22] 백업 실패(백업 경로에 같은 이름의 디렉터리) → 마이그레이션하지 않고 시작을 거부한다 (user_version = 0 유지)", () => {
    const path = createTempDbPath();
    createV1Database(path);
    mkdirSync(backupPathOf(path));

    const refused = openExpectingRefusal(path);

    expect(refused, "openDatabase 가 시작을 거부하지 않았습니다").toBeInstanceOf(Error);
    const after = inspect(path, (db) => ({
      userVersion: userVersionOf(db),
      entryColumns: columnsOf(db, "blacklist_entries"),
      entries: countRows(db, "blacklist_entries"),
      findings: countRows(db, "findings"),
    }));
    expect(after).toEqual({
      userVersion: 0,
      entryColumns: ["id", "name", "version_range", "reason", "created_at", "updated_at"],
      entries: 3,
      findings: 3,
    });
    expect(() => createTestApp({ dbPath: path })).toThrow();
  });

  it("[CT-22] 마이그레이션(v2 단계) 실패 → 행이 그대로이고 user_version = 0, 백업은 v0-backup 1개, 시작을 거부한다", () => {
    const path = createTempDbPath();
    // `updated_at` 이 없는 깨진 blacklist_entries: 새 테이블로 복사하는 단계가 실패한다.
    const brokenColumns = ["id", "name", "version_range", "reason", "created_at"];
    createV1Database(
      path,
      (db) => {
        const insert = db.prepare(
          "INSERT INTO blacklist_entries (name, version_range, reason, created_at) VALUES (?, '', '사유', ?)",
        );
        insert.run("evil-pkg", V1_SEEDED_AT);
        insert.run("left-pad", V1_SEEDED_AT);
        db.prepare("INSERT INTO settings (key, value) VALUES ('org', 'my-org')").run();
      },
      (db) => {
        db.exec(`CREATE TABLE blacklist_entries (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          name          TEXT NOT NULL,
          version_range TEXT NOT NULL DEFAULT '',
          reason        TEXT NOT NULL,
          created_at    TEXT NOT NULL,
          UNIQUE (name, version_range)
        )`);
      },
    );
    const v1FindingColumns = inspect(path, (db) => columnsOf(db, "findings"));

    const refused = openExpectingRefusal(path);

    expect(refused, "openDatabase 가 시작을 거부하지 않았습니다").toBeInstanceOf(Error);
    const after = inspect(path, (db) => ({
      userVersion: userVersionOf(db),
      entryColumns: columnsOf(db, "blacklist_entries"),
      findingColumns: columnsOf(db, "findings"),
      names: db
        .prepare<[], { id: number; name: string }>("SELECT id, name FROM blacklist_entries ORDER BY id")
        .all(),
      settings: countRows(db, "settings"),
    }));
    expect(after).toEqual({
      userVersion: 0,
      entryColumns: brokenColumns,
      // 같은 트랜잭션의 앞 단계(findings 컬럼 추가)도 되돌아간다.
      findingColumns: v1FindingColumns,
      names: [
        { id: 1, name: "evil-pkg" },
        { id: 2, name: "left-pad" },
      ],
      settings: 1,
    });
    expect(backupFilesIn(path)).toEqual(["package-watcher.db.v0-backup"]);
    expect(inspect(backupPathOf(path), (db) => userVersionOf(db))).toBe(0);
  });

  it("[CT-22] 마이그레이션 후에도 시작 보정(running → failed)이 동작한다", async () => {
    const path = createTempDbPath();
    let runningId = 0;
    createV1Database(path, (db) => {
      seedV1Rows(db);
      runningId = Number(
        db
          .prepare(`INSERT INTO scans ("trigger", status, started_at) VALUES ('manual', 'running', ?)`)
          .run(V1_SEEDED_AT).lastInsertRowid,
      );
    });

    const t = createTestApp({ dbPath: path });

    expect(userVersionOf(t.instance.db)).toBe(LATEST_VERSION);
    expect(await getScan(t, runningId)).toMatchObject({
      status: "failed",
      error: "서버 재시작",
      finishedAt: expect.any(String),
    });
  });

  it("[CT-22] 새 DB 도 user_version = 2 이고 백업 파일을 만들지 않는다. 두 번 시작해도 같다", () => {
    const path = createTempDbPath();

    const first = open(path);
    expect(userVersionOf(first.db)).toBe(LATEST_VERSION);
    expect(first.migratedFrom).toBeNull();
    expect(first.backupPath).toBeNull();
    expect(columnsOf(first.db, "blacklist_entries")).toEqual(
      expect.arrayContaining(["ecosystem", "severity", "enabled", "expires_at"]),
    );
    expect(columnsOf(first.db, "findings")).toEqual(expect.arrayContaining(["ecosystem", "severity"]));
    expect(insertPlainEntry(first.db, "kept-pkg")).toBe(1);
    first.db.close();

    const second = open(path);
    expect(userVersionOf(second.db)).toBe(LATEST_VERSION);
    expect(second.migratedFrom).toBeNull();
    expect(second.backupPath).toBeNull();
    expect(entryIds(second.db)).toEqual([1]);
    expect(backupFilesIn(path)).toEqual([]);
  });

  it("[CT-22] 마이그레이션한 DB 를 다시 시작해도 같다 (다시 마이그레이션하지 않고 백업도 그대로)", () => {
    const path = createTempDbPath();
    createV1Database(path);
    const first = open(path);
    expect(userVersionOf(first.db)).toBe(LATEST_VERSION);
    insertPlainEntry(first.db, "after-migration");
    first.db.close();

    const second = open(path);

    expect(userVersionOf(second.db)).toBe(LATEST_VERSION);
    expect(second.migratedFrom).toBeNull();
    expect(second.backupPath).toBeNull();
    expect(entryIds(second.db)).toEqual([1, 2, 3, 4]);
    expect(countRows(second.db, "findings")).toBe(3);
    // 백업은 첫 마이그레이션 직전의 v1 상태 그대로다.
    expect(backupFilesIn(path)).toEqual(["package-watcher.db.v0-backup"]);
    expect(
      inspect(backupPathOf(path), (db) => [userVersionOf(db), countRows(db, "blacklist_entries")]),
    ).toEqual([0, 3]);
  });

  it("[CT-22] user_version 이 더 큰 DB 는 시작을 거부하고 DB 를 바꾸지 않는다", () => {
    const path = createTempDbPath();
    createV1Database(path, (db) => {
      seedV1Rows(db);
      db.pragma("user_version = 3");
    });

    const refused = openExpectingRefusal(path);

    expect(refused, "openDatabase 가 시작을 거부하지 않았습니다").toBeInstanceOf(Error);
    expect(() => createTestApp({ dbPath: path })).toThrow();
    expect(inspect(path, (db) => [userVersionOf(db), countRows(db, "blacklist_entries")])).toEqual([3, 3]);
    expect(backupFilesIn(path)).toEqual([]);
  });
});
