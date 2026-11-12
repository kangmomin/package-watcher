import { describe, expect, it } from "vitest";
import { expectInputRejected, packageKeys } from "../test/assertions.ts";
import * as fx from "./__fixtures__/index.ts";
import { parseNpmLock } from "./npm.ts";

describe("parseNpmLock", () => {
  it("[AC-03] v1: dependencies 를 재귀로 읽고 npm: 별칭을 분해하며 git 버전은 원문으로 낸다", () => {
    expect(packageKeys(parseNpmLock(fx.NPM_V1))).toEqual(fx.NPM_V1_EXPECTED);
  });

  it("[AC-03] v2: packages 만 읽고 dependencies 섹션은 무시한다", () => {
    expect(packageKeys(parseNpmLock(fx.NPM_V2))).toEqual(fx.NPM_V2_EXPECTED);
  });

  it("[AC-03] v3: 루트와 link 항목을 빼고 별칭은 name 필드, 중첩은 마지막 node_modules/ 뒤 경로로 읽는다", () => {
    expect(packageKeys(parseNpmLock(fx.NPM_V3))).toEqual(fx.NPM_V3_EXPECTED);
  });

  it("[AC-03] UTF-8 BOM 과 CRLF 를 정규화한다", () => {
    expect(packageKeys(parseNpmLock(fx.withBomAndCrlf(fx.NPM_V3)))).toEqual(fx.NPM_V3_EXPECTED);
    expect(packageKeys(parseNpmLock(fx.withBomAndCrlf(fx.NPM_V1)))).toEqual(fx.NPM_V1_EXPECTED);
  });

  it("[EC-13] 빈 입력과 깨진 JSON 은 예외", () => {
    expectInputRejected(() => parseNpmLock(""));
    expectInputRejected(() => parseNpmLock("   \n"));
    expectInputRejected(() => parseNpmLock('{ "lockfileVersion": 3, "packages": {'));
  });
});
