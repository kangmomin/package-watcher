import { Range } from "semver";

const SEMVER_ALL = new Set(["*", "x", ">=0", ">=0.0.0", ">0", ">0.0.0"]);
const INTERVAL_ALL = new Set(["[0,)", "(,)", "[0.0.0,)", "(0,)"]);

/**
 * 같은 뜻의 범위를 같은 문자열로 만든다(비교용 — 저장된 값은 바꾸지 않는다).
 * "모든 버전"의 표기(null, 빈 문자열, `*`, `>=0` 등)는 모두 ''. npm·pub 은 semver 의 표준 형태, 그 외는 공백을 없앤 소문자.
 * 예외 없음 — 읽을 수 없으면 trim 한 원문.
 */
export function comparableRange(ecosystem: string, range: string | null): string {
  if (range === null) return "";
  const trimmed = range.trim();
  if (trimmed === "") return "";
  const compact = trimmed.replace(/\s+/g, "").toLowerCase();
  // go 는 버전에 v 접두가 있다(`>=v0.0.0`)
  const bare = ecosystem === "go" ? compact.replace(/(^|[<>=])v(?=\d)/g, "$1") : compact;
  switch (ecosystem) {
    case "npm":
    case "pub":
      if (SEMVER_ALL.has(bare)) return "";
      try {
        return new Range(trimmed, { includePrerelease: true }).range;
      } catch {
        return trimmed;
      }
    case "cargo":
    case "go":
      return SEMVER_ALL.has(bare) ? "" : compact;
    case "pypi":
      return bare === ">=0" || bare === ">=0.0.0" ? "" : compact;
    case "nuget":
    case "maven":
      return INTERVAL_ALL.has(compact) ? "" : compact;
    default:
      return compact;
  }
}
