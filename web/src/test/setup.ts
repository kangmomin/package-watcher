import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// globals: false 이므로 자동 cleanup 이 등록되지 않는다.
afterEach(() => {
  cleanup();
});
