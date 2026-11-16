// query key.
// 무효화는 prefix 로 한다: findings 는 모든 filter·page, scans 는 모든 page 를 함께 무효화한다.
import type { BlacklistFilter, FeedEntriesFilter, FindingsFilter, ScanReposFilter } from "@/lib/api";

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
        severity: filter.severity,
      },
      page,
    ] as const,
  // 필터가 없으면 ["blacklist"] 그대로(설정 화면이 같은 key 를 쓴다). 있으면 prefix 무효화에 함께 걸린다.
  blacklist: (filter?: BlacklistFilter) => {
    const active = { ecosystem: filter?.ecosystem, status: filter?.status, source: filter?.source, q: filter?.q };
    return active.ecosystem || active.status || active.source || active.q
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
  feedEntries: (filter: FeedEntriesFilter, page: number) =>
    ["feed", "entries", { q: filter.q, ecosystem: filter.ecosystem }, page] as const,
};
