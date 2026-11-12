// TanStack Query 기본값.
// 계약: query retry = 4xx 0회·그 외 1회(ApiRequestError.status 로 판정), mutation retry 0회,
// staleTime 0, refetchOnWindowFocus true, optimistic update 없음.
import { QueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "@/lib/api";

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetryQuery,
        staleTime: 0,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: 0 },
    },
  });
}
