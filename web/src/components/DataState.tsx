// 공통 loading / empty / error 표현 (표 자리).
// 판정(첫 로드 실패만 오류, 재조회 실패는 마지막 데이터 유지)은 lib/queryState 의 firstLoadState 가 한다.
// 여기는 loading → error → empty → children 분기만 한다.
import type { ReactNode } from "react";
import { LoadError } from "@/components/LoadError";
import { LoadingState } from "@/components/LoadingState";
import { Skeleton } from "@/components/ui/skeleton";

export interface DataStateProps {
  /** 첫 로드 중 (데이터 없음) */
  isLoading: boolean;
  /** 첫 로드 실패 (데이터 없음) */
  isError: boolean;
  isEmpty: boolean;
  emptyMessage: string;
  onRetry: () => void;
  children: ReactNode;
}

const SKELETON_ROWS = 5;

export function DataState({
  isLoading,
  isError,
  isEmpty,
  emptyMessage,
  onRetry,
  children,
}: DataStateProps) {
  if (isLoading) {
    return (
      <LoadingState>
        <TableSkeleton />
      </LoadingState>
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

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <Skeleton className="h-6 w-full" />
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <Skeleton key={index} className="h-8 w-full" />
      ))}
    </div>
  );
}
