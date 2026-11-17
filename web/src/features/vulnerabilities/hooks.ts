// 취약점 hooks.
// 목록: GET /api/vulnerabilities (패키지별 묶음). 상세: GET /api/vulnerabilities/detail — 행을 열 때(enabled)만 조회한다.
import { VULNERABILITIES_DEFAULT_LIMIT, type Ecosystem, type Page, type VulnerabilityDetail, type VulnerabilityGroup } from "@pw/shared";
import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { api, type ApiRequestError, type VulnerabilitiesFilter } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

export const VULNERABILITIES_PAGE_LIMIT = VULNERABILITIES_DEFAULT_LIMIT;

export function useVulnerabilities(
  filter: VulnerabilitiesFilter,
  page: number,
): UseQueryResult<Page<VulnerabilityGroup>, ApiRequestError> {
  return useQuery<Page<VulnerabilityGroup>, ApiRequestError>({
    queryKey: queryKeys.vulnerabilities(filter, page),
    queryFn: () => api.listVulnerabilities({ ...filter, page, limit: VULNERABILITIES_PAGE_LIMIT }),
    placeholderData: keepPreviousData,
  });
}

export function useVulnerabilityDetail(
  ecosystem: Ecosystem,
  name: string,
  enabled: boolean,
): UseQueryResult<VulnerabilityDetail, ApiRequestError> {
  return useQuery<VulnerabilityDetail, ApiRequestError>({
    queryKey: queryKeys.vulnerabilityDetail(ecosystem, name),
    queryFn: () => api.getVulnerabilityDetail(ecosystem, name),
    enabled,
  });
}
