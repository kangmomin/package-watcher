import { MutationObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api";
import { createQueryClient } from "@/lib/queryClient";

// UI State Contract: query retry = 4xx 는 0회, 그 외 1회. mutation retry 0회.
// Error Contract: retry 판정은 ApiRequestError.status 를 쓴다.

describe("createQueryClient retry 정책", () => {
  it.each([
    [400, "VALIDATION_ERROR"],
    [404, "NOT_FOUND"],
    [409, "SCAN_RUNNING"],
  ] as const)("[CT-10] query 는 %i %s 를 재시도하지 않는다", async (status, code) => {
    const client = createQueryClient();
    const error = new ApiRequestError(status, code, "요청 오류");
    const queryFn = vi.fn().mockRejectedValue(error);

    await expect(client.fetchQuery({ queryKey: ["retry-4xx"], queryFn })).rejects.toBe(error);
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it.each([
    [500, "INTERNAL_ERROR"],
    [502, "SMTP_FAILED"],
    [0, "NETWORK_ERROR"],
  ] as const)("[CT-10] query 는 status %i (%s) 를 1회만 재시도한다", async (status, code) => {
    vi.useFakeTimers();
    const client = createQueryClient();
    const error = new ApiRequestError(status, code, "서버 오류");
    const queryFn = vi.fn().mockRejectedValue(error);

    const settled = client.fetchQuery({ queryKey: ["retry-other"], queryFn }).catch((reason: unknown) => reason);
    await vi.runAllTimersAsync();

    await expect(settled).resolves.toBe(error);
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it("[CT-10] mutation 은 재시도하지 않는다", async () => {
    vi.useFakeTimers();
    const client = createQueryClient();
    const error = new ApiRequestError(500, "INTERNAL_ERROR", "서버 오류");
    const mutationFn = vi.fn().mockRejectedValue(error);
    const observer = new MutationObserver<unknown, ApiRequestError, void>(client, { mutationFn });

    const settled = observer.mutate().catch((reason: unknown) => reason);
    await vi.runAllTimersAsync();

    await expect(settled).resolves.toBe(error);
    expect(mutationFn).toHaveBeenCalledTimes(1);
  });
});
