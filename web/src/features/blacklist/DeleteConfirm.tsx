// 삭제 확인 Dialog (Phase 6.1 스텁 — Phase 6.2 에서 구현).
// 요청 중 [삭제] 비활성 + 닫기 불가. 성공 또는 NOT_FOUND → 닫기, 그 외 → 열어 둠.
import type { BlacklistEntry } from "@pw/shared";

export interface DeleteConfirmProps {
  /** null 이면 닫힌 상태 */
  entry: BlacklistEntry | null;
  onOpenChange: (open: boolean) => void;
}

export function DeleteConfirm(_props: DeleteConfirmProps) {
  return null;
}
