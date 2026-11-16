// 외부 목록(feed) hooks.
// 상태는 동기화가 진행 중일 때만 3초마다 다시 읽는다.
import type { FeedStatus, FeedEntry, Page } from "@pw/shared";
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
  return useQuery<FeedStatus, ApiRequestError>({
    queryKey: queryKeys.feedStatus(),
    queryFn: api.getFeedStatus,
    refetchInterval: (query) => (query.state.data?.syncing ? FEED_POLL_MS : false),
  });
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
