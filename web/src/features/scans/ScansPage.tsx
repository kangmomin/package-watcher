// 스캔 이력 `/scans`.
// 구성: ScanNowButton + ScansTable(행 펼침) + Pager(limit 20). empty = "스캔 이력이 없습니다".
import { useState } from "react";
import { DataState } from "@/components/DataState";
import { Pager } from "@/components/Pager";
import { useScans } from "@/features/scans/hooks";
import { ScanNowButton } from "@/features/scans/ScanNowButton";
import { ScansTable } from "@/features/scans/ScansTable";
import { emptyPageFallback, firstLoadState } from "@/lib/queryState";

export function ScansPage() {
  const [page, setPage] = useState(1);
  const scans = useScans(page);
  const data = scans.data;

  // 보던 페이지가 비었으면 마지막 페이지로 옮긴다 (UI State Contract 페이저 규칙).
  const lastPage = emptyPageFallback(scans);
  if (lastPage !== undefined && page !== lastPage) setPage(lastPage);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">스캔 이력</h1>
        <ScanNowButton />
      </div>
      <DataState
        {...firstLoadState(scans)}
        isEmpty={data?.total === 0}
        emptyMessage="스캔 이력이 없습니다"
        onRetry={() => void scans.refetch()}
      >
        {data && (
          <div className="flex flex-col gap-3">
            <ScansTable items={data.items} />
            <Pager page={data.page} limit={data.limit} total={data.total} onPageChange={setPage} />
          </div>
        )}
      </DataState>
    </div>
  );
}
