import {
  CVE_SOURCE,
  SEVERITIES,
  SEVERITY_RANK,
  VULNERABILITY_DETAIL_MAX_FINDINGS,
  VULNERABILITY_MAX_PATCHED_VERSIONS,
  type Ecosystem,
  type Finding,
  type Page,
  type Severity,
  type VulnerabilitiesQuery,
  type VulnerabilityAdvisory,
  type VulnerabilityGroup,
} from "@pw/shared";
import type { Db } from "../db/index.ts";
import { FINDING_COLUMNS, toFinding, type FindingRow } from "./findings.ts";

export interface VulnerabilityDetailRows {
  advisories: VulnerabilityAdvisory[];
  findings: Finding[];
  findingsTotal: number;
}

/** 취약점(`source = cve`)의 open 검출을 패키지로 묶어 읽는다. 집계는 SQL 이 한다. */
export interface VulnerabilitiesRepository {
  /** 최고 점수 내림차순(없으면 뒤) → repo 수 내림차순 → 이름 */
  list(query: VulnerabilitiesQuery): Page<VulnerabilityGroup>;
  /** 그 패키지의 open 검출이 없으면 null */
  detail(ecosystem: Ecosystem, name: string): VulnerabilityDetailRows | null;
}

const SEVERITY_RANK_SQL = `CASE b.severity ${SEVERITIES.map((severity) => `WHEN '${severity}' THEN ${SEVERITY_RANK[severity]}`).join(" ")} END`;
const SEVERITY_OF_RANK = new Map<number, Severity>(SEVERITIES.map((severity) => [SEVERITY_RANK[severity], severity]));

// 검출 → 그 항목(cve) → 항목의 권고 행(같은 id·종류·이름·범위). 권고 행이 사라졌어도 검출은 남기려고 LEFT JOIN 이다.
const HITS_FROM = `
  FROM findings fi
  JOIN blacklist_entries b ON b.id = fi.blacklist_entry_id AND b.source = '${CVE_SOURCE}'
  LEFT JOIN feed_entries f ON f.kind = 'cve' AND f.external_id = b.external_id AND f.ecosystem = b.ecosystem
    AND f.name = b.name AND f.version_range = b.version_range`;

interface GroupRow {
  ecosystem: Ecosystem;
  package_name: string;
  max_score: number | null;
  max_rank: number;
  advisory_count: number;
  repo_count: number;
  finding_count: number;
  has_direct: number;
}

