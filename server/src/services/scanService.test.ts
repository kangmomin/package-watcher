import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bunLock,
  npmLockV3,
  pkgJson,
  pnpmV9Lock,
  yarnClassicLock,
} from "../test/repoFixtures.ts";
import {
  addBlacklist,
  allFindings,
  cleanupTestApps,
  createTestApp,
  EVIL,
  findOne,
  LODASH,
  putSettings,
  RECIPIENTS,
  runScan,
  type TestApp,
} from "../test/testApp.ts";

const withEvil = (spec = "^1.0.0") => pkgJson({ dependencies: { "evil-pkg": spec } });
const clean = () => pkgJson({ dependencies: { "safe-lib": "^2.0.0" } });

let t: TestApp;

beforeEach(async () => {
  t = createTestApp();
  await putSettings(t);
});

afterEach(cleanupTestApps);

describe("매칭 (AC-02 ~ AC-04)", () => {
  it("[AC-02] lockfile 이 없는 repo 의 package.json 에 블랙리스트 패키지(범위 null)가 있으면 open·direct 검출 1건", async () => {
    const entry = await addBlacklist(t, EVIL);
    t.github.setRepos([
      {
        name: "api",
        files: { "package.json": pkgJson({ dependencies: { "evil-pkg": "^1.0.0", "safe-lib": "^2.0.0" } }) },
      },
    ]);

    const scan = await runScan(t);

    expect(scan).toMatchObject({ status: "success", newFindingCount: 1, failedRepos: [] });
    const items = await allFindings(t);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      repo: "api",
      filePath: "package.json",
      packageName: "evil-pkg",
      version: "^1.0.0",
      dependencyType: "direct",
      status: "open",
      blacklistEntryId: entry.id,
      reason: "악성 코드",
      htmlUrl: "https://github.com/my-org/api/blob/HEAD/package.json",
      resolvedAt: null,
    });
  });

  it("[AC-02] dependencies·devDependencies·optionalDependencies·peerDependencies 를 모두 본다", async () => {
    await addBlacklist(t, EVIL);
    t.github.setRepos([
      { name: "r-deps", files: { "package.json": pkgJson({ dependencies: { "evil-pkg": "1.0.0" } }) } },
      { name: "r-dev", files: { "package.json": pkgJson({ devDependencies: { "evil-pkg": "1.0.0" } }) } },
      { name: "r-opt", files: { "package.json": pkgJson({ optionalDependencies: { "evil-pkg": "1.0.0" } }) } },
      { name: "r-peer", files: { "package.json": pkgJson({ peerDependencies: { "evil-pkg": "1.0.0" } }) } },
    ]);

    await runScan(t);

    const items = await allFindings(t);
    expect(items.map((item) => item.repo).sort()).toEqual(["r-deps", "r-dev", "r-opt", "r-peer"]);
    expect(items.every((item) => item.dependencyType === "direct")).toBe(true);
  });

  it("[AC-02] 하위 폴더 package.json 도 검사하고 node_modules/ 아래 파일은 무시한다", async () => {
    await addBlacklist(t, EVIL);
    t.github.setRepos([
      {
        name: "tools",
        files: {
          "package.json": clean(),
          "cli/package.json": withEvil("^3.0.0"),
          "node_modules/evil-pkg/package.json": withEvil(),
          "cli/node_modules/x/package.json": withEvil(),
        },
      },
    ]);

    await runScan(t);

    const items = await allFindings(t);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      filePath: "cli/package.json",
      version: "^3.0.0",
      htmlUrl: "https://github.com/my-org/tools/blob/HEAD/cli/package.json",
    });
  });

  it("[AC-03] lockfile 4종 각각의 전이 의존성이 범위를 만족하면 종류마다 open·transitive 검출 1건 (version = 정확한 버전)", async () => {
    await addBlacklist(t, LODASH);
    const pkg = pkgJson({ dependencies: { "some-lib": "^1.0.0" } });
    const versions = { "some-lib": "1.0.0", lodash: "4.17.20" };
    const rootDeps = { "some-lib": "^1.0.0" };
    t.github.setRepos([
      { name: "npm-repo", files: { "package.json": pkg, "package-lock.json": npmLockV3(versions, rootDeps) } },
      { name: "yarn-repo", files: { "package.json": pkg, "yarn.lock": yarnClassicLock(versions) } },
      { name: "pnpm-repo", files: { "package.json": pkg, "pnpm-lock.yaml": pnpmV9Lock(versions, rootDeps) } },
      { name: "bun-repo", files: { "package.json": pkg, "bun.lock": bunLock(versions, rootDeps) } },
    ]);

    const scan = await runScan(t);

    expect(scan).toMatchObject({ status: "success", newFindingCount: 4 });
    const items = await allFindings(t);
    const expected = [
      ["bun-repo", "bun.lock"],
      ["npm-repo", "package-lock.json"],
      ["pnpm-repo", "pnpm-lock.yaml"],
      ["yarn-repo", "yarn.lock"],
    ];
    for (const [repo, filePath] of expected) {
      expect(findOne(items, { repo, filePath })).toMatchObject({
        packageName: "lodash",
        version: "4.17.20",
        dependencyType: "transitive",
        status: "open",
      });
    }
    expect(items).toHaveLength(4);
  });

  it("[AC-03] workspace 로 선언된 package.json 의 직접 의존성은 루트 lockfile 의 정확한 버전으로 direct 검출", async () => {
    await addBlacklist(t, LODASH);
    t.github.setRepos([
      {
        name: "mono",
        files: {
          "package.json": pkgJson({ workspaces: ["packages/*"] }),
          "packages/a/package.json": pkgJson({ name: "a", devDependencies: { lodash: "^4.17.0" } }),
          "package-lock.json": npmLockV3({ lodash: "4.17.20" }),
        },
      },
    ]);

    await runScan(t);

    const items = await allFindings(t);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      filePath: "package-lock.json",
      packageName: "lodash",
      version: "4.17.20",
      dependencyType: "direct",
    });
  });

  it("[AC-02] 담당 lockfile 이 있어도 lockfile 에 없는 직접 의존성은 그것만 range 검사 (filePath = package.json, direct)", async () => {
    await addBlacklist(t, EVIL);
    t.github.setRepos([
      {
        name: "app",
        files: {
          "package.json": pkgJson({ dependencies: { "evil-pkg": "^1.0.0", "some-lib": "^1.0.0" } }),
          "package-lock.json": npmLockV3({ "some-lib": "1.0.0" }),
        },
      },
    ]);

    await runScan(t);

    const items = await allFindings(t);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      filePath: "package.json",
      packageName: "evil-pkg",
      version: "^1.0.0",
      dependencyType: "direct",
    });
  });

  it("[AC-04] lockfile 의 버전이 블랙리스트 범위 밖이면 검출 0건", async () => {
    await addBlacklist(t, LODASH);
    t.github.setRepos([
      {
        name: "api",
        files: {
          "package.json": pkgJson({ dependencies: { lodash: "^4.17.0" } }),
          "package-lock.json": npmLockV3({ lodash: "4.17.21" }),
        },
      },
    ]);

    const scan = await runScan(t);

    expect(scan).toMatchObject({ status: "success", newFindingCount: 0 });
    expect(await allFindings(t)).toEqual([]);
  });
});

