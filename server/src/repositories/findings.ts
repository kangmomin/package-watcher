import {
  ECOSYSTEM_CATEGORY,
  POLICY_ECOSYSTEM,
  SEVERITIES,
  SEVERITY_RANK,
  type DependencyType,
  type Ecosystem,
  type EcosystemCategory,
  type Finding,
  type FindingStatus,
  type Page,
  type Severity,
} from "@pw/shared";
import type { Db } from "../db/index.ts";
import { ACTIVE_ENTRY_SQL } from "../services/entryActivity.ts";

/** 검출 키. 활성(open/ignored) 행에 대해 유일하다. */
export interface FindingKey {
  repo: string;
  filePath: string;
  packageName: string;
  version: string;
  blacklistEntryId: number;
}

export interface NewFinding extends FindingKey {
  ecosystem: Ecosystem;
  severity: Severity;
  dependencyType: DependencyType;
  reason: string;
  htmlUrl: string;
}

export interface FindingsFilter {
  status?: FindingStatus;
  /** trim 후 대소문자 무시 부분 일치 */
  repo?: string;
  package?: string;
  /** 정확히 일치하는 값만 ("이상" 이 아니다) */
  ecosystem?: Ecosystem;
  /** 그 분류의 종류만 (`ECOSYSTEM_CATEGORY` 에서 만든 목록을 bind 한다) */
  category?: EcosystemCategory;
  /** 그 분류의 종류를 뺀다 */
  excludeCategory?: EcosystemCategory;
  severity?: Severity;
  page: number;
  limit: number;
}

/** SQL 만 담당. */
export interface FindingsRepository {
  /** 심각도 높은 순 → `firstSeenAt` 내림차순 → `id` 내림차순. `total` = 필터 적용 후 개수 */
  list(filter: FindingsFilter): Page<Finding>;
  get(id: number): Finding | null;
  /** `policy`(위험한 설정)를 뺀 검출의 수 — 대시보드의 숫자가 policy 로 뛰지 않게 한다 */
  countByStatus(status: FindingStatus): number;
  /** `policy` 검출의 수 */
  countPolicyByStatus(status: FindingStatus): number;
  listActive(): Finding[];
  listOpen(): Finding[];
  /**
   * `notifiedAt` 이 null 인 `open` 검출 중 심각도 순위가 `minRank` 이상인 것. `policy` 는 즉시 메일의 대상이 아니라서
   * 조회에서 뺀다 (notified_at 이 영원히 null 이어도 매번 다시 평가되지 않는다).
   */
  listUnnotifiedOpen(minRank: number): Finding[];
  insertOpen(finding: NewFinding, now: string): Finding;
  /** 다시 보인 활성 행: `last_seen_at`, `dependency_type` 만 갱신 */
  touch(id: number, dependencyType: DependencyType, now: string): void;
  setStatus(id: number, status: "open" | "ignored"): Finding;
  resolve(ids: number[], now: string): void;
  resolveByBlacklistEntry(blacklistEntryId: number, now: string): number;
  resolveAllActive(now: string): number;
  /** 그 항목의 활성 검출의 사유와 심각도를 항목의 값으로 맞춘다 */
  updateReasonAndSeverityForEntry(blacklistEntryId: number, reason: string, severity: Severity): void;
  /**
   * 비활성 항목(끔 또는 만료)의 활성 검출을 모두 resolved 로 바꾼다. 멱등이다.
   * "비활성 항목에는 활성 검출이 없다"는 불변식을 검출을 읽는 모든 시점에 성립시킨다.
   */
  resolveForInactiveEntries(todayKst: string, now: string): number;
  /** 활성 검출의 severity 를 항목의 값으로 맞춘다(이전 버전 이미지가 만든 검출 보정). 멱등이다. */
  syncSeverityFromEntries(): number;
  markNotified(ids: number[], now: string): void;
}

