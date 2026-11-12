// 검출 조회·상태 변경 hooks.
// 계약: GET /api/findings?status&repo&package&page&limit (limit 50). 빈 필터는 파라미터를 생략한다.
// PATCH 성공·INTERNAL_ERROR·NETWORK_ERROR·parse 실패 → findings·summary 무효화. INVALID_STATE 도 같다.
import { FINDINGS_DEFAULT_LIMIT, type Finding, type FindingStatusInput, type Page } from "@pw/shared";
import {
  keepPreviousData,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type ApiRequestError, type FindingsFilter } from "@/lib/api";
import { errorToastMessage, hasErrorCode, invalidateKeys, isUnknownOutcome } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";

export const FINDINGS_PAGE_LIMIT = FINDINGS_DEFAULT_LIMIT;

export function useFindings(filter: FindingsFilter, page: number): UseQueryResult<Page<Finding>, ApiRequestError> {
  return useQuery<Page<Finding>, ApiRequestError>({
    queryKey: queryKeys.findings(filter, page),
    queryFn: () => api.listFindings({ ...filter, page, limit: FINDINGS_PAGE_LIMIT }),
    placeholderData: keepPreviousData,
  });
}

export interface SetFindingStatusVariables {
  id: number;
  status: FindingStatusInput["status"];
}

const SET_FINDING_STATUS_KEY = ["setFindingStatus"] as const;
const STATUS_CHANGE_KEYS = [queryKeys.findingsAll(), queryKeys.summary()];

export function useSetFindingStatus(): UseMutationResult<Finding, ApiRequestError, SetFindingStatusVariables> {
  const queryClient = useQueryClient();
  return useMutation<Finding, ApiRequestError, SetFindingStatusVariables>({
    mutationKey: SET_FINDING_STATUS_KEY,
    mutationFn: ({ id, status }) => api.setFindingStatus(id, { status }),
    onSuccess: async () => {
      toast.success("상태를 변경했습니다");
      await invalidateKeys(queryClient, STATUS_CHANGE_KEYS);
    },
    onError: async (error) => {
      toast.error(errorToastMessage(error));
      if (isUnknownOutcome(error) || hasErrorCode(error, "INVALID_STATE")) {
        await invalidateKeys(queryClient, STATUS_CHANGE_KEYS);
      } else if (hasErrorCode(error, "NOT_FOUND")) {
        await invalidateKeys(queryClient, [queryKeys.findingsAll()]);
      }
    },
  });
}

/** 상태 변경 요청이 진행 중인 검출 id 들 (그 행의 메뉴를 비활성으로 둔다) */
export function usePendingFindingIds(): Set<number> {
  const ids = useMutationState({
    filters: { mutationKey: SET_FINDING_STATUS_KEY, status: "pending" },
    select: (mutation) => (mutation.state.variables as SetFindingStatusVariables | undefined)?.id,
  });
  return new Set(ids.filter((id): id is number => id !== undefined));
}
