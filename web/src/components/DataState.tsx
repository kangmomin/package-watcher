// 공통 loading / empty / error 표현.
// 계약: loading = Skeleton. GET 오류는 첫 로드 실패일 때만 "데이터를 불러오지 못했습니다" + [다시 시도].
// 데이터가 있는 상태의 재조회 실패는 마지막 데이터를 유지한다(toast 없음).
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const LOAD_ERROR_MESSAGE = "데이터를 불러오지 못했습니다";

export interface DataStateProps {
  /** 첫 로드 중 (데이터 없음) */
  isLoading: boolean;
  /** 첫 로드 실패 (데이터 없음) */
  isError: boolean;
  isEmpty: boolean;
  emptyMessage: string;
  onRetry: () => void;
  /** loading 때 보여 줄 Skeleton. 생략하면 기본 Skeleton */
  skeleton?: ReactNode;
  children: ReactNode;
}

export function DataState({
  isLoading,
  isError,
  isEmpty,
  emptyMessage,
  onRetry,
  skeleton,
  children,
}: DataStateProps) {
  if (isLoading) {
    return (
      <div aria-busy="true">
        {skeleton ?? <TableSkeleton />}
        <span className="sr-only">불러오는 중</span>
      </div>
    );
  }
  if (isError) {
    return <LoadError onRetry={onRetry} />;
  }
  if (isEmpty) {
    return (
      <div className="rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground">{emptyMessage}</div>
    );
  }
  return <>{children}</>;
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border px-4 py-10 text-center text-sm">
      <p className="text-muted-foreground">{LOAD_ERROR_MESSAGE}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        다시 시도
      </Button>
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <Skeleton className="h-6 w-full" />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-8 w-full" />
      ))}
    </div>
  );
}
