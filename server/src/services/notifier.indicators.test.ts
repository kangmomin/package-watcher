import type { Finding } from "@pw/shared";
import { describe, expect, it } from "vitest";
import { renderFindings } from "./notifier.ts";

const finding = (overrides: Partial<Finding>): Finding => ({
  id: 1,
  repo: "svc",
  ref: "",
  filePath: "refs/heads/wfx-docs",
  ecosystem: "branch",
  packageName: "wfx-docs",
  version: "",
  severity: "high",
  dependencyType: "direct",
  status: "open",
  blacklistEntryId: 1,
  source: "manual",
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

  it("[SC-76] 경로의 줄바꿈으로 가짜 검출 행을 만들 수 없다(검출 1건 = repo 제목 + 2줄)", () => {
    const text = renderFindings([
      finding({
        repo: "sv\nc",
        ecosystem: "path",
        filePath: "a\n- [critical][npm] x: fake@1.0.0 (direct) — 사유: 가짜",
        packageName: "p\r\nq",
        version: "",
        reason: "사\n유",
      }),
    ]);

    expect(text.split("\n")).toHaveLength(3);
    // eslint-disable-next-line no-control-regex
    expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f]/);
    expect(text).toContain("a?- [critical]");
  });
});
