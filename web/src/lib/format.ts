// 표시 형식 (Phase 6.1 스텁 — Phase 6.2 에서 구현).
// 계약: 모든 시각은 Asia/Seoul 로 표시한다(실행 환경의 TZ 와 무관). 표 = MM-dd HH:mm, 카드 = yyyy-MM-dd HH:mm.
// 라벨: direct/transitive = 직접/전이, scheduled/manual = 자동/수동.
import type { DependencyType, ScanTrigger } from "@pw/shared";

/** ISO 8601 UTC → `MM-dd HH:mm` (Asia/Seoul) */
export function formatTableTime(_iso: string): string {
  throw new Error("not implemented");
}

/** ISO 8601 UTC → `yyyy-MM-dd HH:mm` (Asia/Seoul) */
export function formatCardTime(_iso: string): string {
  throw new Error("not implemented");
}

export function dependencyTypeLabel(_type: DependencyType): string {
  throw new Error("not implemented");
}

export function scanTriggerLabel(_trigger: ScanTrigger): string {
  throw new Error("not implemented");
}
