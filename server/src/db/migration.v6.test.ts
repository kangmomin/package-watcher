import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTestApps, createTempDbPath } from "../test/testApp.ts";
import { createV1Database } from "../test/v1Schema.ts";
import { columnsOf, openDatabaseForTest, userVersionOf } from "../test/v2.ts";
import type { Db } from "./index.ts";
import { LATEST_VERSION, migrateToV2, migrateToV3, migrateToV4, migrateToV5 } from "./schema.ts";

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

/** v5 서버가 만든 DB: 외부 목록(malware) 2건, 그 일치로 만든 source=feed 항목 1건과 검출 1건 */
function createV5Database(path: string): void {
  createV1Database(path);
  const db = new Database(path);
  try {
    db.transaction(() => {
      migrateToV2(db);
      migrateToV3(db);
      migrateToV4(db);
      migrateToV5(db);
      const feed = db.prepare(
        `INSERT INTO feed_entries (external_id, ecosystem, name, version_range, raw_range, severity, summary, url, updated_at, seen_run)
         VALUES (?, 'npm', ?, '', '>= 0', 'critical', 's', 'https://github.com/advisories/x', '2026-11-01T00:00:00.000Z', 'run1')`,
      );
      feed.run("GHSA-aaaa-aaaa-0001", "evil-a");
      feed.run("GHSA-aaaa-aaaa-0002", "evil-b");
      db.prepare(
        `INSERT INTO blacklist_entries (ecosystem, name, version_range, reason, created_at, updated_at, source, external_id)
         VALUES ('npm', 'evil-a', '', 'r', 't', 't', 'feed', 'GHSA-aaaa-aaaa-0001')`,
      ).run();
      db.prepare(
        `INSERT INTO findings (repo, file_path, package_name, version, dependency_type, blacklist_entry_id,
           status, reason, html_url, first_seen_at, last_seen_at, ecosystem, severity)
         VALUES ('r', 'package-lock.json', 'evil-a', '1.0.0', 'direct', 1, 'open', 'r', 'u', 't', 't', 'npm', 'critical')`,
      ).run();
      db.prepare("INSERT INTO settings (key, value) VALUES ('feed_full_sync_done', 'true')").run();
      db.pragma("user_version = 5");
    })();
  } finally {
    db.close();
  }
}

describe("DB 마이그레이션 v6 (외부 목록의 분류와 CVSS 점수)", () => {
  it("[SI-10] v5 DB → v6: 기존 행은 보존되고 kind = malware, 점수·고쳐진 버전은 null. user_version 6, 백업은 v5-backup", () => {
    const path = createTempDbPath();
    createV5Database(path);
    const before = new Database(path);
    const feedBefore = before.prepare<[], Record<string, unknown>>("SELECT * FROM feed_entries ORDER BY id").all();
    const entriesBefore = before.prepare<[], Record<string, unknown>>("SELECT * FROM blacklist_entries ORDER BY id").all();
    const findingsBefore = before.prepare("SELECT * FROM findings ORDER BY id").all();
    before.close();

    const { db, migratedFrom, backupPath } = open(path);

    expect(LATEST_VERSION).toBe(6);
    expect(userVersionOf(db)).toBe(6);
    expect(migratedFrom).toBe(5);
    expect(backupPath).toBe(`${path}.v5-backup`);
    expect(readdirSync(dirname(path)).filter((name) => name.includes("backup"))).toEqual([
      "package-watcher.db.v5-backup",
    ]);
    const feed = db.prepare<[], Record<string, unknown>>("SELECT * FROM feed_entries ORDER BY id").all();
    expect(feed).toHaveLength(2);
    for (const [index, row] of feed.entries()) {
      expect(row).toMatchObject({ ...(feedBefore[index] as object), kind: "malware", cvss_score: null, patched_version: null });
    }
    expect(db.prepare("SELECT * FROM blacklist_entries ORDER BY id").all()).toEqual(entriesBefore);
    expect(db.prepare("SELECT * FROM findings ORDER BY id").all()).toEqual(findingsBefore);
    // 백업은 v5 의 모양이다
    const backup = new Database(`${path}.v5-backup`, { readonly: true });
    try {
      expect(Number(backup.pragma("user_version", { simple: true }))).toBe(5);
      expect(columnsOf(backup as Db, "feed_entries")).not.toContain("kind");
    } finally {
      backup.close();
    }
  });

  it("[SI-11] 새 열의 모양: kind 의 기본값은 malware, 점수는 소수를 저장하고, (kind) index 가 있다", () => {
    const path = createTempDbPath();
    createV5Database(path);
    const { db } = open(path);

    expect(columnsOf(db, "feed_entries")).toEqual(expect.arrayContaining(["kind", "cvss_score", "patched_version"]));
    db.prepare(
      `INSERT INTO feed_entries (external_id, ecosystem, name, version_range, raw_range, severity, summary, url, updated_at, kind, cvss_score, patched_version)
       VALUES ('GHSA-cccc-cccc-0001', 'npm', 'lodash', '<4.17.21', '< 4.17.21', 'high', 's', 'u', 't', 'cve', 7.5, '4.17.21')`,
    ).run();
    db.prepare(
      `INSERT INTO feed_entries (external_id, ecosystem, name, version_range, raw_range, severity, summary, url, updated_at)
       VALUES ('GHSA-cccc-cccc-0002', 'npm', 'x', '', '>= 0', 'high', 's', 'u', 't')`,
    ).run();
    expect(db.prepare("SELECT kind, cvss_score FROM feed_entries WHERE name IN ('lodash', 'x') ORDER BY id").all()).toEqual([
      { kind: "cve", cvss_score: 7.5 },
      { kind: "malware", cvss_score: null },
    ]);
    const indexes = db.prepare<[], { name: string }>("SELECT name FROM pragma_index_list('feed_entries')").all();
    expect(indexes.map((index) => index.name)).toContain("feed_entries_kind");
  });

  it("[SI-12] blacklist_entries.source 는 cve 를 받는다 (CHECK 가 없다)", () => {
    const path = createTempDbPath();
    createV5Database(path);
    const { db } = open(path);

    expect(() =>
      db
        .prepare(
          `INSERT INTO blacklist_entries (ecosystem, name, version_range, reason, created_at, updated_at, source, external_id)
           VALUES ('npm', 'cve-pkg', '<4.17.21', 'r', 't', 't', 'cve', 'GHSA-cccc-cccc-0001')`,
        )
        .run(),
    ).not.toThrow();
  });

  it("[SI-13] 새 DB 도 같은 스키마이고 마이그레이션 기록이 없다. 두 번 시작해도 백업을 만들지 않는다", () => {
    const fresh = createTempDbPath();
    const first = open(fresh);
    const old = createTempDbPath();
    createV5Database(old);
    const { db: oldDb } = open(old);

    expect(first.migratedFrom).toBeNull();
    expect(userVersionOf(first.db)).toBe(6);
    expect(columnsOf(first.db, "feed_entries")).toEqual(columnsOf(oldDb, "feed_entries"));
    first.db.close();
    const second = open(fresh);
    expect(second.migratedFrom).toBeNull();
    expect(readdirSync(dirname(fresh)).filter((name) => name.includes("backup"))).toEqual([]);
  });
});
