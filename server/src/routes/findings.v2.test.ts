import { SEVERITY_RANK, type Finding } from "@pw/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MINUTE } from "../test/clock.ts";
import { pkgJson } from "../test/repoFixtures.ts";
import {
  allFindings,
  cleanupTestApps,
  createTestApp,
  expectApiError,
  findOne,
  listFindings,
  patchFinding,
  putSettings,
  runScan,
  type TestApp,
} from "../test/testApp.ts";
import { addEntry } from "../test/v2.ts";

let t: TestApp;

beforeEach(async () => {
  t = createTestApp();
  await putSettings(t);
});

afterEach(cleanupTestApps);

const deps = (...packages: string[]) =>
  pkgJson({ dependencies: Object.fromEntries(packages.map((name) => [name, "^1.0.0"])) });

const packagesOf = (items: Finding[]): string[] => items.map((item) => item.packageName);

/** 계약의 정렬: 심각도 높은 순 → firstSeenAt 내림차순 → id 내림차순 */
function byContractOrder(a: Finding, b: Finding): number {
  return (
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    b.firstSeenAt.localeCompare(a.firstSeenAt) ||
    b.id - a.id
  );
}

describe("GET /api/findings — ecosystem·severity", () => {
  it("[v2-AC-03][CT-18] 심각도가 다른 검출 3건은 critical → high → low 순서이고 ?severity=high 는 high 검출만 반환한다 (응답에 ecosystem·severity)", async () => {
    await addEntry(t, { name: "low-pkg", reason: "낮음", severity: "low" });
    await addEntry(t, { name: "crit-pkg", reason: "치명", severity: "critical" });
    await addEntry(t, { name: "high-pkg", reason: "높음", severity: "high" });
    t.github.setRepos([{ name: "api", files: { "package.json": deps("crit-pkg", "high-pkg", "low-pkg") } }]);
    await runScan(t);

    const all = await listFindings(t);
    expect(all.total).toBe(3);
    expect(all.items.map((item) => [item.packageName, item.ecosystem, item.severity])).toEqual([
      ["crit-pkg", "npm", "critical"],
      ["high-pkg", "npm", "high"],
      ["low-pkg", "npm", "low"],
    ]);

    const high = await listFindings(t, { severity: "high" });
    expect(high.total).toBe(1);
    expect(high.items.map((item) => [item.packageName, item.severity])).toEqual([["high-pkg", "high"]]);
  });

  it("[CT-18] 정렬은 심각도 → 최신(firstSeenAt) → id 내림차순이다", async () => {
    await addEntry(t, { name: "low-a", reason: "x", severity: "low" });
    await addEntry(t, { name: "high-a", reason: "x", severity: "high" });
    await addEntry(t, { name: "high-b", reason: "x", severity: "high" });
    await addEntry(t, { name: "high-c", reason: "x", severity: "high" });
    await addEntry(t, { name: "crit-b", reason: "x", severity: "critical" });
    await addEntry(t, { name: "plain-b", reason: "x" });
    t.github.setRepos([{ name: "api", files: { "package.json": deps("high-a", "low-a") } }]);
    await runScan(t);

    t.github.upsertRepo({
      name: "web",
      files: { "package.json": deps("plain-b", "high-b", "crit-b", "high-c") },
    });
    t.clock.advance(MINUTE);
    await runScan(t);

    const { items } = await listFindings(t);
    expect(items.map((item) => item.severity)).toEqual(["critical", "high", "high", "high", "medium", "low"]);
    // 같은 high 안에서는 나중 스캔의 검출이 먼저다.
    expect(packagesOf(items).slice(1, 4).sort()).toEqual(["high-a", "high-b", "high-c"]);
    expect(items[3]).toMatchObject({ packageName: "high-a", repo: "api" });
    expect(items.map((item) => item.id)).toEqual([...items].sort(byContractOrder).map((item) => item.id));

    // 페이지를 나눠도 같은 순서다.
    const firstPage = await listFindings(t, { limit: "2", page: "1" });
    const secondPage = await listFindings(t, { limit: "2", page: "2" });
    expect([...firstPage.items, ...secondPage.items].map((item) => item.id)).toEqual(
      items.slice(0, 4).map((item) => item.id),
    );
  });

  it("[CT-18] ?severity 와 ?ecosystem 은 정확히 일치하는 값만 반환하고(\"이상\"이 아니다) 다른 필터와 함께 쓸 수 있다", async () => {
    await addEntry(t, { name: "low-pkg", reason: "x", severity: "low" });
    await addEntry(t, { name: "med-pkg", reason: "x" });
    await addEntry(t, { name: "high-pkg", reason: "x", severity: "high" });
    t.github.setRepos([
      { name: "api", files: { "package.json": deps("low-pkg", "med-pkg", "high-pkg") } },
      { name: "web", files: { "package.json": deps("high-pkg") } },
    ]);
    await runScan(t);
    const webHigh = findOne(await allFindings(t), { repo: "web", packageName: "high-pkg" });
    await patchFinding(t, webHigh.id, "ignored");

    const medium = await listFindings(t, { severity: "medium" });
    expect(medium.total).toBe(1);
    expect(packagesOf(medium.items)).toEqual(["med-pkg"]);
    expect(packagesOf((await listFindings(t, { severity: "low" })).items)).toEqual(["low-pkg"]);
    expect((await listFindings(t, { severity: "critical" })).total).toBe(0);

    const highOpen = await listFindings(t, { severity: "high", status: "open" });
    expect(highOpen.items.map((item) => [item.repo, item.packageName])).toEqual([["api", "high-pkg"]]);
    expect((await listFindings(t, { severity: "high", repo: "web" })).total).toBe(1);

    expect((await listFindings(t, { ecosystem: "npm" })).total).toBe(4);
    expect((await listFindings(t, { ecosystem: "npm", severity: "high" })).total).toBe(2);
    // 조회 필터는 enum 7개를 모두 받는다. 이 묶음에는 npm 검출만 있다.
    for (const ecosystem of ["go", "pypi", "nuget", "cargo", "pub", "maven"]) {
      const page = await listFindings(t, { ecosystem });
      expect(page.total, ecosystem).toBe(0);
      expect(page.items, ecosystem).toEqual([]);
    }
  });

  it("[CT-18] enum 밖의 severity·ecosystem 은 400 VALIDATION_ERROR (+details), 올바른 값은 그 값의 검출만 반환한다", async () => {
    await addEntry(t, { name: "low-pkg", reason: "x", severity: "low" });
    await addEntry(t, { name: "crit-pkg", reason: "x", severity: "critical" });
    t.github.setRepos([{ name: "api", files: { "package.json": deps("low-pkg", "crit-pkg") } }]);
    await runScan(t);

    const badSeverity = await t.request("GET", "/api/findings?severity=urgent");
    expect(expectApiError(badSeverity, 400, "VALIDATION_ERROR").details).toHaveProperty("severity");
    const badEcosystem = await t.request("GET", "/api/findings?ecosystem=cobol");
    expect(expectApiError(badEcosystem, 400, "VALIDATION_ERROR").details).toHaveProperty("ecosystem");

    expect(packagesOf((await listFindings(t, { severity: "critical" })).items)).toEqual(["crit-pkg"]);
  });
});
