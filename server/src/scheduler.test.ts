import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeMailer } from "./test/mailer.ts";
import { pkgJson } from "./test/repoFixtures.ts";
import {
  addBlacklist,
  allFindings,
  cleanupTestApps,
  createTestApp,
  EVIL,
  findOne,
  getSummary,
  listScans,
  ORG,
  patchFinding,
  putSettings,
  RECIPIENTS,
  runScan,
  waitForScans,
  type TestApp,
} from "./test/testApp.ts";

const withEvil = () => pkgJson({ dependencies: { "evil-pkg": "^1.0.0" } });
const clean = () => pkgJson({ dependencies: { "safe-lib": "^2.0.0" } });

async function tick(t: TestApp): Promise<void> {
  await t.instance.scheduler.tick();
}

// 서버 TZ 와 무관하게 KST 로 판정해야 한다 (Plan 테스트 전략: TZ=UTC, TZ=America/Los_Angeles).
describe.each(["UTC", "America/Los_Angeles"])("scheduler (TZ=%s)", (tz) => {
  let previousTz: string | undefined;

  beforeAll(() => {
    previousTz = process.env.TZ;
    process.env.TZ = tz;
  });

  afterAll(() => {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  });

  afterEach(cleanupTestApps);

  describe("자동 스캔 (nextScanAt)", () => {
    const T = "2026-11-12T00:00:00.000Z";

    it("[CT-14] T 에 interval 6 저장 → 예정 전 tick 은 무시, T+6h+30s tick 에서 scheduled 스캔 1건, nextScanAt = T+12h", async () => {
      const t = createTestApp({ now: T });
      t.github.setRepos([{ name: "api", files: { "package.json": clean() } }]);
      await putSettings(t, { scanIntervalHours: 6 });
      expect((await getSummary(t)).nextScanAt).toBe("2026-11-12T06:00:00.000Z");

      t.clock.set("2026-11-12T05:59:00.000Z");
      await tick(t);
      await waitForScans(t);
      expect((await listScans(t)).total).toBe(0);

      t.clock.set("2026-11-12T06:00:30.000Z");
      await tick(t);
      await waitForScans(t);
      const scans = await listScans(t);
      expect(scans.total).toBe(1);
      expect(scans.items[0]).toMatchObject({ trigger: "scheduled" });
      expect((await getSummary(t)).nextScanAt).toBe("2026-11-12T12:00:00.000Z");

      await tick(t);
      await waitForScans(t);
      expect((await listScans(t)).total).toBe(1);
    });

    it("[AC-01] interval 이 지나면 scheduled·success 스캔 1개, repoCount = 활성 repo 수 (archived·fork 제외, Node 아닌 repo 포함)", async () => {
      const t = createTestApp({ now: T });
      t.github.setRepos([
        { name: "api", files: { "package.json": clean() } },
        { name: "web", files: { "package.json": clean() } },
        { name: "docs", files: { "README.md": "# docs" } },
        { name: "archived-svc", archived: true, files: { "package.json": clean() } },
        { name: "forked-lib", fork: true, files: { "package.json": clean() } },
      ]);
      await putSettings(t, { scanIntervalHours: 24 });

      t.clock.set("2026-11-13T00:00:30.000Z");
      await tick(t);
      await waitForScans(t);

      const scans = await listScans(t);
      expect(scans.total).toBe(1);
      expect(scans.items[0]).toMatchObject({
        trigger: "scheduled",
        status: "success",
        repoCount: 3,
        failedRepos: [],
      });
    });

    it("[CT-14] 3일 정지 후 재시작해도 스캔은 1건이고 nextScanAt 은 원래 격자의 다음 미래 시각이다", async () => {
      const first = createTestApp({ now: T });
      first.github.setRepos([{ name: "api", files: { "package.json": clean() } }]);
      await putSettings(first, { scanIntervalHours: 6 });
      await first.close();

      const second = createTestApp({
        dbPath: first.dbPath,
        github: first.github,
        now: "2026-11-15T00:00:30.000Z",
      });
      await tick(second);
      await waitForScans(second);
      await tick(second);
      await waitForScans(second);

      const scans = await listScans(second);
      expect(scans.total).toBe(1);
      expect(scans.items[0]).toMatchObject({ trigger: "scheduled" });
      expect((await getSummary(second)).nextScanAt).toBe("2026-11-15T06:00:00.000Z");
    });

    it("[CT-14] 예정 시각에 스캔이 실행 중이면 그 회차를 건너뛰고(스캔 행 없음) nextScanAt 만 다음 격자로 옮긴다", async () => {
      const t = createTestApp({ now: T });
      t.github.setRepos([{ name: "api", files: { "package.json": clean() } }]);
      await putSettings(t, { scanIntervalHours: 6 });
      const gate = t.github.pause("getTree", "api");
      const res = await t.request("POST", "/api/scans");
      expect(res.status, res.text).toBe(202);
      await gate.waitReached();

      t.clock.set("2026-11-12T06:00:30.000Z");
      await tick(t);

      expect((await listScans(t)).total).toBe(1);
      expect((await getSummary(t)).nextScanAt).toBe("2026-11-12T12:00:00.000Z");
      gate.release();
      await waitForScans(t);
      const scans = await listScans(t);
      expect(scans.items.map((scan) => scan.trigger)).toEqual(["manual"]);
    });

    it("[CT-14] org 또는 토큰이 없으면 자동 스캔을 하지 않고 nextScanAt 은 null", async () => {
      const noToken = createTestApp({ now: T, tokenSource: "none" });
      await putSettings(noToken, { scanIntervalHours: 1 });
      noToken.clock.set("2026-11-12T03:00:00.000Z");
      await tick(noToken);
      expect((await listScans(noToken)).total).toBe(0);
      expect((await getSummary(noToken)).nextScanAt).toBeNull();

      const noOrg = createTestApp({ now: T });
      noOrg.clock.set("2026-11-14T00:00:00.000Z");
      await tick(noOrg);
      expect((await listScans(noOrg)).total).toBe(0);
      expect((await getSummary(noOrg)).nextScanAt).toBeNull();
    });

    it("[CT-14] next_scan_at 이 없고 org·토큰이 있으면 서버 시작 시각 + 1분에 첫 스캔을 예약한다", async () => {
      const t = createTestApp({ now: T, initialSettings: { org: ORG } });
      expect((await getSummary(t)).nextScanAt).toBe("2026-11-12T00:01:00.000Z");

      t.clock.set("2026-11-12T00:01:30.000Z");
      await tick(t);
      await waitForScans(t);
      expect((await listScans(t)).items.map((scan) => scan.trigger)).toEqual(["scheduled"]);

      const noToken = createTestApp({ now: T, initialSettings: { org: ORG }, tokenSource: "none" });
      expect((await getSummary(noToken)).nextScanAt).toBeNull();
    });
  });

  describe("일일 요약", () => {
    // 2026-11-11T22:00Z = KST 11-12 07:00. interval 168h 라서 이 테스트들 안에서는 자동 스캔이 없다.
    const SEED_AT = "2026-11-11T22:00:00.000Z";
    const KST_1112_0900_30 = "2026-11-12T00:00:30.000Z";
    const KST_1113_0900_30 = "2026-11-13T00:00:30.000Z";

    async function seed(
      options: { recipients?: string[]; digestTime?: string } = {},
    ): Promise<TestApp> {
      const t = createTestApp({ now: SEED_AT });
      await putSettings(t, {
        scanIntervalHours: 168,
        digestTime: options.digestTime ?? "09:00",
        recipients: options.recipients ?? RECIPIENTS,
      });
      await addBlacklist(t, EVIL);
      t.github.setRepos(
        ["repo-alpha", "repo-bravo", "repo-charlie", "repo-zulu"].map((name) => ({
          name,
          files: { "package.json": withEvil() },
        })),
      );
      await runScan(t);
      const zulu = findOne(await allFindings(t), { repo: "repo-zulu" });
      await patchFinding(t, zulu.id, "ignored");
      t.mailer.clear();
      return t;
    }

    async function tickAt(t: TestApp, iso: string): Promise<void> {
      t.clock.set(iso);
      await tick(t);
    }

    function digestsTo(t: TestApp, address: string): number {
      return t.mailer.sentTo(address).length;
    }

    it("[AC-06][AC-08] digestTime 에 open 3건·ignored 1건이면 수신자마다 요약 메일 1통, 본문에는 open 3건만 있다", async () => {
      const t = await seed();

      await tickAt(t, KST_1112_0900_30);

      for (const address of RECIPIENTS) expect(digestsTo(t, address)).toBe(1);
      const text = t.mailer.sentText();
      for (const repo of ["repo-alpha", "repo-bravo", "repo-charlie"]) expect(text).toContain(repo);
      expect(text).not.toContain("repo-zulu");
    });

    it("[AC-06] digestTime 이전에는 보내지 않는다", async () => {
      const t = await seed();

      await tickAt(t, "2026-11-11T23:59:00.000Z");

      expect(t.mailer.attempts).toHaveLength(0);
    });

    it("[AC-06] 하루에 1회만 보내고 다음 KST 날짜에 다시 보낸다", async () => {
      const t = await seed();

      await tickAt(t, KST_1112_0900_30);
      await tickAt(t, "2026-11-12T00:30:00.000Z");
      await tickAt(t, "2026-11-12T14:00:00.000Z");
      for (const address of RECIPIENTS) expect(digestsTo(t, address)).toBe(1);

      await tickAt(t, KST_1113_0900_30);
      for (const address of RECIPIENTS) expect(digestsTo(t, address)).toBe(2);
    });

    it("[AC-06] 날짜와 시각은 UTC·서버 TZ 가 아니라 Asia/Seoul 기준이다 (KST 날짜 경계)", async () => {
      const t = await seed({ digestTime: "08:00" });

      await tickAt(t, "2026-11-11T22:30:00.000Z"); // KST 11-12 07:30 — 아직 이르다
      expect(t.mailer.attempts).toHaveLength(0);

      await tickAt(t, "2026-11-11T23:30:00.000Z"); // KST 11-12 08:30
      for (const address of RECIPIENTS) expect(digestsTo(t, address)).toBe(1);

      await tickAt(t, "2026-11-12T01:00:00.000Z"); // UTC 날짜는 바뀌었지만 KST 는 같은 11-12
      for (const address of RECIPIENTS) expect(digestsTo(t, address)).toBe(1);

      await tickAt(t, "2026-11-12T23:30:00.000Z"); // KST 11-13 08:30
      for (const address of RECIPIENTS) expect(digestsTo(t, address)).toBe(2);
    });

    it("[AC-06] open 0건이면 보내지 않고 그날은 끝낸다 (나중에 open 이 생겨도 그날은 보내지 않는다)", async () => {
      const t = createTestApp({ now: SEED_AT });
      await putSettings(t, { scanIntervalHours: 168 });
      await addBlacklist(t, EVIL);
      t.github.setRepos([{ name: "repo-alpha", files: { "package.json": clean() } }]);
      await runScan(t);

      await tickAt(t, KST_1112_0900_30);
      expect(t.mailer.attempts).toHaveLength(0);

      t.github.setFiles("repo-alpha", { "package.json": withEvil() });
      t.clock.set("2026-11-12T01:00:00.000Z");
      await runScan(t);
      t.mailer.clear();
      await tickAt(t, "2026-11-12T01:01:00.000Z");
      expect(t.mailer.attempts).toHaveLength(0);

      await tickAt(t, KST_1113_0900_30);
      for (const address of RECIPIENTS) expect(digestsTo(t, address)).toBe(1);
    });

    it("[AC-06] 수신자가 0명이면 보내지 않는다", async () => {
      const t = await seed({ recipients: [] });

      await tickAt(t, KST_1112_0900_30);

      expect(t.mailer.attempts).toHaveLength(0);
    });

    it("[AC-06] 발송 실패는 그날 다시 시도하지 않는다", async () => {
      const t = await seed();
      t.mailer.failWith = new Error("SMTP down");

      await tickAt(t, KST_1112_0900_30);
      const attempted = t.mailer.attempts.length;
      expect(attempted).toBeGreaterThan(0);

      await tickAt(t, "2026-11-12T00:30:00.000Z");
      expect(t.mailer.attempts).toHaveLength(attempted);

      t.mailer.failWith = null;
      await tickAt(t, KST_1113_0900_30);
      for (const address of RECIPIENTS) expect(digestsTo(t, address)).toBe(1);
    });

    it("[AC-06] 재시작 후에도 같은 KST 날짜에는 다시 보내지 않는다 (last_digest_date 유지)", async () => {
      const first = await seed();
      await tickAt(first, KST_1112_0900_30);
      for (const address of RECIPIENTS) expect(digestsTo(first, address)).toBe(1);
      await first.close();

      const mailer = new FakeMailer();
      const second = createTestApp({
        dbPath: first.dbPath,
        github: first.github,
        mailer,
        now: "2026-11-12T00:30:00.000Z",
      });
      await tick(second);

      expect(mailer.attempts).toHaveLength(0);
    });

    it("[AC-08] PATCH 로 ignored 한 검출은 다음 요약 메일에 없다", async () => {
      const t = await seed();
      await tickAt(t, KST_1112_0900_30);
      expect(t.mailer.sentText()).toContain("repo-bravo");

      const bravo = findOne(await allFindings(t), { repo: "repo-bravo" });
      const patched = await patchFinding(t, bravo.id, "ignored");
      expect(patched.status).toBe("ignored");
      t.mailer.clear();
      await tickAt(t, KST_1113_0900_30);

      const text = t.mailer.sentText();
      expect(text).toContain("repo-alpha");
      expect(text).not.toContain("repo-bravo");
    });
  });
});
