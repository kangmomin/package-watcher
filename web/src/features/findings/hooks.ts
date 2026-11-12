// 검출 조회·상태 변경 hooks (Phase 6.1 스텁 — Phase 6.2 에서 구현).
// 계약: GET /api/findings?status&repo&package&page&limit (limit 50). 빈 필터는 파라미터를 생략한다.
// PATCH 성공·INTERNAL_ERROR·NETWORK_ERROR·parse 실패 → findings·summary 무효화. INVALID_STATE 도 같다.
import type { Finding, FindingStatusInput, Page } from "@pw/shared";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import type { ApiRequestError, FindingsFilter } from "@/lib/api";

export const FINDINGS_PAGE_LIMIT = 50;

export function useFindings(
  _filter: FindingsFilter,
  _page: number,
): UseQueryResult<Page<Finding>, ApiRequestError> {
  throw new Error("not implemented");
}

export interface SetFindingStatusVariables {
  id: number;
  status: FindingStatusInput["status"];
}

export function useSetFindingStatus(): UseMutationResult<Finding, ApiRequestError, SetFindingStatusVariables> {
  throw new Error("not implemented");
}
