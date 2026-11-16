import { describe, expect, it } from "vitest";
import { normalizeFor } from "../matcher.ts";
import { extractGitmodules } from "./gitmodules.ts";
import { extractRegistryConfig } from "./registryConfig.ts";
import { extractTerraform, normalizeTerraformSource } from "./terraform.ts";

describe("[SG-210] terraform source 의 정규화", () => {
  it.each([
    ["git::https://github.com/Org/Repo.git", "github.com/org/repo"],
    ["github.com/org/repo", "github.com/org/repo"],
    ["https://GitHub.com/org/repo.git//sub/dir?ref=v1", "github.com/org/repo"],
    ["git::git@github.com:org/repo.git", "github.com/org/repo"],
    ["git@github.com:org/repo", "github.com/org/repo"],
    ["git::ssh://git@github.com/org/repo.git", "github.com/org/repo"],
    ["git::https://user:token@github.com/org/repo.git", "github.com/org/repo"],
    ["http://github.com/org/repo", "github.com/org/repo"],
    ["Terraform-AWS-Modules/VPC/aws", "terraform-aws-modules/vpc/aws"],
    ["app.terraform.io/Org/Name/aws//modules/x", "app.terraform.io/org/name/aws"],
  ])("%s → %s", (source, expected) => {
    expect(normalizeTerraformSource(source)).toBe(expected);
  });

  it("추출한 이름은 정규화한 값이고 raw 는 원문이다", () => {
    const [mod] = extractTerraform('module "a" {\n  source = "git::git@GitHub.com:Org/Repo.git?ref=v1.0.0"\n}\n');
    expect(mod).toEqual({ name: "github.com/org/repo", version: "v1.0.0", raw: "git::git@GitHub.com:Org/Repo.git?ref=v1.0.0" });
  });

  it("항목의 이름에도 같은 정규화를 적용해서 비교한다", () => {
    expect(normalizeFor("terraform", "git::https://github.com/o/r.git")).toBe(normalizeFor("terraform", "github.com/o/r"));
  });
});

describe("[SG-211] .gitmodules 의 userinfo 와 주석", () => {
  it("userinfo 는 마지막 @ 까지 떼고 따옴표 밖의 인라인 주석을 뗀다", () => {
    const text = `[submodule "a"]
\turl = https://user:p@ss@host.example/x.git
[submodule "b"]
\turl = https://host.example/b.git ; 주석
[submodule "c"]
\turl = https://host.example/c.git # 주석
[submodule "d"]
\turl = "https://host.example/d#frag.git"
`;
    expect(extractGitmodules(text)).toEqual([
      "https://host.example/x.git",
      "https://host.example/b.git",
      "https://host.example/c.git",
      "https://host.example/d#frag.git",
    ]);
  });
});

describe("[SG-212] registry 설정의 보강", () => {
  it("환경 변수가 든 URL 은 host 대신 (환경 변수) 로 파일마다 1건", () => {
    expect(extractRegistryConfig(".npmrc", "registry=${REGISTRY}\n@a:registry=$OTHER/npm\n").registryHosts).toEqual(["(환경 변수)"]);
    expect(extractRegistryConfig("pip.conf", "[global]\nindex-url = https://$USER:$PW@x.io/simple\n").registryHosts).toEqual(["(환경 변수)"]);
    expect(extractRegistryConfig("requirements.txt", "--index-url ${URL}\n").registryHosts).toEqual(["(환경 변수)"]);
  });

  it(".yarnrc.yml 의 npmRegistryServer 와 npmScopes 안의 것", () => {
    const text = `npmRegistryServer: "https://registry.yarnpkg.com"
npmScopes:
  acme:
    npmRegistryServer: "https://npm.acme.io" # 주석
npmRegistries:
  "//npm.acme.io":
    npmAuthToken: abcdefghijkl
`;
    expect(extractRegistryConfig(".yarnrc.yml", text)).toEqual({ registryHosts: ["npm.acme.io"], tokenKeys: ["npmAuthToken"] });
  });

  it("requirements.txt 의 줄 이어 쓰기와 값 뒤의 주석, tool.uv.pip", () => {
    expect(extractRegistryConfig("requirements.txt", "--extra-index-url \\\n  https://a.example/simple # c\n").registryHosts).toEqual(["a.example"]);
    expect(extractRegistryConfig("uv.toml", '[pip]\nindex-url = "https://b.example/simple"\n').registryHosts).toEqual(["b.example"]);
    expect(extractRegistryConfig("pyproject.toml", '[tool.uv.pip]\nextra-index-url = ["https://c.example/simple"]\n').registryHosts).toEqual(["c.example"]);
  });

  it("토큰의 키는 중복 없이 정렬해서 모두 담는다", () => {
    const text = "_password=aaaaaaaaaaaa\n_authToken=bbbbbbbbbbbb\n_auth=cccccccccccc\n";
    expect(extractRegistryConfig(".npmrc", text).tokenKeys).toEqual(["_auth", "_authToken", "_password"]);
  });
});
