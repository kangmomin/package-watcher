// 스캔 이력·수동 실행 hooks (Phase 6.1 스텁 — Phase 6.2 에서 구현).
// 계약: GET /api/scans?page&limit (limit 20). isScanRunning(summary) && page === 1 이면 refetchInterval 5000.
// POST 202·SCAN_RUNNING·INTERNAL_ERROR·NETWORK_ERROR·parse 실패 → scans·summary 무효화.
// FE 는 GET /api/scans/:id 를 호출하지 않는다.
import type { Page, Scan } from "@pw/shared";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import type { ApiRequestError } from "@/lib/api";

export const SCANS_PAGE_LIMIT = 20;

export function useScans(_page: number): UseQueryResult<Page<Scan>, ApiRequestError> {
  throw new Error("not implemented");
}

export function useTriggerScan(): UseMutationResult<Scan, ApiRequestError, void> {
  throw new Error("not implemented");
}
