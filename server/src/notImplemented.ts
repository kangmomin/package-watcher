/**
 * Phase 6.1(Red) 스텁 표지. Phase 6.2 에서 실제 구현으로 바꾸면서 호출을 지운다.
 * 인자는 noUnusedParameters 를 피하려고 받기만 한다.
 */
export function notImplemented(..._args: unknown[]): never {
  throw new Error("not implemented");
}
