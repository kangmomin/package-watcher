// 화면 테스트용 렌더 헬퍼. 앱과 같은 Provider(QueryClient, Router, Tooltip, Toaster)로 감싼다.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, type RenderResult } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LOCATION_TEST_ID, LocationProbe } from "@/test/LocationProbe";

/**
 * 계약의 retry 정책(query: 4xx 0회·그 외 1회, mutation 0회)을 따르되
 * 테스트가 기다리지 않게 retryDelay 는 0 으로 둔다. 앱의 실제 정책은 lib/queryClient.test.ts 가 검증한다.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          const status = (error as { status?: unknown } | null)?.status;
          if (typeof status === "number" && status >= 400 && status < 500) return false;
          return failureCount < 1;
        },
        retryDelay: 0,
        staleTime: 0,
        refetchOnWindowFocus: true,
        // 테스트 중 gc 타이머가 남지 않게 한다.
        gcTime: Number.POSITIVE_INFINITY,
      },
      mutations: { retry: 0 },
    },
  });
}

/** 현재 라우터 pathname (예: toast action 으로 이동했는지 확인). */
export function currentPath(): string {
  return screen.getByTestId(LOCATION_TEST_ID).textContent ?? "";
}

export interface RenderWithProvidersOptions {
  /** MemoryRouter 의 시작 경로 */
  route?: string;
  queryClient?: QueryClient;
}

export interface RenderWithProvidersResult extends RenderResult {
  user: UserEvent;
  queryClient: QueryClient;
}

/**
 * 가짜 시계를 쓰는 테스트는 render 전에 `vi.useFakeTimers({ shouldAdvanceTime: true })` 를 호출한다.
 * 그러면 user-event 도 가짜 시계를 함께 진행시킨다.
 */
export function renderWithProviders(
  ui: ReactElement,
  { route = "/", queryClient = createTestQueryClient() }: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  const user = vi.isFakeTimers()
    ? userEvent.setup({
        advanceTimers: async (ms) => {
          await vi.advanceTimersByTimeAsync(ms);
        },
      })
    : userEvent.setup();

  const result = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[route]}>
          {ui}
          <LocationProbe />
        </MemoryRouter>
        {/* next-themes Provider 가 없으므로 theme 를 고정한다 */}
        <Toaster theme="light" />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { ...result, user, queryClient };
}
