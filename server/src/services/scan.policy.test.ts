import {
  POLICY_CHECKS,
  findingsPageSchema,
  scanReposPageSchema,
  type BlacklistEntry,
  type Finding,
  type PolicyCheckId,
} from "@pw/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { npmLockV3, pkgJson } from "../test/repoFixtures.ts";
import {
  cleanupTestApps,
  createTestApp,
  getScan,
  getSummary,
  listFindings,
  putSettings,
  runScan,
  type TestApp,
} from "../test/testApp.ts";
import { addEntry, listEntries, putEntry } from "../test/v2.ts";

let t: TestApp;

beforeEach(async () => {
  t = createTestApp({ seedPolicy: true });
  await putSettings(t);
});

afterEach(cleanupTestApps);

const policyEntries = (): Promise<BlacklistEntry[]> => listEntries(t, { ecosystem: "policy" });

/** 지정한 검사만 켜고 나머지는 끈다 (빈 목록이면 모두 끈다) */
async function only(...ids: PolicyCheckId[]): Promise<Map<string, number>> {
  const entries = await policyEntries();
  const off = entries.filter((entry) => !ids.includes(entry.name as PolicyCheckId)).map((entry) => entry.id);
  if (off.length > 0) {
    const res = await t.request("POST", "/api/blacklist/bulk", { action: "disable", ids: off });
    expect(res.status, res.text).toBe(200);
  }
  return new Map(entries.map((entry) => [entry.name, entry.id]));
}

const policyFindings = async (): Promise<Finding[]> => (await listFindings(t, { category: "policy" })).items;

/** 그 검사의 검출을 `파일|이름|버전` 으로 정렬해서 돌려준다 */
async function found(id: PolicyCheckId): Promise<string[]> {
  const entry = (await policyEntries()).find((item) => item.name === id);
  return (await policyFindings())
    .filter((finding) => finding.blacklistEntryId === entry?.id)
    .map((finding) => `${finding.filePath}|${finding.packageName}|${finding.version}`)
    .sort();
}

const WF = ".github/workflows/ci.yml";
const lock = npmLockV3({});

describe("검사: unpinned-action", () => {
  it("[SD-30] SHA 가 아닌 외부 action 만 보고한다 (actions·github·같은 org·로컬 제외)", async () => {
    await only("unpinned-action");
    const sha = "a".repeat(40);
    t.github.setRepos([
      {
        name: "svc",
        files: {
          [WF]:
            "permissions: {}\njobs:\n  a:\n    steps:\n" +
            "      - uses: actions/checkout@v4\n" +
            "      - uses: github/codeql-action/init@v3\n" +
            "      - uses: My-Org/shared/.github/actions/x@main\n" +
            "      - uses: ./local\n" +
            `      - uses: pnpm/action-setup@${sha}\n` +
            "      - uses: Docker/Build-Push-Action@v5\n" +
            "      - uses: tj-actions/changed-files\n" +
            "      - uses: codecov/codecov-action@" + "b".repeat(39) + "\n",
          "action.yml":
            "runs:\n  using: composite\n  steps:\n    - uses: peter-evans/create-pull-request@v6\n",
        },
      },
    ]);

    await runScan(t);

    expect(await found("unpinned-action")).toEqual([
      `.github/workflows/ci.yml|codecov/codecov-action|${"b".repeat(39)}`,
      ".github/workflows/ci.yml|docker/build-push-action|v5",
      ".github/workflows/ci.yml|tj-actions/changed-files|",
      "action.yml|peter-evans/create-pull-request|v6",
    ]);
    const [first] = await policyFindings();
    expect(first).toMatchObject({ ecosystem: "policy", dependencyType: "direct", status: "open" });
  });
});

