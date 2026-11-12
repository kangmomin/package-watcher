import { describe, expect, it } from "vitest";
import { packageKeys } from "../test/assertions.ts";
import * as fx from "./__fixtures__/index.ts";
import { lockfileKindOf, parseLockfile } from "./index.ts";

describe("lockfiles/index", () => {
  it("[AC-03] 파일 이름으로 lockfile 4종을 구분한다 (디렉터리 무관)", () => {
    expect(lockfileKindOf("package-lock.json")).toBe("npm");
    expect(lockfileKindOf("apps/web/yarn.lock")).toBe("yarn");
    expect(lockfileKindOf("pnpm-lock.yaml")).toBe("pnpm");
    expect(lockfileKindOf("tools/bun.lock")).toBe("bun");
    expect(lockfileKindOf("package.json")).toBeNull();
  });

  it("[EC-12] bun.lockb 는 lockfile 로 보지 않는다", () => {
    expect(lockfileKindOf("bun.lockb")).toBeNull();
    expect(lockfileKindOf("apps/web/bun.lockb")).toBeNull();
  });

  it("[AC-03] parseLockfile 은 종류별 파서로 보낸다", () => {
    expect(packageKeys(parseLockfile("npm", fx.NPM_V3))).toEqual(fx.NPM_V3_EXPECTED);
    expect(packageKeys(parseLockfile("yarn", fx.YARN_BERRY))).toEqual(fx.YARN_BERRY_EXPECTED);
    expect(packageKeys(parseLockfile("pnpm", fx.PNPM_V9))).toEqual(fx.PNPM_V9_EXPECTED);
    expect(packageKeys(parseLockfile("bun", fx.BUN_LOCK))).toEqual(fx.BUN_LOCK_EXPECTED);
  });
});
