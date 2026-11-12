// 대시보드 카드 4개.
// open 수, ignored 수, 마지막 스캔(lastScan.startedAt + 상태 배지 / null = "스캔 이력 없음"),
// 다음 스캔(nextScanAt / null = "예정 없음"). loading = 카드 Skeleton,
// 오류 = 값 "-" + 카드 영역 [다시 시도] 1개(표와 독립).
import type { ReactNode } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSummary } from "@/features/summary/useSummary";
import { formatCardTime } from "@/lib/format";
import { firstLoadState } from "@/lib/queryState";

interface SummaryCardProps {
  title: string;
  children: ReactNode;
}

const NO_VALUE = "-";

export function SummaryCards() {
  const summary = useSummary();
  const data = summary.data;
  const { isLoading, isError: isLoadError } = firstLoadState(summary);

  const render = (value: (summaryData: NonNullable<typeof data>) => ReactNode): ReactNode => {
    if (isLoading) return <Skeleton className="h-7 w-24" />;
    if (data === undefined) return NO_VALUE;
    return value(data);
  };

  return (
    <section aria-label="요약" className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="open">{render((s) => s.openCount)}</SummaryCard>
        <SummaryCard title="ignored">{render((s) => s.ignoredCount)}</SummaryCard>
        <SummaryCard title="마지막 스캔">
          {render((s) =>
            s.lastScan === null ? (
              <span className="text-base text-muted-foreground">스캔 이력 없음</span>
            ) : (
              <span className="flex flex-wrap items-center gap-2 text-base">
                <span>{formatCardTime(s.lastScan.startedAt)}</span>
                <StatusBadge status={s.lastScan.status} />
              </span>
            ),
          )}
        </SummaryCard>
        <SummaryCard title="다음 스캔">
          {render((s) =>
            s.nextScanAt === null ? (
              <span className="text-base text-muted-foreground">예정 없음</span>
            ) : (
              <span className="text-base">{formatCardTime(s.nextScanAt)}</span>
            ),
          )}
        </SummaryCard>
      </div>
      {isLoadError && (
        <div className="flex items-center gap-3 text-sm">
          <p className="text-muted-foreground">요약을 불러오지 못했습니다</p>
          <Button variant="outline" size="sm" onClick={() => void summary.refetch()}>
            다시 시도
          </Button>
        </div>
      )}
    </section>
  );
}

function SummaryCard({ title, children }: SummaryCardProps) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-2xl font-semibold tabular-nums">{children}</CardContent>
    </Card>
  );
}