describe("신규 알림 (AC-05, EC-03, EC-10)", () => {
  async function seedTwoRepos(): Promise<void> {
    await addBlacklist(t, EVIL);
    await addBlacklist(t, LODASH);
    t.github.setRepos([
      { name: "svc-one", files: { "package.json": withEvil("^1.0.0") } },
      {
        name: "svc-two",
        files: {
          "package.json": pkgJson({ dependencies: { lodash: "^4.17.0" } }),
          "package-lock.json": npmLockV3({ lodash: "4.17.20" }),
        },
      },
    ]);
  }

  it("[AC-05] 신규 open 검출 2건으로 끝나면 수신자마다 메일 1통, 본문에 repo·파일 경로·패키지@버전·사유, 두 검출의 notifiedAt 기록", async () => {
    await seedTwoRepos();

    const scan = await runScan(t);

    expect(scan.newFindingCount).toBe(2);
    for (const address of RECIPIENTS) {
      expect(t.mailer.sentTo(address)).toHaveLength(1);
    }
    const text = t.mailer.sentText();
    for (const piece of [
      "svc-one",
      "package.json",
      "evil-pkg@^1.0.0",
      "악성 코드",
      "svc-two",
      "package-lock.json",
      "lodash@4.17.20",
      "취약점",
    ]) {
      expect(text).toContain(piece);
    }
    const items = await allFindings(t);
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.notifiedAt !== null)).toBe(true);
  });

  it("[EC-03] SMTP 발송이 실패하면 검출은 저장되고 notifiedAt 은 null, 다음 스캔 종료 시 다시 메일에 포함한다", async () => {
    await seedTwoRepos();
    t.mailer.failWith = new Error("SMTP connection refused");

    const first = await runScan(t);

    expect(first.status).toBe("success");
    expect(t.mailer.attempts.length).toBeGreaterThan(0);
    let items = await allFindings(t);
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.notifiedAt === null)).toBe(true);

    t.mailer.failWith = null;
    t.mailer.clear();
    t.clock.advance(60_000);
    const second = await runScan(t);

    expect(second.newFindingCount).toBe(0);
    expect(t.mailer.sent.length).toBeGreaterThan(0);
    expect(t.mailer.sentText()).toContain("svc-one");
    expect(t.mailer.sentText()).toContain("svc-two");
    items = await allFindings(t);
    expect(items.every((item) => item.notifiedAt !== null)).toBe(true);
  });

  it("[EC-03] 모든 수신자가 거부하면 실패로 보고 notifiedAt 은 null 이다", async () => {
    await seedTwoRepos();
    t.mailer.rejectAll = true;

    await runScan(t);

    expect(t.mailer.attempts.length).toBeGreaterThan(0);
    expect((await allFindings(t)).every((item) => item.notifiedAt === null)).toBe(true);
  });

  it("[EC-10] 수신자가 0명이면 메일을 보내지 않고 검출은 저장하며 notifiedAt 은 null 이다", async () => {
    await putSettings(t, { recipients: [] });
    await seedTwoRepos();

    const scan = await runScan(t);

    expect(scan.newFindingCount).toBe(2);
    expect(t.mailer.attempts).toHaveLength(0);
    const items = await allFindings(t);
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.notifiedAt === null)).toBe(true);
  });
});