describe("검사: missing-lockfile, non-registry-dependency", () => {
  it("[SD-31] 의존성이 있는데 담당 lock 파일이 없는 package.json 만 보고한다 (workspace 의 하위는 root lock 이 담당)", async () => {
    await only("missing-lockfile");
    t.github.setRepos([
      {
        name: "mono",
        files: {
          "package.json": pkgJson({ dependencies: { a: "1.0.0" }, workspaces: ["packages/*"] }),
          "package-lock.json": lock,
          "packages/x/package.json": pkgJson({ name: "x", dependencies: { b: "1.0.0" } }),
          "tools/package.json": pkgJson({ name: "tools", dependencies: { c: "1.0.0" } }),
          "empty/package.json": pkgJson({ name: "empty" }),
          "node_modules/y/package.json": pkgJson({ name: "y", dependencies: { d: "1" } }),
        },
      },
    ]);

    await runScan(t);

    expect(await found("missing-lockfile")).toEqual(["tools/package.json|package.json|"]);
  });

  it("[SD-32] registry 밖의 의존성(git·URL·축약형·tgz)만 보고하고 workspace·link·npm·file 폴더는 제외한다", async () => {
    await only("non-registry-dependency");
    const long = `https://x.io/${"a".repeat(200)}.tgz`;
    t.github.setRepos([
      {
        name: "svc",
        files: {
          "package.json": pkgJson({
            dependencies: {
              a: "git+https://github.com/x/y.git",
              b: "github:x/y",
              c: "x/y#main",
              d: "https://x.io/a.tgz",
              e: "file:./vendor/e.tgz",
              f: "./vendor/f.tar.gz",
              g: "file:../pkgs/g",
              h: "workspace:*",
              i: "link:../i",
              j: "npm:real@^1",
              k: "^1.0.0",
              l: "latest",
              m: "git://github.com/x/m.git",
              n: "gitlab:x/n",
              o: "bitbucket:x/o",
              p: "http://x.io/p",
              q: "./vendor/q",
              r: long,
            },
          }),
          "package-lock.json": lock,
        },
      },
    ]);

    await runScan(t);

    const got = await found("non-registry-dependency");
    expect(got.map((line) => line.split("|")[1])).toEqual(["a", "b", "c", "d", "e", "f", "m", "n", "o", "p", "r"]);
    expect(got[0]).toBe("package.json|a|git+https://github.com/x/y.git");
    const longRow = got.find((line) => line.split("|")[1] === "r") ?? "";
    expect(longRow.split("|")[2]).toHaveLength(128);
  });
});

