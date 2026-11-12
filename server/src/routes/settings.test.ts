import { settingsSchema, testEmailResultSchema } from "@pw/shared";
import { afterEach, describe, expect, it } from "vitest";
import { HOUR } from "../test/clock.ts";
import { pkgJson } from "../test/repoFixtures.ts";
import {
  addBlacklist,
  allFindings,
  cleanupTestApps,
  createTestApp,
  DEFAULT_SETTINGS,
  EVIL,
  expectApiError,
  findOne,
  getSettings,
  getSummary,
  patchFinding,
  putSettings,
  RECIPIENTS,
  runScan,
} from "../test/testApp.ts";

const T = "2026-11-12T00:00:00.000Z";

afterEach(cleanupTestApps);

describe("GET /api/settings", () => {
  it("[CT-08] 초기값은 Settings 스키마 (org null, 24시간, 09:00, Asia/Seoul, 수신자 0명)이고 비밀값 키가 없다", async () => {
    const t = createTestApp();

    const res = await t.request("GET", "/api/settings");

    expect(res.status).toBe(200);
    expect(settingsSchema.parse(res.json)).toEqual({
      org: null,
      scanIntervalHours: 24,
      digestTime: "09:00",
      digestTimezone: "Asia/Seoul",
      recipients: [],
      githubTokenSource: "env",
      smtpConfigured: true,
      notifyMinSeverity: "low",
    });
    expect(Object.keys(res.json as object).sort()).toEqual(
      [
        "digestTime",
        "digestTimezone",
        "githubTokenSource",
        "notifyMinSeverity",
        "org",
        "recipients",
        "scanIntervalHours",
        "smtpConfigured",
      ].sort(),
    );
  });

  it("[CT-08] 연결 상태(githubTokenSource, smtpConfigured)는 서버가 해석한 값이다", async () => {
    const gh = createTestApp({ tokenSource: "gh", smtpConfigured: false });
    expect(await getSettings(gh)).toMatchObject({ githubTokenSource: "gh", smtpConfigured: false });

    const none = createTestApp({ tokenSource: "none" });
    expect(await getSettings(none)).toMatchObject({ githubTokenSource: "none", smtpConfigured: true });
  });
});

describe("PUT /api/settings", () => {
  it("[CT-08][AC-11] 유효한 값이면 200 + 정규화한 저장 값 (org 소문자, 수신자 trim·중복 제거)", async () => {
    const t = createTestApp();

    const res = await t.request("PUT", "/api/settings", {
      org: "  My-Org ",
      scanIntervalHours: 6,
      digestTime: "07:30",
      recipients: [" a@example.com ", "a@example.com", "b@example.com"],
    });

    expect(res.status).toBe(200);
    const saved = settingsSchema.parse(res.json);
    expect(saved).toMatchObject({
      org: "my-org",
      scanIntervalHours: 6,
      digestTime: "07:30",
      recipients: ["a@example.com", "b@example.com"],
    });
    expect(await getSettings(t)).toEqual(saved);
  });

  it("[EC-11][CT-08] scanIntervalHours=0 또는 잘못된 이메일 등은 저장하지 않고 400 VALIDATION_ERROR (+details)", async () => {
    const t = createTestApp();
    await putSettings(t);
    const before = await getSettings(t);

    const cases: [Record<string, unknown>, string][] = [
      [{ scanIntervalHours: 0 }, "scanIntervalHours"],
      [{ scanIntervalHours: 169 }, "scanIntervalHours"],
      [{ scanIntervalHours: 1.5 }, "scanIntervalHours"],
      [{ recipients: ["ok@example.com", "not-an-email"] }, "recipients"],
      [{ org: "-bad-org" }, "org"],
      [{ digestTime: "24:00" }, "digestTime"],
    ];
    for (const [override, field] of cases) {
      const error = expectApiError(
        await t.request("PUT", "/api/settings", { ...DEFAULT_SETTINGS, ...override }),
        400,
        "VALIDATION_ERROR",
      );
      expect(error.details, JSON.stringify(override)).toHaveProperty(field);
    }
    const badEmail = expectApiError(
      await t.request("PUT", "/api/settings", { ...DEFAULT_SETTINGS, recipients: ["not-an-email"] }),
      400,
      "VALIDATION_ERROR",
    );
    expect(badEmail.details?.recipients).toContain("not-an-email");
    expect(await getSettings(t)).toEqual(before);
  });

  it("[CT-08] org 가 바뀌면 활성(open·ignored) 검출이 모두 resolved 가 된다", async () => {
    const t = createTestApp();
    await putSettings(t);
    await addBlacklist(t, EVIL);
    t.github.setRepos([
      { name: "api", files: { "package.json": pkgJson({ dependencies: { "evil-pkg": "^1.0.0" } }) } },
      { name: "web", files: { "package.json": pkgJson({ dependencies: { "evil-pkg": "^2.0.0" } }) } },
    ]);
    await runScan(t);
    await patchFinding(t, findOne(await allFindings(t), { repo: "web" }).id, "ignored");

    await putSettings(t, { org: "another-org" });

    const items = await allFindings(t);
    expect(items.every((item) => item.status === "resolved" && item.resolvedAt !== null)).toBe(true);
    expect(await getSummary(t)).toMatchObject({ openCount: 0, ignoredCount: 0 });
  });

  it("[CT-08] 대소문자만 다른 org 저장은 변경이 아니다 (검출·nextScanAt 불변)", async () => {
    const t = createTestApp({ now: T });
    await putSettings(t);
    await addBlacklist(t, EVIL);
    t.github.setRepos([
      { name: "api", files: { "package.json": pkgJson({ dependencies: { "evil-pkg": "^1.0.0" } }) } },
    ]);
    await runScan(t);
    const nextBefore = (await getSummary(t)).nextScanAt;

    t.clock.advance(HOUR);
    await putSettings(t, { org: "MY-ORG" });

    expect(findOne(await allFindings(t), { repo: "api" }).status).toBe("open");
    expect((await getSummary(t)).nextScanAt).toBe(nextBefore);
    expect((await getSettings(t)).org).toBe("my-org");
  });
});

