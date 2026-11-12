import { DIGEST_TIMEZONE, settingsInputSchema, type Settings } from "@pw/shared";
import type { Clock } from "../clock.ts";
import type { TokenSource } from "../config.ts";
import type { Repositories } from "../repositories/index.ts";
import { addMs, HOUR_MS, parseInput, readStoredSettings, toIso } from "./common.ts";

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
  const { repos, clock, githubTokenSource, smtpConfigured } = deps;

  function get(): Settings {
    const stored = readStoredSettings(repos.settings);
    return {
      org: stored.org,
      scanIntervalHours: stored.scanIntervalHours,
      digestTime: stored.digestTime,
      digestTimezone: DIGEST_TIMEZONE,
      recipients: stored.recipients,
      githubTokenSource,
      smtpConfigured,
      notifyMinSeverity: stored.notifyMinSeverity,
    };
  }

  return {
    get,
    update(input) {
      const data = parseInput(settingsInputSchema, input);
      const now = clock.now();
      repos.transaction(() => {
        const previous = readStoredSettings(repos.settings);
        const orgChanged = previous.org !== data.org;
        const intervalChanged = previous.scanIntervalHours !== data.scanIntervalHours;

        repos.settings.set("org", data.org);
        repos.settings.set("scan_interval_hours", String(data.scanIntervalHours));
        repos.settings.set("digest_time", data.digestTime);
        repos.settings.set("recipients", JSON.stringify(data.recipients));
        // 생략하면 저장된 값을 유지한다(v1 클라이언트 호환).
        if (data.notifyMinSeverity !== undefined) {
          repos.settings.set("notify_min_severity", data.notifyMinSeverity);
        }
        if (orgChanged) {
          repos.findings.resolveAllActive(toIso(now));
          repos.settings.set("listed_baseline", null);
        }
        if (orgChanged || intervalChanged) {
          repos.settings.set(
            "next_scan_at",
            toIso(addMs(now, data.scanIntervalHours * HOUR_MS)),
          );
        }
      });
      return get();
    },
  };
}