interface FindingRow {
  id: number;
  repo: string;
  file_path: string;
  ecosystem: Ecosystem;
  package_name: string;
  version: string;
  severity: Severity;
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
  "id, repo, file_path, ecosystem, package_name, version, severity, dependency_type, blacklist_entry_id, " +
  "status, reason, html_url, first_seen_at, resolved_at, notified_at";
const ACTIVE = "status IN ('open', 'ignored')";
const ecosystemsOf = (category: EcosystemCategory): string[] =>
  Object.entries(ECOSYSTEM_CATEGORY).flatMap(([ecosystem, value]) => (value === category ? [ecosystem] : []));
const ORDER = "ORDER BY first_seen_at DESC, id DESC";
// 심각도 순위의 SQL 조각. 검출 정렬과 알림 임계값이 같은 정의를 쓴다.
const SEVERITY_RANK_SQL = `CASE severity ${SEVERITIES.map(
  (severity) => `WHEN '${severity}' THEN ${SEVERITY_RANK[severity]}`,
).join(" ")} END`;
const LIST_ORDER = `ORDER BY ${SEVERITY_RANK_SQL} DESC, first_seen_at DESC, id DESC`;

function toFinding(row: FindingRow): Finding {
  return {
    id: row.id,
    repo: row.repo,
    filePath: row.file_path,
    ecosystem: row.ecosystem,
    packageName: row.package_name,
    version: row.version,
    severity: row.severity,
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
    `SELECT COUNT(*) AS count FROM findings WHERE status = ? AND ecosystem <> '${POLICY_ECOSYSTEM}'`,
  );
  const countPolicyStmt = db.prepare<[string], { count: number }>(
    `SELECT COUNT(*) AS count FROM findings WHERE status = ? AND ecosystem = '${POLICY_ECOSYSTEM}'`,
  );
  const activeStmt = db.prepare<[], FindingRow>(
    `SELECT ${COLUMNS} FROM findings WHERE ${ACTIVE} ${ORDER}`,
  );
  const openStmt = db.prepare<[], FindingRow>(
    `SELECT ${COLUMNS} FROM findings WHERE status = 'open' ${ORDER}`,
  );
  const unnotifiedStmt = db.prepare<[number], FindingRow>(
    `SELECT ${COLUMNS} FROM findings
     WHERE status = 'open' AND notified_at IS NULL AND ecosystem <> '${POLICY_ECOSYSTEM}'
       AND ${SEVERITY_RANK_SQL} >= ? ${ORDER}`,
  );
  const insertStmt = db.prepare<unknown[], FindingRow>(
    `INSERT INTO findings (repo, file_path, ecosystem, package_name, version, severity, dependency_type,
       blacklist_entry_id, status, reason, html_url, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?) RETURNING ${COLUMNS}`,
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
  const reasonStmt = db.prepare<[string, string, number]>(
    `UPDATE findings SET reason = ?, severity = ? WHERE blacklist_entry_id = ? AND ${ACTIVE}`,
  );
  const inactiveStmt = db.prepare<{ now: string; todayKst: string }>(
    `UPDATE findings SET status = 'resolved', resolved_at = :now
     WHERE ${ACTIVE} AND blacklist_entry_id IN (
       SELECT id FROM blacklist_entries WHERE NOT (${ACTIVE_ENTRY_SQL}))`,
  );
  // join 형태로 쓴다. 상관 서브쿼리는 항목이 없는 검출에서 NOT NULL 위반이 되어 시작을 막는다.
  const syncSeverityStmt = db.prepare(
    `UPDATE findings SET severity = e.severity FROM blacklist_entries e
     WHERE e.id = findings.blacklist_entry_id AND findings.${ACTIVE}
       AND findings.severity <> e.severity`,
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
      if (filter.ecosystem) {
        where.push("ecosystem = ?");
        params.push(filter.ecosystem);
      }
      for (const [category, negate] of [[filter.category, false], [filter.excludeCategory, true]] as const) {
        if (!category) continue;
        const list = ecosystemsOf(category);
        where.push(`ecosystem ${negate ? "NOT IN" : "IN"} (${list.map(() => "?").join(", ")})`);
        params.push(...list);
      }
      if (filter.severity) {
        where.push("severity = ?");
        params.push(filter.severity);
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
                `SELECT ${COLUMNS} FROM findings ${whereSql} ${LIST_ORDER} LIMIT ? OFFSET ?`,
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
    countPolicyByStatus: (status) => countPolicyStmt.get(status)?.count ?? 0,
    listActive: () => activeStmt.all().map(toFinding),
    listOpen: () => openStmt.all().map(toFinding),
    listUnnotifiedOpen: (minRank) => unnotifiedStmt.all(minRank).map(toFinding),
    insertOpen(finding, now) {
      const row = insertStmt.get(
        finding.repo,
        finding.filePath,
        finding.ecosystem,
        finding.packageName,
        finding.version,
        finding.severity,
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
    updateReasonAndSeverityForEntry(blacklistEntryId, reason, severity) {
      reasonStmt.run(reason, severity, blacklistEntryId);
    },
    resolveForInactiveEntries: (todayKst, now) => inactiveStmt.run({ now, todayKst }).changes,
    syncSeverityFromEntries: () => syncSeverityStmt.run().changes,
    markNotified(ids, now) {
      for (const id of ids) notifiedStmt.run(now, id);
    },
  };
}
