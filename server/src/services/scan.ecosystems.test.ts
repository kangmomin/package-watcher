import { scanReposPageSchema, type Page, type ScanRepo } from "@pw/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fx from "../ecosystems/__fixtures__/index.ts";
import { pkgJson } from "../test/repoFixtures.ts";
import {
  allFindings,
  cleanupTestApps,
  createTestApp,
  expectApiError,
  listFindings,
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

const goMod = (...requires: string[]) =>
  `module example.com/app\n\ngo 1.22\n\nrequire (\n${requires.map((line) => `\t${line}\n`).join("")})\n`;

const cargoLock = (...packages: [string, string][]) =>
  "version = 3\n\n" +
  packages
    .map(
      ([name, version]) =>
        `[[package]]\nname = "${name}"\nversion = "${version}"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n`,
    )
    .join("\n");

const cargoToml = (deps: Record<string, string>) =>
  `[package]\nname = "app"\nversion = "0.1.0"\n\n[dependencies]\n${Object.entries(deps)
    .map(([name, spec]) => `${name} = "${spec}"`)
    .join("\n")}\n`;

const entry = (ecosystem: string, name: string, versionRange: string | null = null) =>
  addEntry(t, { ecosystem, name, versionRange, reason: `${ecosystem} 악성` });

async function repoRows(scanId: number): Promise<Page<ScanRepo>> {
  const res = await t.request("GET", `/api/scans/${scanId}/repos?limit=200`);
  expect(res.status, res.text).toBe(200);
  return scanReposPageSchema.parse(res.json);
}

const rowOf = (page: Page<ScanRepo>, repo: string): ScanRepo => {
  const found = page.items.find((item) => item.repo === repo);
  if (!found) throw new Error(`repo 행이 없습니다: ${repo}`);
  return found;
};

describe("종류별 검출", () => {
  it("[v2-AC-09] 6개 종류(go, pypi, nuget, cargo, pub, maven) 각각 검출 1건과 ecosystem·filePath·version 이 맞다", async () => {
    await entry("go", "github.com/evil/mod", "<v1.5.0");
    await entry("pypi", "evil-pkg");
    await entry("nuget", "evil.nuget", "[1.0,2.0)");
    await entry("cargo", "evil-crate", "<2.0.0");
    await entry("pub", "evil_pub", ">=1.0.0 <2.0.0");
    await entry("maven", "com.evil:lib", "[1.0,2.0)");
    t.github.setRepos([
      { name: "go-svc", files: { "go.mod": goMod("github.com/evil/mod v1.2.0") } },
      { name: "py-svc", files: { "requirements.txt": "evil-pkg==1.0.0\n" } },
      {
        name: "cs-svc",
        files: {
          "src/App.csproj": `<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Evil.NuGet" Version="1.5.0" /></ItemGroup></Project>`,
        },
      },
      {
        name: "rs-svc",
        files: { "Cargo.toml": cargoToml({ "evil-crate": "1" }), "Cargo.lock": cargoLock(["evil-crate", "1.1.0"]) },
      },
      {
        name: "dart-svc",
        files: {
          "pubspec.yaml": "name: app\ndependencies:\n  evil_pub: ^1.0.0\n",
          "pubspec.lock":
            'packages:\n  evil_pub:\n    dependency: "direct main"\n    source: hosted\n    version: "1.4.0"\n',
        },
      },
      {
        name: "android",
        files: { "app/build.gradle": "dependencies {\n  implementation 'com.evil:lib:1.5'\n}\n" },
      },
    ]);

    const scan = await runScan(t);

    expect(scan).toMatchObject({ status: "success", failedRepos: [], newFindingCount: 6 });
    const found = (await allFindings(t))
      .map((item) => ({
        repo: item.repo,
        ecosystem: item.ecosystem,
        filePath: item.filePath,
        packageName: item.packageName,
        version: item.version,
        dependencyType: item.dependencyType,
      }))
      .sort((a, b) => a.repo.localeCompare(b.repo));
    expect(found).toEqual([
      { repo: "android", ecosystem: "maven", filePath: "app/build.gradle", packageName: "com.evil:lib", version: "1.5", dependencyType: "direct" },
      { repo: "cs-svc", ecosystem: "nuget", filePath: "src/App.csproj", packageName: "Evil.NuGet", version: "1.5.0", dependencyType: "direct" },
      { repo: "dart-svc", ecosystem: "pub", filePath: "pubspec.lock", packageName: "evil_pub", version: "1.4.0", dependencyType: "direct" },
      { repo: "go-svc", ecosystem: "go", filePath: "go.mod", packageName: "github.com/evil/mod", version: "v1.2.0", dependencyType: "direct" },
      { repo: "py-svc", ecosystem: "pypi", filePath: "requirements.txt", packageName: "evil-pkg", version: "1.0.0", dependencyType: "direct" },
      { repo: "rs-svc", ecosystem: "cargo", filePath: "Cargo.lock", packageName: "evil-crate", version: "1.1.0", dependencyType: "direct" },
    ]);
  });

  it("[v2-AC-09] 범위 밖의 버전은 검출하지 않는다", async () => {
    await entry("go", "github.com/evil/mod", "<v1.0.0");
    await entry("maven", "com.evil:lib", "[1.0,2.0)");
    t.github.setRepos([
      { name: "go-svc", files: { "go.mod": goMod("github.com/evil/mod v1.0.0") } },
      { name: "android", files: { "build.gradle.kts": 'dependencies { implementation("com.evil:lib:2.0") }\n' } },
    ]);

    const scan = await runScan(t);

    expect(scan).toMatchObject({ status: "success", newFindingCount: 0 });
  });

  it("[v2-AC-11] 이름은 종류의 규칙으로 정규화해서 비교하고 검출의 packageName 은 파일의 실제 이름이다", async () => {
    await entry("pypi", "foo-bar");
    await entry("nuget", "newtonsoft.json", "[12.0,13.0)");
    // 저장할 때 정규화되므로 아래 두 입력도 같은 항목이다.
    const saved = await addEntry(t, { ecosystem: "pypi", name: "Baz_Qux", reason: "x" });
    expect(saved.name).toBe("baz-qux");
    t.github.setRepos([
      { name: "py", files: { "requirements.txt": "Foo_Bar==1.0\nBaz.Qux>=2\n" } },
      { name: "cs", files: { "packages.config": fx.PACKAGES_CONFIG } },
    ]);

    await runScan(t);

    const found = (await allFindings(t)).map((item) => `${item.repo}|${item.packageName}|${item.version}`).sort();
    expect(found).toEqual(["cs|Newtonsoft.Json|12.0.3", "py|Baz.Qux|>=2", "py|Foo_Bar|1.0"]);
  });

  it("[v2-AC-12] go.mod 의 // indirect 는 transitive, 나머지는 direct", async () => {
    await entry("go", "golang.org/x/net");
    await entry("go", "github.com/pkg/errors");
    t.github.setRepos([{ name: "svc", files: { "go.mod": fx.GO_MOD } }]);

    await runScan(t);

    const types = Object.fromEntries((await allFindings(t)).map((item) => [item.packageName, item.dependencyType]));
    expect(types).toEqual({ "golang.org/x/net": "transitive", "github.com/pkg/errors": "direct" });
  });

  it("[v2-AC-13] 검출 목록을 ecosystem 으로 거른다", async () => {
    await entry("go", "github.com/evil/mod");
    await entry("pypi", "evil-pkg");
    await entry("npm", "evil-npm");
    t.github.setRepos([
      {
        name: "mixed",
        files: {
          "go.mod": goMod("github.com/evil/mod v1.0.0"),
          "requirements.txt": "evil-pkg==1.0\n",
          "package.json": pkgJson({ dependencies: { "evil-npm": "1.0.0" } }),
        },
      },
    ]);

    await runScan(t);

    expect((await listFindings(t, { ecosystem: "go" })).items.map((item) => item.packageName)).toEqual([
      "github.com/evil/mod",
    ]);
    expect((await listFindings(t, { ecosystem: "pypi" })).items.map((item) => item.packageName)).toEqual([
      "evil-pkg",
    ]);
    expect((await listFindings(t, { ecosystem: "npm" })).items).toHaveLength(1);
    expect(await allFindings(t)).toHaveLength(3);
  });

  it("[v2-AC-14] package.json 이 없어도 다른 종류의 선언 파일이 있으면 검사된다 (건너뜀 아님). 선언 파일이 하나도 없는 repo 만 건너뜀", async () => {
    await entry("go", "github.com/evil/mod");
    t.github.setRepos([
      { name: "go-clean", files: { "go.mod": goMod("github.com/ok/mod v1.0.0") } },
      { name: "go-evil", files: { "go.mod": goMod("github.com/evil/mod v1.0.0") } },
      { name: "docs", files: { "README.md": "# docs\n" } },
    ]);

    const scan = await runScan(t);

    const rows = await repoRows(scan.id);
    expect(rowOf(rows, "go-clean")).toMatchObject({ status: "passed", fileCount: 1 });
    expect(rowOf(rows, "go-evil")).toMatchObject({ status: "issue", fileCount: 1 });
    expect(rowOf(rows, "docs")).toMatchObject({ status: "skipped", fileCount: 0 });
    expect(scan.repoStats).toMatchObject({ passed: 1, issue: 1, skipped: 1 });
  });

  it("[v2-AC-14] 다른 종류의 선언 파일이 모두 사라진 repo 의 활성 검출은 resolve 된다", async () => {
    await entry("go", "github.com/evil/mod");
    t.github.setRepos([{ name: "svc", files: { "go.mod": goMod("github.com/evil/mod v1.0.0") } }]);
    await runScan(t);
    expect((await allFindings(t)).map((item) => item.status)).toEqual(["open"]);

    t.github.setFiles("svc", { "README.md": "go.mod 를 지웠다\n" });
    t.clock.advance(60_000);
    await runScan(t);

    expect((await allFindings(t)).map((item) => item.status)).toEqual(["resolved"]);
  });
});

describe("오류와 예외", () => {
  it("[v2-EC-06] 깨진 Cargo.lock 은 그 repo 만 실패이고 스캔은 partial, 기존 검출은 유지된다", async () => {
    await entry("cargo", "evil-crate");
    await entry("go", "github.com/evil/mod");
    t.github.setRepos([
      {
        name: "rs",
        files: { "Cargo.toml": cargoToml({ "evil-crate": "1" }), "Cargo.lock": cargoLock(["evil-crate", "1.1.0"]) },
      },
      { name: "go-svc", files: { "go.mod": goMod("github.com/evil/mod v1.0.0") } },
    ]);
    await runScan(t);
    expect(await allFindings(t)).toHaveLength(2);

    t.github.setFiles("rs", { "Cargo.toml": cargoToml({ "evil-crate": "1" }), "Cargo.lock": '[[package]\nname = "evil-crate"' });
    t.clock.advance(60_000);
    const scan = await runScan(t);

    expect(scan.status).toBe("partial");
    expect(scan.failedRepos).toHaveLength(1);
    expect(scan.failedRepos[0]).toMatchObject({ repo: "rs" });
    expect(scan.failedRepos[0]?.error).toContain("Cargo.lock");
    expect((await allFindings(t)).map((item) => item.status)).toEqual(["open", "open"]);
    expect(rowOf(await repoRows(scan.id), "rs")).toMatchObject({ status: "failed" });
  });

  it("[v2-EC-06] 빈 go.mod 와 형식 표지가 없는 pubspec.lock 도 그 repo 의 실패다", async () => {
    await entry("go", "github.com/evil/mod");
    await entry("pub", "evil_pub");
    t.github.setRepos([
      { name: "empty-go", files: { "go.mod": "" } },
      { name: "bad-lock", files: { "pubspec.yaml": "name: a\n", "pubspec.lock": "hello: world\n" } },
    ]);

    const scan = await runScan(t);

    expect(scan.status).toBe("partial");
    expect(scan.failedRepos.map((failed) => failed.repo).sort()).toEqual(["bad-lock", "empty-go"]);
  });

  it("[v2-EC-07] build.gradle 의 읽을 수 없는 선언($ 변수, 버전 없음)은 그 선언만 건너뛰고 repo 는 실패하지 않는다", async () => {
    await entry("maven", "com.evil:lib");
    await entry("maven", "com.example:lib");
    await entry("maven", "com.example:noversion");
    t.github.setRepos([
      {
        name: "android",
        files: {
          "build.gradle":
            'dependencies {\n  implementation "com.example:lib:$libVersion"\n  implementation "com.example:noversion"\n  implementation "com.evil:lib:1.0"\n}\n',
        },
      },
    ]);

    const scan = await runScan(t);

    expect(scan).toMatchObject({ status: "success", failedRepos: [], newFindingCount: 1 });
    expect((await allFindings(t)).map((item) => item.packageName)).toEqual(["com.evil:lib"]);
  });

  it("[v2-EC-08] 범위 spec 만 있는 선언은 범위가 있는 항목과 일치하지 않고, 범위가 null 인 항목에는 version = spec 문자열로 일치한다", async () => {
    await entry("pypi", "ranged-pkg", "<1.0");
    await entry("pypi", "any-pkg");
    await entry("cargo", "ranged-crate", "<1.0.0");
    await entry("cargo", "any-crate");
    t.github.setRepos([
      { name: "py", files: { "requirements.txt": "ranged-pkg>=0.5\nany-pkg>=2.0\n" } },
      { name: "rs", files: { "Cargo.toml": cargoToml({ "ranged-crate": "0.5", "any-crate": "1.2" }) } },
    ]);

    await runScan(t);

    const found = (await allFindings(t)).map((item) => `${item.packageName}|${item.version}|${item.filePath}`).sort();
    expect(found).toEqual(["any-crate|1.2|Cargo.toml", "any-pkg|>=2.0|requirements.txt"]);
  });

  it("[v2-EC-08] 선언 파일의 고정 버전(==, go.mod, Gradle)은 정확한 버전으로 범위와 비교한다", async () => {
    await entry("pypi", "pinned", "<1.0");
    await entry("pypi", "pinned-ok", "<1.0");
    t.github.setRepos([{ name: "py", files: { "requirements.txt": "pinned==0.9\npinned-ok==1.1\n" } }]);

    await runScan(t);

    expect((await allFindings(t)).map((item) => `${item.packageName}|${item.version}`)).toEqual(["pinned|0.9"]);
  });

  it("[v2-EC-09] 읽을 수 없는 버전은 불일치이고 예외도 repo 실패도 없다", async () => {
    await entry("cargo", "evil-crate", "<2.0.0");
    await entry("nuget", "evil.nuget", "[1.0,2.0)");
    await entry("go", "github.com/evil/mod", "<v2.0.0");
    t.github.setRepos([
      {
        name: "rs",
        files: { "Cargo.toml": cargoToml({}), "Cargo.lock": cargoLock(["evil-crate", "not-a-version"]) },
      },
      {
        name: "cs",
        files: {
          "a.csproj": `<Project><ItemGroup><PackageReference Include="Evil.Nuget" Version="$(EvilVersion)" /></ItemGroup></Project>`,
        },
      },
      { name: "go", files: { "go.mod": goMod("github.com/evil/mod garbage") } },
    ]);

    const scan = await runScan(t);

    expect(scan).toMatchObject({ status: "success", failedRepos: [], newFindingCount: 0 });
  });

  it("[v2-EC-02][v2-EC-03] 종류가 다르면 같은 이름·범위의 항목이 공존하고, 정규화한 이름이 같으면 중복이다", async () => {
    await entry("npm", "same-name");
    await entry("pypi", "same-name");
    await entry("cargo", "same-name");
    const dup = await t.request("POST", "/api/blacklist", {
      ecosystem: "pypi",
      name: "Same_Name",
      reason: "정규화하면 같은 이름",
    });
    expectApiError(dup, 409, "DUPLICATE_ENTRY");
  });
});

describe("활성 항목이 있는 종류의 파일만 읽는다", () => {
  it("[ME-13][v2-AC-14] 블랙리스트에 npm 항목만 있으면 go.mod 등 다른 종류의 파일 내용을 받지 않고 그 repo 는 통과다", async () => {
    await entry("npm", "evil-pkg");
    t.github.setRepos([
      {
        name: "go-svc",
        files: { "go.mod": goMod("github.com/evil/mod v1.0.0"), "requirements.txt": "evil-pkg==1.0\n" },
      },
    ]);

    const scan = await runScan(t);

    expect(t.github.callsOf("getTree", "go-svc")).toHaveLength(1);
    expect(t.github.callsOf("getFile", "go-svc")).toHaveLength(0);
    const row = rowOf(await repoRows(scan.id), "go-svc");
    expect(row).toMatchObject({ status: "passed", fileCount: 0 });
    expect(await allFindings(t)).toEqual([]);
  });

  it("[ME-13] 항목이 있는 종류의 파일만 받는다 (go 항목만 있으면 requirements.txt·Cargo.lock 은 받지 않는다)", async () => {
    await entry("go", "github.com/evil/mod");
    t.github.setRepos([
      {
        name: "mixed",
        files: {
          "go.mod": goMod("github.com/evil/mod v1.0.0"),
          "requirements.txt": "x==1\n",
          "Cargo.lock": "깨진 내용",
        },
      },
    ]);

    const scan = await runScan(t);

    expect(scan).toMatchObject({ status: "success", newFindingCount: 1 });
    expect(t.github.callsOf("getFile", "mixed")).toHaveLength(1);
    expect(rowOf(await repoRows(scan.id), "mixed")).toMatchObject({ status: "issue", fileCount: 1 });
  });

  it("[ME-13] 꺼졌거나 만료된 항목의 종류는 활성이 아니라서 그 종류의 파일을 받지 않는다", async () => {
    const off = await entry("go", "github.com/evil/mod");
    await putEntry(t, off.id, { name: "github.com/evil/mod", versionRange: null, reason: "x", enabled: false });
    await addEntry(t, { ecosystem: "pypi", name: "old", reason: "x", expiresAt: "2026-11-13" });
    t.clock.advance(3 * 24 * 60 * 60 * 1000);
    t.github.setRepos([{ name: "svc", files: { "go.mod": goMod("github.com/evil/mod v1.0.0"), "requirements.txt": "old==1\n" } }]);

    await runScan(t);

    expect(t.github.callsOf("getFile", "svc")).toHaveLength(0);
  });
});

describe("제외 폴더", () => {
  it("[ME-11] vendor·.venv·node_modules 같은 폴더 아래의 파일은 읽지 않고, 그 파일뿐인 repo 는 건너뜀이다", async () => {
    await entry("go", "github.com/evil/mod");
    await entry("pypi", "evil-pkg");
    t.github.setRepos([
      {
        name: "vendored",
        files: {
          "vendor/github.com/x/go.mod": goMod("github.com/evil/mod v1.0.0"),
          ".venv/lib/site-packages/requirements.txt": "evil-pkg==1.0\n",
          "web/node_modules/a/go.mod": goMod("github.com/evil/mod v1.0.0"),
          "app/.dart_tool/x/pubspec.yaml": "name: a\n",
          "Pods/Foo/go.mod": goMod("github.com/evil/mod v1.0.0"),
        },
      },
      {
        name: "with-real",
        files: {
          "vendor/github.com/x/go.mod": goMod("github.com/evil/mod v1.0.0"),
          "go.mod": goMod("github.com/ok/mod v1.0.0"),
        },
      },
    ]);

    const scan = await runScan(t);

    expect(scan).toMatchObject({ status: "success", newFindingCount: 0 });
    const rows = await repoRows(scan.id);
    expect(rowOf(rows, "vendored")).toMatchObject({ status: "skipped", fileCount: 0 });
    expect(rowOf(rows, "with-real")).toMatchObject({ status: "passed", fileCount: 1 });
  });
});

describe("lock 의 담당 범위와 direct/transitive", () => {
  it("[ME-12][D-23] lock 은 같은 폴더와 lock 이 없는 하위 폴더를 담당하고, 하위 폴더에 같은 종류의 lock 이 있으면 그 lock 이 담당한다", async () => {
    await entry("cargo", "dep-a");
    await entry("cargo", "dep-t");
    await entry("cargo", "dep-b");
    await entry("cargo", "ghost");
    t.github.setRepos([
      {
        name: "ws",
        files: {
          "Cargo.toml": cargoToml({}),
          "Cargo.lock": cargoLock(["dep-a", "1.0.0"], ["dep-t", "1.0.0"], ["dep-b", "1.0.0"]),
          // lock 이 없는 하위 폴더 → 루트 lock 이 담당. dep-a 는 직접 의존성, ghost 는 lock 에 없다.
          "crates/a/Cargo.toml": cargoToml({ "dep-a": "1", ghost: "=1.0.0" }),
          // 자기 lock 이 있는 하위 폴더 → 루트 lock 은 담당하지 않는다. dep-b 는 루트 lock 기준으로 transitive.
          "crates/b/Cargo.toml": cargoToml({ "dep-b": "1" }),
          "crates/b/Cargo.lock": cargoLock(["dep-b", "1.0.0"]),
        },
      },
    ]);

    await runScan(t);

    const found = (await allFindings(t))
      .map((item) => `${item.filePath}|${item.packageName}|${item.version}|${item.dependencyType}`)
      .sort();
    expect(found).toEqual([
      "Cargo.lock|dep-a|1.0.0|direct",
      "Cargo.lock|dep-b|1.0.0|transitive",
      "Cargo.lock|dep-t|1.0.0|transitive",
      "crates/a/Cargo.toml|ghost|1.0.0|direct",
      "crates/b/Cargo.lock|dep-b|1.0.0|direct",
    ]);
  });

  it("[ME-12] lock 이 담당하는 선언 파일의 의존성은 lock 에 있으면 선언 파일에서는 검출하지 않는다 (lock 의 정확한 버전이 우선)", async () => {
    await entry("cargo", "evil-crate", "<1.0.0");
    await entry("pypi", "evil-pkg", "<1.0");
    t.github.setRepos([
      { name: "rs", files: { "Cargo.toml": cargoToml({ "evil-crate": "=0.5.0" }), "Cargo.lock": cargoLock(["evil-crate", "1.2.0"]) } },
      {
        name: "py",
        files: {
          "requirements.txt": "Evil_Pkg==0.5\n",
          "uv.lock":
            'version = 1\n\n[[package]]\nname = "evil-pkg"\nversion = "1.5.0"\nsource = { registry = "https://pypi.org/simple" }\n',
        },
      },
    ]);

    await runScan(t);

    expect(await allFindings(t)).toEqual([]);
  });

  it("[ME-12] pypi: lock 의 패키지는 담당 선언 파일에 정규화한 이름이 있으면 direct, 없으면 transitive", async () => {
    await entry("pypi", "requests");
    await entry("pypi", "urllib3");
    t.github.setRepos([{ name: "py", files: { "requirements.txt": "Requests>=2\n", "uv.lock": fx.UV_LOCK } }]);

    await runScan(t);

    const types = Object.fromEntries((await allFindings(t)).map((item) => [item.packageName, item.dependencyType]));
    expect(types).toEqual({ requests: "direct", urllib3: "transitive" });
  });

  it("[ME-12] lock 이 직접 여부를 알려 주면 그 값을 쓴다 (packages.lock.json 의 Direct/Transitive)", async () => {
    await entry("nuget", "newtonsoft.json");
    await entry("nuget", "system.memory");
    t.github.setRepos([{ name: "cs", files: { "src/App.csproj": '<Project Sdk="Microsoft.NET.Sdk" />', "src/packages.lock.json": fx.PACKAGES_LOCK_JSON } }]);

    await runScan(t);

    const found = (await allFindings(t)).map((item) => `${item.packageName}|${item.version}|${item.dependencyType}|${item.filePath}`).sort();
    expect(found).toEqual([
      "Newtonsoft.Json|13.0.3|direct|src/packages.lock.json",
      "System.Memory|4.5.5|transitive|src/packages.lock.json",
    ]);
  });

  it("[ME-12] 같은 종류의 파일 읽기 결과는 fileCount 에 읽은 파일 수만 센다", async () => {
    await entry("go", "github.com/evil/mod");
    t.github.setRepos([
      {
        name: "svc",
        files: {
          "go.mod": goMod("github.com/evil/mod v1.0.0"),
          "tools/go.mod": goMod("github.com/ok/mod v1.0.0"),
          "requirements.txt": "x==1\n",
        },
      },
    ]);

    const scan = await runScan(t);

    expect(rowOf(await repoRows(scan.id), "svc")).toMatchObject({ fileCount: 2, status: "issue" });
  });
});

describe("npm 과 다른 종류가 함께 있는 repo", () => {
  it("[ME-12] package.json 의 npm 검출과 다른 종류의 검출이 같은 repo 에서 함께 나온다", async () => {
    await entry("npm", "evil-npm");
    await entry("go", "github.com/evil/mod");
    t.github.setRepos([
      {
        name: "poly",
        files: {
          "package.json": pkgJson({ dependencies: { "evil-npm": "1.0.0" } }),
          "server/go.mod": goMod("github.com/evil/mod v1.0.0"),
        },
      },
    ]);

    const scan = await runScan(t);

    expect(scan.newFindingCount).toBe(2);
    expect(rowOf(await repoRows(scan.id), "poly")).toMatchObject({ status: "issue", fileCount: 2 });
  });
});
