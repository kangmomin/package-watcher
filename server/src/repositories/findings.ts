import type { DependencyType, Finding, FindingStatus, Page } from "@pw/shared";
import type { Db } from "../db/index.ts";

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

interface FindingRow {
  id: number;
  repo: string;
  file_path: string;
  package_name: string;
  version: string;
  dependency_type: DependencyType;
  blacklist_entry_id: number;
  status: FindingStatus;
  reason: string;
  html_url: string;
  first_seen_at: string;
  resolved_at: string | null;
  notified_at: string | null;
}

const COLUMNS =
  "id, repo, file_path, package_name, version, dependency_type, blacklist_entry_id, status, " +
  "reason, html_url, first_seen_at, resolved_at, notified_at";
const ACTIVE = "status IN ('open', 'ignored')";
const ORDER = "ORDER BY first_seen_at DESC, id DESC";

function toFinding(row: FindingRow): Finding {
  return {
    id: row.id,
    repo: row.repo,
    filePath: row.file_path,
    ecosystem: "npm", // v2-shim
    packageName: row.package_name,
    version: row.version,
    severity: "medium", // v2-shim
    dependencyType: row.dependency_type,
    status: row.status,
    blacklistEntryId: row.blacklist_entry_id,
    reason: row.reason,
    htmlUrl: row.html_url,
    firstSeenAt: row.first_seen_at,
    resolvedAt: row.resolved_at,
    notifiedAt: row.notified_at,
  };
}

export function createFindingsRepository(db: Db): FindingsRepository {
  const getStmt = db.prepare<[number], FindingRow>(
    `SELECT ${COLUMNS} FROM findings WHERE id = ?`,
  );
  const countStmt = db.prepare<[string], { count: number }>(
    "SELECT COUNT(*) AS count FROM findings WHERE status = ?",
  );
  const activeStmt = db.prepare<[], FindingRow>(
    `SELECT ${COLUMNS} FROM findings WHERE ${ACTIVE} ${ORDER}`,
  );
  const openStmt = db.prepare<[], FindingRow>(
    `SELECT ${COLUMNS} FROM findings WHERE status = 'open' ${ORDER}`,
  );
  const unnotifiedStmt = db.prepare<[], FindingRow>(
    `SELECT ${COLUMNS} FROM findings WHERE status = 'open' AND notified_at IS NULL ${ORDER}`,
  );
  const insertStmt = db.prepare<
    [string, string, string, string, string, number, string, string, string, string],
    FindingRow
  >(
    `INSERT INTO findings (repo, file_path, package_name, version, dependency_type, blacklist_entry_id,
       status, reason, html_url, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?) RETURNING ${COLUMNS}`,
  );
  const touchStmt = db.prepare<[string, string, number]>(
    "UPDATE findings SET dependency_type = ?, last_seen_at = ? WHERE id = ?",
  );
  const setStatusStmt = db.prepare<[string, number], FindingRow>(
    `UPDATE findings SET status = ? WHERE id = ? RETURNING ${COLUMNS}`,
  );
  const resolveStmt = db.prepare<[string, number]>(
    `UPDATE findings SET status = 'resolved', resolved_at = ? WHERE id = ? AND ${ACTIVE}`,
  );
  const resolveByEntryStmt = db.prepare<[string, number]>(
    `UPDATE findings SET status = 'resolved', resolved_at = ?
     WHERE blacklist_entry_id = ? AND ${ACTIVE}`,
  );
  const resolveAllStmt = db.prepare<[string]>(
    `UPDATE findings SET status = 'resolved', resolved_at = ? WHERE ${ACTIVE}`,
  );
  const reasonStmt = db.prepare<[string, number]>(
    `UPDATE findings SET reason = ? WHERE blacklist_entry_id = ? AND ${ACTIVE}`,
  );
  const notifiedStmt = db.prepare<[string, number]>(
    "UPDATE findings SET notified_at = ? WHERE id = ?",
  );

  return {
    list(filter) {
      const where: string[] = [];
      const params: (string | number)[] = [];
      if (filter.status) {
        where.push("status = ?");
        params.push(filter.status);
      }
      // 부분 일치는 instr 로 한다(LIKE 의 %, _ 이스케이프가 필요 없다).
      if (filter.repo) {
        where.push("instr(lower(repo), lower(?)) > 0");
        params.push(filter.repo);
      }
      if (filter.package) {
        where.push("instr(lower(package_name), lower(?)) > 0");
        params.push(filter.package);
      }
      const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
      const countSql = `SELECT COUNT(*) AS count FROM findings ${whereSql}`;
      const total = db.prepare<(string | number)[], { count: number }>(countSql).get(...params)?.count ?? 0;
      const offset = (filter.page - 1) * filter.limit;
      const items =
        offset >= total
          ? []
          : db
              .prepare<(string | number)[], FindingRow>(
                `SELECT ${COLUMNS} FROM findings ${whereSql} ${ORDER} LIMIT ? OFFSET ?`,
              )
              .all(...params, filter.limit, offset)
              .map(toFinding);
      return { items, total, page: filter.page, limit: filter.limit };
    },
    get(id) {
      const row = getStmt.get(id);
      return row ? toFinding(row) : null;
    },
    countByStatus: (status) => countStmt.get(status)?.count ?? 0,
    listActive: () => activeStmt.all().map(toFinding),
    listOpen: () => openStmt.all().map(toFinding),
    listUnnotifiedOpen: () => unnotifiedStmt.all().map(toFinding),
    insertOpen(finding, now) {
      const row = insertStmt.get(
        finding.repo,
        finding.filePath,
        finding.packageName,
        finding.version,
        finding.dependencyType,
        finding.blacklistEntryId,
        finding.reason,
        finding.htmlUrl,
        now,
        now,
      );
      if (!row) throw new Error("finding insert 결과가 없습니다");
      return toFinding(row);
    },
    touch(id, dependencyType, now) {
      touchStmt.run(dependencyType, now, id);
    },
    setStatus(id, status) {
      const row = setStatusStmt.get(status, id);
      if (!row) throw new Error(`검출이 없습니다: ${id}`);
      return toFinding(row);
    },
    resolve(ids, now) {
      for (const id of ids) resolveStmt.run(now, id);
    },
    resolveByBlacklistEntry: (blacklistEntryId, now) =>
      resolveByEntryStmt.run(now, blacklistEntryId).changes,
    resolveAllActive: (now) => resolveAllStmt.run(now).changes,
    updateReasonForEntry(blacklistEntryId, reason) {
      reasonStmt.run(reason, blacklistEntryId);
    },
    markNotified(ids, now) {
      for (const id of ids) notifiedStmt.run(now, id);
    },
  };
}
