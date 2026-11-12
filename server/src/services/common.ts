import { digestTimeSchema, scanIntervalHoursSchema, toDetails } from "@pw/shared";
import type { z } from "zod";
import type { TokenSource } from "../config.ts";
import { AppError } from "../errors.ts";
import type { SettingsRepository } from "../repositories/settings.ts";

export const HOUR_MS = 60 * 60 * 1000;
export const DEFAULT_SCAN_INTERVAL_HOURS = 24;
export const DEFAULT_DIGEST_TIME = "09:00";

export const toIso = (date: Date): string => date.toISOString();
export const addMs = (date: Date, ms: number): Date => new Date(date.getTime() + ms);

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
}

/** 저장된 설정. 값이 없거나 깨졌으면 기본값을 쓴다. */
export function readStoredSettings(settings: SettingsRepository): StoredSettings {
  const interval = scanIntervalHoursSchema.safeParse(Number(settings.get("scan_interval_hours")));
  const digestTime = digestTimeSchema.safeParse(settings.get("digest_time"));
  return {
    org: settings.get("org"),
    scanIntervalHours: interval.success ? interval.data : DEFAULT_SCAN_INTERVAL_HOURS,
    digestTime: digestTime.success ? digestTime.data : DEFAULT_DIGEST_TIME,
    recipients: parseRecipients(settings.get("recipients")),
  };
}

function parseRecipients(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/** 자동 스캔과 `nextScanAt` 의 전제: org 와 토큰이 모두 있다. */
export function canScan(org: string | null, tokenSource: TokenSource): org is string {
  return org !== null && tokenSource !== "none";
}
