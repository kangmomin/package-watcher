import type { Logger } from "../logger.ts";

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  text: string;
}

/** 테스트용 Logger. 메시지와 인자를 문자열 1개로 합쳐 기록한다. */
export class FakeLogger implements Logger {
  readonly entries: LogEntry[] = [];

  info(message: string, ...args: unknown[]): void {
    this.push("info", message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.push("warn", message, args);
  }

  error(message: string, ...args: unknown[]): void {
    this.push("error", message, args);
  }

  texts(level: LogLevel): string[] {
    return this.entries.filter((entry) => entry.level === level).map((entry) => entry.text);
  }

  private push(level: LogLevel, message: string, args: unknown[]): void {
    this.entries.push({ level, text: [message, ...args.map(format)].join(" ") });
  }
}

function format(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
