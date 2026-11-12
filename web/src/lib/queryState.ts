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
 * 방금 받은 응답으로만 판정한다(S-17). 조회 중이면 data 가 캐시에 남은 예전 응답일 수 있고,
 * placeholder 는 이전 page 의 데이터이며, 재조회가 실패했으면 data 는 예전 응답이다.
 */
export function emptyPageFallback(query: {
  data: Page<unknown> | undefined;
  isPlaceholderData: boolean;
  isFetching: boolean;
  isError: boolean;
}): number | undefined {
  const { data } = query;
  if (!data || query.isPlaceholderData || query.isFetching || query.isError) return undefined;
  if (data.items.length === 0 && data.total > 0 && data.page > 1) return Math.ceil(data.total / data.limit);
  return undefined;
}

/**
 * 보이는 목록이 아직 지금의 page·필터 응답으로 확인되지 않았는지 (S-17).
 * - placeholder: 필터·페이지를 바꾼 직후 이전 응답을 보여 주는 중
 * - 이 key 로 바꾼 뒤 아직 응답이 오지 않아 캐시의 예전 값을 보여 주는 중
 * 이 동안 페이저는 이전 응답 기준으로 계산되므로 비활성으로 두고 표를 busy 로 표시한다.
 * 이미 확인한 page 의 백그라운드 재조회(polling, focus)는 넣지 않는다(5초마다 버튼이 깜박이고 포커스를 잃지 않게).
 */
export function isUnconfirmedPage(query: {
  isPlaceholderData: boolean;
  isFetching: boolean;
  isFetchedAfterMount: boolean;
}): boolean {
  return query.isPlaceholderData || (query.isFetching && !query.isFetchedAfterMount);
}
