import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  allFindings,
  cleanupTestApps,
  createTestApp,
  putSettings,
  runScan,
  type TestApp,
} from "../test/testApp.ts";
import { addEntry, putEntry } from "../test/v2.ts";

let t: TestApp;

beforeEach(async () => {
  t = createTestApp();
  await putSettings(t);
});

afterEach(cleanupTestApps);

const entry = (ecosystem: string, name: string, versionRange: string | null = null) =>
  addEntry(t, { ecosystem, name, versionRange, reason: `${ecosystem} 악성` });

const disable = (id: number, ecosystem: string, name: string, versionRange: string | null) =>
  putEntry(t, id, { ecosystem, name, versionRange, reason: "r", enabled: false });

const WF = ".github/workflows/ci.yml";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const DIGEST = `sha256:${"b".repeat(64)}`;

const workflow = (...uses: string[]) =>
  `jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n${uses.map((use) => `      - uses: ${use}\n`).join("")}`;

const keysOf = async (): Promise<string[]> =>
  (await allFindings(t)).map((f) => `${f.ecosystem}:${f.packageName}@${f.version}`).sort();

describe("actions 검출", () => {
  it("[SB-40] 정확한 ref, SHA 의 앞부분, 이름 대소문자를 구분하지 않고 일치한다", async () => {
    await entry("actions", "aquasecurity/trivy-action", "v0.34.0, v0.34.1");
    await entry("actions", "evil/sha-action", "0123456");
    t.github.setRepos([
      {
        name: "svc",
        files: {
          [WF]: workflow(
            "Aquasecurity/Trivy-Action@v0.34.1",
            "aquasecurity/trivy-action@v0.35.0",
            `evil/sha-action/sub@${SHA}`,
            "actions/checkout@v4",
          ),
        },
      },
    ]);

    await runScan(t);

    expect(await keysOf()).toEqual([
      "actions:aquasecurity/trivy-action@v0.34.1",
      `actions:evil/sha-action@${SHA}`,
    ]);
  });

  it("[SB-41] 패턴 owner/* 는 그 owner 의 모든 action 에 일치하고 범위가 있으면 ref 도 본다", async () => {
    await entry("actions", "badorg/*", "v1");
    t.github.setRepos([{ name: "svc", files: { [WF]: workflow("badorg/a@v1", "badorg/b@v2", "other/a@v1") } }]);

    await runScan(t);

    expect(await keysOf()).toEqual(["actions:badorg/a@v1"]);
  });

  it("[SB-42] ref 가 없는 uses 는 범위가 없는 항목에만 일치한다", async () => {
    await entry("actions", "owner/all-bad");
    await entry("actions", "owner/ranged", "v1");
    t.github.setRepos([{ name: "svc", files: { [WF]: workflow("owner/all-bad", "owner/ranged") } }]);

    await runScan(t);

    expect((await allFindings(t)).map((f) => f.packageName)).toEqual(["owner/all-bad"]);
  });

  it("[SB-43] 같은 파일의 같은 (이름, ref)는 1건이고 composite action.yml 도 읽는다", async () => {
    await entry("actions", "evil/act", "v1");
    t.github.setRepos([
      {
        name: "svc",
        files: {
          [WF]: workflow("evil/act@v1", "evil/act@v1"),
          "tools/action.yml": "runs:\n  using: composite\n  steps:\n    - uses: evil/act@v1\n      shell: bash\n",
        },
      },
    ]);

    await runScan(t);

    expect((await allFindings(t)).map((f) => f.filePath).sort()).toEqual([WF, "tools/action.yml"]);
  });

  it("[SB-44] 항목을 끄면 검출이 resolved 가 된다", async () => {
    const created = await entry("actions", "evil/act", "v1");
    t.github.setRepos([{ name: "svc", files: { [WF]: workflow("evil/act@v1") } }]);
    await runScan(t);
    expect((await allFindings(t))[0]?.status).toBe("open");

    await disable(created.id, "actions", "evil/act", "v1");
    await runScan(t);

    expect((await allFindings(t))[0]?.status).toBe("resolved");
  });
});

