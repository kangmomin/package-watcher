import type { Ecosystem, FeedEntriesQuery, FeedEntry, Page, Severity } from "@pw/shared";
import type { Db } from "../db/index.ts";

/** 저장할 값. 이름은 그 종류의 `normalizeName` 을 적용한 값이다. */
export interface FeedWrite {
  externalId: string;
  ecosystem: Ecosystem;
  name: string;
  /** null = 모든 버전 */
  versionRange: string | null;
  rawRange: string;
  severity: Severity;
  summary: string;
  url: string;
  updatedAt: string;
}

/** 스캔의 대조 index 를 만드는 데 필요한 열만 */
export interface FeedIndexRow {
  id: number;
  ecosystem: string;
  name: string;
  versionRange: string | null;
}

export interface StoredFeedEntry extends FeedWrite {
  id: number;
}

/** SQL 만 담당한다. 동기화·스캔이 호출 쪽 트랜잭션 안에서 쓴다. */
export interface FeedRepository {
  /**
   * 한 권고의 한 패키지(external_id, ecosystem, name)를 `entries` 의 범위 집합으로 교체한다.
   * 집합에 없는 옛 범위는 지우고, 있는 범위는 값이 바뀐 것만 갱신한다. 바뀐 행의 수를 반환한다.
   * `prune` 이 false 이면 지우지 않고 더하기만 한다(같은 권고의 범위가 여러 페이지에 나뉘어 온 경우).
   */
  replaceGroup(externalId: string, ecosystem: Ecosystem, name: string, entries: FeedWrite[], prune?: boolean): number;
  /** 철회된 권고: 그 `external_id` 의 항목을 모두 지운다. 지운 행의 수 */
  deleteByExternalId(externalId: string): number;
  count(): number;
  countsByEcosystem(): Record<string, number>;
  /** 스캔의 index 용. 15만 건을 한꺼번에 배열로 만들지 않는다. */
  iterateIndexRows(): IterableIterator<FeedIndexRow>;
  get(id: number): StoredFeedEntry | null;
  /** `updatedAt` 내림차순, 같으면 id */
  list(query: FeedEntriesQuery): Page<FeedEntry>;
}

interface FeedRow {
  id: number;
  external_id: string;
  ecosystem: Ecosystem;
  name: string;
  version_range: string;
  raw_range: string;
  severity: Severity;
  summary: string;
  url: string;
  updated_at: string;
}

const COLUMNS = "id, external_id, ecosystem, name, version_range, raw_range, severity, summary, url, updated_at";

// "모든 버전"은 DB 에 '' 로 저장한다(블랙리스트와 같다).
const toDbRange = (range: string | null): string => range ?? "";
const fromDbRange = (range: string): string | null => (range === "" ? null : range);

const toStored = (row: FeedRow): StoredFeedEntry => ({
  id: row.id,
  externalId: row.external_id,
  ecosystem: row.ecosystem,
  name: row.name,
  versionRange: fromDbRange(row.version_range),
  rawRange: row.raw_range,
  severity: row.severity,
  summary: row.summary,
  url: row.url,
  updatedAt: row.updated_at,
});

export function createFeedRepository(db: Db): FeedRepository {
  // 값이 같으면 갱신하지 않아서 `changes` 가 "정말 바뀐 행"의 수가 된다.
  const upsertStmt = db.prepare<unknown[]>(
    `INSERT INTO feed_entries (${COLUMNS.replace("id, ", "")})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (external_id, ecosystem, name, version_range) DO UPDATE SET
       raw_range = excluded.raw_range, severity = excluded.severity, summary = excluded.summary,
       url = excluded.url, updated_at = excluded.updated_at
     WHERE raw_range IS NOT excluded.raw_range OR severity IS NOT excluded.severity
        OR summary IS NOT excluded.summary OR url IS NOT excluded.url OR updated_at IS NOT excluded.updated_at`,
  );
  const pruneStmt = db.prepare<[string, string, string, string]>(
    `DELETE FROM feed_entries
     WHERE external_id = ? AND ecosystem = ? AND name = ?
       AND version_range NOT IN (SELECT value FROM json_each(?))`,
  );
  const deleteByIdStmt = db.prepare<[string]>("DELETE FROM feed_entries WHERE external_id = ?");
  const countStmt = db.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM feed_entries");
  const byEcosystemStmt = db.prepare<[], { ecosystem: string; count: number }>(
    "SELECT ecosystem, COUNT(*) AS count FROM feed_entries GROUP BY ecosystem",
  );
  const indexStmt = db.prepare<[], { id: number; ecosystem: string; name: string; version_range: string }>(
    "SELECT id, ecosystem, name, version_range FROM feed_entries",
  );
  const getStmt = db.prepare<[number], FeedRow>(`SELECT ${COLUMNS} FROM feed_entries WHERE id = ?`);

  return {
    replaceGroup(externalId, ecosystem, name, entries, prune = true) {
      const ranges = JSON.stringify([...new Set(entries.map((entry) => toDbRange(entry.versionRange)))]);
      let changes = prune ? pruneStmt.run(externalId, ecosystem, name, ranges).changes : 0;
      for (const entry of entries) {
        changes += upsertStmt.run(
          entry.externalId,
          entry.ecosystem,
          entry.name,
          toDbRange(entry.versionRange),
          entry.rawRange,
          entry.severity,
          entry.summary,
          entry.url,
          entry.updatedAt,
        ).changes;
      }
      return changes;
    },
    deleteByExternalId: (externalId) => deleteByIdStmt.run(externalId).changes,
    count: () => countStmt.get()?.count ?? 0,
    countsByEcosystem: () => Object.fromEntries(byEcosystemStmt.all().map((row) => [row.ecosystem, row.count])),
    *iterateIndexRows() {
      for (const row of indexStmt.iterate()) {
        yield { id: row.id, ecosystem: row.ecosystem, name: row.name, versionRange: fromDbRange(row.version_range) };
      }
    },
    get(id) {
      const row = getStmt.get(id);
      return row ? toStored(row) : null;
    },
    list(query) {
      const where: string[] = [];
      const params: (string | number)[] = [];
      if (query.ecosystem !== undefined) {
        where.push("ecosystem = ?");
        params.push(query.ecosystem);
      }
      // 부분 일치는 instr 로 한다(LIKE 의 %, _ 이스케이프가 필요 없다).
      if (query.q !== undefined) {
        where.push("(instr(lower(name), lower(?)) > 0 OR instr(lower(external_id), lower(?)) > 0)");
        params.push(query.q, query.q);
      }
      const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
      const total =
        db.prepare<unknown[], { count: number }>(`SELECT COUNT(*) AS count FROM feed_entries ${whereSql}`).get(...params)
          ?.count ?? 0;
      const rows = db
        .prepare<unknown[], FeedRow>(
          `SELECT ${COLUMNS} FROM feed_entries ${whereSql} ORDER BY updated_at DESC, id ASC LIMIT ? OFFSET ?`,
        )
        .all(...params, query.limit, (query.page - 1) * query.limit);
      return {
        items: rows.map((row) => {
          const { id: _id, ...entry } = toStored(row);
          return entry;
        }),
        total,
        page: query.page,
        limit: query.limit,
      };
    },
  };
}