describe("검사: unpinned-exec, curl-pipe-shell, workflow-no-permissions, unpinned-image", () => {
  it("[SD-33] 버전 없이 받아서 실행하는 패키지를 보고한다 (정확한 버전·install·선언된 로컬 도구 제외)", async () => {
    await only("unpinned-exec");
    t.github.setRepos([
      {
        name: "svc",
        files: {
          "package.json": pkgJson({ devDependencies: { vitest: "^2.0.0" } }),
          "package-lock.json": lock,
          [WF]:
            "permissions: {}\njobs:\n  a:\n    steps:\n      - run: |\n" +
            "          npx vitest run\n          npx foo\n          npx bar@latest\n          npx baz@1.2.3\n" +
            "          pnpm dlx qux@^1\n          uvx ruff\n          pnpm add foo2\n          npm i -g foo3\n",
          ".mcp.json": JSON.stringify({ mcpServers: { pw: { command: "npx", args: ["-y", "@playwright/mcp@latest"] } } }),
        },
      },
    ]);

    await runScan(t);

    expect(await found("unpinned-exec")).toEqual([
      ".github/workflows/ci.yml|bar|latest",
      ".github/workflows/ci.yml|foo|",
      ".github/workflows/ci.yml|qux|^1",
      ".github/workflows/ci.yml|ruff|",
      ".mcp.json|@playwright/mcp|latest",
    ]);
  });

  it("[SD-34] curl | sh 는 파일 1개당 1건 (workflow, Dockerfile, action.yml)", async () => {
    await only("curl-pipe-shell");
    t.github.setRepos([
      {
        name: "svc",
        files: {
          [WF]:
            "permissions: {}\njobs:\n  a:\n    steps:\n      - run: curl -fsSL https://x.io/i.sh | sh\n      - run: bash <(curl -s https://x.io/j.sh)\n",
          Dockerfile: "FROM node:20\nRUN curl -fsSL https://x.io/i.sh | sudo bash\n",
          "ok/Dockerfile": "FROM node:20\nRUN curl -fsSL https://x.io/a.tgz -o a.tgz\n",
          "action.yml": "runs:\n  using: composite\n  steps:\n    - run: wget -qO- https://x.io | sh\n      shell: bash\n",
        },
      },
    ]);

    await runScan(t);

    expect(await found("curl-pipe-shell")).toEqual([
      ".github/workflows/ci.yml|curl | sh|",
      "Dockerfile|curl | sh|",
      "action.yml|curl | sh|",
    ]);
  });

  it("[SD-35] permissions 가 없는 workflow 만 보고한다", async () => {
    await only("workflow-no-permissions");
    t.github.setRepos([
      {
        name: "svc",
        files: {
          ".github/workflows/a.yml": "on: push\njobs:\n  a:\n    steps: []\n",
          ".github/workflows/b.yml": "on: push\npermissions:\n  contents: read\njobs:\n  a:\n    steps: []\n",
          ".github/workflows/c.yml": "jobs:\n  a:\n    permissions: {}\n  b:\n    permissions: {}\n",
          ".github/workflows/d.yml": "jobs:\n  a:\n    permissions: {}\n  b:\n    steps: []\n",
        },
      },
    ]);

    await runScan(t);

    expect(await found("workflow-no-permissions")).toEqual([
      ".github/workflows/a.yml|permissions|",
      ".github/workflows/d.yml|permissions|",
    ]);
  });

  it("[SD-36] tag 가 없거나 latest 인 이미지만 보고한다 (digest 가 있으면 제외)", async () => {
    await only("unpinned-image");
    t.github.setRepos([
      {
        name: "svc",
        files: {
          Dockerfile: `FROM node\nFROM node:20 AS build\nFROM alpine:latest\nFROM busybox@sha256:${"a".repeat(64)}\n`,
          "compose.yml": "services:\n  db:\n    image: postgres\n  cache:\n    image: redis:7\n",
          [WF]: "permissions: {}\njobs:\n  a:\n    container: ghcr.io/o/img:latest\n    steps: []\n",
        },
      },
    ]);

    await runScan(t);

    expect(await found("unpinned-image")).toEqual([
      ".github/workflows/ci.yml|ghcr.io/o/img|latest",
      "Dockerfile|alpine|latest",
      "Dockerfile|node|latest",
      "compose.yml|postgres|latest",
    ]);
  });
});

describe("검사: committed-node-modules, suspicious-filename", () => {
  it("[SD-37] node_modules/<x>/package.json 이 있으면 repo 당 1건, 가장 얕은 폴더의 경로다", async () => {
    await only("committed-node-modules");
    t.github.setRepos([
      {
        name: "svc",
        files: {
          "node_modules/left-pad/package.json": "{}",
          "a/node_modules/@s/x/package.json": "{}",
          "node_modules/.bin/tool": "x",
        },
      },
      { name: "plain", files: { "src/index.js": "x", "node_modules/readme.md": "x" } },
    ]);

    await runScan(t);

    expect(await found("committed-node-modules")).toEqual(["node_modules|node_modules|"]);
    expect((await policyFindings()).map((finding) => finding.repo)).toEqual(["svc"]);
  });

  it("[SD-38] 경로의 제어 문자를 원문 그대로 보고한다", async () => {
    await only("suspicious-filename");
    t.github.setRepos([
      { name: "svc", files: { "src/ok.js": "x", "src/ev\u0007il.js": "x", "bad\nname.txt": "x", "del\u007fx": "x" } },
    ]);

    await runScan(t);

    expect(await found("suspicious-filename")).toEqual([
      "bad\nname.txt|제어 문자|",
      "del\u007fx|제어 문자|",
      "src/ev\u0007il.js|제어 문자|",
    ]);
  });

  it("[SD-39] 검사 1개의 검출은 repo 당 100건으로 자르고 경고를 1줄 남긴다 (정렬한 앞의 100건)", async () => {
    await only("suspicious-filename");
    const files: Record<string, string> = {};
    for (let i = 0; i < 150; i += 1) files[`d/f${String(i).padStart(3, "0")}\u0001`] = "x";
    t.github.setRepos([{ name: "svc", files }]);

    await runScan(t);

    const got = await found("suspicious-filename");
    expect(got).toHaveLength(100);
    expect(got[0]).toContain("d/f000");
    expect(got[99]).toContain("d/f099");
    const warns = t.logger.texts("warn").filter((text) => text.includes("suspicious-filename"));
    expect(warns).toHaveLength(1);
  });
});

