import { notImplemented } from "../notImplemented.ts";
import type { LockPackage } from "./index.ts";

/**
 * `pnpm-lock.yaml`. `packages` 만 읽는다(v9 의 `snapshots` 무시).
 * 키 형식: v5 `/name/1.0.0_peer`, v6 `/name@1.0.0(peer)`, v9 `name@1.0.0(peer)` — peer suffix 를 뗀다.
 * git/tarball 항목은 `name`/`version` 필드에서 읽는다.
 * 공통: UTF-8 BOM 제거, CRLF → LF. 파싱 실패·빈 입력은 예외.
 */
export function parsePnpmLock(content: string): LockPackage[] {
  return notImplemented(content);
}
