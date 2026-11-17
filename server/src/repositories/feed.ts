import {
  cveMeetsMinScore,
  type Ecosystem,
  type FeedEntriesQuery,
  type FeedEntry,
  type FeedKind,
  type Page,
  type Severity,
} from "@pw/shared";
import type { Db } from "../db/index.ts";

/** 저장할 값. 이름은 그 종류의 `normalizeName` 을 적용한 값이다. */
export interface FeedWrite {
  /** 생략하면 malware */
  kind?: FeedKind;
  /** CVSS 점수(v3 와 v4 중 큰 값). 생략하거나 null 이면 점수 없음 */
  cvssScore?: number | null;
  /** 이 범위를 고친 첫 버전 */
  patchedVersion?: string | null;
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
  /** 생략하면 malware */
  kind?: FeedKind;
  ecosystem: string;
  name: string;
  versionRange: string | null;
}

export interface StoredFeedEntry extends FeedWrite {
  id: number;
  kind: FeedKind;
  cvssScore: number | null;
  patchedVersion: string | null;
}

/** SQL 만 담당한다. 동기화·스캔이 호출 쪽 트랜잭션 안에서 쓴다. */
export interface FeedRepository {
  /**
   * 항목을 더하거나, 값이 바뀐 것만 갱신한다. 바뀐(새로 생기거나 값이 달라진) 행의 수를 반환한다.
   * `seenRun` 이 있으면(전체 동기화) 그 행에 실행 id 를 남긴다 — 값이 같아도 남기지만 바뀐 행의 수에는 세지 않는다.
   * 지우지 않는다(옛 범위는 전체 동기화의 `sweep` 이 정리한다).
   */
  upsert(entries: FeedWrite[], seenRun: string | null): number;
  /** 이번 전체 동기화(`runId`)가 보지 못한 그 분류의 행을 모두 지운다(다른 분류는 건드리지 않는다). 지운 행의 수 */
  sweep(kind: FeedKind, runId: string): number;
  /** 철회된 권고: 그 분류에서 `external_id` 의 항목을 모두 지운다. 지운 행의 수 */
  deleteByExternalId(kind: FeedKind, externalId: string): number;
  /** 분류를 생략하면 전체 */
  count(kind?: FeedKind): number;
  countsByEcosystem(kind?: FeedKind): Record<string, number>;
  /**
   * 스캔의 index 용. 15만 건을 한꺼번에 배열로 만들지 않는다.
   * malware 는 모두, cve 는 `cveMeetsMinScore` 가 true 인 것만(기본 0 = cve 없음).
   */
  iterateIndexRows(cveMinScore?: number): IterableIterator<FeedIndexRow>;
  get(id: number): StoredFeedEntry | null;
  /** `updatedAt` 내림차순, 같으면 id */
  list(query: FeedEntriesQuery): Page<FeedEntry>;
}

