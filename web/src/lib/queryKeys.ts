// query key.
// 무효화는 prefix 로 한다: findings 는 모든 filter·page, scans 는 모든 page 를 함께 무효화한다.
import type { FindingsFilter, ScanReposFilter } from "@/lib/api";

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
        severity: filter.severity,
      },
      page,
    ] as const,
  blacklist: () => ["blacklist"] as const,
  scansAll: () => ["scans"] as const,
  scans: (page: number) => ["scans", page] as const,
  // ["scans"] prefix 라서 scansAll() 무효화에 함께 걸린다.
  scanRepos: (scanId: number, filter: ScanReposFilter, page: number) =>
    ["scans", scanId, "repos", { status: filter.status, q: filter.q }, page] as const,
  settings: () => ["settings"] as const,
};
