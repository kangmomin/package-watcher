import type { Settings } from "@pw/shared";
import type { Clock } from "../clock.ts";
import type { TokenSource } from "../config.ts";
import { notImplemented } from "../notImplemented.ts";
import type { Repositories } from "../repositories/index.ts";

/** REST(`GET/PUT /api/settings`)와 MCP(`get_settings`)가 함께 쓴다. */
export interface SettingsService {
  get(): Settings;
  /**
   * `settingsInputSchema` 로 검증·정규화(org 소문자). 실패 → VALIDATION_ERROR(+details).
   * org 가 바뀌면(정규화 후 비교) 같은 트랜잭션에서 활성 검출을 모두 `resolved` 로 바꾸고 `listed_baseline` 을 비운다.
   * `scanIntervalHours` 또는 org 가 바뀌면 `next_scan_at = 저장 시각 + interval`. 다른 필드만 바뀌면 그대로.
   */
  update(input: unknown): Settings;
}

export interface SettingsServiceDeps {
  repos: Repositories;
  clock: Clock;
  githubTokenSource: TokenSource;
  smtpConfigured: boolean;
}

export function createSettingsService(deps: SettingsServiceDeps): SettingsService {
  return notImplemented(deps);
}
