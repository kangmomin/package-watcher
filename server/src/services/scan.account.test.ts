import { afterEach, describe, expect, it } from "vitest";
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
  putSettings,
  runScan,
  type TestApp,
} from "../test/testApp.ts";

const T = "2026-11-12T00:00:00.000Z";
const EVIL_PKG = { "package.json": pkgJson({ dependencies: { "evil-pkg": "^1.0.0" } }) };
const CLEAN_PKG = { "package.json": pkgJson({ dependencies: { lodash: "^4.17.21" } }) };

afterEach(cleanupTestApps);

async function accountApp(): Promise<TestApp> {
  const t = createTestApp({ now: T });
  await putSettings(t, { scanTarget: "user", org: null });
  await addBlacklist(t, EVIL);
  return t;
}

describe("설정: 스캔 대상(scanTarget)", () => {
  it("로그인 계정을 대상으로 하면 org 없이 저장되고, 스캔 전에는 accountLogin 이 null 이다", async () => {
    const t = createTestApp({ now: T });

    const saved = await putSettings(t, { scanTarget: "user", org: null });

    expect(saved).toMatchObject({ scanTarget: "user", org: null, accountLogin: null });
    expect((await getSummary(t)).nextScanAt).toBe("2026-11-13T00:00:00.000Z");
  });

  it("빈 org 는 user 대상에서 null 로 보고, org 대상(또는 생략)에서는 org 필드 오류다", async () => {
    const t = createTestApp({ now: T });

    expect(await putSettings(t, { scanTarget: "user", org: "  " })).toMatchObject({ scanTarget: "user", org: null });
    for (const body of [
      { ...DEFAULT_SETTINGS, org: "" },
      { ...DEFAULT_SETTINGS, org: null },
      { ...DEFAULT_SETTINGS, scanTarget: "org", org: null },
    ]) {
      const error = expectApiError(await t.request("PUT", "/api/settings", body), 400, "VALIDATION_ERROR");
      expect(error.details, JSON.stringify(body)).toHaveProperty("org");
    }
    const bad = expectApiError(
      await t.request("PUT", "/api/settings", { ...DEFAULT_SETTINGS, scanTarget: "team" }),
      400,
      "VALIDATION_ERROR",
    );
    expect(bad.details).toHaveProperty("scanTarget");
  });

  it("user 대상에서 org 를 비우면 저장된 org 를 유지하고, org 만 바꾸는 것은 대상 변경이 아니다", async () => {
    const t = await accountApp();
    await putSettings(t, { scanTarget: "org" });
    await putSettings(t, { scanTarget: "user", org: null });
    expect((await getSettings(t)).org).toBe("my-org");

    t.github.setRepos([{ name: "api", files: EVIL_PKG }]);
    await runScan(t);
    await putSettings(t, { scanTarget: "user", org: "other-org" });

    expect(findOne(await allFindings(t), { repo: "api" }).status).toBe("open");
  });

  it("org ↔ 로그인 계정으로 대상을 바꾸면 활성 검출이 모두 resolved 가 된다", async () => {
    const t = createTestApp({ now: T });
    await putSettings(t);
    await addBlacklist(t, EVIL);
    t.github.setRepos([{ name: "api", files: EVIL_PKG }]);
    await runScan(t);

    await putSettings(t, { scanTarget: "user", org: null });

    expect((await allFindings(t)).every((finding) => finding.status === "resolved")).toBe(true);
  });

  it("scanTarget 을 생략하면 저장된 대상을 유지한다 (v1 클라이언트)", async () => {
    const t = createTestApp({ now: T });
    await putSettings(t, { scanTarget: "user", org: null });

    const saved = await putSettings(t, { org: "my-org" });

    expect(saved.scanTarget).toBe("user");
  });
});

