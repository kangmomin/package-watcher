// 검출 표 + 행 메뉴 (Phase 6.1 스텁 — Phase 6.2 에서 구현).
// 행 메뉴: open = 무시 + GitHub에서 보기 / ignored = 다시 열기 + GitHub에서 보기 / resolved = GitHub에서 보기만.
// PATCH 중 그 행 메뉴 비활성.
import type { Finding } from "@pw/shared";

export interface FindingsTableProps {
  items: Finding[];
}

export function FindingsTable(_props: FindingsTableProps) {
  return null;
}
