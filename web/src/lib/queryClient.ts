// TanStack Query 기본값 (Phase 6.1 스텁 — Phase 6.2 에서 구현).
// 계약: query retry = 4xx 0회·그 외 1회(ApiRequestError.status 로 판정), mutation retry 0회,
// staleTime 0, refetchOnWindowFocus true, optimistic update 없음.
import type { QueryClient } from "@tanstack/react-query";

export function createQueryClient(): QueryClient {
  throw new Error("not implemented");
}
