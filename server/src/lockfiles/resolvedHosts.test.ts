import { describe, expect, it } from "vitest";
import { resolvedHostsOf } from "./resolvedHosts.ts";

describe("[SG-50] lock 의 resolved 주소의 host", () => {
  it("package-lock.json: 공식이 아닌 http(s) host 만(포트 포함, 소문자), file:·git+·없음은 제외, v1 의 중첩 dependencies 도 본다", () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { name: "app" },
        "node_modules/a": { resolved: "https://registry.npmjs.org/a/-/a-1.0.0.tgz" },
        "node_modules/b": { resolved: "https://Npm.Acme.io:4873/b/-/b-1.0.0.tgz" },
        "node_modules/c": { resolved: "file:../c" },
        "node_modules/d": { resolved: "git+ssh://git@github.com/x/d.git#abc" },
        "node_modules/e": { version: "1.0.0" },
        "node_modules/f": { resolved: "http://plain.example/f.tgz" },
        "node_modules/g": { resolved: "https://registry.yarnpkg.com/g/-/g-1.0.0.tgz" },
      },
      dependencies: {
        h: { resolved: "https://old.example/h.tgz", dependencies: { i: { resolved: "https://nested.example/i.tgz" } } },
      },
    });
    expect(resolvedHostsOf("npm", lock)).toEqual(["nested.example", "npm.acme.io:4873", "old.example", "plain.example"]);
  });

  it("yarn.lock: classic 의 resolved 와 berry 의 resolution(URL 이 든 것만)", () => {
    const lock = `# yarn lockfile v1

"a@^1.0.0":
  version "1.0.0"
  resolved "https://registry.yarnpkg.com/a/-/a-1.0.0.tgz#abc"

"b@^1.0.0":
  version "1.0.0"
  resolved "https://evil.example/b-1.0.0.tgz#abc"

"c@npm:1.0.0":
  version: 1.0.0
  resolution: "c@npm:1.0.0"

"d@https://berry.example/d.tgz":
  version: 1.0.0
  resolution: "d@https://berry.example/d.tgz"
`;
    expect(resolvedHostsOf("yarn", lock)).toEqual(["berry.example", "evil.example"]);
  });

  it("pnpm-lock.yaml: resolution 의 tarball", () => {
    const lock = `lockfileVersion: '9.0'
packages:
  a@1.0.0:
    resolution: {integrity: sha512-aaa}
  b@1.0.0:
    resolution: {tarball: https://tarballs.example/b.tgz}
  c@1.0.0:
    resolution:
      tarball: "https://other.example/c.tgz"
      integrity: sha512-ccc
`;
    expect(resolvedHostsOf("pnpm", lock)).toEqual(["other.example", "tarballs.example"]);
  });

  it("bun 은 읽지 않고, 큰 입력도 빠르다", () => {
    expect(resolvedHostsOf("bun", "{}")).toEqual([]);
    const started = Date.now();
    const lines = Array.from({ length: 200_000 }, (_, i) => `  resolved "https://h${i % 50}.example/x${i}.tgz"`).join("\n");
    expect(resolvedHostsOf("yarn", lines)).toHaveLength(50);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
