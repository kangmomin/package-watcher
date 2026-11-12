import type { BlacklistEntry, BlacklistInput } from "@pw/shared";
import type { Db } from "../db/index.ts";

/** SQL 만 담당. 입력은 이미 검증·정규화된 값이다. */
export interface BlacklistRepository {
  /** `name` 오름차순, 같으면 `id` 오름차순 */
  list(): BlacklistEntry[];
  get(id: number): BlacklistEntry | null;
  /** 정규화한 (name, versionRange) 로 찾는다. null 범위끼리도 같은 키다. */
  findByKey(name: string, versionRange: string | null): BlacklistEntry | null;
  insert(input: BlacklistInput, now: string): BlacklistEntry;
  update(id: number, input: BlacklistInput, now: string): BlacklistEntry;
  remove(id: number): boolean;
}

interface BlacklistRow {
  id: number;
  name: string;
  version_range: string;
  reason: string;
  created_at: string;
  updated_at: string;
}

const COLUMNS = "id, name, version_range, reason, created_at, updated_at";

// "모든 버전"은 DB 에 '' 로 저장한다(unique 제약이 null 끼리 중복을 잡게 하려고). API 에서는 null 이다.
const toDbRange = (versionRange: string | null): string => versionRange ?? "";

function toEntry(row: BlacklistRow): BlacklistEntry {
  return {
    id: row.id,
    name: row.name,
    versionRange: row.version_range === "" ? null : row.version_range,
    reason: row.reason,
    ecosystem: "npm", // v2-shim
    severity: "medium", // v2-shim
    enabled: true, // v2-shim
    expiresAt: null, // v2-shim
    isExpired: false, // v2-shim
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createBlacklistRepository(db: Db): BlacklistRepository {
  const listStmt = db.prepare<[], BlacklistRow>(
    `SELECT ${COLUMNS} FROM blacklist_entries ORDER BY name ASC, id ASC`,
  );
  const getStmt = db.prepare<[number], BlacklistRow>(
    `SELECT ${COLUMNS} FROM blacklist_entries WHERE id = ?`,
  );
  const findByKeyStmt = db.prepare<[string, string], BlacklistRow>(
    `SELECT ${COLUMNS} FROM blacklist_entries WHERE name = ? AND version_range = ?`,
  );
  const insertStmt = db.prepare<[string, string, string, string, string], BlacklistRow>(
    `INSERT INTO blacklist_entries (name, version_range, reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?) RETURNING ${COLUMNS}`,
  );
  const updateStmt = db.prepare<[string, string, string, string, number], BlacklistRow>(
    `UPDATE blacklist_entries SET name = ?, version_range = ?, reason = ?, updated_at = ?
     WHERE id = ? RETURNING ${COLUMNS}`,
  );
  const removeStmt = db.prepare<[number]>("DELETE FROM blacklist_entries WHERE id = ?");

  return {
    list: () => listStmt.all().map(toEntry),
    get(id) {
      const row = getStmt.get(id);
      return row ? toEntry(row) : null;
    },
    findByKey(name, versionRange) {
      const row = findByKeyStmt.get(name, toDbRange(versionRange));
      return row ? toEntry(row) : null;
    },
    insert(input, now) {
      const row = insertStmt.get(input.name, toDbRange(input.versionRange), input.reason, now, now);
      if (!row) throw new Error("blacklist insert 결과가 없습니다");
      return toEntry(row);
    },
    update(id, input, now) {
      const row = updateStmt.get(input.name, toDbRange(input.versionRange), input.reason, now, id);
      if (!row) throw new Error(`blacklist 항목이 없습니다: ${id}`);
      return toEntry(row);
    },
    remove: (id) => removeStmt.run(id).changes > 0,
  };
}
