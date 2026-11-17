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
  /** 외부 목록(feed)이 꺼짐에서 켜짐으로 바뀐 직후(저장 뒤)에 부른다 — 동기화를 시작한다 */
  onFeedEnabled?: () => void;
}

export function createSettingsService(deps: SettingsServiceDeps): SettingsService {
  const { repos, clock, githubTokenSource, smtpConfigured, onFeedEnabled } = deps;

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
      feedEnabled: stored.feedEnabled,
      branchScanDays: stored.branchScanDays,
      cveMinScore: stored.cveMinScore,
    };
  }

  return {
    get,
    update(input) {
      const data = parseInput(settingsInputSchema, input);
      const now = clock.now();
      const wasFeedEnabled = readStoredSettings(repos.settings).feedEnabled;
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
        if (data.feedEnabled !== undefined) {
          repos.settings.set("feed_enabled", String(data.feedEnabled));
        }
        if (data.branchScanDays !== undefined) {
          repos.settings.set("branch_scan_days", String(data.branchScanDays));
        }
        // 기준을 바꿔도 기존 검출은 다음 스캔의 종료 트랜잭션에서 정리·재생성된다(저장은 검출을 건드리지 않는 것이 의도다).
        if (data.cveMinScore !== undefined) {
          repos.settings.set("cve_min_score", String(data.cveMinScore));
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
      if (!wasFeedEnabled && data.feedEnabled === true) {
        try {
          onFeedEnabled?.();
        } catch {
          // 동기화 시작의 실패가 설정 저장을 실패로 만들지 않는다
        }
      }
      return get();
    },
  };
}
