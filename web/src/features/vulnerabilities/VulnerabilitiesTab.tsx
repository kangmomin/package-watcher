// 대시보드의 "취약점" 탭: 필터 + 패키지별 표 + 쪽 나눔.
// 필터와 page 는 대시보드가 들고 있다(탭을 바꿔도 유지).
import { useEffect } from "react";
import { DataState } from "@/components/DataState";
import { Pager } from "@/components/Pager";
import { useSettings } from "@/features/settings/hooks";
import { VulnerabilitiesFilters } from "@/features/vulnerabilities/VulnerabilitiesFilters";
import { VulnerabilitiesTable } from "@/features/vulnerabilities/VulnerabilitiesTable";
import { useVulnerabilities } from "@/features/vulnerabilities/hooks";
import type { VulnerabilitiesFilter } from "@/lib/api";
import { emptyPageFallback, firstLoadState, isUnconfirmedPage } from "@/lib/queryState";
import { cn } from "@/lib/utils";

const CVE_OFF_MESSAGE = "취약점의 대조가 꺼져 있습니다. 설정에서 기준 점수를 정하십시오";
const CVE_EMPTY_MESSAGE = "기준 이상의 취약점이 없습니다";
const FILTERED_EMPTY_MESSAGE = "조건에 맞는 취약점이 없습니다";

export interface VulnerabilitiesTabProps {
  filter: VulnerabilitiesFilter;
  page: number;
  onFilterChange: (filter: VulnerabilitiesFilter) => void;
  onPageChange: (page: number) => void;
}

export function VulnerabilitiesTab({ filter, page, onFilterChange, onPageChange }: VulnerabilitiesTabProps) {
  const vulnerabilities = useVulnerabilities(filter, page);
  const data = vulnerabilities.data;
  const isUnconfirmed = isUnconfirmedPage(vulnerabilities);
  const hasFilter = filter.ecosystem !== undefined || filter.q !== undefined || filter.directOnly === true;
  const isEmpty = data?.total === 0;
  // 대조가 꺼져 있는지는 0건일 때만 필요하다.
  const settings = useSettings({ enabled: isEmpty && !hasFilter }).data;

  const lastPage = emptyPageFallback(vulnerabilities);
  useEffect(() => {
    if (lastPage !== undefined && page !== lastPage) onPageChange(lastPage);
  }, [lastPage, page, onPageChange]);

  const emptyMessage = hasFilter
    ? FILTERED_EMPTY_MESSAGE
    : settings?.cveMinScore === 0
      ? CVE_OFF_MESSAGE
      : CVE_EMPTY_MESSAGE;

  return (
    <>
      <VulnerabilitiesFilters filter={filter} onFilterChange={onFilterChange} />
      <DataState
        {...firstLoadState(vulnerabilities)}
        isEmpty={isEmpty}
        emptyMessage={emptyMessage}
        onRetry={() => void vulnerabilities.refetch()}
      >
        {data && (
          <div className="flex flex-col gap-3">
            <div aria-busy={isUnconfirmed || undefined} className={cn("transition-opacity", isUnconfirmed && "opacity-60")}>
              <VulnerabilitiesTable items={data.items} />
            </div>
            <Pager page={data.page} limit={data.limit} total={data.total} onPageChange={onPageChange} isDisabled={isUnconfirmed} />
          </div>
        )}
      </DataState>
    </>
  );
}