describe("평가 범위와 상태", () => {
  it("[SD-40] 끈 검사는 평가하지 않고, 켠 검사가 끄면 그 검출이 resolved 가 된다", async () => {
    const ids = await only("workflow-no-permissions", "suspicious-filename");
    t.github.setRepos([
      { name: "svc", files: { ".github/workflows/a.yml": "jobs:\n  a:\n    steps: []\n", "x\u0001": "x" } },
    ]);
    await runScan(t);
    expect(await policyFindings()).toHaveLength(2);

    const entry = (await policyEntries()).find((item) => item.name === "suspicious-filename");
    if (!entry) throw new Error("항목이 없습니다");
    await putEntry(t, entry.id, { name: entry.name, versionRange: null, reason: entry.reason, enabled: false });

    const all = (await listFindings(t, { category: "policy", status: "resolved" })).items;
    expect(all.map((finding) => finding.blacklistEntryId)).toEqual([ids.get("suspicious-filename")]);
    expect(await found("workflow-no-permissions")).toHaveLength(1);
  });

  it("[SD-41] 활성 policy 검사가 없으면 보조 파일을 받지 않는다 (요청 수 불변)", async () => {
    await only();
    t.github.setRepos([
      {
        name: "svc",
        files: {
          "package.json": pkgJson(),
          "package-lock.json": lock,
          [WF]: "jobs: {}\n",
          Dockerfile: "FROM node\n",
          "compose.yml": "services: {}\n",
          ".mcp.json": "{}",
          "action.yml": "runs: {}\n",
        },
      },
    ]);

    await runScan(t);

    expect(t.github.callsOf("getFile")).toHaveLength(2); // package.json, package-lock.json
  });

  it.each([
    ["unpinned-action", 4],
    ["workflow-no-permissions", 4],
    ["curl-pipe-shell", 5],
    ["unpinned-exec", 6],
    ["unpinned-image", 6],
    ["missing-lockfile", 2],
    ["non-registry-dependency", 2],
    ["committed-node-modules", 2],
    ["suspicious-filename", 2],
  ] as const)("[SD-42] %s 만 켜면 getFile 은 %i 번이다", async (id, expected) => {
    await only(id);
    t.github.setRepos([
      {
        name: "svc",
        files: {
          "package.json": pkgJson(),
          "package-lock.json": lock,
          [WF]: "permissions: {}\njobs: {}\n",
          Dockerfile: "FROM node:20\n",
          "compose.yml": "services: {}\n",
          ".mcp.json": "{}",
          "action.yml": "runs: {}\n",
        },
      },
    ]);

    await runScan(t);

    expect(t.github.callsOf("getFile")).toHaveLength(expected);
  });

  it("[SD-43] 의존성 파일이 없는 repo 도 tree 검사의 대상이다 (passed). 이후 사라지면 resolved", async () => {
    await only("suspicious-filename");
    t.github.setRepos([{ name: "svc", files: { "x\u0001": "x" } }]);

    const scan = await runScan(t);

    expect(await found("suspicious-filename")).toHaveLength(1);
    const rows = scanReposPageSchema.parse((await t.request("GET", `/api/scans/${scan.id}/repos`)).json);
    expect(rows.items[0]).toMatchObject({ repo: "svc", status: "passed", openFindingCount: 0, newFindingCount: 0 });
    expect(t.github.callsOf("getFile")).toHaveLength(0);

    t.github.setFiles("svc", { "ok.txt": "x" });
    await runScan(t);
    expect((await listFindings(t, { category: "policy", status: "resolved" })).items).toHaveLength(1);
  });

  it("[SD-44] 활성 policy 검사가 없으면 의존성 파일이 없는 repo 는 이전처럼 skipped 다", async () => {
    await only();
    t.github.setRepos([{ name: "svc", files: { "x\u0001": "x" } }]);

    const scan = await runScan(t);

    const rows = scanReposPageSchema.parse((await t.request("GET", `/api/scans/${scan.id}/repos`)).json);
    expect(rows.items[0]).toMatchObject({ status: "skipped" });
  });

  it("[SD-45] 파싱 실패한 보조 파일은 건너뛰고 repo 는 실패하지 않는다", async () => {
    await only("unpinned-action", "workflow-no-permissions", "suspicious-filename");
    t.github.setRepos([
      {
        name: "svc",
        files: {
          ".github/workflows/broken.yml": "a: [1,\n",
          ".github/workflows/ok.yml": "jobs:\n  a:\n    steps:\n      - uses: o/r@main\n",
          "x\u0001": "x",
        },
      },
    ]);

    const scan = await runScan(t);

    expect(scan.status).toBe("success");
    expect(await found("unpinned-action")).toEqual([".github/workflows/ok.yml|o/r|main"]);
    expect(await found("workflow-no-permissions")).toEqual([".github/workflows/ok.yml|permissions|"]);
    expect(await found("suspicious-filename")).toHaveLength(1);
  });
});

