// query key.
// 무효화는 prefix 로 한다: findings 는 모든 filter·page, scans 는 모든 page 를 함께 무효화한다.
import type {
  BlacklistFilter,
  FeedEntriesFilter,
  FindingsFilter,
  ScanReposFilter,
  VulnerabilitiesFilter,
} from "@/lib/api";

export const queryKeys = {
  summary: () => ["summary"] as const,
  findingsAll: () => ["findings"] as const,
  findings: (filter: FindingsFilter, page: number) =>
    [
      "findings",
      {
        status: filter.status,
        repo: filter.repo,
        package: filter.package,
        ecosystem: filter.ecosystem,
        category: filter.category,
        excludeCategory: filter.excludeCategory,
        source: filter.source,
        excludeSource: filter.excludeSource,
        severity: filter.severity,
      },
      page,
    ] as const,
  // 필터가 없으면 ["blacklist"] 그대로(설정 화면이 같은 key 를 쓴다). 있으면 prefix 무효화에 함께 걸린다.
  blacklist: (filter?: BlacklistFilter) => {
    const active = {
      ecosystem: filter?.ecosystem,
      status: filter?.status,
      source: filter?.source,
      excludeSource: filter?.excludeSource,
      q: filter?.q,
    };
    return active.ecosystem || active.status || active.source || active.excludeSource || active.q
      ? (["blacklist", active] as const)
      : (["blacklist"] as const);
  },
  scansAll: () => ["scans"] as const,
  scans: (page: number) => ["scans", page] as const,
  // ["scans"] prefix 라서 scansAll() 무효화에 함께 걸린다.
  scanRepos: (scanId: number, filter: ScanReposFilter, page: number) =>
    ["scans", scanId, "repos", { status: filter.status, q: filter.q }, page] as const,
  settings: () => ["settings"] as const,
  feedStatus: () => ["feed", "status"] as const,
  feedEntriesAll: () => ["feed", "entries"] as const,
  // 검출 상태 변경·블랙리스트 변경·스캔이 바꾸므로 prefix 로 함께 무효화한다.
  vulnerabilitiesAll: () => ["vulnerabilities"] as const,
  vulnerabilities: (filter: VulnerabilitiesFilter, page: number) =>
    ["vulnerabilities", "list", { ecosystem: filter.ecosystem, q: filter.q, directOnly: filter.directOnly }, page] as const,
  vulnerabilityDetail: (ecosystem: string, name: string) => ["vulnerabilities", "detail", ecosystem, name] as const,
  feedEntries: (filter: FeedEntriesFilter, page: number) =>
    ["feed", "entries", { kind: filter.kind, q: filter.q, ecosystem: filter.ecosystem }, page] as const,
};