describe("nextScanAt (CT-14, AC-11)", () => {
  it("[CT-14][AC-11] 가짜 시계 T 에서 scanIntervalHours=6 저장 → summary.nextScanAt === T+6h", async () => {
    const t = createTestApp({ now: T });

    const saved = await putSettings(t, { scanIntervalHours: 6 });

    expect(saved.scanIntervalHours).toBe(6);
    expect((await getSummary(t)).nextScanAt).toBe("2026-11-12T06:00:00.000Z");
  });

  it("[CT-14] 다른 필드만 바꾸면 nextScanAt 은 그대로, interval 이나 org 를 바꾸면 저장 시각 + interval", async () => {
    const t = createTestApp({ now: T });
    await putSettings(t, { scanIntervalHours: 6 });

    t.clock.advance(HOUR);
    await putSettings(t, { scanIntervalHours: 6, digestTime: "10:00", recipients: ["c@example.com"] });
    expect((await getSummary(t)).nextScanAt).toBe("2026-11-12T06:00:00.000Z");

    t.clock.advance(HOUR);
    await putSettings(t, { scanIntervalHours: 12 });
    expect((await getSummary(t)).nextScanAt).toBe("2026-11-12T14:00:00.000Z");

    t.clock.advance(HOUR);
    await putSettings(t, { scanIntervalHours: 12, org: "other-org" });
    expect((await getSummary(t)).nextScanAt).toBe("2026-11-12T15:00:00.000Z");
  });

  it("[CT-14] org 또는 토큰이 없으면 nextScanAt 은 null", async () => {
    const noOrg = createTestApp({ now: T });
    expect((await getSummary(noOrg)).nextScanAt).toBeNull();

    const noToken = createTestApp({ now: T, tokenSource: "none" });
    await putSettings(noToken, { scanIntervalHours: 6 });
    expect((await getSummary(noToken)).nextScanAt).toBeNull();
  });
});

describe("POST /api/settings/test-email", () => {
  it("[AC-12][CT-09] SMTP 정상이면 200 {ok:true}, 저장된 수신자에게 테스트 메일 1통", async () => {
    const t = createTestApp();
    await putSettings(t);

    const res = await t.request("POST", "/api/settings/test-email");

    expect(res.status).toBe(200);
    expect(testEmailResultSchema.parse(res.json)).toEqual({ ok: true });
    for (const address of RECIPIENTS) expect(t.mailer.sentTo(address)).toHaveLength(1);
  });

  it("[CT-09] 저장된 수신자가 0명이면 400 NO_RECIPIENTS", async () => {
    const t = createTestApp();
    await putSettings(t, { recipients: [] });

    expectApiError(await t.request("POST", "/api/settings/test-email"), 400, "NO_RECIPIENTS");
    expect(t.mailer.attempts).toHaveLength(0);
  });

  it("[CT-09] SMTP 가 설정되지 않았으면 400 SMTP_NOT_CONFIGURED", async () => {
    const t = createTestApp({ smtpConfigured: false });
    await putSettings(t);

    expectApiError(await t.request("POST", "/api/settings/test-email"), 400, "SMTP_NOT_CONFIGURED");
    expect(t.mailer.attempts).toHaveLength(0);
  });

  it("[CT-09] SMTP 발송이 실패하면 502 SMTP_FAILED", async () => {
    const t = createTestApp();
    await putSettings(t);
    t.mailer.failWith = new Error("535 Authentication failed");

    const error = expectApiError(await t.request("POST", "/api/settings/test-email"), 502, "SMTP_FAILED");

    expect(error.message).not.toBe("");
  });
});
