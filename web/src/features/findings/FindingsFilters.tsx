// 대시보드 필터 (Phase 6.1 스텁 — Phase 6.2 에서 구현).
// 상태 select = open(기본)/ignored/resolved/전체(파라미터 생략). repo·패키지 입력 = trim + 300ms debounce, 비면 생략.
import type { FindingsFilter } from "@/lib/api";

export interface FindingsFiltersProps {
  filter: FindingsFilter;
  onFilterChange: (filter: FindingsFilter) => void;
}

export function FindingsFilters(_props: FindingsFiltersProps) {
  return null;
}
