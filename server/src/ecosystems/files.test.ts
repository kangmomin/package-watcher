import { describe, expect, it } from "vitest";
import { classifyFile, isExcludedPath } from "./index.ts";

describe("파일 판정", () => {
  it("[ME-11] 종류별 선언 파일과 lock 파일을 경로로 판정한다", () => {
    const cases: [string, ReturnType<typeof classifyFile>][] = [
      ["go.mod", { ecosystem: "go", role: "manifest" }],
      ["svc/api/go.mod", { ecosystem: "go", role: "manifest" }],
      ["go.sum", { ecosystem: "go", role: "lock" }],
      ["pyproject.toml", { ecosystem: "pypi", role: "manifest" }],
      ["requirements.txt", { ecosystem: "pypi", role: "manifest" }],
      ["req/requirements-dev.txt", { ecosystem: "pypi", role: "manifest" }],
      ["requirements_test.txt", { ecosystem: "pypi", role: "manifest" }],
      ["requirements/base.txt", null],
      ["uv.lock", { ecosystem: "pypi", role: "lock" }],
      ["poetry.lock", { ecosystem: "pypi", role: "lock" }],
      ["src/App/App.csproj", { ecosystem: "nuget", role: "manifest" }],
      ["App.fsproj", null],
      ["packages.config", { ecosystem: "nuget", role: "manifest" }],
      ["Directory.Packages.props", { ecosystem: "nuget", role: "manifest" }],
      ["Directory.Build.props", null],
      ["packages.lock.json", { ecosystem: "nuget", role: "lock" }],
      ["Cargo.toml", { ecosystem: "cargo", role: "manifest" }],
      ["crates/a/Cargo.lock", { ecosystem: "cargo", role: "lock" }],
      ["pubspec.yaml", { ecosystem: "pub", role: "manifest" }],
      ["pubspec.lock", { ecosystem: "pub", role: "lock" }],
      ["gradle/libs.versions.toml", { ecosystem: "maven", role: "manifest" }],
      ["app/gradle/libs.versions.toml", { ecosystem: "maven", role: "manifest" }],
      ["libs.versions.toml", null],
      ["build.gradle", { ecosystem: "maven", role: "manifest" }],
      ["app/build.gradle.kts", { ecosystem: "maven", role: "manifest" }],
      ["settings.gradle", null],
      ["pom.xml", { ecosystem: "maven", role: "manifest" }],
      ["package.json", null],
      ["README.md", null],
    ];
    for (const [path, expected] of cases) expect(classifyFile(path), path).toEqual(expected);
  });

  it("[ME-11] 제외 폴더: node_modules, vendor, .venv, venv, site-packages, .dart_tool, Pods 아래는 읽지 않는다", () => {
    for (const dir of ["node_modules", "vendor", ".venv", "venv", "site-packages", ".dart_tool", "Pods"]) {
      expect(isExcludedPath(`${dir}/x/go.mod`), dir).toBe(true);
      expect(isExcludedPath(`app/${dir}/x/go.mod`), dir).toBe(true);
    }
    expect(isExcludedPath("go.mod")).toBe(false);
    expect(isExcludedPath("vendors/go.mod")).toBe(false);
    expect(isExcludedPath("src/venvs/go.mod")).toBe(false);
  });
});
