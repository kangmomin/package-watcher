import { expect } from "vitest";

/**
 * 입력을 거부하는 예외인지 확인한다. 스텁의 "not implemented" 는 거부로 치지 않는다
 * (그래야 "예외를 던진다" 계약이 미구현 상태에서 우연히 통과하지 않는다).
 */
export function expectInputRejected(fn: () => unknown): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, "예외가 나지 않았습니다").toBeInstanceOf(Error);
  expect((thrown as Error).message).not.toMatch(/not implemented/);
}

/** `name@version` 키를 정렬·중복 제거해서 비교한다(같은 패키지가 여러 번 나와도 된다). */
export function packageKeys(packages: { name: string; version: string }[]): string[] {
  return [...new Set(packages.map((pkg) => `${pkg.name}@${pkg.version}`))].sort();
}

export function sortedKeys(keys: string[]): string[] {
  return [...new Set(keys)].sort();
}
