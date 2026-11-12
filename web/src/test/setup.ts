import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, vi } from "vitest";
import "./polyfills";

// globals: false 이므로 자동 cleanup 이 등록되지 않는다.
afterEach(() => {
  cleanup();
  // sonner 는 toast 를 모듈 전역 저장소에 둔다. 지우지 않으면 이전 테스트의 toast 가 다음 테스트에 다시 나타난다.
  toast.dismiss();
  // fetch mock(vi.stubGlobal), TZ(vi.stubEnv), 가짜 시계가 다음 테스트로 새지 않게 한다.
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