describe("숫자·상태·분류에서 policy 를 뺀다", () => {
  async function mixed(): Promise<void> {
    await only("workflow-no-permissions", "suspicious-filename");
    await addEntry(t, { name: "evil-pkg", versionRange: null, reason: "악성" });
    t.github.setRepos([
      { name: "dirty", files: { "package.json": pkgJson({ dependencies: { "evil-pkg": "1.0.0" } }), "x\u0001": "x" } },
      { name: "policy-only", files: { [WF]: "jobs:\n  a:\n    steps: []\n", "y\u0002": "x" } },
    ]);
  }

  it("[SD-50] summary: openCount·ignoredCount 는 policy 를 세지 않고 policyOpenCount 가 센다", async () => {
    await mixed();
    await runScan(t);

    expect(await getSummary(t)).toMatchObject({ openCount: 1, ignoredCount: 0, policyOpenCount: 3 });

    const [one] = (await policyFindings()).slice(0, 1);
    const res = await t.request("PATCH", `/api/findings/${one?.id}`, { status: "ignored" });
    expect(res.status, res.text).toBe(200);
    expect(await getSummary(t)).toMatchObject({ openCount: 1, ignoredCount: 0, policyOpenCount: 2 });
  });

  it("[SD-51] repo 상태와 openFindingCount·newFindingCount, 스캔의 newFindingCount 는 policy 를 세지 않는다", async () => {
    await mixed();

    const scan = await runScan(t);

    expect(scan.newFindingCount).toBe(1);
    expect((await getScan(t, scan.id)).newFindingCount).toBe(1);
    const rows = scanReposPageSchema.parse((await t.request("GET", `/api/scans/${scan.id}/repos`)).json);
    expect(rows.items.find((row) => row.repo === "dirty")).toMatchObject({
      status: "issue",
      openFindingCount: 1,
      newFindingCount: 1,
    });
    expect(rows.items.find((row) => row.repo === "policy-only")).toMatchObject({
      status: "passed",
      openFindingCount: 0,
      newFindingCount: 0,
    });
    expect(await policyFindings()).toHaveLength(3);
  });

  it("[SD-52] GET /api/findings 의 category·excludeCategory (ecosystem 과 함께 쓸 수 있다)", async () => {
    await mixed();
    await runScan(t);

    const query = async (params: Record<string, string>) =>
      findingsPageSchema.parse(
        (await t.request("GET", `/api/findings?${new URLSearchParams(params).toString()}`)).json,
      );

    expect((await query({})).total).toBe(4);
    expect((await query({ category: "policy" })).total).toBe(3);
    expect((await query({ excludeCategory: "policy" })).items.map((item) => item.packageName)).toEqual(["evil-pkg"]);
    expect((await query({ category: "package" })).total).toBe(1);
    expect((await query({ category: "policy", excludeCategory: "policy" })).total).toBe(0);
    expect((await query({ category: "policy", ecosystem: "policy" })).total).toBe(3);
    expect((await query({ category: "ci", ecosystem: "policy" })).total).toBe(0);
    expect((await query({ excludeCategory: "package", severity: "low" })).total).toBe(3);
  });
});