describe("스캔: 로그인 계정의 repo", () => {
  it("계정 소유 repo 는 이름으로, 협업자 repo 는 owner/name 으로 검출하고 실제 owner 로 GitHub 를 부른다", async () => {
    const t = await accountApp();
    t.github.setRepos([
      { name: "api", files: EVIL_PKG },
      { name: "lib", owner: "friend", files: EVIL_PKG },
      { name: "clean", files: CLEAN_PKG },
    ]);

    const scan = await runScan(t);

    expect(scan.status).toBe("success");
    expect(t.github.callsOf("listOrgRepos")).toHaveLength(0);
    expect(t.github.callsOf("listAccountRepos")).toHaveLength(1);
    expect(t.github.callsOf("getTree", "api").map((call) => call.org)).toEqual(["me"]);
    expect(t.github.callsOf("getTree", "lib").map((call) => call.org)).toEqual(["friend"]);
    const findings = await allFindings(t);
    expect(findings.map((finding) => finding.repo).sort()).toEqual(["api", "friend/lib"]);
    expect(findOne(findings, { repo: "api" }).htmlUrl).toBe("https://github.com/me/api/blob/HEAD/package.json");
    expect(findOne(findings, { repo: "friend/lib" }).htmlUrl).toBe(
      "https://github.com/friend/lib/blob/HEAD/package.json",
    );
    expect((await getSettings(t)).accountLogin).toBe("me");
  });

  it("목록에서 빠진 협업자 repo 는 저장소가 남아 있어도 resolve 하고, 소유 repo 는 지금처럼 보류한다", async () => {
    const t = await accountApp();
    t.github.setRepos([
      { name: "api", files: EVIL_PKG },
      { name: "lib", owner: "friend", files: EVIL_PKG },
      { name: "one", files: CLEAN_PKG },
      { name: "two", files: CLEAN_PKG },
    ]);
    await runScan(t);

    t.github.hide("api");
    t.github.hide("lib");
    const scan = await runScan(t);

    const findings = await allFindings(t);
    expect(findOne(findings, { repo: "friend/lib" }).status).toBe("resolved");
    expect(findOne(findings, { repo: "api" }).status).toBe("open");
    expect(scan.failedRepos.map((failed) => failed.repo)).toEqual(["api"]);
    expect(t.github.callsOf("getRepo", "lib").map((call) => call.org)).toEqual(["friend"]);
  });

  it("토큰의 계정이 바뀌면 이전 계정의 검출을 resolve 하고 새 계정의 repo 를 검출한다", async () => {
    const t = await accountApp();
    t.github.setRepos([{ name: "api", files: EVIL_PKG }]);
    await runScan(t);
    const before = findOne(await allFindings(t), { repo: "api" });

    t.github.login = "someone";
    await runScan(t);

    const findings = await allFindings(t);
    expect(findings.find((finding) => finding.id === before.id)?.status).toBe("resolved");
    expect(findings.filter((finding) => finding.status === "open").map((finding) => finding.htmlUrl)).toEqual([
      "https://github.com/someone/api/blob/HEAD/package.json",
    ]);
    expect((await getSettings(t)).accountLogin).toBe("someone");
  });

  it("로그인 계정을 확인하지 못하면 스캔이 실패한다", async () => {
    const t = await accountApp();
    t.github.setRepos([{ name: "api", files: EVIL_PKG }]);
    t.github.login = new Error("GitHub API 오류 (401): Bad credentials");

    const scan = await runScan(t);

    expect(scan.status).toBe("failed");
    expect(scan.error).toContain("로그인한 GitHub 계정을 확인하지 못했습니다");
    expect(t.github.callsOf("listAccountRepos")).toHaveLength(0);
  });

  it("스캔 중 대상이 바뀌면 결과를 저장하지 않는다", async () => {
    const t = await accountApp();
    t.github.setRepos([{ name: "api", files: EVIL_PKG }]);
    const gate = t.github.pause("getTree", "api");
    const pending = runScan(t);
    await gate.waitReached();

    await putSettings(t, { scanTarget: "org" });
    gate.release();
    const scan = await pending;

    expect(scan.status).toBe("failed");
    expect(await allFindings(t)).toHaveLength(0);
  });
});