describe("docker 검출", () => {
  it("[SB-45] tag 와 digest 를 모두 비교한다 (tag 가 일치하면 version = tag, digest 만 일치하면 digest)", async () => {
    await entry("docker", "ghcr.io/berriai/litellm", "v1.107.0");
    await entry("docker", "evil/img", DIGEST);
    t.github.setRepos([
      {
        name: "svc",
        files: {
          Dockerfile: `FROM ghcr.io/BerriAI/litellm:v1.107.0@${DIGEST}\nFROM evil/img:safe@${DIGEST}\nFROM evil/img:other\n`,
        },
      },
    ]);

    await runScan(t);

    expect(await keysOf()).toEqual([`docker:evil/img@${DIGEST}`, "docker:ghcr.io/berriai/litellm@v1.107.0"]);
  });

  it("[SB-46] 둘 다 일치해도 이미지 1개당 1건(tag 우선), 짧은 digest 의 앞부분도 일치", async () => {
    await entry("docker", "evil/img", `v1, sha256:${"b".repeat(12)}`);
    t.github.setRepos([{ name: "svc", files: { Dockerfile: `FROM evil/img:v1@${DIGEST}\n` } }]);

    await runScan(t);

    expect((await allFindings(t)).map((f) => f.version)).toEqual(["v1"]);
  });

  it("[SB-47] 범위가 없는 항목은 이름만으로 일치하고 version 은 tag(없으면 latest, tag 없이 digest 뿐이면 digest)", async () => {
    await entry("docker", "node");
    await entry("docker", "evil/pinned");
    t.github.setRepos([
      { name: "a", files: { Dockerfile: "FROM docker.io/library/node:20\n" } },
      { name: "b", files: { Dockerfile: "FROM node\n" } },
      { name: "c", files: { Dockerfile: `FROM evil/pinned@${DIGEST}\n` } },
    ]);

    await runScan(t);

    const byRepo = Object.fromEntries((await allFindings(t)).map((f) => [f.repo, f.version]));
    expect(byRepo).toEqual({ a: "20", b: "latest", c: DIGEST });
  });

  it("[SB-48] workflow 의 container·services, docker:// 와 compose 의 image 도 검출한다", async () => {
    await entry("docker", "evil/img", "1");
    t.github.setRepos([
      {
        name: "svc",
        files: {
          [WF]:
            "jobs:\n  a:\n    container: evil/img:1\n    services:\n      s:\n        image: evil/img:2\n" +
            "    steps:\n      - uses: docker://evil/img:1\n",
          "docker-compose.yml": "services:\n  a:\n    image: ${IMG:-evil/img}:${TAG:-1}\n",
        },
      },
    ]);

    await runScan(t);

    expect((await allFindings(t)).map((f) => f.filePath).sort()).toEqual([WF, "docker-compose.yml"]);
  });
});

describe("받는 파일의 범위와 실패 격리", () => {
  const files = {
    [WF]: workflow("a/b@v1"),
    Dockerfile: "FROM node:20\n",
    "docker-compose.yml": "services:\n  a:\n    image: node:20\n",
    ".mcp.json": "{}",
  };
  const fetched = () => t.github.callsOf("getFile", "svc").length;

  it("[SB-49] 활성 종류가 npm 이면 workflow·Dockerfile·mcp 를 받고 compose 는 받지 않는다", async () => {
    await entry("npm", "evil-cli");
    t.github.setRepos([{ name: "svc", files }]);
    await runScan(t);
    expect(fetched()).toBe(3);
  });

  it("[SB-50] 활성 종류가 docker 면 workflow·Dockerfile·compose 만, actions 면 workflow 만 받는다", async () => {
    const docker = await entry("docker", "node");
    t.github.setRepos([{ name: "svc", files }]);
    await runScan(t);
    expect(fetched()).toBe(3);

    await disable(docker.id, "docker", "node", null);
    await entry("actions", "a/b");
    const before = fetched();
    await runScan(t);
    expect(fetched() - before).toBe(1);
  });

  it("[SB-51] 활성 항목이 없는 종류의 파일은 받지 않는다", async () => {
    await entry("go", "github.com/x/y");
    t.github.setRepos([{ name: "svc", files }]);
    await runScan(t);
    expect(fetched()).toBe(0);
  });

  it("[SB-52] 보조 파일의 YAML 오류는 repo 실패가 아니고 다른 파일의 검출은 남는다", async () => {
    await entry("actions", "evil/act", "v1");
    await entry("docker", "evil/img", "1");
    t.github.setRepos([
      {
        name: "svc",
        files: { [WF]: "jobs: [\n", "docker-compose.yml": "services:\n  a:\n    image: evil/img:1\n" },
      },
    ]);

    const scan = await runScan(t);

    expect(scan.status).toBe("success");
    expect((await allFindings(t)).map((f) => f.packageName)).toEqual(["evil/img"]);
  });

  it("[SB-53] 파일당 action 은 5000개까지만 검사한다", async () => {
    await entry("actions", "evil/act", "v1");
    const uses = Array.from({ length: 5000 }, (_, n) => `owner/filler${n}@v1`);
    uses.push("evil/act@v1");
    t.github.setRepos([{ name: "svc", files: { [WF]: workflow(...uses) } }]);

    await runScan(t);

    expect(await allFindings(t)).toHaveLength(0);
    expect(t.logger.texts("warn").some((text) => text.includes(WF))).toBe(true);
  });
});
