import { kstDateOf, type BlacklistEntry } from "@pw/shared";
import type { Clock } from "../clock.ts";

/**
 * 활성 항목 판정의 단일 정의다. 활성 목록, `isExpired` 응답, 스캔 종료 트랜잭션, 비활성 정리, PUT 이 모두 이것을 쓴다.
 * 만료일 당일은 활성이다. 바인딩 이름은 `todayKst`(`YYYY-MM-DD`, 문자열 비교 = 날짜 비교).
 */
export const ACTIVE_ENTRY_SQL = "enabled = 1 AND (expires_at IS NULL OR expires_at >= :todayKst)";

/** `isExpired` 의 SQL 형태. 같은 바인딩(`todayKst`)을 쓴다. */
export const EXPIRED_ENTRY_SQL = "(expires_at IS NOT NULL AND expires_at < :todayKst)";

/** KST 오늘 날짜. 서버 TZ 와 무관하다. */
export const todayKst = (clock: Clock): string => kstDateOf(clock.now());

/** 만료일 다음 날 00:00(KST)부터 true */
export const isExpired = (expiresAt: string | null, today: string): boolean =>
  expiresAt !== null && expiresAt < today;

export const isEntryActive = (
  entry: Pick<BlacklistEntry, "enabled" | "expiresAt">,
  today: string,
): boolean => entry.enabled && !isExpired(entry.expiresAt, today);
