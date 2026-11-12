// 스캔 이력·수동 실행 hooks.
// 계약: GET /api/scans?page&limit (limit 20). isScanRunning(summary) && page === 1 이면 refetchInterval 5000.
// POST 202·SCAN_RUNNING·INTERNAL_ERROR·NETWORK_ERROR·parse 실패 → scans·summary 무효화.
// FE 는 GET /api/scans/:id 를 호출하지 않는다. repo별 표만 펼친 행에서 GET /api/scans/:id/repos 를 호출한다.
import { SCAN_REPOS_DEFAULT_LIMIT, SCANS_DEFAULT_LIMIT, type Page, type Scan, type ScanRepo } from "@pw/shared";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { isScanRunning, SCAN_POLL_INTERVAL_MS, useSummary } from "@/features/summary/useSummary";
import { api, type ApiRequestError, type ScanReposFilter } from "@/lib/api";
import { errorToastMessage, hasErrorCode, invalidateKeys, isUnknownOutcome } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";

export const SCANS_PAGE_LIMIT = SCANS_DEFAULT_LIMIT;

export function useScans(page: number): UseQueryResult<Page<Scan>, ApiRequestError> {
  const summary = useSummary();
  const poll = isScanRunning(summary.data) && page === 1;
  return useQuery<Page<Scan>, ApiRequestError>({
    queryKey: queryKeys.scans(page),
    queryFn: () => api.listScans({ page, limit: SCANS_PAGE_LIMIT }),
    placeholderData: keepPreviousData,
    refetchInterval: poll ? SCAN_POLL_INTERVAL_MS : false,
  });
}

/** 펼친 스캔의 repo별 진행 상황. 스캔이 running 이면 5초마다 다시 조회한다. */
export function useScanRepos(
  scanId: number,
  filter: ScanReposFilter,
  page: number,
  running: boolean,
): UseQueryResult<Page<ScanRepo>, ApiRequestError> {
  return useQuery<Page<ScanRepo>, ApiRequestError>({
    queryKey: queryKeys.scanRepos(scanId, filter, page),
    queryFn: () => api.listScanRepos(scanId, { ...filter, page, limit: SCAN_REPOS_DEFAULT_LIMIT }),
    placeholderData: keepPreviousData,
    refetchInterval: running ? SCAN_POLL_INTERVAL_MS : false,
  });
}

export function useTriggerScan(): UseMutationResult<Scan, ApiRequestError, void> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const refresh = () => invalidateKeys(queryClient, [queryKeys.scansAll(), queryKeys.summary()]);

  // 무효화 promise 를 돌려줘서 summary 가 running 으로 갱신될 때까지 "요청 중" 으로 둔다
  // (그 사이에 버튼이 잠깐 활성화되어 409 를 부르지 않게).
  return useMutation<Scan, ApiRequestError, void>({
    mutationFn: () => api.triggerScan(),
    onSuccess: () => {
      toast.success("스캔을 시작했습니다");
      return refresh();
    },
    onError: (error) => {
      if (hasErrorCode(error, "ORG_NOT_SET", "TOKEN_MISSING")) {
        toast.error(error.message, {
          action: { label: "설정으로 이동", onClick: () => void navigate("/settings") },
        });
        return;
      }
      toast.error(errorToastMessage(error));
      if (hasErrorCode(error, "SCAN_RUNNING") || isUnknownOutcome(error)) return refresh();
    },
  });
}
