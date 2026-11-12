// "스캔 실행 중" 판정의 단일 소스 (Phase 6.1 스텁 — Phase 6.2 에서 구현).
// 계약: running 인 동안 summary 를 5초 polling 한다. running → 종료 전이를 감지하면
// scans·findings·summary 를 무효화한다. 대시보드와 /scans 가 모두 이 hook 을 쓴다.
import type { Summary } from "@pw/shared";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ApiRequestError } from "@/lib/api";

export function useSummary(): UseQueryResult<Summary, ApiRequestError> {
  throw new Error("not implemented");
}

/** `summary.lastScan?.status === "running"` */
export function isScanRunning(_summary: Summary | undefined): boolean {
  throw new Error("not implemented");
}
