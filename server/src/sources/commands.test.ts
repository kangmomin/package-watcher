import { describe, expect, it } from "vitest";
import { extractCommandPackages } from "./commands.ts";

/** ecosystem:name@version 로 줄여서 비교한다 */
const keys = (text: string): string[] =>
  extractCommandPackages(text).map((pkg) => `${pkg.ecosystem}:${pkg.name}@${pkg.version}`);

describe("명령에서 패키지 추출 - npm", () => {
  it("[SA-10] npx: 플래그를 건너뛰고 첫 위치 인자를 읽는다", () => {
    expect(keys("npx -y create-foo@1.2.3 --flag")).toEqual(["npm:create-foo@1.2.3"]);
    expect(keys("npx --yes foo")).toEqual(["npm:foo@"]);
    expect(keys("npx foo@latest")).toEqual(["npm:foo@"]);
    expect(keys("npx foo@^1.0.0")).toEqual(["npm:foo@"]);
    expect(keys("npx @scope/pkg@2.0.0 run")).toEqual(["npm:@scope/pkg@2.0.0"]);
    expect(keys("npx @scope/pkg")).toEqual(["npm:@scope/pkg@"]);
  });

  it("[SA-11] npx -p / --package / --package= 는 그 값만 패키지고 뒤의 실행 파일 이름은 아니다", () => {
    expect(keys("npx -p typescript@5.0.0 tsc --init")).toEqual(["npm:typescript@5.0.0"]);
    expect(keys("npx --package=foo@1.0.0 bar")).toEqual(["npm:foo@1.0.0"]);
    expect(keys("npx --package foo@1.0.0 bar")).toEqual(["npm:foo@1.0.0"]);
    expect(keys("npx -p a -p b@2.0.0 run")).toEqual(["npm:a@", "npm:b@2.0.0"]);
  });

  it("[SA-12] pnpm dlx, pnpx, yarn dlx, bunx", () => {
    expect(keys("pnpm dlx foo@1.0.0")).toEqual(["npm:foo@1.0.0"]);
    expect(keys("pnpx foo")).toEqual(["npm:foo@"]);
    expect(keys("yarn dlx foo@2.0.0")).toEqual(["npm:foo@2.0.0"]);
    expect(keys("bunx foo@3.0.0 --x")).toEqual(["npm:foo@3.0.0"]);
  });

  it("[SA-13] npm i/install/add 는 패키지 여러 개를 읽고 인자가 없으면 결과가 없다", () => {
    expect(keys("npm install -g a@1.0.0 b")).toEqual(["npm:a@1.0.0", "npm:b@"]);
    expect(keys("npm i --global --save-dev c")).toEqual(["npm:c@"]);
    expect(keys("npm add d@~1.0.0")).toEqual(["npm:d@"]);
    expect(keys("npm install")).toEqual([]);
    expect(keys("npm ci")).toEqual([]);
    expect(keys("yarn install")).toEqual([]);
    expect(keys("yarn")).toEqual([]);
  });

  it("[SA-14] pnpm add, yarn add, yarn global add, bun add", () => {
    expect(keys("pnpm add -g a@1.0.0")).toEqual(["npm:a@1.0.0"]);
    expect(keys("yarn global add a b@2.0.0")).toEqual(["npm:a@", "npm:b@2.0.0"]);
    expect(keys("yarn add x")).toEqual(["npm:x@"]);
    expect(keys("bun add y@1.0.0")).toEqual(["npm:y@1.0.0"]);
  });

  it("[SA-15] 경로·URL·git 인자와 변수가 든 토큰은 패키지로 보지 않는다", () => {
    expect(
      keys("npm install ./local ../x /abs foo.tgz https://x.com/a.tgz git+https://x/y.git github:a/b"),
    ).toEqual([]);
    expect(keys("npx $PKG")).toEqual([]);
    expect(keys("npm i ${{ matrix.pkg }}")).toEqual([]);
    expect(keys("npm i $(cat pkgs)")).toEqual([]);
    expect(keys("npm i pkg@$VERSION")).toEqual(["npm:pkg@"]); // 버전만 변수면 이름은 살린다 (SA-93)
  });
});

