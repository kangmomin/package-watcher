// 블랙리스트 hooks.
// 계약: POST/PUT 성공 → blacklist·findings 무효화. DELETE 성공 → blacklist·findings·summary 무효화.
// INTERNAL_ERROR·NETWORK_ERROR·parse 실패도 성공과 같은 키를 무효화한다. NOT_FOUND → blacklist 재조회.
// toast·Dialog 처리는 화면이 한다(오류 코드별로 필드 오류와 toast 를 나눠야 한다).
import type { BlacklistEntry, BlacklistInput, BlacklistList } from "@pw/shared";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api, type ApiRequestError } from "@/lib/api";
import { hasErrorCode, invalidateKeys, isUnknownOutcome } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";

export function useBlacklist(): UseQueryResult<BlacklistList, ApiRequestError> {
  return useQuery<BlacklistList, ApiRequestError>({
    queryKey: queryKeys.blacklist(),
    queryFn: api.listBlacklist,
  });
}

const UPSERT_KEYS: readonly QueryKey[] = [queryKeys.blacklist(), queryKeys.findingsAll()];
const DELETE_KEYS: readonly QueryKey[] = [queryKeys.blacklist(), queryKeys.findingsAll(), queryKeys.summary()];

function invalidateAfterError(queryClient: QueryClient, error: ApiRequestError, successKeys: readonly QueryKey[]) {
  if (isUnknownOutcome(error)) {
    void invalidateKeys(queryClient, successKeys);
  } else if (hasErrorCode(error, "NOT_FOUND")) {
    void invalidateKeys(queryClient, [queryKeys.blacklist()]);
  }
}

export function useCreateBlacklistEntry(): UseMutationResult<BlacklistEntry, ApiRequestError, BlacklistInput> {
  const queryClient = useQueryClient();
  return useMutation<BlacklistEntry, ApiRequestError, BlacklistInput>({
    mutationFn: api.createBlacklistEntry,
    onSuccess: () => void invalidateKeys(queryClient, UPSERT_KEYS),
    onError: (error) => invalidateAfterError(queryClient, error, UPSERT_KEYS),
  });
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
  const queryClient = useQueryClient();
  return useMutation<BlacklistEntry, ApiRequestError, UpdateBlacklistEntryVariables>({
    mutationFn: ({ id, input }) => api.updateBlacklistEntry(id, input),
    onSuccess: () => void invalidateKeys(queryClient, UPSERT_KEYS),
    onError: (error) => invalidateAfterError(queryClient, error, UPSERT_KEYS),
  });
}

/** 변수 = 삭제할 항목 id */
export function useDeleteBlacklistEntry(): UseMutationResult<void, ApiRequestError, number> {
  const queryClient = useQueryClient();
  return useMutation<void, ApiRequestError, number>({
    mutationFn: api.deleteBlacklistEntry,
    onSuccess: () => void invalidateKeys(queryClient, DELETE_KEYS),
    onError: (error) => invalidateAfterError(queryClient, error, DELETE_KEYS),
  });
}
