import type { FailedRepo, Page, Scan, ScanStatus, ScanTrigger } from "@pw/shared";
import type { Db } from "../db/index.ts";

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
}

const COLUMNS =
  'id, "trigger", status, started_at, finished_at, repo_count, new_finding_count, failed_repos, error';
const ORDER = "ORDER BY started_at DESC, id DESC";

function parseFailedRepos(raw: string): FailedRepo[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is FailedRepo =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as FailedRepo).repo === "string" &&
        typeof (item as FailedRepo).error === "string",
    );
  } catch {
    return [];
  }
}

function toScan(row: ScanRow): Scan {
  return {
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    repoCount: row.repo_count,
    newFindingCount: row.new_finding_count,
    failedRepos: parseFailedRepos(row.failed_repos),
    error: row.error,
  };
}

export function createScansRepository(db: Db): ScansRepository {
  const insertStmt = db.prepare<[string, string], ScanRow>(
    `INSERT INTO scans ("trigger", status, started_at) VALUES (?, 'running', ?) RETURNING ${COLUMNS}`,
  );
  const finishStmt = db.prepare<[string, string, number, number, string, string | null, number], ScanRow>(
    `UPDATE scans SET status = ?, finished_at = ?, repo_count = ?, new_finding_count = ?,
       failed_repos = ?, error = ?
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
    failRunning: (error, finishedAt) => failRunningStmt.run(finishedAt, error).changes,
  };
}
