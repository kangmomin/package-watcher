import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENV_KEYS, isSmtpConfigured, loadConfig, resolveGithubToken } from "./config.ts";

const noGh = () => null;

describe("README", () => {
  it("[A-5] README 의 환경 변수 표는 config.ts 가 읽는 env 목록과 같다", () => {
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    const section = readme.split("## 환경 변수")[1]?.split("\n## ")[0] ?? "";
    const documented = [...section.matchAll(/^\| `([A-Z_]+)` \|/gm)].map((match) => match[1]);

    expect(documented.sort()).toEqual([...ENV_KEYS].sort());
  });
});

describe("loadConfig", () => {
  it("[A-15] env 가 없으면 기본값(listen 127.0.0.1)을 쓰고 빈 문자열 env 는 없음으로 본다", () => {
    const config = loadConfig({ PORT: "", HOST: "  ", GITHUB_ORG: "" }, noGh);

    expect(config).toMatchObject({
      port: 3000,
      host: "127.0.0.1",
      dataDir: "./data",
      github: { token: null, source: "none" },
      smtp: null,
      initialSettings: {},
    });
  });

  it("[D-28] 설정 초기값 env 는 원문 그대로 넘긴다 (검증은 앱 시작 때)", () => {
    const config = loadConfig(
      {
        GITHUB_ORG: "My-Org",
        SCAN_INTERVAL_HOURS: "6",
        DIGEST_TIME: "07:30",
        EMAIL_RECIPIENTS: "a@example.com, b@example.com",
      },
      noGh,
    );

    expect(config.initialSettings).toEqual({
      org: "My-Org",
      scanIntervalHours: "6",
      digestTime: "07:30",
      recipients: "a@example.com, b@example.com",
    });
  });

  it("[CT-09] SMTP 는 SMTP_HOST 와 SMTP_FROM 이 모두 있어야 설정됨이고 SMTP_SECURE 기본값은 port === 465", () => {
    expect(isSmtpConfigured({ SMTP_HOST: "smtp.example.com" })).toBe(false);
    expect(isSmtpConfigured({ SMTP_HOST: "smtp.example.com", SMTP_FROM: "" })).toBe(false);

    const base = { SMTP_HOST: "smtp.example.com", SMTP_FROM: "pw@example.com" };
    expect(loadConfig({ ...base, SMTP_PORT: "465" }, noGh).smtp).toMatchObject({ port: 465, secure: true });
    expect(loadConfig(base, noGh).smtp).toMatchObject({ port: 587, secure: false, user: null });
    expect(loadConfig({ ...base, SMTP_SECURE: "1" }, noGh).smtp).toMatchObject({ port: 465, secure: true });
    expect(loadConfig({ ...base, SMTP_PORT: "465", SMTP_SECURE: "yes" }, noGh).smtp).toMatchObject({
      secure: false,
    });
  });

  it("[CT-08] 토큰은 GITHUB_TOKEN → gh auth token → none 순서로 해석하고 gh 실패는 조용히 none", () => {
    expect(resolveGithubToken({ GITHUB_TOKEN: "env-token" }, () => "gh-token")).toEqual({
      token: "env-token",
      source: "env",
    });
    expect(resolveGithubToken({ GITHUB_TOKEN: " " }, () => "gh-token\n")).toEqual({
      token: "gh-token",
      source: "gh",
    });
    expect(
      resolveGithubToken({}, () => {
        throw new Error("gh not installed");
      }),
    ).toEqual({ token: null, source: "none" });
  });

  it("[A-5] PORT 가 정수가 아니면 시작하지 않는다", () => {
    expect(() => loadConfig({ PORT: "abc" }, noGh)).toThrow(/PORT/);
  });
});
