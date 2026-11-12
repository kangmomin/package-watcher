import type { BlacklistEntry, BlacklistInput } from "@pw/shared";
import type { Db } from "../db/index.ts";
import { notImplemented } from "../notImplemented.ts";

/** SQL 만 담당. 입력은 이미 검증·정규화된 값이다. */
export interface BlacklistRepository {
  /** `name` 오름차순, 같으면 `id` 오름차순 */
  list(): BlacklistEntry[];
  get(id: number): BlacklistEntry | null;
  /** 정규화한 (name, versionRange) 로 찾는다. null 범위끼리도 같은 키다. */
  findByKey(name: string, versionRange: string | null): BlacklistEntry | null;
  insert(input: BlacklistInput, now: string): BlacklistEntry;
  update(id: number, input: BlacklistInput, now: string): BlacklistEntry;
  remove(id: number): boolean;
}

export function createBlacklistRepository(db: Db): BlacklistRepository {
  return notImplemented(db);
}
