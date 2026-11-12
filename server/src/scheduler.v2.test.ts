import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MINUTE } from "./test/clock.ts";
import { pkgJson } from "./test/repoFixtures.ts";
import {
  allFindings,
  cleanupTestApps,
  createTestApp,
  EVIL,
  findOne,
  getSummary,
  listScans,
  patchFinding,
  putSettings,
  runScan,
  type TestApp,
} from "./test/testApp.ts";
import { addEntry, getEntry } from "./test/v2.ts";

const withEvil = () => pkgJson({ dependencies: { "evil-pkg": "^1.0.0" } });

async function tick(t: TestApp): Promise<void> {
  await t.instance.scheduler.tick();
}

// 만료일 2026-11-12 는 KST 로 그날 끝까지 유효하다. KST 자정 = UTC 15:00.
const SEED_AT = "2026-11-12T00:00:00.000Z"; // KST 11-12 09:00
const EXPIRES = "2026-11-12";
const KST_LAST_MS = "2026-11-12T14:59:59.999Z"; // KST 11-12 23:59:59.999
const KST_MIDNIGHT = "2026-11-12T15:00:00.000Z"; // KST 11-13 00:00:00.000

// 서버 TZ 와 무관하게 KST 로 판정해야 한다 (Plan 테스트 전략: TZ=UTC, TZ=America/Los_Angeles).
describe.each(["UTC", "America/Los_Angeles"])("만료 tick (TZ=%s)", (tz) => {
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

  /** interval 168h 라서 이 테스트들 안에서는 자동 스캔이 없다. */
  async function seed(): Promise<{ t: TestApp; entryId: number }> {
    const t = createTestApp({ now: SEED_AT });
    await putSettings(t, { scanIntervalHours: 168 });
    const entry = await addEntry(t, { ...EVIL, expiresAt: EXPIRES });
    t.github.setRepos([
      { name: "alpha-svc", files: { "package.json": withEvil() } },
      { name: "bravo-svc", files: { "package.json": withEvil() } },
    ]);
    await runScan(t);
    await patchFinding(t, findOne(await allFindings(t), { repo: "bravo-svc" }).id, "ignored");
    return { t, entryId: entry.id };
  }

  it("[v2-AC-05][CT-19] expiresAt 이 어제(KST)가 된 뒤의 tick → 항목 isExpired: true, 활성 검출(open·ignored)은 resolved + resolvedAt, 다음 스캔에서 제외된다", async () => {
    const { t, entryId } = await seed();

    // 만료일 당일(KST 23:59)의 tick 은 아무것도 바꾸지 않는다.
    t.clock.set("2026-11-12T14:59:00.000Z");
    await tick(t);
    expect(await getEntry(t, entryId)).toMatchObject({ expiresAt: EXPIRES, isExpired: false });
    expect((await allFindings(t)).map((item) => item.status).sort()).toEqual(["ignored", "open"]);

    t.clock.set("2026-11-12T15:00:30.000Z");
    await tick(t);

    // enabled 는 사용자가 정한 값 그대로이고 만료 여부만 바뀐다.
    expect(await getEntry(t, entryId)).toMatchObject({ enabled: true, expiresAt: EXPIRES, isExpired: true });
    expect((await allFindings(t)).map((item) => [item.status, item.resolvedAt])).toEqual([
      ["resolved", "2026-11-12T15:00:30.000Z"],
      ["resolved", "2026-11-12T15:00:30.000Z"],
    ]);
    expect(await getSummary(t)).toMatchObject({ openCount: 0, ignoredCount: 0 });

    t.github.upsertRepo({ name: "charlie-svc", files: { "package.json": withEvil() } });
    t.clock.advance(MINUTE);
    const scan = await runScan(t);
    expect(scan).toMatchObject({ status: "success", newFindingCount: 0 });
    expect(await allFindings(t)).toHaveLength(2);
    // 만료 정리는 자동 스캔을 시작하지 않는다.
    expect((await listScans(t)).items.map((item) => item.trigger)).toEqual(["manual", "manual"]);
  });

  it("[CT-19] KST 23:59:59.999 에는 isExpired 응답·tick 정리·스캔이 모두 활성으로, 00:00:00.000 에는 모두 만료로 판정한다 (만료일 당일은 활성)", async () => {
    const { t, entryId } = await seed();

    t.clock.set(KST_LAST_MS);
    expect((await getEntry(t, entryId)).isExpired).toBe(false);
    await tick(t);
    expect((await allFindings(t)).map((item) => item.status).sort()).toEqual(["ignored", "open"]);
    t.github.upsertRepo({ name: "charlie-svc", files: { "package.json": withEvil() } });
    const active = await runScan(t);
    expect(active.newFindingCount).toBe(1);
    expect(findOne(await allFindings(t), { repo: "charlie-svc" }).status).toBe("open");

    t.clock.set(KST_MIDNIGHT);
    // 응답의 isExpired 는 tick 을 기다리지 않고 조회 시각으로 계산한다.
    expect((await getEntry(t, entryId)).isExpired).toBe(true);
    await tick(t);
    expect((await allFindings(t)).map((item) => [item.status, item.resolvedAt])).toEqual([
      ["resolved", KST_MIDNIGHT],
      ["resolved", KST_MIDNIGHT],
      ["resolved", KST_MIDNIGHT],
    ]);
    t.github.upsertRepo({ name: "delta-svc", files: { "package.json": withEvil() } });
    const expired = await runScan(t);
    expect(expired.newFindingCount).toBe(0);
    expect(await allFindings(t)).toHaveLength(3);
  });

  it("[CT-19] 자정 정각에 끝나는 스캔의 종료 트랜잭션도 tick 없이 만료 항목의 활성 검출을 resolved 로 바꾼다", async () => {
    const { t } = await seed();
    t.github.upsertRepo({ name: "charlie-svc", files: { "package.json": withEvil() } });

    t.clock.set(KST_MIDNIGHT);
    const scan = await runScan(t);

    expect(scan).toMatchObject({ status: "success", newFindingCount: 0 });
    expect((await allFindings(t)).map((item) => [item.repo, item.status, item.resolvedAt]).sort()).toEqual([
      ["alpha-svc", "resolved", KST_MIDNIGHT],
      ["bravo-svc", "resolved", KST_MIDNIGHT],
    ]);
  });

  it("[CT-19] 꺼진 항목에 남은 활성 검출(이전 버전 이미지가 만든 것)은 tick 이 resolved 로 바꾼다", async () => {
    const t = createTestApp({ now: SEED_AT });
    await putSettings(t, { scanIntervalHours: 168 });
    const entry = await addEntry(t, EVIL);
    t.github.setRepos([{ name: "alpha-svc", files: { "package.json": withEvil() } }]);
    await runScan(t);
    // API 로는 만들 수 없는 상태(꺼진 항목 + 활성 검출)라서 DB 를 직접 고친다.
    t.instance.db.prepare("UPDATE blacklist_entries SET enabled = 0 WHERE id = ?").run(entry.id);
    expect((await allFindings(t)).map((item) => item.status)).toEqual(["open"]);

    t.clock.advance(MINUTE);
    await tick(t);

    expect((await allFindings(t)).map((item) => [item.status, item.resolvedAt])).toEqual([
      ["resolved", t.clock.iso()],
    ]);
    expect(t.logger.texts("error")).toEqual([]);
  });
});
