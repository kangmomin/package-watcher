import { describe, expect, it } from "vitest";
import { extractCommandPackages } from "./commands.ts";
import { extractSource } from "./index.ts";

const keys = (text: string): string[] =>
  extractCommandPackages(text).map((pkg) => `${pkg.ecosystem}:${pkg.name}@${pkg.version}`);
const sourceKeys = (kind: Parameters<typeof extractSource>[0], path: string, content: string): string[] =>
  extractSource(kind, path, content).commands.map((cmd) => `${cmd.ecosystem}:${cmd.name}@${cmd.version}`);

describe("리뷰 반영 - 상한과 성능", () => {
  it("[SA-90] 개행이 든 긴 토큰이나 256자를 넘는 토큰은 패키지가 아니고 빨리 끝난다", () => {
    const started = Date.now();
    expect(keys(`pip install '${"a\n".repeat(20000)}'`)).toEqual([]);
    expect(keys(`npx ${"a".repeat(300)}`)).toEqual([]);
    expect(keys(`pip install ${"a".repeat(300)}`)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("[SA-91] Dockerfile 의 아주 긴 줄 이어 쓰기도 빨리 읽는다", () => {
    const lines = ["RUN npm i \\", ...Array.from({ length: 30000 }, (_, i) => `  pkg${i} \\`), "  last"];
    const started = Date.now();
    const found = extractSource("dockerfile", "Dockerfile", lines.join("\n")).commands;
    expect(found.length).toBeGreaterThan(0);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe("리뷰 반영 - 셸 구문", () => {
  it("[SA-92] 토큰 시작의 # 부터 줄 끝까지는 주석이다", () => {
    expect(keys("# install project's deps\nnpm i evil")).toEqual(["npm:evil@"]);
    expect(keys("npm install express # the web framework")).toEqual(["npm:express@"]);
    expect(keys("pip install pkg#frag")).toEqual([]);
  });

  it("[SA-93] 버전 부분에만 $ 가 있으면 이름은 살리고 버전은 빈 문자열", () => {
    expect(keys("npm i evil@$V")).toEqual(["npm:evil@"]);
    expect(keys("npx evil@${{ matrix.v }}")).toEqual(["npm:evil@"]);
    expect(keys("pip install foo==$V")).toEqual(["pypi:foo@"]);
    expect(keys("npm i $NAME@1.0.0")).toEqual([]);
  });

  it("[SA-94] 리다이렉션: 단독 연산자만 다음 토큰을 건너뛴다", () => {
    expect(keys("pip install a > out.log b")).toEqual(["pypi:a@", "pypi:b@"]);
    expect(keys("pip install a 2>&1 b")).toEqual(["pypi:a@", "pypi:b@"]);
    expect(keys("pip install a >&2 b")).toEqual(["pypi:a@", "pypi:b@"]);
    expect(keys("pip install a >file b")).toEqual(["pypi:a@", "pypi:b@"]);
    expect(keys("pip install a &> log b")).toEqual(["pypi:a@", "pypi:b@"]);
  });

  it("[SA-95] 이름에 * 나 ? 가 있거나 숫자·true/false 뿐인 토큰은 패키지가 아니다", () => {
    expect(keys("npm i 'foo*' 'b?r' 123 true false ok")).toEqual(["npm:ok@"]);
    expect(keys("pip install 'foo*' 'b?r' 42 false ok")).toEqual(["pypi:ok@"]);
  });

  it("[SA-96] bash|sh|zsh -c 의 내부 명령, ( ) { } 구분, then/do/else/!/exec 접두", () => {
    expect(keys("bash -c 'npm i foo'")).toEqual(["npm:foo@"]);
    expect(keys('sh -ec "npx bar@1.0.0"')).toEqual(["npm:bar@1.0.0"]);
    expect(keys("(cd x && npm i foo)")).toEqual(["npm:foo@"]);
    expect(keys("{ npm i foo; }")).toEqual(["npm:foo@"]);
    expect(keys("if true; then npm i a; else npm i b; fi")).toEqual(["npm:a@", "npm:b@"]);
    expect(keys("for x in 1; do npx foo; done")).toEqual(["npm:foo@"]);
    expect(keys("! npm i foo")).toEqual(["npm:foo@"]);
    expect(keys("exec npx foo")).toEqual(["npm:foo@"]);
  });

  it("[SA-97] sudo 의 값 플래그를 건너뛴다", () => {
    expect(keys("sudo -u deploy -E npm i -g foo")).toEqual(["npm:foo@"]);
    expect(keys("sudo -g staff pip install bar")).toEqual(["pypi:bar@"]);
  });
});

describe("리뷰 반영 - 도구", () => {
  it("[SA-98] npm exec, bun x, npm install-test|it", () => {
    expect(keys("npm exec foo@1.0.0")).toEqual(["npm:foo@1.0.0"]);
    expect(keys("npm exec --package=a -- b")).toEqual(["npm:a@"]);
    expect(keys("bun x foo")).toEqual(["npm:foo@"]);
    expect(keys("npm install-test foo")).toEqual(["npm:foo@"]);
    expect(keys("npm it foo")).toEqual(["npm:foo@"]);
  });

  it("[SA-99] 도구와 하위 명령 사이의 전역 플래그, yarn workspace", () => {
    expect(keys("npm --prefix x install foo")).toEqual(["npm:foo@"]);
    expect(keys("pnpm --filter web add foo")).toEqual(["npm:foo@"]);
    expect(keys("pnpm -C app add foo")).toEqual(["npm:foo@"]);
    expect(keys("yarn workspace web add foo@1.2.3")).toEqual(["npm:foo@1.2.3"]);
  });

  it("[SA-100] uv add, poetry add, pipenv install", () => {
    expect(keys("uv add requests==2.0.0")).toEqual(["pypi:requests@2.0.0"]);
    expect(keys("uv add --dev pytest")).toEqual(["pypi:pytest@"]);
    expect(keys("poetry add flask@2.0.0")).toEqual(["pypi:flask@2.0.0"]);
    expect(keys("poetry add --group dev black")).toEqual(["pypi:black@"]);
    expect(keys("pipenv install django")).toEqual(["pypi:django@"]);
    expect(keys("pipenv install")).toEqual([]);
  });

  it("[SA-101] 값이 있는 플래그의 값은 패키지가 아니다", () => {
    expect(keys("npm i --fetch-retries 5 --audit-level high --include dev foo")).toEqual(["npm:foo@"]);
    expect(keys("npm i --lockfile-version 3 --fetch-timeout 100 foo")).toEqual(["npm:foo@"]);
    expect(keys("pip install --progress-bar off --retries 3 --timeout 9 foo")).toEqual(["pypi:foo@"]);
  });
});

describe("리뷰 반영 - 보조 파일", () => {
  it("[SA-102] workflow·Dockerfile 에서 -c 의 내부 명령을 읽고 ONBUILD RUN 도 읽는다", () => {
    const yml = "jobs:\n  a:\n    steps:\n      - run: bash -c 'npm i foo'\n";
    expect(sourceKeys("workflow", "w.yml", yml)).toEqual(["npm:foo@"]);
    expect(sourceKeys("dockerfile", "Dockerfile", "ONBUILD RUN npm i bar\n")).toEqual(["npm:bar@"]);
  });

  it("[SA-103] heredoc 의 인터프리터가 셸이 아니면 본문을 명령으로 읽지 않는다", () => {
    const python = "RUN python - <<EOF\nos.system('npm i evil')\nnpm i evil2\nEOF\nRUN npm i after\n";
    expect(sourceKeys("dockerfile", "Dockerfile", python)).toEqual(["npm:after@"]);
    const bash = "RUN bash <<EOF\nnpm i foo\nEOF\n";
    expect(sourceKeys("dockerfile", "Dockerfile", bash)).toEqual(["npm:foo@"]);
  });

  it("[SA-104] MCP: command 에 공백이 있으면 그대로 쓰고 셸 메타문자가 든 인자는 인용한다", () => {
    const full = JSON.stringify({ mcpServers: { a: { command: "npx -y foo@1.0.0", args: ["--x"] } } });
    expect(sourceKeys("mcp", ".mcp.json", full)).toEqual(["npm:foo@1.0.0"]);
    const meta = JSON.stringify({ mcpServers: { a: { command: "npx", args: ["foo", ";", "npm", "i", "evil"] } } });
    expect(sourceKeys("mcp", ".mcp.json", meta)).toEqual(["npm:foo@"]);
    const dollar = JSON.stringify({ mcpServers: { a: { command: "npx", args: ["$(id)"] } } });
    expect(sourceKeys("mcp", ".mcp.json", dollar)).toEqual([]);
  });
});
