// 블랙리스트 hooks (Phase 6.1 스텁 — Phase 6.2 에서 구현).
// 계약: POST/PUT 성공 → blacklist·findings 무효화. DELETE 성공 → blacklist·findings·summary 무효화.
// INTERNAL_ERROR·NETWORK_ERROR·parse 실패도 성공과 같은 키를 무효화한다. NOT_FOUND → blacklist 재조회.
import type { BlacklistEntry, BlacklistInput, BlacklistList } from "@pw/shared";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import type { ApiRequestError } from "@/lib/api";

export function useBlacklist(): UseQueryResult<BlacklistList, ApiRequestError> {
  throw new Error("not implemented");
}

export function useCreateBlacklistEntry(): UseMutationResult<BlacklistEntry, ApiRequestError, BlacklistInput> {
  throw new Error("not implemented");
}

export interface UpdateBlacklistEntryVariables {
  id: number;
  input: BlacklistInput;
}

export function useUpdateBlacklistEntry(): UseMutationResult<
  BlacklistEntry,
  ApiRequestError,
  UpdateBlacklistEntryVariables
> {
  throw new Error("not implemented");
}

/** 변수 = 삭제할 항목 id */
export function useDeleteBlacklistEntry(): UseMutationResult<void, ApiRequestError, number> {
  throw new Error("not implemented");
}
