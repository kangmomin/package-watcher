import type { Db } from "../db/index.ts";
import { notImplemented } from "../notImplemented.ts";
import type { BlacklistRepository } from "./blacklist.ts";
import type { FindingsRepository } from "./findings.ts";
import type { ScansRepository } from "./scans.ts";
import type { SettingsRepository } from "./settings.ts";

export interface Repositories {
  blacklist: BlacklistRepository;
  findings: FindingsRepository;
  scans: ScansRepository;
  settings: SettingsRepository;
  /** 동기 트랜잭션 (better-sqlite3 `db.transaction`) */
  transaction<T>(fn: () => T): T;
}

export function createRepositories(db: Db): Repositories {
  return notImplemented(db);
}
