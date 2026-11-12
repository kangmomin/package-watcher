import { describe, expect, it } from "vitest";
import { isIncompleteDate } from "@/lib/form";

// jsdom 은 `validity.badInput` 을 구현하지 않는다(항상 false). 그래서 validity 를 stub 한 객체를 넘긴다.
function inputWith(badInput: boolean): Pick<HTMLInputElement, "validity"> {
  return { validity: { badInput } as ValidityState };
}

describe("isIncompleteDate (불완전한 날짜 입력 판정)", () => {
  it("[CT-16] validity.badInput 이 true 면 true(날짜 칸 일부만 채움), false 면 false(완성 또는 빈 값)를 반환한다", () => {
    expect(isIncompleteDate(inputWith(false))).toBe(false);
    expect(isIncompleteDate(inputWith(true))).toBe(true);
  });
});
