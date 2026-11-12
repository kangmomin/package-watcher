import type { Clock } from "../clock.ts";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** 테스트용 시계. `now()` 는 `set`/`advance` 로만 바뀐다. */
export class FakeClock implements Clock {
  private current: number;

  constructor(iso = "2026-11-12T00:00:00.000Z") {
    this.current = parseIso(iso);
  }

  now(): Date {
    return new Date(this.current);
  }

  iso(): string {
    return new Date(this.current).toISOString();
  }

  set(iso: string): void {
    this.current = parseIso(iso);
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

export function isoPlus(iso: string, ms: number): string {
  return new Date(parseIso(iso) + ms).toISOString();
}

function parseIso(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`잘못된 시각: ${iso}`);
  return ms;
}