describe("repo 실패와 목록 실패 (EC-01, EC-02, EC-12, EC-13)", () => {
  it("[EC-01] repo 1개에서 GitHub API 오류가 나면 그 repo 를 건너뛰고 partial, failedRepos 에 기록, 그 repo 의 기존 검출은 그대로", async () => {
    await addBlacklist(t, EVIL);
    t.github.setRepos([
      { name: "good", files: { "package.json": withEvil() } },
      { name: "flaky", files: { "package.json": withEvil() } },
    ]);
    await runScan(t);

    t.github.setFiles("flaky", { "package.json": clean() });
    t.github.failTree("flaky", new Error("GitHub API 오류 (502)"));
    t.clock.advance(60_000);
    const scan = await runScan(t);

    expect(scan.status).toBe("partial");
    expect(scan.repoCount).toBe(2);
    expect(scan.failedRepos).toHaveLength(1);
    expect(scan.failedRepos[0]?.repo).toBe("flaky");
    expect(scan.failedRepos[0]?.error).not.toBe("");
    const flaky = findOne(await allFindings(t), { repo: "flaky" });
    expect(flaky).toMatchObject({ status: "open", resolvedAt: null });
  });

  it("[EC-01] 파일 1개라도 조회에 실패하면 그 repo 전체가 실패다 (그 repo 는 생성·resolve 없음)", async () => {
    await addBlacklist(t, EVIL);
    t.github.setRepos([
      {
        name: "half",
        files: { "package.json": withEvil(), "sub/package.json": withEvil("^2.0.0") },
      },
      { name: "good", files: { "package.json": withEvil() } },
    ]);
    t.github.failFile("half", "sub/package.json", new Error("GitHub API 오류 (500)"));

    const scan = await runScan(t);

    expect(scan.status).toBe("partial");
    expect(scan.failedRepos.map((failed) => failed.repo)).toEqual(["half"]);
    const items = await allFindings(t);
    expect(items.map((item) => item.repo)).toEqual(["good"]);
  });

  it("[EC-01] 모든 repo 가 실패해도 status 는 partial 이다", async () => {
    await addBlacklist(t, EVIL);
    t.github.setRepos([
      { name: "a", files: { "package.json": withEvil() } },
      { name: "b", files: { "package.json": withEvil() } },
    ]);
    t.github.failTree("a", new Error("GitHub API 오류 (502)"));
    t.github.failTree("b", new Error("GitHub API 오류 (502)"));

    const scan = await runScan(t);

    expect(scan.status).toBe("partial");
    expect(scan.failedRepos.map((failed) => failed.repo).sort()).toEqual(["a", "b"]);
    expect(scan.repoCount).toBe(2);
  });

  it("[EC-02] org 목록 조회가 실패하면 스캔 failed + error, 검출 상태 변경 없음", async () => {
    await addBlacklist(t, EVIL);
    t.github.setRepos([{ name: "api", files: { "package.json": withEvil() } }]);
    await runScan(t);
    const before = await allFindings(t);

    t.github.setFiles("api", { "package.json": clean() });
    t.github.listError = new Error("GitHub API 오류 (401) Bad credentials");
    t.clock.advance(60_000);
    const scan = await runScan(t);

    expect(scan.status).toBe("failed");
    expect(scan.error).toEqual(expect.any(String));
    expect(scan.error).not.toBe("");
    expect(scan.finishedAt).not.toBeNull();
    expect(await allFindings(t)).toEqual(before);
  });

  it("[EC-02][EC-03] 목록 조회가 실패한 스캔도 종료 시 미발송 검출의 메일을 다시 시도한다", async () => {
    await addBlacklist(t, EVIL);
    t.github.setRepos([{ name: "api", files: { "package.json": withEvil() } }]);
    t.mailer.failWith = new Error("SMTP down");
    await runScan(t);
    expect((await allFindings(t))[0]?.notifiedAt).toBeNull();

    t.mailer.failWith = null;
    t.mailer.clear();
    t.github.listError = new Error("GitHub API 오류 (404) org 없음");
    const scan = await runScan(t);

    expect(scan.status).toBe("failed");
    expect(t.mailer.sentText()).toContain("api");
    expect((await allFindings(t))[0]?.notifiedAt).not.toBeNull();
  });

  it("[EC-12] bun.lockb 만 있으면 lockfile 없음으로 처리해 package.json range 를 검사하고 경고 로그를 남긴다", async () => {
    await addBlacklist(t, LODASH);
    t.github.setRepos([
      {
        name: "bun-app",
        files: {
          "package.json": pkgJson({ dependencies: { lodash: "^4.17.0" } }),
          "bun.lockb": "\u0000\u0001binary-lockfile",
        },
      },
    ]);

    const scan = await runScan(t);

    expect(scan.status).toBe("success");
    const items = await allFindings(t);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      filePath: "package.json",
      version: "^4.17.0",
      dependencyType: "direct",
    });
    expect(t.logger.texts("warn").some((text) => text.includes("bun.lockb"))).toBe(true);
  });

  it("[EC-13] lockfile 또는 package.json 을 파싱할 수 없으면 그 repo 를 failedRepos 에 기록하고 partial, 다른 repo 는 계속", async () => {
    await addBlacklist(t, EVIL);
    t.github.setRepos([
      { name: "bad-json", files: { "package.json": "{ \"dependencies\": { " } },
      {
        name: "bad-lock",
        files: { "package.json": withEvil(), "yarn.lock": "this is not a yarn lockfile" },
      },
      { name: "good", files: { "package.json": withEvil() } },
    ]);

    const scan = await runScan(t);

    expect(scan.status).toBe("partial");
    expect(scan.failedRepos.map((failed) => failed.repo).sort()).toEqual(["bad-json", "bad-lock"]);
    const items = await allFindings(t);
    expect(items.map((item) => item.repo)).toEqual(["good"]);
  });

  it("[EC-13] tree 가 truncated 이면 그 repo 를 failedRepos 에 기록한다", async () => {
    await addBlacklist(t, EVIL);
    t.github.setRepos([
      { name: "huge", files: { "package.json": withEvil() } },
      { name: "good", files: { "package.json": withEvil() } },
    ]);
    t.github.truncate("huge");

    const scan = await runScan(t);

    expect(scan.status).toBe("partial");
    expect(scan.failedRepos.map((failed) => failed.repo)).toEqual(["huge"]);
    expect((await allFindings(t)).map((item) => item.repo)).toEqual(["good"]);
  });
});

