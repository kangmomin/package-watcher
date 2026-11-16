// 표시 형식.
// 계약: 모든 시각은 Asia/Seoul 로 표시한다(실행 환경의 TZ 와 무관). 표 = MM-dd HH:mm, 카드 = yyyy-MM-dd HH:mm.
// 라벨: direct/transitive = 직접/전이, scheduled/manual = 자동/수동.
import {
  DIGEST_TIMEZONE,
  type DependencyType,
  type Ecosystem,
  type EcosystemCategory,
  type EntrySource,
  type EntryStatus,
  type ScanRepoStatus,
  type ScanTrigger,
  policyCheckOf,
} from "@pw/shared";

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

/** 값이 없거나 쓰지 않는 칸의 표시 */
export const NOT_APPLICABLE_LABEL = "—";

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

const ENTRY_SOURCE_LABELS: Record<EntrySource, string> = { manual: "직접 등록", feed: "자동" };

/** 항목의 출처 라벨: 직접 등록 / 자동(외부 목록이 추가) */
export function entrySourceLabel(source: EntrySource): string {
  return ENTRY_SOURCE_LABELS[source];
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

// 종류 라벨. 기존 패키지 종류는 지금까지 화면이 쓰던 표기(id 그대로)를 유지한다.
const ECOSYSTEM_LABELS: Record<Ecosystem, string> = {
  npm: "npm",
  go: "go",
  pypi: "pypi",
  nuget: "nuget",
  cargo: "cargo",
  pub: "pub",
  maven: "maven",
  rubygems: "RubyGems",
  composer: "Composer",
  cocoapods: "CocoaPods",
  actions: "GitHub Actions",
  docker: "Docker 이미지",
  vscode: "VS Code 확장",
  helm: "Helm chart",
  terraform: "Terraform module",
  path: "파일 경로",
  content: "파일 내용",
  branch: "브랜치 이름",
  commit: "커밋 메시지",
  pr: "PR 제목",
  policy: "위험한 설정",
};
const ECOSYSTEM_CATEGORY_LABELS: Record<EcosystemCategory, string> = {
  package: "패키지",
  ci: "CI·이미지",
  indicator: "침해의 흔적",
  policy: "위험한 설정",
};

export function ecosystemLabel(ecosystem: Ecosystem): string {
  return ECOSYSTEM_LABELS[ecosystem];
}

export function ecosystemCategoryLabel(category: EcosystemCategory): string {
  return ECOSYSTEM_CATEGORY_LABELS[category];
}

/** `—` 의 스크린 리더용 텍스트 (칸의 뜻에 따라 다르다) */
export const NOT_APPLICABLE_SR_TEXT = "해당 없음";
export const NO_VERSION_SR_TEXT = "버전 없음";

/** policy 검출·항목을 검사 이름을 모를 때(목록을 못 받음) 표시하는 이름 */
export const POLICY_FALLBACK_LABEL = "위험한 설정";

/** 내장 검사의 표시 이름. 알 수 없는 id 는 그대로 보인다. */
export function policyCheckTitle(id: string): string {
  return policyCheckOf(id)?.title ?? id;
}

/** 건수의 천 단위 구분 (`151,751`). 로케일과 무관하게 같은 모양이다. */
export function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}

const COMMIT_FILE_PATH = /^commit\/([0-9a-f]{40})$/i;
const PULL_FILE_PATH = /^pull\/(\d+)$/;

/** 검출의 파일 칸 표시: `commit/<40자 sha>` → "커밋 <앞 7자>", `pull/<번호>` → "PR #<번호>", 그 외는 그대로 */
export function findingFileLabel(filePath: string): string {
  const commit = COMMIT_FILE_PATH.exec(filePath);
  if (commit?.[1]) return `커밋 ${commit[1].slice(0, 7)}`;
  const pull = PULL_FILE_PATH.exec(filePath);
  if (pull?.[1]) return `PR #${pull[1]}`;
  return filePath;
}
