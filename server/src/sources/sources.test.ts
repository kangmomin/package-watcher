import { describe, expect, it } from "vitest";
import { extractSource, sourceKindOf } from "./index.ts";

const keys = (kind: Parameters<typeof extractSource>[0], path: string, content: string): string[] =>
  extractSource(kind, path, content).commands.map((cmd) => `${cmd.ecosystem}:${cmd.name}@${cmd.version}`);

describe("보조 파일 판정", () => {
  it("[SA-40] workflow: .github/workflows 직속의 yml/yaml", () => {
    expect(sourceKindOf(".github/workflows/ci.yml")).toBe("workflow");
    expect(sourceKindOf(".github/workflows/ci.yaml")).toBe("workflow");
    expect(sourceKindOf(".github/workflows/sub/ci.yml")).toBeNull();
    expect(sourceKindOf("x/.github/workflows/ci.yml")).toBeNull();
    expect(sourceKindOf(".github/workflows/readme.md")).toBeNull();
  });

  it("[SA-41] dockerfile: Dockerfile, Dockerfile.*, *.Dockerfile, Containerfile (대소문자 무시)", () => {
    for (const path of [
      "Dockerfile",
      "a/b/Dockerfile.dev",
      "app.Dockerfile",
      "Containerfile",
      "x/dockerfile",
      "x/DOCKERFILE.prod",
    ]) {
      expect(sourceKindOf(path), path).toBe("dockerfile");
    }
    for (const path of ["Dockerfiles", "docker/readme.md", "Dockerfile-dev"]) {
      expect(sourceKindOf(path), path).toBeNull();
    }
  });

  it("[SA-42] compose: docker-compose*.yml|yaml, compose*.yml|yaml", () => {
    for (const path of ["docker-compose.yml", "a/docker-compose.prod.yaml", "compose.yml", "compose.override.yaml"]) {
      expect(sourceKindOf(path), path).toBe("compose");
    }
    expect(sourceKindOf("composer.json")).toBeNull();
  });

  it("[SA-43] mcp: .mcp.json, mcp.json, .cursor/mcp.json, .vscode/mcp.json", () => {
    for (const path of [".mcp.json", "mcp.json", "a/.mcp.json", "a/mcp.json", ".cursor/mcp.json", "a/.vscode/mcp.json"]) {
      expect(sourceKindOf(path), path).toBe("mcp");
    }
    expect(sourceKindOf("a/other.json")).toBeNull();
  });

  it("[SA-44] 제외 폴더와 node_modules 안은 보조 파일이 아니다", () => {
    expect(sourceKindOf("node_modules/x/Dockerfile")).toBeNull();
    expect(sourceKindOf("vendor/x/.mcp.json")).toBeNull();
    expect(sourceKindOf("a/node_modules/.github/workflows/ci.yml")).toBeNull();
  });
});

describe("보조 파일 추출", () => {
  it("[SA-50] workflow: 모든 job 의 steps[].run 에서 추출하고 YAML 이 깨지면 throw", () => {
    const yml = `
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
      - run: npx -y foo@1.0.0
      - run: |
          pip install bar==2.0
          npm ci
  b:
    steps:
      - run: pnpm dlx baz
`;
    expect(keys("workflow", ".github/workflows/ci.yml", yml)).toEqual([
      "npm:foo@1.0.0",
      "pypi:bar@2.0",
      "npm:baz@",
    ]);
    expect(extractSource("workflow", ".github/workflows/ci.yml", yml)).toMatchObject({
      path: ".github/workflows/ci.yml",
      kind: "workflow",
    });
    expect(() => extractSource("workflow", "w.yml", "a: [1,\n")).toThrow();
    expect(keys("workflow", "w.yml", "name: x\n")).toEqual([]);
  });

  it("[SA-51] dockerfile: RUN 의 shell 형식, 줄 이어 쓰기, JSON 배열, heredoc 을 읽고 주석은 제외", () => {
    const text = [
      "FROM node:20",
      "# RUN npx commented",
      "RUN npm install -g \\",
      "    a@1.0.0 \\",
      "    b",
      'RUN ["npx", "-y", "c@2.0.0"]',
      "RUN <<EOF",
      "pip install d==3.0",
      "EOF",
      "COPY . .",
      "run uvx e",
    ].join("\n");
    expect(keys("dockerfile", "Dockerfile", text)).toEqual([
      "npm:a@1.0.0",
      "npm:b@",
      "npm:c@2.0.0",
      "pypi:d@3.0",
      "pypi:e@",
    ]);
  });

  it("[SA-52] mcp: mcpServers/servers 의 command + args, Windows cmd /c 형태, JSONC", () => {
    const json = `{
      // 주석
      "mcpServers": {
        "a": { "command": "npx", "args": ["-y", "@playwright/mcp@latest"], },
        "b": { "command": "cmd", "args": ["/c", "npx", "-y", "foo@1.0.0"] },
        "c": { "command": "uvx", "args": ["mcp-server-git==0.5.0"] },
        "d": { "url": "https://x" }
      },
      "servers": { "e": { "command": "node", "args": ["server.js"] } }
    }`;
    expect(keys("mcp", ".mcp.json", json)).toEqual([
      "npm:@playwright/mcp@",
      "npm:foo@1.0.0",
      "pypi:mcp-server-git@0.5.0",
    ]);
    expect(keys("mcp", ".mcp.json", "{}")).toEqual([]);
    expect(() => extractSource("mcp", ".mcp.json", "{ not json")).toThrow();
  });

  it("[SA-53] compose 는 묶음 A 에서 commands 가 비어 있다", () => {
    expect(extractSource("compose", "compose.yml", "services:\n  a:\n    image: x\n").commands).toEqual([]);
  });
});
