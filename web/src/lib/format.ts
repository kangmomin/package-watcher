// 표시 형식.
// 계약: 모든 시각은 Asia/Seoul 로 표시한다(실행 환경의 TZ 와 무관). 표 = MM-dd HH:mm, 카드 = yyyy-MM-dd HH:mm.
// 라벨: direct/transitive = 직접/전이, scheduled/manual = 자동/수동.
import { DIGEST_TIMEZONE, type DependencyType, type EntryStatus, type ScanRepoStatus, type ScanTrigger } from "@pw/shared";

// hourCycle h23: 자정을 "24" 가 아니라 "00" 으로 쓴다.
const kstFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: DIGEST_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function kstParts(iso: string) {
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of kstFormatter.formatToParts(new Date(iso))) {
    parts[part.type] = part.value;
  }
  return {
    year: parts.year ?? "",
    month: parts.month ?? "",
    day: parts.day ?? "",
    hour: parts.hour ?? "",
    minute: parts.minute ?? "",
  };
}

/** ISO 8601 UTC → `MM-dd HH:mm` (Asia/Seoul) */
export function formatTableTime(iso: string): string {
  const { month, day, hour, minute } = kstParts(iso);
  return `${month}-${day} ${hour}:${minute}`;
}

/** ISO 8601 UTC → `yyyy-MM-dd HH:mm` (Asia/Seoul) */
export function formatCardTime(iso: string): string {
  const { year, month, day, hour, minute } = kstParts(iso);
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

/** 블랙리스트 versionRange 가 null 일 때의 표시 */
export const ALL_VERSIONS_LABEL = "(모든 버전)";

const DEPENDENCY_TYPE_LABELS: Record<DependencyType, string> = { direct: "직접", transitive: "전이" };
const SCAN_TRIGGER_LABELS: Record<ScanTrigger, string> = { scheduled: "자동", manual: "수동" };

export function dependencyTypeLabel(type: DependencyType): string {
  return DEPENDENCY_TYPE_LABELS[type];
}

const ENTRY_STATUS_LABELS: Record<EntryStatus, string> = { active: "켬", disabled: "끔", expired: "만료" };

/** 항목 상태 라벨. 상태는 shared entryStatusOf 로 구한다(만료가 enabled 보다 우선). */
export function entryStatusLabel(status: EntryStatus): string {
  return ENTRY_STATUS_LABELS[status];
}

export function scanTriggerLabel(trigger: ScanTrigger): string {
  return SCAN_TRIGGER_LABELS[trigger];
}

const SCAN_REPO_STATUS_LABELS: Record<ScanRepoStatus, string> = {
  pending: "대기",
  running: "진행 중",
  passed: "통과",
  issue: "이슈",
  failed: "실패",
  skipped: "건너뜀",
};

export function scanRepoStatusLabel(status: ScanRepoStatus): string {
  return SCAN_REPO_STATUS_LABELS[status];
}