export function createVulnerabilitiesRepository(db: Db): VulnerabilitiesRepository {
  const advisoriesStmt = db.prepare<[string, string], {
    id: number;
    external_id: string | null;
    cvss_score: number | null;
    severity: Severity;
    summary: string;
    url: string;
    version_range: string;
    patched_version: string | null;
    finding_count: number;
  }>(
    `SELECT b.id AS id, b.external_id AS external_id, f.cvss_score AS cvss_score, b.severity AS severity,
            COALESCE(f.summary, b.reason) AS summary,
            COALESCE(f.url, 'https://github.com/advisories/' || COALESCE(b.external_id, '')) AS url,
            b.version_range AS version_range, f.patched_version AS patched_version, COUNT(fi.id) AS finding_count
     ${HITS_FROM}
     WHERE fi.status = 'open' AND fi.ecosystem = ? AND fi.package_name = ?
     GROUP BY b.id
     ORDER BY (f.cvss_score IS NULL), f.cvss_score DESC, ${SEVERITY_RANK_SQL} DESC, b.external_id ASC, b.id ASC`,
  );
  const findingsStmt = db.prepare<[string, string, number], FindingRow>(
    `SELECT ${FINDING_COLUMNS} FROM findings
     WHERE status = 'open' AND ecosystem = ? AND package_name = ?
       AND blacklist_entry_id IN (SELECT id FROM blacklist_entries WHERE source = '${CVE_SOURCE}')
     ORDER BY repo ASC, ref ASC, file_path ASC, id ASC LIMIT ?`,
  );
  const findingsTotalStmt = db.prepare<[string, string], { count: number }>(
    `SELECT COUNT(*) AS count FROM findings
     WHERE status = 'open' AND ecosystem = ? AND package_name = ?
       AND blacklist_entry_id IN (SELECT id FROM blacklist_entries WHERE source = '${CVE_SOURCE}')`,
  );

  return {
    list(query) {
      const where = ["fi.status = 'open'"];
      const params: (string | number)[] = [];
      if (query.ecosystem !== undefined) {
        where.push("fi.ecosystem = ?");
        params.push(query.ecosystem);
      }
      // 부분 일치는 instr 로 한다(LIKE 의 %, _ 이스케이프가 필요 없다).
      if (query.q !== undefined) {
        where.push("instr(lower(fi.package_name), lower(?)) > 0");
        params.push(query.q);
      }
      const having = query.directOnly === true ? "HAVING has_direct = 1" : "";
      const grouped = `
        SELECT fi.ecosystem AS ecosystem, fi.package_name AS package_name, MAX(f.cvss_score) AS max_score,
               MAX(${SEVERITY_RANK_SQL}) AS max_rank, COUNT(DISTINCT b.id) AS advisory_count,
               COUNT(DISTINCT fi.repo) AS repo_count, COUNT(*) AS finding_count,
               MAX(fi.dependency_type = 'direct') AS has_direct
        ${HITS_FROM}
        WHERE ${where.join(" AND ")}
        GROUP BY fi.ecosystem, fi.package_name
        ${having}`;
      const total =
        db.prepare<(string | number)[], { count: number }>(`SELECT COUNT(*) AS count FROM (${grouped})`).get(...params)
          ?.count ?? 0;
      const offset = (query.page - 1) * query.limit;
      const rows =
        offset >= total
          ? []
          : db
              .prepare<(string | number)[], GroupRow>(
                `${grouped}
                 ORDER BY (max_score IS NULL), max_score DESC, repo_count DESC, package_name ASC, ecosystem ASC
                 LIMIT ? OFFSET ?`,
              )
              .all(...params, query.limit, offset)
      ;
      const patched = new Map<string, string[]>();
      if (rows.length > 0) {
        const keys = rows.map(() => "(?, ?)").join(", ");
        const found = db
          .prepare<string[], { ecosystem: string; package_name: string; patched_version: string }>(
            `SELECT DISTINCT fi.ecosystem AS ecosystem, fi.package_name AS package_name, f.patched_version AS patched_version
             ${HITS_FROM}
             WHERE fi.status = 'open' AND f.patched_version IS NOT NULL AND (fi.ecosystem, fi.package_name) IN (VALUES ${keys})
             ORDER BY f.patched_version ASC`,
          )
          .all(...rows.flatMap((row) => [row.ecosystem, row.package_name]));
        for (const row of found) {
          const key = `${row.ecosystem}\u0000${row.package_name}`;
          const list = patched.get(key) ?? [];
          list.push(row.patched_version);
          patched.set(key, list);
        }
      }
      return {
        items: rows.map((row) => ({
          ecosystem: row.ecosystem,
          packageName: row.package_name,
          maxScore: row.max_score,
          severity: SEVERITY_OF_RANK.get(row.max_rank) ?? "medium",
          advisoryCount: row.advisory_count,
          repoCount: row.repo_count,
          findingCount: row.finding_count,
          hasDirect: row.has_direct === 1,
          patchedVersions: (patched.get(`${row.ecosystem}\u0000${row.package_name}`) ?? []).slice(
            0,
            VULNERABILITY_MAX_PATCHED_VERSIONS,
          ),
        })),
        total,
        page: query.page,
        limit: query.limit,
      };
    },
    detail(ecosystem, name) {
      const findingsTotal = findingsTotalStmt.get(ecosystem, name)?.count ?? 0;
      if (findingsTotal === 0) return null;
      return {
        advisories: advisoriesStmt.all(ecosystem, name).map((row) => ({
          blacklistEntryId: row.id,
          externalId: row.external_id ?? "unknown",
          cvssScore: row.cvss_score,
          severity: row.severity,
          summary: row.summary,
          url: row.url,
          versionRange: row.version_range === "" ? null : row.version_range,
          patchedVersion: row.patched_version,
          findingCount: row.finding_count,
        })),
        findings: findingsStmt.all(ecosystem, name, VULNERABILITY_DETAIL_MAX_FINDINGS).map(toFinding),
        findingsTotal,
      };
    },
  };
}
