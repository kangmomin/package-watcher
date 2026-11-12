// 스캔 이력 표 (Phase 6.1 스텁 — Phase 6.2 에서 구현).
// 열: 시작 시각, 종류(자동/수동), 상태, repo 수, 신규, 실패(failedRepos.length). running 행은 repo 수·신규·실패 = "-".
// 행 펼침 = 목록 데이터의 error(null 아니면) + failedRepos. 둘 다 비면 펼칠 수 없다.
import type { Scan } from "@pw/shared";

export interface ScansTableProps {
  items: Scan[];
}

export function ScansTable(_props: ScansTableProps) {
  return null;
}
