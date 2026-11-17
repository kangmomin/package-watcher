// 블랙리스트 hooks.
// 계약: POST 성공 → blacklist·findings, PUT 성공 → blacklist·findings·summary 무효화. DELETE 성공 → blacklist·findings·summary 무효화.
// INTERNAL_ERROR·NETWORK_ERROR·parse 실패도 성공과 같은 키를 무효화한다. NOT_FOUND → blacklist 재조회.
// toast·Dialog 처리는 화면이 한다(오류 코드별로 필드 오류와 toast 를 나눠야 한다).
import type {
  BlacklistEntry,
  BlacklistInput,
  BlacklistList,
  BulkInput,
  BulkResult,
  ImportInput,
  ImportResult,
} from "@pw/shared";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api, type ApiRequestError, type BlacklistFilter } from "@/lib/api";
import { hasErrorCode, invalidateKeys, isUnknownOutcome } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";

/** 필터를 주지 않으면(설정 화면) 지금까지처럼 필터 없는 목록이다. */
export function useBlacklist(
  filter: BlacklistFilter = {},
): UseQueryResult<BlacklistList, ApiRequestError> {
  return useQuery<BlacklistList, ApiRequestError>({
    queryKey: queryKeys.blacklist(filter),
    queryFn: () => api.listBlacklist(filter),
    // 필터를 바꾸는 동안 이전 목록을 유지해 표가 깜박이지 않게 한다.
    placeholderData: keepPreviousData,
  });
}

const CREATE_KEYS: readonly QueryKey[] = [queryKeys.blacklist(), queryKeys.findingsAll(), queryKeys.vulnerabilitiesAll()];
// 항목을 끄거나 만료일을 바꾸면 검출이 resolved 가 되므로 요약도 다시 읽는다.
const UPDATE_KEYS: readonly QueryKey[] = [
  queryKeys.blacklist(),
  queryKeys.findingsAll(),
  queryKeys.vulnerabilitiesAll(),
  queryKeys.summary(),
];
const DELETE_KEYS = UPDATE_KEYS;

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
    onSuccess: () => void invalidateKeys(queryClient, CREATE_KEYS),
    onError: (error) => invalidateAfterError(queryClient, error, CREATE_KEYS),
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
    onSuccess: () => void invalidateKeys(queryClient, UPDATE_KEYS),
    onError: (error) => invalidateAfterError(queryClient, error, UPDATE_KEYS),
  });
}

/** 일괄 켜기·끄기·삭제. 성공과 결과를 알 수 없는 오류는 3개를, NOT_FOUND 는 blacklist 만 무효화한다. */
export function useBulkBlacklist(): UseMutationResult<BulkResult, ApiRequestError, BulkInput> {
  const queryClient = useQueryClient();
  return useMutation<BulkResult, ApiRequestError, BulkInput>({
    mutationFn: api.bulkBlacklist,
    onSuccess: () => void invalidateKeys(queryClient, UPDATE_KEYS),
    onError: (error) => invalidateAfterError(queryClient, error, UPDATE_KEYS),
  });
}

/** 가져오기. 미리 보기(dryRun)는 아무것도 바꾸지 않으므로 실제로 적용됐을 때만 무효화한다. */
export function useImportBlacklist(): UseMutationResult<ImportResult, ApiRequestError, ImportInput> {
  const queryClient = useQueryClient();
  return useMutation<ImportResult, ApiRequestError, ImportInput>({
    mutationFn: api.importBlacklist,
    onSuccess: (result) => {
      if (result.applied) void invalidateKeys(queryClient, UPDATE_KEYS);
    },
    onError: (error, input) => {
      if (!input.dryRun) invalidateAfterError(queryClient, error, UPDATE_KEYS);
    },
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
