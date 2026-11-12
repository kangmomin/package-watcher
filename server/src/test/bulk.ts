import { importResultSchema, type ImportResult } from "@pw/shared";
import { expect } from "vitest";
import type { TestApp, TestResponse } from "./testApp.ts";

export const CSV_HEADER = "ecosystem,name,versionRange,severity,reason,enabled,expiresAt";

export function bulkRequest(t: TestApp, action: string, ids: unknown): Promise<TestResponse> {
  return t.request("POST", "/api/blacklist/bulk", { action, ids });
}

export function importRequest(
  t: TestApp,
  format: string,
  content: string,
  dryRun?: boolean,
): Promise<TestResponse> {
  return t.request("POST", "/api/blacklist/import", {
    format,
    content,
    ...(dryRun === undefined ? {} : { dryRun }),
  });
}

/** 200 응답을 `ImportResult` 로 읽는다. */
export async function importOk(
  t: TestApp,
  format: "csv" | "json",
  content: string,
  dryRun: boolean,
): Promise<ImportResult> {
  const res = await importRequest(t, format, content, dryRun);
  expect(res.status, res.text).toBe(200);
  return importResultSchema.parse(res.json);
}

export function exportRequest(t: TestApp, query: Record<string, string>): Promise<TestResponse> {
  const qs = new URLSearchParams(query).toString();
  return t.request("GET", `/api/blacklist/export${qs ? `?${qs}` : ""}`);
}

export function jsonFile(items: unknown[]): string {
  return JSON.stringify({ version: 1, items });
}

/** 헤더 + 행. 값은 인용하지 않으므로 쉼표·줄바꿈이 없는 값만 쓴다. */
export function csvFile(rows: string[][], header: string = CSV_HEADER): string {
  return [header, ...rows.map((row) => row.join(","))].join("\r\n") + "\r\n";
}
