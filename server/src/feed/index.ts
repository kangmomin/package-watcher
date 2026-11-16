import { normalizeFor, type EntryIndex, type MatchableEntry } from "../matcher.ts";
import { keyOf } from "../repositories/blacklist.ts";
import type { FeedIndexRow } from "../repositories/feed.ts";

/** 외부 목록 항목의 임시 id 는 `-행 id` 다. 블랙리스트 항목의 id 는 양수라서 겹치지 않는다. */
export const feedTempId = (rowId: number): number => -rowId;
export const isFeedTempId = (id: number): boolean => id < 0;
export const feedRowIdOf = (tempId: number): number => -tempId;

/**
 * 외부 목록(feed)의 대조 index. 정확한 이름만 있다(`*` 패턴 없음).
 * 15만 건이라서 항목에는 대조에 필요한 값(id, 이름, 종류, 범위)만 둔다. 사유·링크는 일치했을 때 DB 에서 읽는다.
 */
export interface FeedIndex {
  readonly size: number;
  /** 항목이 1건 이상인 종류 */
  readonly ecosystems: ReadonlySet<string>;
  /** `name` 은 그 종류의 규칙으로 정규화한 값이어야 한다 */
  match(ecosystem: string, normalizedName: string): MatchableEntry[] | undefined;
}

export function createFeedIndex(rows: Iterable<FeedIndexRow>): FeedIndex {
  const byEcosystem = new Map<string, Map<string, MatchableEntry[]>>();
  let size = 0;
  for (const row of rows) {
    let names = byEcosystem.get(row.ecosystem);
    if (!names) {
      names = new Map();
      byEcosystem.set(row.ecosystem, names);
    }
    const entry: MatchableEntry = {
      id: feedTempId(row.id),
      name: row.name,
      ecosystem: row.ecosystem,
      versionRange: row.versionRange,
    };
    const list = names.get(row.name);
    if (list) list.push(entry);
    else names.set(row.name, [entry]);
    size += 1;
  }
  return {
    size,
    ecosystems: new Set(byEcosystem.keys()),
    match: (ecosystem, normalizedName) => byEcosystem.get(ecosystem)?.get(normalizedName),
  };
}

/**
 * 블랙리스트 index 에 외부 목록의 일치를 더한 index. 스캔 코드는 둘을 구분하지 않는다.
 * `blocked`(이미 블랙리스트에 있는 키)와 같은 (종류, 이름, 범위)의 외부 목록 항목은 뺀다 — 그 항목의 상태가 우선한다
 * (사용자가 끈 항목이 다시 살아나지 않는다).
 */
export function createCompositeIndex<E extends MatchableEntry>(
  base: EntryIndex<E>,
  feed: FeedIndex | null,
  blocked: ReadonlySet<string>,
): EntryIndex<MatchableEntry> {
  if (feed === null) return base;
  return {
    match(ecosystem, name) {
      const own = base.match(ecosystem, name);
      const fromFeed = feed.match(ecosystem, normalizeFor(ecosystem, name));
      if (!fromFeed) return own;
      const usable = fromFeed.filter((entry) => !blocked.has(keyOf(entry.ecosystem, entry.name, entry.versionRange)));
      return usable.length === 0 ? own : [...own, ...usable];
    },
  };
}
