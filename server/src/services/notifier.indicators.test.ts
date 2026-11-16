import type { Finding } from "@pw/shared";
import { describe, expect, it } from "vitest";
import { renderFindings } from "./notifier.ts";

const finding = (overrides: Partial<Finding>): Finding => ({
  id: 1,
  repo: "svc",
  filePath: "refs/heads/wfx-docs",
  ecosystem: "branch",
  packageName: "wfx-docs",
  version: "",
  severity: "high",
  dependencyType: "direct",
  status: "open",
  blacklistEntryId: 1,
  reason: "침해의 흔적",
  htmlUrl: "https://github.com/my-org/svc/tree/wfx-docs",
  firstSeenAt: "2026-11-16T00:00:00.000Z",
  resolvedAt: null,
  notifiedAt: null,
  ...overrides,
});

describe("메일 — 흔적 검출", () => {
  it("[SC-60] 흔적 종류의 빈 버전은 -로 표시하고 기존 종류의 표시는 그대로다", () => {
    const text = renderFindings([
      finding({}),
      finding({ id: 2, ecosystem: "npm", filePath: "package.json", packageName: "evil", version: "1.0.0" }),
    ]);

    expect(text).toContain("refs/heads/wfx-docs: wfx-docs@- (");
    expect(text).not.toContain("wfx-docs@ ");
    expect(text).toContain("package.json: evil@1.0.0 (");
  });
});
