// "스캔 실행 중" 판정의 단일 소스.
// 계약: running 인 동안 summary 를 5초 polling 한다. 스캔 종료를 감지하면 scans·findings·summary 를 무효화한다.
// 종료 판정(S-18): running 이던 스캔이 종료 상태가 되거나, running 인 채로 lastScan.id 가 바뀌면
// (polling 간격 안에 스캔 A 가 끝나고 스캔 B 가 시작됨) 종료로 본다. 대시보드와 /scans 가 모두 이 hook 을 쓴다.
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

/** 실행 중인 스캔의 id. 실행 중이 아니면 null. */
function runningScanId(summary: Summary | undefined): number | null {
  const lastScan = summary?.lastScan;
  return lastScan?.status === "running" ? lastScan.id : null;
}

const watchedClients = new WeakSet<QueryClient>();

/**
 * 스캔 종료를 QueryClient 당 1번만 감지한다.
 * useSummary 를 쓰는 컴포넌트가 여러 개여도 무효화가 중복되지 않게 observer 가 아니라 캐시를 구독한다.
 */
function watchScanFinish(queryClient: QueryClient): void {
  if (watchedClients.has(queryClient)) return;
  watchedClients.add(queryClient);

  const summaryHash = hashKey(queryKeys.summary());
  let previousRunningId = runningScanId(queryClient.getQueryData<Summary>(queryKeys.summary()));
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    if (event.query.queryHash !== summaryHash) return;
    const currentRunningId = runningScanId(event.query.state.data as Summary | undefined);
    // 직전 running 스캔이 더는 running 이 아니다 = 종료 상태가 됐거나 다른 스캔으로 바뀌었다.
    const finished = previousRunningId !== null && currentRunningId !== previousRunningId;
    previousRunningId = currentRunningId;
    if (finished) {
      // 이 알림은 summary 상태를 갱신하는 도중에 온다. 갱신이 끝난 뒤에 무효화한다.
      queueMicrotask(() => {
        void invalidateKeys(queryClient, [
          queryKeys.scansAll(),
          queryKeys.findingsAll(),
          queryKeys.vulnerabilitiesAll(),
          queryKeys.summary(),
        ]);
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
