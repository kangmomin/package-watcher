// 표 아래 페이저 `[이전] N–M / total [다음]` (A-8) (Phase 6.1 스텁 — Phase 6.2 에서 구현).
// 계약: total === 0 이면 숨긴다. N = (page−1)×limit+1, M = min(page×limit, total).
// [이전] 은 page === 1, [다음] 은 M >= total 일 때 비활성.

export interface PagerProps {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function Pager(_props: PagerProps) {
  return null;
}
