import type { Db } from "../db/index.ts";
import { createBlacklistRepository, type BlacklistRepository } from "./blacklist.ts";
import { createFindingsRepository, type FindingsRepository } from "./findings.ts";
import { createScansRepository, type ScansRepository } from "./scans.ts";
import { createSettingsRepository, type SettingsRepository } from "./settings.ts";

export interface Repositories {
  blacklist: BlacklistRepository;
  findings: FindingsRepository;
  scans: ScansRepository;
  settings: SettingsRepository;
  /** 동기 트랜잭션 (better-sqlite3 `db.transaction`) */
  transaction<T>(fn: () => T): T;
}

export function createRepositories(db: Db): Repositories {
  return {
    blacklist: createBlacklistRepository(db),
    findings: createFindingsRepository(db),
    scans: createScansRepository(db),
    settings: createSettingsRepository(db),
    transaction: (fn) => db.transaction(fn)(),
  };
}
