import type { Db } from "../db/index.ts";

/**
 * settings 테이블 키. `next_scan_at`, `last_digest_date`, `listed_baseline` 은 내부 키라서 API 응답에 없다.
 */
export type SettingKey =
  | "org"
  | "scan_interval_hours"
  | "digest_time"
  | "recipients"
  | "next_scan_at"
  | "last_digest_date"
  | "listed_baseline";

/** SQL 만 담당. 값은 문자열로 저장한다. */
export interface SettingsRepository {
  get(key: SettingKey): string | null;
  set(key: SettingKey, value: string | null): void;
  /** `INSERT OR IGNORE` — env 초기값용 */
  insertIfMissing(key: SettingKey, value: string): void;
}

export function createSettingsRepository(db: Db): SettingsRepository {
  const getStmt = db.prepare<[string], { value: string }>("SELECT value FROM settings WHERE key = ?");
  const upsertStmt = db.prepare<[string, string]>(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  );
  const deleteStmt = db.prepare<[string]>("DELETE FROM settings WHERE key = ?");
  const insertIgnoreStmt = db.prepare<[string, string]>(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
  );

  return {
    get: (key) => getStmt.get(key)?.value ?? null,
    set(key, value) {
      // null 은 "값 없음"이다. 행을 지워서 insertIfMissing 과 같은 의미를 유지한다.
      if (value === null) deleteStmt.run(key);
      else upsertStmt.run(key, value);
    },
    insertIfMissing(key, value) {
      insertIgnoreStmt.run(key, value);
    },
  };
}
