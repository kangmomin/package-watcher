import { describe, expect, it } from "vitest";
import { expectInputRejected, packageKeys } from "../test/assertions.ts";
import * as fx from "./__fixtures__/index.ts";
import { parseYarnLock } from "./yarn.ts";

describe("parseYarnLock", () => {
  it("[AC-03] classic: 다중 spec 블록, scoped, npm: 별칭, git URL spec 의 이름을 읽는다", () => {
    expect(packageKeys(parseYarnLock(fx.YARN_CLASSIC))).toEqual(fx.YARN_CLASSIC_EXPECTED);
  });

  it("[AC-03] berry: __metadata 와 workspace 항목을 빼고 이름은 resolution, patch 는 기본 패키지 이름으로 읽는다", () => {
    expect(packageKeys(parseYarnLock(fx.YARN_BERRY))).toEqual(fx.YARN_BERRY_EXPECTED);
  });

  it("[AC-03] UTF-8 BOM 과 CRLF 를 정규화한다", () => {
    expect(packageKeys(parseYarnLock(fx.withBomAndCrlf(fx.YARN_CLASSIC)))).toEqual(
      fx.YARN_CLASSIC_EXPECTED,
    );
    expect(packageKeys(parseYarnLock(fx.withBomAndCrlf(fx.YARN_BERRY)))).toEqual(
      fx.YARN_BERRY_EXPECTED,
    );
  });

  it("[EC-13] 빈 입력과 형식 표지(# yarn lockfile v1 / __metadata)가 없는 입력은 예외", () => {
    expectInputRejected(() => parseYarnLock(""));
    expectInputRejected(() => parseYarnLock("\n\n"));
    expectInputRejected(() => parseYarnLock('lodash@^4.17.0:\n  version "4.17.20"\n'));
  });
});