describe("명령에서 패키지 추출 - pypi", () => {
  it("[SA-20] uvx, uv tool run/install, pipx run/install", () => {
    expect(keys("uvx ruff==0.1.0 check")).toEqual(["pypi:ruff@0.1.0"]);
    expect(keys("uvx ruff")).toEqual(["pypi:ruff@"]);
    expect(keys("uv tool run black")).toEqual(["pypi:black@"]);
    expect(keys("uv tool install httpie==3.0")).toEqual(["pypi:httpie@3.0"]);
    expect(keys("pipx run cowsay")).toEqual(["pypi:cowsay@"]);
    expect(keys("pipx install poetry==1.8.0")).toEqual(["pypi:poetry@1.8.0"]);
  });

  it("[SA-21] pip/pip3/python -m pip/uv pip install: 여러 패키지, 값이 있는 플래그의 값은 건너뛴다", () => {
    expect(keys("pip install a==1.0 b>=2 c")).toEqual(["pypi:a@1.0", "pypi:b@", "pypi:c@"]);
    expect(keys("pip3 install --upgrade -q requests")).toEqual(["pypi:requests@"]);
    expect(keys("python -m pip install flask==2.0.0")).toEqual(["pypi:flask@2.0.0"]);
    expect(keys("python3 -m pip install flask")).toEqual(["pypi:flask@"]);
    expect(keys("uv pip install numpy")).toEqual(["pypi:numpy@"]);
    expect(keys("pip install -r requirements.txt")).toEqual([]);
    expect(keys("pip install -c constraints.txt -e . pkg")).toEqual(["pypi:pkg@"]);
    expect(keys("pip install --index-url https://x/simple pkg")).toEqual(["pypi:pkg@"]);
  });

  it("[SA-22] extras 는 이름에서 빼고 경로·wheel·sdist·URL·git 은 건너뛴다", () => {
    expect(keys("pip install 'pkg[a,b]==1.0'")).toEqual(["pypi:pkg@1.0"]);
    expect(keys("pip install . ./x /abs a.whl b.tar.gz https://x/y.zip git+https://x/z.git")).toEqual([]);
  });
});

describe("명령에서 패키지 추출 - 셸 구문", () => {
  it("[SA-30] &&, ||, ;, |, 줄바꿈으로 명령을 나눈다", () => {
    expect(keys("cd x && npx a@1.0.0 ; pip install b | tee log\nuvx c || true")).toEqual([
      "npm:a@1.0.0",
      "pypi:b@",
      "pypi:c@",
    ]);
  });

  it("[SA-31] 줄 끝 \\ 이어 쓰기를 합친다", () => {
    expect(keys("npm install -g \\\n  a@1.0.0 \\\n  b@2.0.0")).toEqual(["npm:a@1.0.0", "npm:b@2.0.0"]);
  });

  it("[SA-32] 따옴표를 벗기고 sudo/env/time 접두를 건너뛴다", () => {
    expect(keys('npx -y "@playwright/mcp@latest"')).toEqual(["npm:@playwright/mcp@"]);
    expect(keys("sudo npm i -g 'a@1.0.0'")).toEqual(["npm:a@1.0.0"]);
    expect(keys("env CI=1 NODE_ENV=x npx foo")).toEqual(["npm:foo@"]);
    expect(keys("time npx foo")).toEqual(["npm:foo@"]);
    expect(keys("FOO=1 npx foo")).toEqual(["npm:foo@"]);
  });

  it("[SA-33] 이름 규칙에 맞지 않는 토큰은 버리고 예외를 던지지 않는다", () => {
    expect(keys("npx 'a b'")).toEqual([]);
    expect(keys('npx "unterminated')).toBeInstanceOf(Array);
    expect(keys("")).toEqual([]);
    expect(keys("echo hello world")).toEqual([]);
    expect(keys("npm install --")).toEqual([]);
  });

  it("[SA-34] raw 와 tool 을 채운다", () => {
    expect(extractCommandPackages("npx -y @playwright/mcp@latest")).toEqual([
      { ecosystem: "npm", name: "@playwright/mcp", version: "", raw: "@playwright/mcp@latest", tool: "npx" },
    ]);
    expect(extractCommandPackages("pip install a==1.0")[0]).toMatchObject({ raw: "a==1.0", tool: "pip" });
  });
});
