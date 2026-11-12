import type { BlacklistEntry, BlacklistQuery, Ecosystem, Severity } from "@pw/shared";
import type { Db } from "../db/index.ts";
import { ACTIVE_ENTRY_SQL, EXPIRED_ENTRY_SQL, isExpired } from "../services/entryActivity.ts";

/** 저장할 값. 검증·기본값 적용·병합이 끝난 상태라서 모든 필드가 있다. */
export interface BlacklistWrite {
  name: string;
  versionRange: string | null;
  reason: string;
  ecosystem: Ecosystem;
  severity: Severity;
  enabled: boolean;
  expiresAt: string | null;
}

/**
 * SQL 만 담당. 입력은 이미 검증·정규화된 값이다.
 * `today`(KST 날짜)는 `isExpired` 계산에 쓴다. 호출자가 요청당 1번만 구해서 넘긴다.
 */
export interface BlacklistRepository {
  /** `name` 오름차순, 같으면 `id` 오름차순 */
  list(filter: BlacklistQuery, today: string): BlacklistEntry[];
  /** 활성(켜짐 + 만료되지 않음) 항목만. 정렬은 `list` 와 같다 */
  listActive(today: string): BlacklistEntry[];
  get(id: number, today: string): BlacklistEntry | null;
  /** 정규화한 (ecosystem, name, versionRange) 로 찾는다. null 범위끼리도 같은 키다. */
  findByKey(
    ecosystem: Ecosystem,
    name: string,
    versionRange: string | null,
    today: string,
  ): BlacklistEntry | null;
  insert(input: BlacklistWrite, now: string, today: string): BlacklistEntry;
  update(id: number, input: BlacklistWrite, now: string, today: string): BlacklistEntry;
  remove(id: number): boolean;
}

interface BlacklistRow {
  id: number;
  ecosystem: Ecosystem;
  name: string;
  version_range: string;
  reason: string;
  severity: Severity;
  enabled: number;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  "id, ecosystem, name, version_range, reason, severity, enabled, expires_at, created_at, updated_at";
const ORDER = "ORDER BY name ASC, id ASC";

// "모든 버전"은 DB 에 '' 로 저장한다(unique 제약이 null 끼리 중복을 잡게 하려고). API 에서는 null 이다.
const toDbRange = (versionRange: string | null): string => versionRange ?? "";

function toEntry(row: BlacklistRow, today: string): BlacklistEntry {
  return {
    id: row.id,
    ecosystem: row.ecosystem,
    name: row.name,
    versionRange: row.version_range === "" ? null : row.version_range,
    reason: row.reason,
    severity: row.severity,
    enabled: row.enabled === 1,
    expiresAt: row.expires_at,
    isExpired: isExpired(row.expires_at, today),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createBlacklistRepository(db: Db): BlacklistRepository {
  const activeStmt = db.prepare<{ todayKst: string }, BlacklistRow>(
    `SELECT ${COLUMNS} FROM blacklist_entries WHERE ${ACTIVE_ENTRY_SQL} ${ORDER}`,
  );
  const getStmt = db.prepare<[number], BlacklistRow>(
    `SELECT ${COLUMNS} FROM blacklist_entries WHERE id = ?`,
  );
  const findByKeyStmt = db.prepare<[string, string, string], BlacklistRow>(
    `SELECT ${COLUMNS} FROM blacklist_entries WHERE ecosystem = ? AND name = ? AND version_range = ?`,
  );
  const insertStmt = db.prepare<unknown[], BlacklistRow>(
    `INSERT INTO blacklist_entries
       (ecosystem, name, version_range, reason, severity, enabled, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${COLUMNS}`,
  );
  const updateStmt = db.prepare<unknown[], BlacklistRow>(
    `UPDATE blacklist_entries
     SET ecosystem = ?, name = ?, version_range = ?, reason = ?, severity = ?, enabled = ?, expires_at = ?,
         updated_at = ?
     WHERE id = ? RETURNING ${COLUMNS}`,
  );
  const removeStmt = db.prepare<[number]>("DELETE FROM blacklist_entries WHERE id = ?");

  return {
    list(filter, today) {
      const where: string[] = [];
      const params: (string | number)[] = [];
      if (filter.ecosystem !== undefined) {
        where.push("ecosystem = ?");
        params.push(filter.ecosystem);
      }
      // 사용자가 정한 값으로 거른다(만료 여부와 무관).
      if (filter.enabled !== undefined) {
        where.push("enabled = ?");
        params.push(filter.enabled ? 1 : 0);
      }
      // 부분 일치는 instr 로 한다(LIKE 의 %, _ 이스케이프가 필요 없다).
      if (filter.q !== undefined) {
        where.push("instr(lower(name), lower(?)) > 0");
        params.push(filter.q);
      }
      // 만료가 끄기보다 우선한다: expired 는 꺼짐 여부와 무관하고, disabled 는 만료되지 않은 꺼진 항목이다.
      if (filter.status === "active") where.push(ACTIVE_ENTRY_SQL);
      if (filter.status === "disabled") where.push(`enabled = 0 AND NOT ${EXPIRED_ENTRY_SQL}`);
      if (filter.status === "expired") where.push(EXPIRED_ENTRY_SQL);
      const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
      const statement = db.prepare<unknown[], BlacklistRow>(
        `SELECT ${COLUMNS} FROM blacklist_entries ${whereSql} ${ORDER}`,
      );
      const rows =
        filter.status === undefined ? statement.all(...params) : statement.all(...params, { todayKst: today });
      return rows.map((row) => toEntry(row, today));
    },
    listActive: (today) => activeStmt.all({ todayKst: today }).map((row) => toEntry(row, today)),
    get(id, today) {
      const row = getStmt.get(id);
      return row ? toEntry(row, today) : null;
    },
    findByKey(ecosystem, name, versionRange, today) {
      const row = findByKeyStmt.get(ecosystem, name, toDbRange(versionRange));
      return row ? toEntry(row, today) : null;
    },
    insert(input, now, today) {
      const row = insertStmt.get(
        input.ecosystem,
        input.name,
        toDbRange(input.versionRange),
        input.reason,
        input.severity,
        input.enabled ? 1 : 0,
        input.expiresAt,
        now,
        now,
      );
      if (!row) throw new Error("blacklist insert 결과가 없습니다");
      return toEntry(row, today);
    },
    update(id, input, now, today) {
      const row = updateStmt.get(
        input.ecosystem,
        input.name,
        toDbRange(input.versionRange),
        input.reason,
        input.severity,
        input.enabled ? 1 : 0,
        input.expiresAt,
        now,
        id,
      );
      if (!row) throw new Error(`blacklist 항목이 없습니다: ${id}`);
      return toEntry(row, today);
    },
    remove: (id) => removeStmt.run(id).changes > 0,
  };
}