describe("resolve ① (EC-04)", () => {
  it("[EC-04] 이전에 open 이던 검출이 성공한 스캔에서 안 보이면 resolved + resolvedAt, 메일 없음", async () => {
    await addBlacklist(t, EVIL);
    t.github.setRepos([{ name: "api", files: { "package.json": withEvil() } }]);
    await runScan(t);
    t.mailer.clear();

    t.github.setFiles("api", { "package.json": clean() });
    t.clock.advance(60_000);
    const scan = await runScan(t);

    expect(scan.status).toBe("success");
    const finding = findOne(await allFindings(t), { repo: "api" });
    expect(finding.status).toBe("resolved");
    expect(finding.resolvedAt).not.toBeNull();
    expect(t.mailer.attempts).toHaveLength(0);
  });

  it("[EC-04] resolved 검출이 다시 나타나면 새 open 행을 만들고 신규 알림 대상이다", async () => {
    await addBlacklist(t, EVIL);
    t.github.setRepos([{ name: "api", files: { "package.json": withEvil() } }]);
    await runScan(t);
    t.github.setFiles("api", { "package.json": clean() });
    t.clock.advance(60_000);
    await runScan(t);
    t.mailer.clear();

    t.github.setFiles("api", { "package.json": withEvil() });
    t.clock.advance(60_000);
    const scan = await runScan(t);

    expect(scan.newFindingCount).toBe(1);
    const items = await allFindings(t);
    expect(items).toHaveLength(2);
    expect(items.filter((item) => item.status === "resolved")).toHaveLength(1);
    expect(items.filter((item) => item.status === "open")).toHaveLength(1);
    expect(t.mailer.sentText()).toContain("api");
  });
});

