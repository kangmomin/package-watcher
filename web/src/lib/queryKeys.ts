// query key (Phase 6.1 스텁 — Phase 6.2 에서 구현).
// 무효화는 prefix 로 한다: findings 는 모든 filter·page, scans 는 모든 page 를 함께 무효화한다.
import type { FindingsFilter } from "@/lib/api";

function notImplemented(): never {
  throw new Error("not implemented");
}

export const queryKeys = {
  summary: (): readonly unknown[] => notImplemented(),
  findingsAll: (): readonly unknown[] => notImplemented(),
  findings: (_filter: FindingsFilter, _page: number): readonly unknown[] => notImplemented(),
  blacklist: (): readonly unknown[] => notImplemented(),
  scansAll: (): readonly unknown[] => notImplemented(),
  scans: (_page: number): readonly unknown[] => notImplemented(),
  settings: (): readonly unknown[] => notImplemented(),
};
