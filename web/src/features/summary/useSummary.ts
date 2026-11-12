// "스캔 실행 중" 판정의 단일 소스.
// 계약: running 인 동안 summary 를 5초 polling 한다. running → 종료 전이를 감지하면
// scans·findings·summary 를 무효화한다. 대시보드와 /scans 가 모두 이 hook 을 쓴다.
import type { Summary } from "@pw/shared";
import { hashKey, useQuery, useQueryClient, type QueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, type ApiRequestError } from "@/lib/api";
import { invalidateKeys } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";

export const SCAN_POLL_INTERVAL_MS = 5_000;

/** `summary.lastScan?.status === "running"` */
export function isScanRunning(summary: Summary | undefined): boolean {
  return summary?.lastScan?.status === "running";
}

const watchedClients = new WeakSet<QueryClient>();

/**
 * running → 종료 전이를 QueryClient 당 1번만 감지한다.
 * useSummary 를 쓰는 컴포넌트가 여러 개여도 무효화가 중복되지 않게 observer 가 아니라 캐시를 구독한다.
 */
function watchScanFinish(queryClient: QueryClient): void {
  if (watchedClients.has(queryClient)) return;
  watchedClients.add(queryClient);

  const summaryHash = hashKey(queryKeys.summary());
  let wasRunning = isScanRunning(queryClient.getQueryData<Summary>(queryKeys.summary()));
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    if (event.query.queryHash !== summaryHash) return;
    const running = isScanRunning(event.query.state.data as Summary | undefined);
    const finished = wasRunning && !running;
    wasRunning = running;
    if (finished) {
      // 이 알림은 summary 상태를 갱신하는 도중에 온다. 갱신이 끝난 뒤에 무효화한다.
      queueMicrotask(() => {
        void invalidateKeys(queryClient, [queryKeys.scansAll(), queryKeys.findingsAll(), queryKeys.summary()]);
      });
    }
  });
}

export function useSummary(): UseQueryResult<Summary, ApiRequestError> {
  const queryClient = useQueryClient();
  useEffect(() => {
    watchScanFinish(queryClient);
  }, [queryClient]);

  return useQuery<Summary, ApiRequestError>({
    queryKey: queryKeys.summary(),
    queryFn: api.getSummary,
    refetchInterval: (query) => (isScanRunning(query.state.data) ? SCAN_POLL_INTERVAL_MS : false),
  });
}
