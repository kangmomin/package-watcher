// 화면 공통 query 상태 판정 (UI State Contract).
import type { Page } from "@pw/shared";

/**
 * GET 오류는 첫 로드 실패일 때만 표시한다. 데이터가 있으면 둘 다 false(마지막 데이터 유지).
 * [다시 시도] 로 재조회 중(isFetching)이면 다시 loading 으로 본다.
 */
export function firstLoadState(query: { data: unknown; isError: boolean; isFetching: boolean }): {
  isLoading: boolean;
  isError: boolean;
} {
  const isError = query.data === undefined && query.isError && !query.isFetching;
  return { isLoading: query.data === undefined && !isError, isError };
}

/**
 * 보던 페이지가 비었으면(항목이 줄어듦) 옮겨 갈 마지막 페이지 = ceil(total/limit). 아니면 undefined.
 * placeholder(이전 page 의 데이터)로는 판정하지 않는다.
 */
export function emptyPageFallback(query: {
  data: Page<unknown> | undefined;
  isPlaceholderData: boolean;
}): number | undefined {
  const { data } = query;
  if (!data || query.isPlaceholderData) return undefined;
  if (data.items.length === 0 && data.total > 0 && data.page > 1) return Math.ceil(data.total / data.limit);
  return undefined;
}
