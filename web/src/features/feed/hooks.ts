// 외부 목록(feed) hooks.
// 상태는 동기화가 진행 중일 때만 3초마다 다시 읽는다.
import type { FeedStatus, FeedEntry, Page } from "@pw/shared";
import { useEffect, useRef } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type ApiRequestError, type FeedEntriesFilter } from "@/lib/api";
import { errorToastMessage, hasErrorCode, isUnknownOutcome } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";

export const FEED_POLL_MS = 3000;
export const FEED_PAGE_LIMIT = 50;

export function useFeedStatus(): UseQueryResult<FeedStatus, ApiRequestError> {
  const queryClient = useQueryClient();
  const query = useQuery<FeedStatus, ApiRequestError>({
    queryKey: queryKeys.feedStatus(),
    queryFn: api.getFeedStatus,
    refetchInterval: (q) => (q.state.data?.syncing ? FEED_POLL_MS : false),
  });
  // 동기화가 끝나는 순간(syncing true → false) 검색 결과가 낡았으므로 다시 받는다.
  const syncing = query.data?.syncing;
  const wasSyncing = useRef(false);
  useEffect(() => {
    if (syncing === undefined) return;
    if (wasSyncing.current && !syncing) void queryClient.invalidateQueries({ queryKey: queryKeys.feedEntriesAll() });
    wasSyncing.current = syncing;
  }, [syncing, queryClient]);
  return query;
}

/** toast 는 여기서 한다: 오류 코드마다 문구가 정해져 있고 화면이 따로 처리할 것이 없다. */
export function useSyncFeed(): UseMutationResult<FeedStatus, ApiRequestError, void> {
  const queryClient = useQueryClient();
  return useMutation<FeedStatus, ApiRequestError, void>({
    mutationFn: () => api.syncFeed(),
    onSuccess: (status) => {
      queryClient.setQueryData(queryKeys.feedStatus(), status);
    },
    onError: (error) => {
      if (hasErrorCode(error, "FEED_SYNC_RUNNING")) {
        toast.error("이미 동기화 중입니다");
        void queryClient.invalidateQueries({ queryKey: queryKeys.feedStatus() });
        return;
      }
      toast.error(errorToastMessage(error));
      if (isUnknownOutcome(error)) void queryClient.invalidateQueries({ queryKey: queryKeys.feedStatus() });
    },
  });
}

export function useFeedEntries(
  filter: FeedEntriesFilter,
  page: number,
): UseQueryResult<Page<FeedEntry>, ApiRequestError> {
  return useQuery<Page<FeedEntry>, ApiRequestError>({
    queryKey: queryKeys.feedEntries(filter, page),
    queryFn: () => api.listFeedEntries({ ...filter, page, limit: FEED_PAGE_LIMIT }),
    placeholderData: keepPreviousData,
  });
}
