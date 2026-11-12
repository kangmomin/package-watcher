// 공통 loading / empty / error 표현 (Phase 6.1 스텁 — Phase 6.2 에서 구현).
// 계약: loading = Skeleton. GET 오류는 첫 로드 실패일 때만 "데이터를 불러오지 못했습니다" + [다시 시도].
// 데이터가 있는 상태의 재조회 실패는 마지막 데이터를 유지한다(toast 없음).
import type { ReactNode } from "react";

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

export function DataState(_props: DataStateProps) {
  return null;
}
