import { describe, expect, it } from "vitest";
import { extractCommandPackages, isRunCommand } from "./commands.ts";
import { hasCurlPipeShell } from "./curlPipe.ts";
import { extractSource } from "./index.ts";

describe("curl | sh 판정", () => {
  it.each([
    "curl -fsSL https://x.io/install.sh | sh",
    "curl -fsSL https://x.io/i.sh | sudo bash",
    "wget -qO- https://x.io/i.sh | bash -s -- --yes",
    "curl https://x.io | sudo -E /bin/zsh",
    "echo start && curl -s https://x.io | sh",
    "bash <(curl -s https://x.io/i.sh)",
    "sh <(wget -qO- https://x.io/i.sh)",
    'sh -c "$(curl -fsSL https://x.io/i.sh)"',
    "bash -c \"$(wget -qO- https://x.io/i.sh)\"",
    "curl -s https://x.io \\\n  | sh",
  ])("[SD-20] 잡는다: %s", (text) => {
    expect(hasCurlPipeShell(text)).toBe(true);
  });

  it.each([
    "curl -fsSL https://x.io/a.tar.gz -o a.tar.gz",
    "curl https://x.io | jq .name",
    "curl https://x.io | sha256sum",
    "cat a.sh | sh",
    "echo curl || sh",
    "curl -s https://x.io > out.sh && sh out.sh",
    "bash <(cat file)",
    "sh -c 'echo hi'",
    "",
  ])("[SD-21] 잡지 않는다: %s", (text) => {
    expect(hasCurlPipeShell(text)).toBe(false);
  });

  it("[SD-22] 아주 긴 줄과 반복 입력도 빠르게 끝난다", () => {
    const started = Date.now();
    expect(hasCurlPipeShell("curl " + "| ".repeat(200_000))).toBe(false);
    expect(hasCurlPipeShell("sh -c \"$(".repeat(100_000))).toBe(false);
    expect(hasCurlPipeShell("a ".repeat(500_000) + "<(".repeat(1000))).toBe(false);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe("보조 파일의 policy 사실", () => {
  it("[SD-23] workflow 의 run, Dockerfile 의 RUN, action.yml 의 run 에서 curl | sh 를 찾는다", () => {
    const wf = "jobs:\n  a:\n    permissions: {}\n    steps:\n      - run: curl -fsSL https://x.io/i.sh | sh\n";
    const action = "runs:\n  using: composite\n  steps:\n    - run: wget -qO- https://x.io | bash\n      shell: bash\n";
    const dockerfile = "FROM node:20\nRUN apt-get update \\\n && curl -fsSL https://x.io/i.sh | bash\n";
    const heredoc = "FROM node:20\nRUN <<EOF\ncurl https://x.io | sh\nEOF\n";
    const clean = "FROM node:20\nRUN curl -fsSL https://x.io/a.tgz -o a.tgz\n";

    expect(extractSource("workflow", "w.yml", wf).hasCurlPipeShell).toBe(true);
    expect(extractSource("action", "action.yml", action).hasCurlPipeShell).toBe(true);
    expect(extractSource("dockerfile", "Dockerfile", dockerfile).hasCurlPipeShell).toBe(true);
    expect(extractSource("dockerfile", "Dockerfile", heredoc).hasCurlPipeShell).toBe(true);
    expect(extractSource("dockerfile", "Dockerfile", clean).hasCurlPipeShell).toBe(false);
    expect(extractSource("compose", "compose.yml", "services: {}\n").hasCurlPipeShell).toBe(false);
  });

  it("[SD-24] workflow 의 permissions: 최상위가 있거나 모든 job 에 있으면 통과, 아니면 missing", () => {
    const missing = (yaml: string) => extractSource("workflow", ".github/workflows/a.yml", yaml).missingPermissions;

    expect(missing("on: push\njobs:\n  a:\n    runs-on: x\n    steps: []\n")).toBe(true);
    expect(missing("on: push\npermissions: read-all\njobs:\n  a:\n    steps: []\n")).toBe(false);
    expect(missing("on: push\npermissions: {}\njobs:\n  a:\n    steps: []\n")).toBe(false);
    expect(
      missing("jobs:\n  a:\n    permissions: { contents: read }\n  b:\n    permissions: { contents: write }\n"),
    ).toBe(false);
    expect(missing("jobs:\n  a:\n    permissions: { contents: read }\n  b:\n    steps: []\n")).toBe(true);
    expect(missing("jobs:\n  a:\n    uses: o/r/.github/workflows/x.yml@v1\n")).toBe(true);
    // 판정할 workflow 가 아니다
    expect(missing("")).toBe(false);
    expect(missing("name: x\n")).toBe(false);
    expect(extractSource("action", "action.yml", "runs:\n  using: node20\n").missingPermissions).toBe(false);
  });
});

describe("받아서 바로 실행하는 명령의 표시(run)", () => {
  const runOf = (text: string) => extractCommandPackages(text).map((pkg) => `${pkg.name}:${isRunCommand(pkg)}`);

  it("[SD-25] npx·dlx·exec·uvx·pipx run 은 run, install·add 는 아니다", () => {
    expect(runOf("npx foo")).toEqual(["foo:true"]);
    expect(runOf("pnpx foo")).toEqual(["foo:true"]);
    expect(runOf("bunx foo")).toEqual(["foo:true"]);
    expect(runOf("bun x foo")).toEqual(["foo:true"]);
    expect(runOf("pnpm dlx foo")).toEqual(["foo:true"]);
    expect(runOf("yarn dlx foo")).toEqual(["foo:true"]);
    expect(runOf("npm exec foo")).toEqual(["foo:true"]);
    expect(runOf("uvx ruff")).toEqual(["ruff:true"]);
    expect(runOf("uv tool run black")).toEqual(["black:true"]);
    expect(runOf("pipx run cowsay")).toEqual(["cowsay:true"]);

    expect(runOf("npm install foo")).toEqual(["foo:false"]);
    expect(runOf("pnpm add foo")).toEqual(["foo:false"]);
    expect(runOf("yarn add foo")).toEqual(["foo:false"]);
    expect(runOf("pip install foo")).toEqual(["foo:false"]);
    expect(runOf("uv tool install httpie")).toEqual(["httpie:false"]);
    expect(runOf("pipx install poetry")).toEqual(["poetry:false"]);
  });
});
