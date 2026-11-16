import {
  SCAN_REPO_STATUSES,
  type Page,
  type ScanRepo,
  type ScanRepoStats,
  type ScanRepoStatus,
} from "@pw/shared";
import type { Db } from "../db/index.ts";

export interface ScanReposFilter {
  status?: ScanRepoStatus;
  /** repo 이름의 대소문자 무시 부분 일치 */
  q?: string;
  page: number;
  limit: number;
}

/** `markDone` 이 기록하는 결과. 임시 passed·issue 는 종료 트랜잭션이 확정한다. */
export interface RepoDone {
  status: Exclude<ScanRepoStatus, "pending" | "running">;
  fileCount: number;
  /** 평가한 브랜치(기본 브랜치 제외)의 수 */
  branchCount: number;
  error: string | null;
  finishedAt: string;
}

export interface RepoFinal {
  status: "passed" | "issue";
  openFindingCount: number;
  newFindingCount: number;
}

/** 스캔의 repo 별 진행 기록. SQL 만 담당. */
export interface ScanReposRepository {
  /** 대상 repo 마다 pending 행을 만든다 */
  insertPending(scanId: number, names: string[]): void;
  markRunning(scanId: number, repo: string, startedAt: string): void;
  markDone(scanId: number, repo: string, done: RepoDone): void;
  /** 종료 트랜잭션: 검사를 끝낸 repo 의 상태와 검출 수를 확정한다 */
  finalize(scanId: number, repo: string, final: RepoFinal): void;
  /** 남은 pending·running 행을 failed 로 바꾼다 */
  failUnfinished(scanId: number, error: string, now: string): void;
  /** 행이 없으면 null (합 = total) */
  stats(scanId: number): ScanRepoStats | null;
  /** 실패 → 이슈 → 진행 중 → 대기 → 통과 → 건너뜀, 같으면 repo 이름 */
  list(scanId: number, filter: ScanReposFilter): Page<ScanRepo>;
  /** 가장 최근 `keepScans` 개의 스캔을 뺀 나머지 스캔의 행을 지운다 */
  prune(keepScans?: number): void;
}

interface Row {
  repo: string;
  status: ScanRepoStatus;
  open_finding_count: number;
  new_finding_count: number;
  file_count: number;
  branch_count: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

/** repo 별 기록을 남기는 스캔 수 */
export const SCAN_REPOS_KEEP = 30;

const ORDER_SQL = `CASE status ${["failed", "issue", "running", "pending", "passed", "skipped"]
  .map((status, rank) => `WHEN '${status}' THEN ${rank}`)
  .join(" ")} END, repo`;

function toScanRepo(row: Row): ScanRepo {
  return {
    repo: row.repo,
    status: row.status,
    openFindingCount: row.open_finding_count,
    newFindingCount: row.new_finding_count,
    fileCount: row.file_count,
    branchCount: row.branch_count,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

/** `scans` 저장소도 쓰는 집계. 행이 없으면 null */
export function readScanRepoStats(db: Db, scanId: number): ScanRepoStats | null {
  const rows = db
    .prepare<[number], { status: ScanRepoStatus; count: number }>(
      "SELECT status, COUNT(*) AS count FROM scan_repos WHERE scan_id = ? GROUP BY status",
    )
    .all(scanId);
  if (rows.length === 0) return null;
  const stats: ScanRepoStats = { total: 0, pending: 0, running: 0, passed: 0, issue: 0, failed: 0, skipped: 0 };
  for (const row of rows) {
    if (!SCAN_REPO_STATUSES.includes(row.status)) continue;
    stats[row.status] = row.count;
    stats.total += row.count;
  }
  return stats;
}

/**
 * 확정되지 않은 행을 실패로 바꾼다. 인자: error, now, scan_id.
 * 임시 passed·issue 도 포함한다: 결과를 버린 스캔에서는 그 repo 의 검출이 반영되지 않았다.
 */
export const FAIL_UNCONFIRMED_SQL = `UPDATE scan_repos SET status = 'failed', error = ?, finished_at = COALESCE(finished_at, ?)
   WHERE scan_id = ? AND status IN ('pending', 'running', 'passed', 'issue')`;

export function createScanReposRepository(db: Db): ScanReposRepository {
  const insertStmt = db.prepare<[number, string]>(
    "INSERT OR IGNORE INTO scan_repos (scan_id, repo, status) VALUES (?, ?, 'pending')",
  );
  const runningStmt = db.prepare<[string, number, string]>(
    "UPDATE scan_repos SET status = 'running', started_at = ? WHERE scan_id = ? AND repo = ?",
  );
  const doneStmt = db.prepare<[string, number, number, string | null, string, number, string]>(
    `UPDATE scan_repos SET status = ?, file_count = ?, branch_count = ?, error = ?, finished_at = ?
     WHERE scan_id = ? AND repo = ?`,
  );
  const finalStmt = db.prepare<[string, number, number, number, string]>(
    `UPDATE scan_repos SET status = ?, open_finding_count = ?, new_finding_count = ?
     WHERE scan_id = ? AND repo = ?`,
  );
  const failStmt = db.prepare<[string, string, number]>(FAIL_UNCONFIRMED_SQL);
  const pruneStmt = db.prepare<[number]>(
    `DELETE FROM scan_repos WHERE scan_id NOT IN
       (SELECT id FROM scans ORDER BY started_at DESC, id DESC LIMIT ?)`,
  );

  return {
    insertPending(scanId, names) {
      for (const name of names) insertStmt.run(scanId, name);
    },
    markRunning(scanId, repo, startedAt) {
      runningStmt.run(startedAt, scanId, repo);
    },
    markDone(scanId, repo, done) {
      doneStmt.run(done.status, done.fileCount, done.branchCount, done.error, done.finishedAt, scanId, repo);
    },
    finalize(scanId, repo, final) {
      finalStmt.run(final.status, final.openFindingCount, final.newFindingCount, scanId, repo);
    },
    failUnfinished(scanId, error, now) {
      failStmt.run(error, now, scanId);
    },
    stats: (scanId) => readScanRepoStats(db, scanId),
    list(scanId, filter) {
      const where = ["scan_id = ?"];
      const params: (string | number)[] = [scanId];
      if (filter.status) {
        where.push("status = ?");
        params.push(filter.status);
      }
      // 부분 일치는 instr 로 한다(LIKE 의 %, _ 이스케이프가 필요 없다).
      if (filter.q) {
        where.push("instr(lower(repo), lower(?)) > 0");
        params.push(filter.q);
      }
      const whereSql = `WHERE ${where.join(" AND ")}`;
      const total =
        db
          .prepare<(string | number)[], { count: number }>(`SELECT COUNT(*) AS count FROM scan_repos ${whereSql}`)
          .get(...params)?.count ?? 0;
      const offset = (filter.page - 1) * filter.limit;
      const items =
        offset >= total
          ? []
          : db
              .prepare<(string | number)[], Row>(
                `SELECT repo, status, open_finding_count, new_finding_count, file_count, branch_count, error, started_at, finished_at
                 FROM scan_repos ${whereSql} ORDER BY ${ORDER_SQL} LIMIT ? OFFSET ?`,
              )
              .all(...params, filter.limit, offset)
              .map(toScanRepo);
      return { items, total, page: filter.page, limit: filter.limit };
    },
    prune(keepScans = SCAN_REPOS_KEEP) {
      pruneStmt.run(keepScans);
    },
  };
}
