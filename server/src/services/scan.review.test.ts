import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pkgJson } from "../test/repoFixtures.ts";
import { allFindings, cleanupTestApps, createTestApp, putSettings, runScan, type TestApp } from "../test/testApp.ts";
import { addEntry } from "../test/v2.ts";

let t: TestApp;

beforeEach(async () => {
  t = createTestApp();
  await putSettings(t);
});

afterEach(cleanupTestApps);

const entry = (ecosystem: string, name: string, versionRange: string | null = null) =>
  addEntry(t, { ecosystem, name, versionRange, reason: `${ecosystem} 악성` });

const uvLock = (version: string) =>
  `version = 1\n\n[[package]]\nname = "evil"\nversion = "${version}"\nsource = { registry = "https://pypi.org/simple" }\n`;

describe("코드 리뷰 지적 수정 (스캔)", () => {
  it("[ME-16] 0바이트 pyproject.toml 이 있어도 repo 는 실패하지 않고 npm 검출이 생긴다", async () => {
    await entry("npm", "evil-npm");
    await entry("pypi", "evil-pkg");
    t.github.setRepos([
      {
        name: "poly",
        files: { "package.json": pkgJson({ dependencies: { "evil-npm": "1.0.0" } }), "pyproject.toml": "" },
      },
    ]);

    const scan = await runScan(t);

    expect(scan).toMatchObject({ status: "success", failedRepos: [], newFindingCount: 1 });
  });

  it("[ME-16] 선언 파일의 고정 버전이 lock 의 버전과 다르면 선언 파일도 따로 검사하고, 같으면 lock 만 검출하며, 범위 spec 은 lock 이 있으면 건너뛴다", async () => {
    await entry("pypi", "evil", "==1.0.0");
    t.github.setRepos([
      { name: "differ", files: { "requirements.txt": "evil==1.0.0\n", "uv.lock": uvLock("2.0.0") } },
      { name: "same", files: { "requirements.txt": "evil==1.0.0\n", "uv.lock": uvLock("1.0.0") } },
      { name: "ranged", files: { "requirements.txt": "evil>=1.0.0\n", "uv.lock": uvLock("2.0.0") } },
    ]);

    await runScan(t);

    const found = (await allFindings(t)).map((item) => `${item.repo}|${item.filePath}|${item.version}`).sort();
    expect(found).toEqual(["differ|requirements.txt|1.0.0", "same|uv.lock|1.0.0"]);
  });

  it("[ME-16] UTF-16 으로 저장된 requirements.txt 는 그 repo 의 실패다", async () => {
    await entry("pypi", "evil");
    t.github.setRepos([{ name: "utf16", files: { "requirements.txt": "e\0v\0i\0l\0=\0=\x001\0" } }]);

    const scan = await runScan(t);

    expect(scan.status).toBe("partial");
    expect(scan.failedRepos[0]).toMatchObject({ repo: "utf16" });
    expect(scan.failedRepos[0]?.error).toContain("UTF-8");
  });
});
