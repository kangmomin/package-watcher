import type { Db } from "../db/index.ts";
import { notImplemented } from "../notImplemented.ts";

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
  return notImplemented(db);
}
