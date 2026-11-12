import {
  failedRepoSchema,
  scanRepoStatsSchema,
  type FailedRepo,
  type Page,
  type Scan,
  type ScanRepoStats,
  type ScanStatus,
  type ScanTrigger,
} from "@pw/shared";
import type { Db } from "../db/index.ts";
import { FAIL_UNCONFIRMED_SQL, readScanRepoStats } from "./scanRepos.ts";

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
  /** 서버 시작 시 남은 running 을 failed 로 바꾼다. 그 스캔의 확정되지 않은 repo(pending·running·임시 passed·issue)도 failed(같은 오류)로 바꾼다 */
  failRunning(error: string, finishedAt: string): number;
}

interface ScanRow {
  id: number;
  trigger: ScanTrigger;
  status: ScanStatus;
  started_at: string;
  finished_at: string | null;
  repo_count: number;
  new_finding_count: number;
  failed_repos: string;
  error: string | null;
  repo_stats: string | null;
}

const COLUMNS =
  'id, "trigger", status, started_at, finished_at, repo_count, new_finding_count, failed_repos, error, repo_stats';
const ORDER = "ORDER BY started_at DESC, id DESC";

function parseFailedRepos(raw: string): FailedRepo[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is FailedRepo => failedRepoSchema.safeParse(item).success);
  } catch {
    return [];
  }
}

const serializeStats = (stats: ScanRepoStats | null): string | null =>
  stats === null ? null : JSON.stringify(stats);

function parseRepoStats(raw: string | null): ScanRepoStats | null {
  if (raw === null) return null;
  try {
    const parsed = scanRepoStatsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function createScansRepository(db: Db): ScansRepository {
  // running 이면 repo 별 기록의 실시간 집계, 끝났으면 종료 때 저장한 값
  const toScan = (row: ScanRow): Scan => ({
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    repoCount: row.repo_count,
    newFindingCount: row.new_finding_count,
    failedRepos: parseFailedRepos(row.failed_repos),
    error: row.error,
    repoStats: row.status === "running" ? readScanRepoStats(db, row.id) : parseRepoStats(row.repo_stats),
  });
  const insertStmt = db.prepare<[string, string], ScanRow>(
    `INSERT INTO scans ("trigger", status, started_at) VALUES (?, 'running', ?) RETURNING ${COLUMNS}`,
  );
  const finishStmt = db.prepare<[string, string, number, number, string, string | null, string | null, number], ScanRow>(
    `UPDATE scans SET status = ?, finished_at = ?, repo_count = ?, new_finding_count = ?,
       failed_repos = ?, error = ?, repo_stats = ?
     WHERE id = ? RETURNING ${COLUMNS}`,
  );
  const getStmt = db.prepare<[number], ScanRow>(`SELECT ${COLUMNS} FROM scans WHERE id = ?`);
  const latestStmt = db.prepare<[], ScanRow>(`SELECT ${COLUMNS} FROM scans ${ORDER} LIMIT 1`);
  const countStmt = db.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM scans");
  const pageStmt = db.prepare<[number, number], ScanRow>(
    `SELECT ${COLUMNS} FROM scans ${ORDER} LIMIT ? OFFSET ?`,
  );
  const failRunningStmt = db.prepare<[string, string]>(
    `UPDATE scans SET status = 'failed', finished_at = ?, error = ? WHERE status = 'running'`,
  );
  const runningIdsStmt = db.prepare<[], { id: number }>("SELECT id FROM scans WHERE status = 'running'");
  const failRepoRowsStmt = db.prepare<[string, string, number]>(FAIL_UNCONFIRMED_SQL);
  const saveStatsStmt = db.prepare<[string | null, number]>("UPDATE scans SET repo_stats = ? WHERE id = ?");

  return {
    insertRunning(trigger, startedAt) {
      const row = insertStmt.get(trigger, startedAt);
      if (!row) throw new Error("scan insert 결과가 없습니다");
      return toScan(row);
    },
    finish(id, result) {
      const row = finishStmt.get(
        result.status,
        result.finishedAt,
        result.repoCount,
        result.newFindingCount,
        JSON.stringify(result.failedRepos),
        result.error,
        // 집계를 스캔 행에 남긴다 — repo 별 행은 오래되면 지워지지만 집계는 남는다.
        serializeStats(readScanRepoStats(db, id)),
        id,
      );
      if (!row) throw new Error(`스캔이 없습니다: ${id}`);
      return toScan(row);
    },
    get(id) {
      const row = getStmt.get(id);
      return row ? toScan(row) : null;
    },
    latest() {
      const row = latestStmt.get();
      return row ? toScan(row) : null;
    },
    list(page, limit) {
      const total = countStmt.get()?.count ?? 0;
      const offset = (page - 1) * limit;
      const items = offset >= total ? [] : pageStmt.all(limit, offset).map(toScan);
      return { items, total, page, limit };
    },
    failRunning: (error, finishedAt) =>
      db.transaction(() => {
        const ids = runningIdsStmt.all().map((row) => row.id);
        for (const id of ids) {
          failRepoRowsStmt.run(error, finishedAt, id);
          saveStatsStmt.run(serializeStats(readScanRepoStats(db, id)), id);
        }
        return failRunningStmt.run(finishedAt, error).changes;
      })(),
  };
}
