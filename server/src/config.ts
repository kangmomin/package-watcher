import type { Settings } from "@pw/shared";
import { notImplemented } from "./notImplemented.ts";

export type TokenSource = Settings["githubTokenSource"];

export type Env = Record<string, string | undefined>;

export interface SmtpConfig {
  host: string;
  port: number;
  /** `SMTP_SECURE` 미설정이면 `port === 465` */
  secure: boolean;
  user: string | null;
  pass: string | null;
  from: string;
}

/**
 * 설정 초기값 env 원문(`GITHUB_ORG`, `SCAN_INTERVAL_HOURS`, `DIGEST_TIME`, `EMAIL_RECIPIENTS`).
 * 키별로 SettingsInput 규칙으로 검증·정규화하고 settings 에 그 키가 없을 때만 넣는다.
 */
export interface InitialSettingsEnv {
  org?: string;
  scanIntervalHours?: string;
  digestTime?: string;
  /** 쉼표 구분 */
  recipients?: string;
}

export interface AppConfig {
  port: number;
  host: string;
  dataDir: string;
  webDistDir: string;
  github: { token: string | null; source: TokenSource };
  smtp: SmtpConfig | null;
  initialSettings: InitialSettingsEnv;
}

/** env 로드. 빈 문자열 env 는 "없음". boolean env 는 "true"/"1" 만 true. */
export function loadConfig(env: Env, ghAuthToken: () => string | null): AppConfig {
  return notImplemented(env, ghAuthToken);
}

/** 토큰 해석(시작 시 1회): `GITHUB_TOKEN` → `gh auth token` → none. */
export function resolveGithubToken(
  env: Env,
  ghAuthToken: () => string | null,
): { token: string | null; source: TokenSource } {
  return notImplemented(env, ghAuthToken);
}

/** `gh auth token` 실행. 실패는 조용히 null. */
export function readGhAuthToken(): string | null {
  return notImplemented();
}

/** `SMTP_HOST && SMTP_FROM`. `Settings.smtpConfigured` 와 `SMTP_NOT_CONFIGURED` 판정이 같은 함수를 쓴다. */
export function isSmtpConfigured(env: Env): boolean {
  return notImplemented(env);
}
