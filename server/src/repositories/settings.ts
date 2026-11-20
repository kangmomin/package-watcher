import type { Db } from "../db/index.ts";

/**
 * settings 테이블 키. `next_scan_at`, `last_digest_date`, `listed_baseline` 은 내부 키라서 API 응답에 없다.
 */
export type SettingKey =
  | "org"
  // 스캔 대상의 종류(`org` | `user`). 없으면 org
  | "scan_target"
  // scan_target = user 의 스캔이 마지막으로 확인한 로그인 계정 (계정이 바뀌면 활성 검출을 resolve 한다)
  | "account_login"
  | "scan_interval_hours"
  | "digest_time"
  | "recipients"
  | "notify_min_severity"
  | "next_scan_at"
  | "last_digest_date"
  | "listed_baseline"
  | "feed_enabled"
  | "branch_scan_days"
  // repo_authors 를 기록한 org (org 가 바뀌면 비운다)
  | "authors_org"
  // 외부 목록 동기화의 내부 상태(API 응답은 feed 서비스가 조합한다)
  | "feed_full_sync_done"
  | "feed_cursor"
  | "feed_full_started_at"
  | "feed_run_id"
  | "feed_last_full_at"
  | "feed_last_started_at"
  | "feed_last_synced_at"
  | "feed_skipped"
  | "feed_last_error"
  // 취약점(cve) 의 기준 점수와, 분류마다 독립인 동기화 상태 (malware 는 위의 `feed_*`)
  | "cve_min_score"
  | "feed_cve_full_sync_done"
  | "feed_cve_cursor"
  | "feed_cve_full_started_at"
  | "feed_cve_run_id"
  | "feed_cve_last_full_at"
  | "feed_cve_last_started_at"
  | "feed_cve_last_synced_at"
  | "feed_cve_skipped"
  | "feed_cve_last_error";

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
