// 대시보드 `/`.
// 구성: SummaryCards(카드 4개) + FindingsFilters + FindingsTable + Pager.
// 초기 요청 = /api/findings?status=open&page=1&limit=50. 필터 변경 → page=1.
import { useCallback, useState } from "react";
import { DataState } from "@/components/DataState";
import { Pager } from "@/components/Pager";
import { FindingsFilters } from "@/features/findings/FindingsFilters";
import { FindingsTable } from "@/features/findings/FindingsTable";
import { useFindings } from "@/features/findings/hooks";
import { SummaryCards } from "@/features/findings/SummaryCards";
import type { FindingsFilter } from "@/lib/api";
import { emptyPageFallback, firstLoadState } from "@/lib/queryState";

export function DashboardPage() {
  const [filter, setFilter] = useState<FindingsFilter>({ status: "open" });
  const [page, setPage] = useState(1);
  const findings = useFindings(filter, page);
  const data = findings.data;

  const handleFilterChange = useCallback((next: FindingsFilter) => {
    setFilter(next);
    setPage(1);
  }, []);

  // 보던 페이지가 비었으면(검출이 줄어듦) 마지막 페이지로 옮긴다.
  const lastPage = emptyPageFallback(findings);
  if (lastPage !== undefined && page !== lastPage) setPage(lastPage);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">대시보드</h1>
      <SummaryCards />
      <section aria-label="검출 목록" className="flex flex-col gap-3">
        <FindingsFilters filter={filter} onFilterChange={handleFilterChange} />
        <DataState
          {...firstLoadState(findings)}
          isEmpty={data?.total === 0}
          emptyMessage="검출이 없습니다"
          onRetry={() => void findings.refetch()}
        >
          {data && (
            <div className="flex flex-col gap-3">
              <FindingsTable items={data.items} />
              <Pager page={data.page} limit={data.limit} total={data.total} onPageChange={setPage} />
            </div>
          )}
        </DataState>
      </section>
    </div>
  );
}
