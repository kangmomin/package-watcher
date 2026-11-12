import type { DependencyType, Finding, FindingStatus, Page } from "@pw/shared";
import type { Db } from "../db/index.ts";
import { notImplemented } from "../notImplemented.ts";

/** 검출 키. 활성(open/ignored) 행에 대해 유일하다. */
export interface FindingKey {
  repo: string;
  filePath: string;
  packageName: string;
  version: string;
  blacklistEntryId: number;
}

export interface NewFinding extends FindingKey {
  dependencyType: DependencyType;
  reason: string;
  htmlUrl: string;
}

export interface FindingsFilter {
  status?: FindingStatus;
  /** trim 후 대소문자 무시 부분 일치 */
  repo?: string;
  package?: string;
  page: number;
  limit: number;
}

/** SQL 만 담당. */
export interface FindingsRepository {
  /** `firstSeenAt` 내림차순, 같으면 `id` 내림차순. `total` = 필터 적용 후 개수 */
  list(filter: FindingsFilter): Page<Finding>;
  get(id: number): Finding | null;
  countByStatus(status: FindingStatus): number;
  listActive(): Finding[];
  listOpen(): Finding[];
  listUnnotifiedOpen(): Finding[];
  insertOpen(finding: NewFinding, now: string): Finding;
  /** 다시 보인 활성 행: `last_seen_at`, `dependency_type` 만 갱신 */
  touch(id: number, dependencyType: DependencyType, now: string): void;
  setStatus(id: number, status: "open" | "ignored"): Finding;
  resolve(ids: number[], now: string): void;
  resolveByBlacklistEntry(blacklistEntryId: number, now: string): number;
  resolveAllActive(now: string): number;
  updateReasonForEntry(blacklistEntryId: number, reason: string): void;
  markNotified(ids: number[], now: string): void;
}

export function createFindingsRepository(db: Db): FindingsRepository {
  return notImplemented(db);
}
