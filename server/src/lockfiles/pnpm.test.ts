import { describe, expect, it } from "vitest";
import { expectInputRejected, packageKeys } from "../test/assertions.ts";
import * as fx from "./__fixtures__/index.ts";
import { parsePnpmLock } from "./pnpm.ts";

describe("parsePnpmLock", () => {
  it("[AC-03] v5: /name/1.0.0_peer 키에서 peer suffix 를 뗀다", () => {
    expect(packageKeys(parsePnpmLock(fx.PNPM_V5))).toEqual(fx.PNPM_V5_EXPECTED);
  });

  it("[AC-03] v6: /name@1.0.0(peer) 키에서 suffix 를 떼고 git 항목은 name/version 필드에서 읽는다", () => {
    expect(packageKeys(parsePnpmLock(fx.PNPM_V6))).toEqual(fx.PNPM_V6_EXPECTED);
  });

  it("[AC-03] v9: packages 만 읽고 snapshots 는 무시한다", () => {
    expect(packageKeys(parsePnpmLock(fx.PNPM_V9))).toEqual(fx.PNPM_V9_EXPECTED);
  });

  it("[AC-03] UTF-8 BOM 과 CRLF 를 정규화한다", () => {
    expect(packageKeys(parsePnpmLock(fx.withBomAndCrlf(fx.PNPM_V9)))).toEqual(
      fx.PNPM_V9_EXPECTED,
    );
  });

  it("[EC-13] 빈 입력과 깨진 YAML 은 예외", () => {
    expectInputRejected(() => parsePnpmLock(""));
    expectInputRejected(() => parsePnpmLock("lockfileVersion: '9.0'\npackages: [unclosed\n"));
  });
});
