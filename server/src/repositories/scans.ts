import type { FailedRepo, Page, Scan, ScanStatus, ScanTrigger } from "@pw/shared";
import type { Db } from "../db/index.ts";
import { notImplemented } from "../notImplemented.ts";

export interface ScanResult {
  status: Exclude<ScanStatus, "running">;
  finishedAt: string;
  repoCount: number;
  newFindingCount: number;
  failedRepos: FailedRepo[];
  error: string | null;
}

/** SQL 만 담당. */
export interface ScansRepository {
  insertRunning(trigger: ScanTrigger, startedAt: string): Scan;
  finish(id: number, result: ScanResult): Scan;
  get(id: number): Scan | null;
  /** `startedAt` 이 가장 최신인 1건 (running 포함) */
  latest(): Scan | null;
  /** `startedAt` 내림차순, 같으면 `id` 내림차순 */
  list(page: number, limit: number): Page<Scan>;
  /** 서버 시작 시 남은 running 을 failed 로 바꾼다 */
  failRunning(error: string, finishedAt: string): number;
}

export function createScansRepository(db: Db): ScansRepository {
  return notImplemented(db);
}
