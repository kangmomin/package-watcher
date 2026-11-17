import {
  cveMeetsMinScore,
  FEED_KIND_SOURCE,
  type BlacklistEntry,
  type BlacklistQuery,
  type Ecosystem,
  type EntrySource,
  type FeedKind,
  type Severity,
} from "@pw/shared";
import type { Db } from "../db/index.ts";
import { comparableRange } from "../feed/comparable.ts";
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
  /** insert 에만 쓴다(출처는 바꿀 수 없다). 생략하면 사용자가 만든 항목(manual) */
  source?: EntrySource;
  externalId?: string | null;
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
  /** 같은 종류·이름에서 범위의 뜻이 같은 항목(꺼짐·만료 포함). 정확한 키가 아니라 `comparableRange` 로 비교한다 */
  findSameMeaning(
    ecosystem: Ecosystem,
    name: string,
    versionRange: string | null,
    today: string,
  ): BlacklistEntry | null;
  /**
   * 외부 목록(feed)에서 사라진 권고의 `source=feed` 항목을 끄고 사유 끝에 표식을 붙인다(항목당 1번 — 표식이 있으면 건너뛴다).
   * 바뀐 항목의 id 를 반환한다. 지우지는 않는다.
   */
  disableWithdrawnFeedEntries(kind: FeedKind, now: string): number[];
  /**
   * 기준 점수를 통과하는 `source=cve` 항목의 id. 같은 (종류, 이름)에서 범위의 뜻이 같은(`comparableRange`) cve 행 중
   * `cveMeetsMinScore` 가 true 인 것이 있으면 통과다(같은 범위의 권고가 여럿이어도 항목은 1개라서 항목의 externalId 하나만 보면
   * 점수가 낮은 권고에 가려지고, 표기만 다른 범위는 문자열 비교로는 영구 휴면한다). `minScore` 가 0 이면 비어 있다.
   */
  cveEntryIdsMeeting(minScore: number): Set<number>;
  /**
   * `source=cve` 항목을 외부 목록의 악성 패키지 항목으로 승격한다(같은 뜻의 범위에 malware 권고가 일치했을 때: malware 가 우선이다).
   * 출처·권고 id·사유·심각도를 malware 권고의 값으로 바꾸고, 사용자가 꺼 두었거나 만료일을 둔 항목도 켜고 만료를 없앤다.
   * 사용자가 취약점을 무시한 것이지 악성 패키지를 무시한 것이 아니다.
   */
  promoteToFeed(id: number, input: { externalId: string; reason: string; severity: Severity }, now: string, today: string): BlacklistEntry;
  /**
   * 모든 항목(꺼짐·만료 포함)의 키. 외부 목록의 항목이 이미 있는 항목과 겹치는지 보는 데 쓴다.
   * 키 모양은 `keyOf` 다.
   */
  allKeys(): Set<string>;
  /** `allKeys` 에서 `source=cve` 항목의 키를 뺀 것. malware 행을 막는 데 쓴다(취약점 항목은 악성 패키지를 막지 못한다) */
  nonCveKeys(): Set<string>;
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
  source: EntrySource;
  external_id: string | null;
}

interface WithdrawnRow {
  id: number;
  reason: string;
  ecosystem: string;
  name: string;
  version_range: string;
}

const COLUMNS =
  "id, ecosystem, name, version_range, reason, severity, enabled, expires_at, created_at, updated_at, source, external_id";
const ORDER = "ORDER BY name ASC, id ASC";

// "모든 버전"은 DB 에 '' 로 저장한다(unique 제약이 null 끼리 중복을 잡게 하려고). API 에서는 null 이다.
/** 권고가 철회돼서 자동으로 끈 항목의 사유 끝에 붙는 표식. 이 표식이 있으면 다시 끄지 않는다 */
export const WITHDRAWN_MARK = " (권고가 철회됨)";
const fromDbRangeText = (range: string): string | null => (range === "" ? null : range);

const toDbRange = (versionRange: string | null): string => versionRange ?? "";

