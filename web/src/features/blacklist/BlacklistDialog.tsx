// 추가/수정 공용 Dialog (Phase 6.1 스텁 — Phase 6.2 에서 구현).
// 필드: 이름*, 버전 범위(placeholder "비우면 모든 버전"), 사유*. 제출 전 shared 스키마로 검증.
// 요청 중 [저장] 비활성 + 닫기 불가. 성공 → 닫기 + reset.
// VALIDATION_ERROR·DUPLICATE_ENTRY·INTERNAL_ERROR·NETWORK_ERROR → 열어 두고 입력 보존.
// DUPLICATE_ENTRY → name 필드 아래에 message. NOT_FOUND → 닫기 + toast + blacklist 재조회.
import type { BlacklistEntry } from "@pw/shared";

export interface BlacklistDialogProps {
  open: boolean;
  /** null = 추가, 값 = 그 항목 수정 */
  entry: BlacklistEntry | null;
  onOpenChange: (open: boolean) => void;
}

export function BlacklistDialog(_props: BlacklistDialogProps) {
  return null;
}
