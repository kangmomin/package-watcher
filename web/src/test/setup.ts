import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import "./polyfills";

// globals: false 이므로 자동 cleanup 이 등록되지 않는다.
afterEach(() => {
  cleanup();
  // fetch mock(vi.stubGlobal), TZ(vi.stubEnv), 가짜 시계가 다음 테스트로 새지 않게 한다.
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