function toEntry(row: BlacklistRow, today: string): BlacklistEntry {
  return {
    id: row.id,
    source: row.source,
    externalId: row.external_id,
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

/** (종류, 이름, 범위) 의 키. 같은 뜻의 범위(공백·`*` 와 null 등)는 같은 키다(`comparableRange`). */
export const keyOf = (ecosystem: string, name: string, versionRange: string | null): string =>
  `${ecosystem}\u0000${name}\u0000${comparableRange(ecosystem, versionRange)}`;

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
       (ecosystem, name, version_range, reason, severity, enabled, expires_at, created_at, updated_at, source, external_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${COLUMNS}`,
  );
  const updateStmt = db.prepare<unknown[], BlacklistRow>(
    `UPDATE blacklist_entries
     SET ecosystem = ?, name = ?, version_range = ?, reason = ?, severity = ?, enabled = ?, expires_at = ?,
         updated_at = ?
     WHERE id = ? RETURNING ${COLUMNS}`,
  );
  const allKeysStmt = db.prepare<[], { ecosystem: string; name: string; version_range: string }>(
    "SELECT ecosystem, name, version_range FROM blacklist_entries",
  );
  const byNameStmt = db.prepare<[string, string], BlacklistRow>(
    `SELECT ${COLUMNS} FROM blacklist_entries WHERE ecosystem = ? AND name = ?`,
  );
  // 분류의 범위 안에서만 본다: 그 분류의 행에 없는 권고의 항목만 철회로 본다.
  const withdrawnStmt = db.prepare<[string, string], WithdrawnRow>(
    `SELECT id, reason, ecosystem, name, version_range FROM blacklist_entries
     WHERE source = ? AND external_id IS NOT NULL
       AND external_id NOT IN (SELECT external_id FROM feed_entries WHERE kind = ?)`,
  );
  const cveEntriesStmt = db.prepare<[], { id: number; ecosystem: string; name: string; version_range: string }>(
    "SELECT id, ecosystem, name, version_range FROM blacklist_entries WHERE source = 'cve'",
  );
  const cveRowsStmt = db.prepare<
    [string, string],
    { version_range: string; cvss_score: number | null; severity: Severity; external_id: string }
  >(
    // 점수가 높은 것이 먼저(NULL 은 뒤)
    `SELECT version_range, cvss_score, severity, external_id FROM feed_entries
     WHERE kind = 'cve' AND ecosystem = ? AND name = ? ORDER BY cvss_score DESC, external_id ASC`,
  );
  const repointStmt = db.prepare<[string, number]>("UPDATE blacklist_entries SET external_id = ? WHERE id = ?");
  const promoteStmt = db.prepare<[string, string, string, string, number], BlacklistRow>(
    `UPDATE blacklist_entries
     SET source = 'feed', external_id = ?, reason = ?, severity = ?, enabled = 1, expires_at = NULL, updated_at = ?
     WHERE id = ? RETURNING ${COLUMNS}`,
  );
  const nonCveKeysStmt = db.prepare<[], { ecosystem: string; name: string; version_range: string }>(
    "SELECT ecosystem, name, version_range FROM blacklist_entries WHERE source <> 'cve'",
  );
  const markWithdrawnStmt = db.prepare<[string, string, number]>(
    "UPDATE blacklist_entries SET enabled = 0, reason = ?, updated_at = ? WHERE id = ?",
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
      if (filter.source !== undefined) {
        where.push("source = ?");
        params.push(filter.source);
      }
      if (filter.excludeSource !== undefined) {
        where.push("source <> ?");
        params.push(filter.excludeSource);
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
    findSameMeaning(ecosystem, name, versionRange, today) {
      const wanted = comparableRange(ecosystem, versionRange);
      const row = byNameStmt
        .all(ecosystem, name)
        .find((candidate) => comparableRange(ecosystem, fromDbRangeText(candidate.version_range)) === wanted);
      return row ? toEntry(row, today) : null;
    },
    cveEntryIdsMeeting(minScore) {
      const passing = new Set<number>();
      if (minScore <= 0) return passing;
      for (const entry of cveEntriesStmt.all()) {
        const wanted = comparableRange(entry.ecosystem, fromDbRangeText(entry.version_range));
        const meets = cveRowsStmt
          .all(entry.ecosystem, entry.name)
          .some(
            (row) =>
              comparableRange(entry.ecosystem, fromDbRangeText(row.version_range)) === wanted &&
              cveMeetsMinScore(row.cvss_score, row.severity, minScore),
          );
        if (meets) passing.add(entry.id);
      }
      return passing;
    },
    promoteToFeed(id, input, now, today) {
      const row = promoteStmt.get(input.externalId, input.reason, input.severity, now, id);
      if (!row) throw new Error(`blacklist 항목이 없습니다: ${id}`);
      return toEntry(row, today);
    },
    disableWithdrawnFeedEntries(kind, now) {
      const changed: number[] = [];
      for (const row of withdrawnStmt.all(FEED_KIND_SOURCE[kind], kind)) {
        if (row.reason.endsWith(WITHDRAWN_MARK)) continue;
        // cve: 같은 뜻의 범위에 다른 권고가 남아 있으면 그 항목은 계속 쓴다 — 권고 id 만 점수가 가장 높은 남은 권고로 바꾼다
        if (kind === "cve") {
          const wanted = comparableRange(row.ecosystem, fromDbRangeText(row.version_range));
          const remaining = cveRowsStmt
            .all(row.ecosystem, row.name)
            .find((candidate) => comparableRange(row.ecosystem, fromDbRangeText(candidate.version_range)) === wanted);
          if (remaining) {
            repointStmt.run(remaining.external_id, row.id);
            continue;
          }
        }
        const reason = `${row.reason.slice(0, 500 - WITHDRAWN_MARK.length)}${WITHDRAWN_MARK}`;
        markWithdrawnStmt.run(reason, now, row.id);
        changed.push(row.id);
      }
      return changed;
    },
    nonCveKeys() {
      const keys = new Set<string>();
      for (const row of nonCveKeysStmt.iterate()) keys.add(keyOf(row.ecosystem, row.name, row.version_range));
      return keys;
    },
    allKeys() {
      const keys = new Set<string>();
      for (const row of allKeysStmt.iterate()) keys.add(keyOf(row.ecosystem, row.name, row.version_range));
      return keys;
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
        input.source ?? "manual",
        input.externalId ?? null,
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
