import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { Settings } from "@pw/shared";

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
  /** blob 의 디스크 캐시 폴더. `BLOB_CACHE=off` 이면 null */
  blobCacheDir: string | null;
  webDistDir: string;
  github: { token: string | null; source: TokenSource };
  /** GitHub API 의 주소. 없으면 `https://api.github.com`. 녹화·재생 도구(`scripts/github-replay.mjs`)를 가리킬 때 쓴다 */
  githubApiUrl: string | null;
  smtp: SmtpConfig | null;
  initialSettings: InitialSettingsEnv;
}

/** README 의 env 표와 같은 목록이다. 이 목록을 바꾸면 README 도 바꾼다. */
export const ENV_KEYS = [
  "PORT",
  "HOST",
  "DATA_DIR",
  "BLOB_CACHE",
  "WEB_DIST_DIR",
  "GITHUB_TOKEN",
  "GITHUB_API_URL",
  "GITHUB_ORG",
  "SCAN_INTERVAL_HOURS",
  "DIGEST_TIME",
  "EMAIL_RECIPIENTS",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
  "SMTP_SECURE",
] as const;

type EnvKey = (typeof ENV_KEYS)[number];

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_DATA_DIR = "./data";
const SMTP_DEFAULT_PORT = 587;
const SMTP_SECURE_PORT = 465;
const GH_TIMEOUT_MS = 10_000;

/** 번들(`server/dist/index.js`)과 소스(`server/src/config.ts`) 모두에서 `<repo>/web/dist` 를 가리킨다. */
function defaultWebDistDir(): string {
  return fileURLToPath(new URL("../../web/dist", import.meta.url));
}

/** 빈 문자열(공백만 포함) env 는 "없음"이다. */
function read(env: Env, key: EnvKey): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

/** boolean env 는 "true"/"1" 만 true */
function readBoolean(env: Env, key: EnvKey): boolean | null {
  const value = read(env, key);
  if (value === null) return null;
  return value === "true" || value === "1";
}

function readPort(env: Env, key: EnvKey, fallback: number): number {
  const value = read(env, key);
  if (value === null) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${key} 는 1~65535 사이의 정수여야 합니다: ${value}`);
  }
  return port;
}

/** http·https 주소만 받는다(끝의 `/` 는 뗀다). 형식이 틀리면 시작을 막는다 — 조용히 실제 GitHub 으로 가면 안 된다. */
function readHttpUrl(env: Env, key: EnvKey): string | null {
  const value = read(env, key);
  if (value === null) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} 는 http 또는 https 주소입니다: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${key} 는 http 또는 https 주소입니다: ${value}`);
  }
  return value.replace(/\/+$/, "");
}

/** env 로드. 빈 문자열 env 는 "없음". boolean env 는 "true"/"1" 만 true. */
export function loadConfig(env: Env, ghAuthToken: () => string | null): AppConfig {
  const initialSettings: InitialSettingsEnv = {};
  const org = read(env, "GITHUB_ORG");
  const interval = read(env, "SCAN_INTERVAL_HOURS");
  const digestTime = read(env, "DIGEST_TIME");
  const recipients = read(env, "EMAIL_RECIPIENTS");
  if (org !== null) initialSettings.org = org;
  if (interval !== null) initialSettings.scanIntervalHours = interval;
  if (digestTime !== null) initialSettings.digestTime = digestTime;
  if (recipients !== null) initialSettings.recipients = recipients;

  return {
    port: readPort(env, "PORT", DEFAULT_PORT),
    host: read(env, "HOST") ?? DEFAULT_HOST,
    dataDir: read(env, "DATA_DIR") ?? DEFAULT_DATA_DIR,
    blobCacheDir: read(env, "BLOB_CACHE")?.toLowerCase() === "off" ? null : join(read(env, "DATA_DIR") ?? DEFAULT_DATA_DIR, "blob-cache"),
    webDistDir: read(env, "WEB_DIST_DIR") ?? defaultWebDistDir(),
    github: resolveGithubToken(env, ghAuthToken),
    githubApiUrl: readHttpUrl(env, "GITHUB_API_URL"),
    smtp: readSmtp(env),
    initialSettings,
  };
}

function readSmtp(env: Env): SmtpConfig | null {
  if (!isSmtpConfigured(env)) return null;
  const secureEnv = readBoolean(env, "SMTP_SECURE");
  const port = readPort(env, "SMTP_PORT", secureEnv ? SMTP_SECURE_PORT : SMTP_DEFAULT_PORT);
  return {
    host: read(env, "SMTP_HOST") ?? "",
    port,
    secure: secureEnv ?? port === SMTP_SECURE_PORT,
    user: read(env, "SMTP_USER"),
    pass: read(env, "SMTP_PASS"),
    from: read(env, "SMTP_FROM") ?? "",
  };
}

/** 토큰 해석(시작 시 1회): `GITHUB_TOKEN` → `gh auth token` → none. */
export function resolveGithubToken(
  env: Env,
  ghAuthToken: () => string | null,
): { token: string | null; source: TokenSource } {
  const fromEnv = read(env, "GITHUB_TOKEN");
  if (fromEnv) return { token: fromEnv, source: "env" };
  let fromGh: string | null = null;
  try {
    fromGh = ghAuthToken()?.trim() || null;
  } catch {
    fromGh = null;
  }
  return fromGh ? { token: fromGh, source: "gh" } : { token: null, source: "none" };
}

/** `gh auth token` 실행. 실패는 조용히 null. */
export function readGhAuthToken(): string | null {
  try {
    const output = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GH_TIMEOUT_MS,
      windowsHide: true,
    });
    return output.trim() || null;
  } catch {
    return null;
  }
}

/** `SMTP_HOST && SMTP_FROM`. `Settings.smtpConfigured` 와 `SMTP_NOT_CONFIGURED` 판정이 같은 함수를 쓴다. */
export function isSmtpConfigured(env: Env): boolean {
  return read(env, "SMTP_HOST") !== null && read(env, "SMTP_FROM") !== null;
}
