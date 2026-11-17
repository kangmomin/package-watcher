import type { Db } from "../db/index.ts";
import { createBlacklistRepository, type BlacklistRepository } from "./blacklist.ts";
import { createFeedRepository, type FeedRepository } from "./feed.ts";
import { createFindingsRepository, type FindingsRepository } from "./findings.ts";
import { createRepoAuthorsRepository, type RepoAuthorsRepository } from "./repoAuthors.ts";
import { createScanReposRepository, type ScanReposRepository } from "./scanRepos.ts";
import { createScansRepository, type ScansRepository } from "./scans.ts";
import { createSettingsRepository, type SettingsRepository } from "./settings.ts";
import { createVulnerabilitiesRepository, type VulnerabilitiesRepository } from "./vulnerabilities.ts";

export interface Repositories {
  blacklist: BlacklistRepository;
  feed: FeedRepository;
  findings: FindingsRepository;
  scans: ScansRepository;
  scanRepos: ScanReposRepository;
  settings: SettingsRepository;
  repoAuthors: RepoAuthorsRepository;
  vulnerabilities: VulnerabilitiesRepository;
  /** 동기 트랜잭션 (better-sqlite3 `db.transaction`) */
  transaction<T>(fn: () => T): T;
}

export function createRepositories(db: Db): Repositories {
  return {
    blacklist: createBlacklistRepository(db),
    feed: createFeedRepository(db),
    findings: createFindingsRepository(db),
    scans: createScansRepository(db),
    scanRepos: createScanReposRepository(db),
    settings: createSettingsRepository(db),
    repoAuthors: createRepoAuthorsRepository(db),
    vulnerabilities: createVulnerabilitiesRepository(db),
    transaction: (fn) => db.transaction(fn)(),
  };
}