interface FeedRow {
  id: number;
  kind: FeedKind;
  cvss_score: number | null;
  patched_version: string | null;
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

const COLUMNS =
  "id, kind, cvss_score, patched_version, external_id, ecosystem, name, version_range, raw_range, severity, summary, url, updated_at";

// "모든 버전"은 DB 에 '' 로 저장한다(블랙리스트와 같다).
const toDbRange = (range: string | null): string => range ?? "";
const fromDbRange = (range: string): string | null => (range === "" ? null : range);

const toStored = (row: FeedRow): StoredFeedEntry => ({
  id: row.id,
  kind: row.kind,
  cvssScore: row.cvss_score,
  patchedVersion: row.patched_version,
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

interface IndexSqlRow {
  id: number;
  kind: FeedKind;
  cvss_score: number | null;
  severity: Severity;
  ecosystem: string;
  name: string;
  version_range: string;
}

export function createFeedRepository(db: Db): FeedRepository {
  // 값이 같으면 갱신하지 않아서 `changes` 가 "정말 바뀐 행"의 수가 된다.
  const upsertStmt = db.prepare<unknown[]>(
    `INSERT INTO feed_entries
       (external_id, ecosystem, name, version_range, raw_range, severity, summary, url, updated_at, seen_run,
        kind, cvss_score, patched_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (external_id, ecosystem, name, version_range) DO UPDATE SET
       raw_range = excluded.raw_range, severity = excluded.severity, summary = excluded.summary,
       url = excluded.url, updated_at = excluded.updated_at, kind = excluded.kind,
       cvss_score = excluded.cvss_score, patched_version = excluded.patched_version
     WHERE raw_range IS NOT excluded.raw_range OR severity IS NOT excluded.severity
        OR summary IS NOT excluded.summary OR url IS NOT excluded.url OR updated_at IS NOT excluded.updated_at
        OR kind IS NOT excluded.kind OR cvss_score IS NOT excluded.cvss_score OR patched_version IS NOT excluded.patched_version`,
  );
  const seenStmt = db.prepare<[string, string, string, string, string, string]>(
    `UPDATE feed_entries SET seen_run = ?
     WHERE external_id = ? AND ecosystem = ? AND name = ? AND version_range = ? AND seen_run IS NOT ?`,
  );
  const sweepStmt = db.prepare<[string, string]>("DELETE FROM feed_entries WHERE kind = ? AND seen_run IS NOT ?");
  const seenAnyStmt = db.prepare<[string, string], { found: number }>(
    "SELECT 1 AS found FROM feed_entries WHERE kind = ? AND seen_run = ? LIMIT 1",
  );
  const deleteByIdStmt = db.prepare<[string, string]>("DELETE FROM feed_entries WHERE kind = ? AND external_id = ?");
  const countStmt = db.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM feed_entries");
  const countKindStmt = db.prepare<[string], { count: number }>(
    "SELECT COUNT(*) AS count FROM feed_entries WHERE kind = ?",
  );
  const byEcosystemStmt = db.prepare<[], { ecosystem: string; count: number }>(
    "SELECT ecosystem, COUNT(*) AS count FROM feed_entries GROUP BY ecosystem",
  );
  const byEcosystemKindStmt = db.prepare<[string], { ecosystem: string; count: number }>(
    "SELECT ecosystem, COUNT(*) AS count FROM feed_entries WHERE kind = ? GROUP BY ecosystem",
  );
  const indexStmt = db.prepare<[], IndexSqlRow>(
    "SELECT id, kind, cvss_score, severity, ecosystem, name, version_range FROM feed_entries",
  );
  const getStmt = db.prepare<[number], FeedRow>(`SELECT ${COLUMNS} FROM feed_entries WHERE id = ?`);

  return {
    upsert(entries, seenRun) {
      let changes = 0;
      for (const entry of entries) {
        const range = toDbRange(entry.versionRange);
        changes += upsertStmt.run(
          entry.externalId,
          entry.ecosystem,
          entry.name,
          range,
          entry.rawRange,
          entry.severity,
          entry.summary,
          entry.url,
          entry.updatedAt,
          seenRun,
          entry.kind ?? "malware",
          entry.cvssScore ?? null,
          entry.patchedVersion ?? null,
        ).changes;
        if (seenRun !== null) seenStmt.run(seenRun, entry.externalId, entry.ecosystem, entry.name, range, seenRun);
      }
      return changes;
    },
    // 이번 실행이 한 행도 보지 못했으면(빈 응답 등) 아무것도 지우지 않는다 - 목록 전체를 잃지 않으려고.
    sweep: (kind, runId) => (seenAnyStmt.get(kind, runId) ? sweepStmt.run(kind, runId).changes : 0),
    deleteByExternalId: (kind, externalId) => deleteByIdStmt.run(kind, externalId).changes,
    count: (kind) => (kind === undefined ? countStmt.get() : countKindStmt.get(kind))?.count ?? 0,
    countsByEcosystem: (kind) =>
      Object.fromEntries(
        (kind === undefined ? byEcosystemStmt.all() : byEcosystemKindStmt.all(kind)).map((row) => [row.ecosystem, row.count]),
      ),
    *iterateIndexRows(cveMinScore = 0) {
      for (const row of indexStmt.iterate()) {
        if (row.kind === "cve" && !cveMeetsMinScore(row.cvss_score, row.severity, cveMinScore)) continue;
        yield { id: row.id, kind: row.kind, ecosystem: row.ecosystem, name: row.name, versionRange: fromDbRange(row.version_range) };
      }
    },
    get(id) {
      const row = getStmt.get(id);
      return row ? toStored(row) : null;
    },
    list(query) {
      const where: string[] = [];
      const params: (string | number)[] = [];
      if (query.kind !== undefined) {
        where.push("kind = ?");
        params.push(query.kind);
      }
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