describe("메일", () => {
  it("[SD-60] policy 검출만 새로 생긴 스캔은 즉시 메일을 보내지 않는다 (심각도가 critical 이어도)", async () => {
    const ids = await only("workflow-no-permissions");
    const id = ids.get("workflow-no-permissions");
    const entry = (await policyEntries()).find((item) => item.id === id);
    if (!entry) throw new Error("항목이 없습니다");
    await putEntry(t, entry.id, { name: entry.name, versionRange: null, reason: entry.reason, severity: "critical" });
    t.github.setRepos([{ name: "svc", files: { [WF]: "jobs:\n  a:\n    steps: []\n" } }]);

    await runScan(t);

    expect(await policyFindings()).toHaveLength(1);
    expect(t.mailer.attempts).toHaveLength(0);
  });

  it("[SD-61] 즉시 메일은 policy 검출을 포함하지 않는다", async () => {
    await only("workflow-no-permissions");
    await addEntry(t, { name: "evil-pkg", versionRange: null, reason: "악성", severity: "critical" });
    t.github.setRepos([
      {
        name: "svc",
        files: { "package.json": pkgJson({ dependencies: { "evil-pkg": "1.0.0" } }), [WF]: "jobs:\n  a:\n    steps: []\n" },
      },
    ]);

    await runScan(t);

    expect(t.mailer.sent).toHaveLength(1);
    expect(t.mailer.sentText()).toContain("evil-pkg");
    expect(t.mailer.sentText()).not.toContain("permissions");
    expect(t.mailer.sentText()).not.toContain("[policy]");
  });

  it("[SD-62] 일일 요약은 행에 policy 를 넣지 않고 끝에 검사별 건수 구역을 붙인다", async () => {
    await only("workflow-no-permissions", "suspicious-filename");
    await addEntry(t, { name: "evil-pkg", versionRange: null, reason: "악성" });
    t.github.setRepos([
      {
        name: "svc",
        files: {
          "package.json": pkgJson({ dependencies: { "evil-pkg": "1.0.0" } }),
          ".github/workflows/a.yml": "jobs:\n  a:\n    steps: []\n",
          ".github/workflows/b.yml": "jobs:\n  a:\n    steps: []\n",
          "x\u0001": "x",
        },
      },
    ]);
    await runScan(t);
    t.mailer.clear();

    await t.instance.services.notifier.sendDigest();

    expect(t.mailer.sent).toHaveLength(1);
    const message = t.mailer.sent[0];
    expect(message?.subject).toContain("미해결 검출 1건");
    const text = message?.text ?? "";
    expect(text).toContain("evil-pkg@1.0.0");
    expect(text).not.toContain("[policy]");
    const workflow = POLICY_CHECKS.find((check) => check.id === "workflow-no-permissions");
    const suspicious = POLICY_CHECKS.find((check) => check.id === "suspicious-filename");
    expect(text).toContain("위험한 설정: 총 3건");
    expect(text.indexOf(`${workflow?.title}: 2건`)).toBeGreaterThan(text.indexOf("위험한 설정"));
    expect(text.indexOf(`${workflow?.title}: 2건`)).toBeLessThan(text.indexOf(`${suspicious?.title}: 1건`));
    expect(text).not.toContain("0건");
    expect(text.indexOf("위험한 설정")).toBeGreaterThan(text.indexOf("evil-pkg"));
  });

  it("[SD-63] policy 만 있고 다른 open 검출이 없으면 요약을 보내지 않는다", async () => {
    await only("workflow-no-permissions");
    t.github.setRepos([{ name: "svc", files: { [WF]: "jobs:\n  a:\n    steps: []\n" } }]);
    await runScan(t);
    t.mailer.clear();

    await t.instance.services.notifier.sendDigest();

    expect(t.mailer.attempts).toHaveLength(0);
  });
});
