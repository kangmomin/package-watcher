import type { BlacklistEntry } from "@pw/shared";
import { describe, expect, it } from "vitest";
import { FakeLogger } from "../test/logger.ts";
import { createPolicyRules, isNonRegistrySpec, policyNeedsSourceKind } from "./scanPolicy.ts";

const entry = (id: number, name: string, enabled = true): BlacklistEntry => ({
  id,
  source: "manual",
  externalId: null,
  ecosystem: "policy",
  name,
  versionRange: null,
  reason: "r",
  severity: "low",
  enabled,
  expiresAt: null,
  isExpired: false,
  createdAt: "2026-11-16T00:00:00.000Z",
  updatedAt: "2026-11-16T00:00:00.000Z",
});

describe("scanPolicy", () => {
  it.each([
    ["git+https://github.com/x/y.git", true],
    ["GIT://github.com/x/y.git", true],
    ["https://x.io/a.tgz", true],
    ["github:x/y", true],
    ["x/y", true],
    ["x/y#semver:^1", true],
    ["file:./a.tgz", true],
    ["../vendor/a.tar.gz", true],
    ["file:../pkgs/a", false],
    ["./pkgs/a", false],
    ["workspace:*", false],
    ["link:../a", false],
    ["npm:real@^1.0.0", false],
    ["^1.0.0", false],
    ["latest", false],
    ["1.x || >=2 <3", false],
    ["", false],
    ["git@github.com:x/y.git", true],
    ["ssh://git@github.com/x/y.git", true],
    ["git+ssh://git@github.com/x/y.git", true],
    ["github.com/x/y", true],
    ["gitlab.example.org/x/y#main", true],
    ["file:vendor/a.tgz#abc", true],
    ["a.tgz?token=1", true],
    ["file:../pkgs/a#hash", false],
  ])("[SD-80] registry 밖의 spec 판정: %s → %s", (spec, expected) => {
    expect(isNonRegistrySpec(spec)).toBe(expected);
  });

  it("[SD-81] 이름이 내장 검사가 아닌 항목과 policy 가 아닌 항목은 무시한다", () => {
    const rules = createPolicyRules([
      entry(1, "unpinned-image"),
      entry(2, "my-own-check"),
      { ...entry(3, "evil-pkg"), ecosystem: "npm" },
    ]);

    expect([...rules.active]).toEqual(["unpinned-image"]);
    expect(policyNeedsSourceKind("compose", rules.active)).toBe(true);
    expect(policyNeedsSourceKind("mcp", rules.active)).toBe(false);
    expect(policyNeedsSourceKind("workflow", new Set())).toBe(false);
  });

  it("[SD-82] tree 10만 개도 이벤트 루프를 오래 막지 않고 입력 순서와 무관하게 같은 결과를 낸다", async () => {
    const rules = createPolicyRules([entry(1, "suspicious-filename"), entry(2, "committed-node-modules")]);
    const paths: string[] = [];
    for (let i = 0; i < 100_000; i += 1) paths.push(`src/dir${i % 500}/file${i}.ts`);
    for (let i = 0; i < 300; i += 1) paths.push(`weird/f${String(i).padStart(3, "0")}\u0001`);
    paths.push("z/node_modules/pkg/package.json", "a/node_modules/pkg/package.json");
    const input = (treePaths: string[]) => ({ org: "o", repo: "r", treePaths, manifests: [], sources: [] });

    let ticks = 0;
    let longest = 0;
    let last = Date.now();
    const timer = setInterval(() => {
      ticks += 1;
      longest = Math.max(longest, Date.now() - last);
      last = Date.now();
    }, 1);
    const first = await rules.evaluate(input(paths), new FakeLogger());
    clearInterval(timer);
    const reversed = await rules.evaluate(input([...paths].reverse()), new FakeLogger());

    expect(first).toEqual(reversed);
    expect(first.filter((match) => match.blacklistEntryId === 1)).toHaveLength(100);
    expect(first.find((match) => match.blacklistEntryId === 2)?.filePath).toBe("a/node_modules");
    expect(ticks).toBeGreaterThan(0);
    expect(longest).toBeLessThan(1000);
  });
});
