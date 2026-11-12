// 블랙리스트 표 (Phase 6.1 스텁 — Phase 6.2 에서 구현).
// 열: 이름, 버전 범위(null = "(모든 버전)"), 사유, 수정, 삭제. 아이콘 버튼은 aria-label 로 이름을 준다.
import type { BlacklistEntry } from "@pw/shared";

export interface BlacklistTableProps {
  items: BlacklistEntry[];
  onEdit: (entry: BlacklistEntry) => void;
  onDelete: (entry: BlacklistEntry) => void;
}

export function BlacklistTable(_props: BlacklistTableProps) {
  return null;
}
