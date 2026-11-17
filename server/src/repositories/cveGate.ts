import { CVE_UNSCORED_SEVERITY } from "@pw/shared";

/**
 * `source = cve` 인 블랙리스트 항목(별칭 `b`)이 기준 점수를 통과하는가의 SQL 조건. 바인딩 이름은 `minScore`.
 * `cveMeetsMinScore` 와 같은 뜻이다(기준 0 = 모두 탈락, 점수가 없으면 등급이 critical 일 때만 통과).
 * 항목은 (종류, 이름, 범위)당 1개라서 같은 키의 cve 행 중 하나라도 통과하면 통과다.
 */
export const CVE_ENTRY_PASSES_SQL = `(:minScore > 0 AND EXISTS (
  SELECT 1 FROM feed_entries f
  WHERE f.kind = 'cve' AND f.ecosystem = b.ecosystem AND f.name = b.name AND f.version_range = b.version_range
    AND (f.cvss_score >= :minScore OR (f.cvss_score IS NULL AND f.severity = '${CVE_UNSCORED_SEVERITY}'))))`;
