import {
  DIGEST_TIMEZONE,
  digestTimeSchema,
  scanIntervalHoursSchema,
  severitySchema,
  toDetails,
  type Severity,
} from "@pw/shared";
import type { z } from "zod";
import type { TokenSource } from "../config.ts";
import { AppError } from "../errors.ts";
import { stringArray } from "../lockfiles/common.ts";
import type { SettingsRepository } from "../repositories/settings.ts";

export const HOUR_MS = 60 * 60 * 1000;
export const DEFAULT_SCAN_INTERVAL_HOURS = 24;
export const DEFAULT_DIGEST_TIME = "09:00";
/** 기본값 low = 모든 검출을 즉시 알린다(v1 동작과 같다) */
export const DEFAULT_NOTIFY_MIN_SEVERITY: Severity = "low";

/** 신뢰할 수 없는 문자열(경로 등)의 제어 문자를 `?` 로 바꾼다 — 메일·로그에서 줄을 위조하지 못하게 한다. */
// eslint-disable-next-line no-control-regex
export const printable = (text: string): string => text.replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]/g, "?");

export const toIso = (date: Date): string => date.toISOString();
export const addMs = (date: Date, ms: number): Date => new Date(date.getTime() + ms);

// 서버 TZ 와 무관하게 Asia/Seoul 기준의 날짜와 시각을 얻는다(`Intl` 만 사용).
const KST_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: DIGEST_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** KST 날짜(`yyyy-MM-dd`)와 시각(`HH:mm`). 일일 요약 판정과 메일 제목이 함께 쓴다. */
export function toKst(date: Date): { date: string; time: string } {
  const parts = Object.fromEntries(KST_PARTS.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/** shared 스키마로 검증한다. 실패하면 VALIDATION_ERROR(+details). */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const details = toDetails(result.error);
  const fields = Object.keys(details);
  if (fields.length === 0) throw new AppError("VALIDATION_ERROR", "요청 형식이 올바르지 않습니다");
  throw new AppError("VALIDATION_ERROR", `입력값이 올바르지 않습니다 (${fields.join(", ")})`, details);
}

export interface StoredSettings {
  org: string | null;
  scanIntervalHours: number;
  digestTime: string;
  recipients: string[];
  notifyMinSeverity: Severity;
  feedEnabled: boolean;
}

/** 저장된 설정. 값이 없거나 깨졌으면 기본값을 쓴다. */
export function readStoredSettings(settings: SettingsRepository): StoredSettings {
  const interval = scanIntervalHoursSchema.safeParse(Number(settings.get("scan_interval_hours")));
  const digestTime = digestTimeSchema.safeParse(settings.get("digest_time"));
  const minSeverity = severitySchema.safeParse(settings.get("notify_min_severity"));
  return {
    // 기본 켬. 저장된 값이 "false" 일 때만 끈다.
    feedEnabled: settings.get("feed_enabled") !== "false",
    notifyMinSeverity: minSeverity.success ? minSeverity.data : DEFAULT_NOTIFY_MIN_SEVERITY,
    org: settings.get("org"),
    scanIntervalHours: interval.success ? interval.data : DEFAULT_SCAN_INTERVAL_HOURS,
    digestTime: digestTime.success ? digestTime.data : DEFAULT_DIGEST_TIME,
    recipients: parseRecipients(settings.get("recipients")),
  };
}

function parseRecipients(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    return stringArray(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** 자동 스캔과 `nextScanAt` 의 전제: org 와 토큰이 모두 있다. */
export function canScan(org: string | null, tokenSource: TokenSource): org is string {
  return org !== null && tokenSource !== "none";
}

/** 순서를 유지하며 최대 `limit` 개씩 실행한다. 하나라도 실패하면 새 작업을 시작하지 않고 그 오류로 reject. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await fn(items[index] as T);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** 검출에 남기는 버전의 최대 길이 */
const MAX_VERSION_LENGTH = 128;

/** 제어 문자를 빼고 128자로 자른다 (원문이 그대로 DB·화면·메일에 간다). */
export function cleanVersion(version: string): string {
  let out = "";
  for (const char of version) {
    const code = char.charCodeAt(0);
    if (code >= 0x20 && code !== 0x7f) out += char;
    if (out.length >= MAX_VERSION_LENGTH) break;
  }
  return out;
}
