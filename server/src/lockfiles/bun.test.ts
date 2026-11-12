import { describe, expect, it } from "vitest";
import { expectInputRejected, packageKeys } from "../test/assertions.ts";
import * as fx from "./__fixtures__/index.ts";
import { parseBunLock } from "./bun.ts";

describe("parseBunLock", () => {
  it("[AC-03] trailing comma 가 있는 JSONC 를 읽고 튜플 [0] 을 yarn 이름 규칙으로 분해한다", () => {
    expect(packageKeys(parseBunLock(fx.BUN_LOCK))).toEqual(fx.BUN_LOCK_EXPECTED);
  });

  it("[AC-03] UTF-8 BOM 과 CRLF 를 정규화한다", () => {
    expect(packageKeys(parseBunLock(fx.withBomAndCrlf(fx.BUN_LOCK)))).toEqual(
      fx.BUN_LOCK_EXPECTED,
    );
  });

  it("[EC-13] 빈 입력과 깨진 JSONC 는 예외", () => {
    expectInputRejected(() => parseBunLock(""));
    expectInputRejected(() => parseBunLock('{ "lockfileVersion": 1, "packages": { "a": ['));
  });
});