describe("깨진 workspace 선언 (EC-13, S-14)", () => {
  /** workspace `packages/a` 의 직접 의존성 lodash 가 루트 lockfile 에 있는 모노레포 */
  function monorepoFiles(kind: "pnpm" | "npm"): Record<string, string> {
    const workspace = pkgJson({ name: "a", dependencies: { lodash: "^4.17.0" } });
    if (kind === "pnpm") {
      return {
        "package.json": pkgJson({ name: "root" }),
        "packages/a/package.json": workspace,
        "pnpm-lock.yaml": pnpmV9Lock({ lodash: "4.17.20" }),
        "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
      };
    }
    return {
      "package.json": pkgJson({ name: "root", workspaces: ["packages/*"] }),
      "packages/a/package.json": workspace,
      "package-lock.json": npmLockV3({ lodash: "4.17.20" }),
    };
  }

  async function seedMonorepo(kind: "pnpm" | "npm") {
    await addBlacklist(t, LODASH);
    t.github.setRepos([
      { name: "mono", files: monorepoFiles(kind) },
      { name: "good", files: { "package.json": clean() } },
    ]);
    await runScan(t);
    const before = findOne(await allFindings(t), { repo: "mono" });
    expect(before).toMatchObject({ version: "4.17.20", dependencyType: "direct", status: "open" });
    t.mailer.clear();
    t.clock.advance(60_000);
    return before;
  }

  it("[EC-13] pnpm-workspace.yaml 의 YAML 문법이 깨지면 그 repo 는 실패(partial, failedRepos)이고 기존 검출은 유지, workspace 의존성을 range 검사로 새로 검출하지 않는다", async () => {
    const before = await seedMonorepo("pnpm");

    t.github.setFiles("mono", {
      ...monorepoFiles("pnpm"),
      "pnpm-workspace.yaml": "packages:\n  - 'packages/*\n",
    });
    const scan = await runScan(t);

    expect(scan).toMatchObject({ status: "partial", newFindingCount: 0, repoCount: 2 });
    expect(scan.failedRepos).toHaveLength(1);
    expect(scan.failedRepos[0]?.repo).toBe("mono");
    expect(scan.failedRepos[0]?.error).toContain("pnpm-workspace.yaml");
    const items = await allFindings(t);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: before.id,
      status: "open",
      dependencyType: "direct",
      resolvedAt: null,
    });
    expect(t.mailer.attempts).toHaveLength(0);
  });

  it("[EC-13] workspaces 를 선언한 루트 package.json 의 JSON 이 깨져도 그 repo 는 실패이고 기존 검출은 유지된다", async () => {
    const before = await seedMonorepo("npm");

    t.github.setFiles("mono", {
      ...monorepoFiles("npm"),
      "package.json": '{ "name": "root", "workspaces": ["packages/*"',
    });
    const scan = await runScan(t);

    expect(scan).toMatchObject({ status: "partial", newFindingCount: 0 });
    expect(scan.failedRepos.map((failed) => failed.repo)).toEqual(["mono"]);
    const items = await allFindings(t);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: before.id, status: "open", resolvedAt: null });
    expect(t.mailer.attempts).toHaveLength(0);
  });
});
