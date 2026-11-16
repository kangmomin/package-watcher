import { describe, expect, it } from "vitest";
import { extractGitmodules } from "./gitmodules.ts";
import { extractHelm } from "./helm.ts";
import { extractSource, sourceKindOf } from "./index.ts";
import { extractRegistryConfig } from "./registryConfig.ts";
import { extractTerraform } from "./terraform.ts";
import { extractVscode } from "./vscode.ts";

describe("[SG-30] 새 보조 파일의 판정", () => {
  it.each([
    [".vscode/extensions.json", "vscode"],
    ["app/.vscode/extensions.json", "vscode"],
    [".devcontainer/devcontainer.json", "vscode"],
    [".devcontainer.json", "vscode"],
    [".devcontainer/php/devcontainer.json", "vscode"],
    ["Chart.yaml", "helm"],
    ["charts/app/Chart.lock", "helm"],
    ["charts/app/requirements.yaml", "helm"],
    ["infra/main.tf", "terraform"],
    [".npmrc", "registry-config"],
    ["web/.yarnrc.yml", "registry-config"],
    ["pip.conf", "registry-config"],
    [".pip/pip.conf", "registry-config"],
    ["pip.ini", "registry-config"],
    ["uv.toml", "registry-config"],
    [".gitmodules", "gitmodules"],
  ])("%s → %s", (path, kind) => {
    expect(sourceKindOf(path)).toBe(kind);
  });

  it.each([
    "extensions.json",
    "src/extensions.json",
    ".devcontainer/a/b/devcontainer.json",
    "chart.yaml",
    "infra/.terraform/modules/x/main.tf",
    "main.tf.json",
    "node_modules/x/.npmrc",
    "vendor/x/main.tf",
    "docs/gitmodules",
  ])("아니다: %s", (path) => {
    expect(sourceKindOf(path)).toBeNull();
  });
});

describe("[SG-31] vscode 확장", () => {
  it("extensions.json 의 recommendations: 이름은 소문자, @버전, JSONC 허용, 형식이 다른 항목은 건너뛴다", () => {
    const text = `{
  // 주석
  "recommendations": ["MS-Python.python", "esbenp.prettier-vscode@10.1.0", 5, "no-dot", "a b.c"],
  "unwantedRecommendations": ["evil.unwanted"],
}`;
    expect(extractVscode(text)).toEqual([
      { name: "ms-python.python", version: "", raw: "MS-Python.python" },
      { name: "esbenp.prettier-vscode", version: "10.1.0", raw: "esbenp.prettier-vscode@10.1.0" },
    ]);
  });

  it("devcontainer.json: customizations.vscode.extensions 와 옛 형식 extensions", () => {
    const text = JSON.stringify({
      customizations: { vscode: { extensions: ["a.one@1.0.0"] } },
      extensions: ["b.two"],
    });
    expect(extractVscode(text).map((item) => item.name)).toEqual(["a.one", "b.two"]);
    expect(extractSource("vscode", ".vscode/extensions.json", text).extensions).toHaveLength(2);
  });

  it("JSON 오류는 예외, 객체가 아니면 빈 목록", () => {
    expect(() => extractVscode("{ bad")).toThrow();
    expect(extractVscode("[1]")).toEqual([]);
  });
});

describe("[SG-32] helm chart", () => {
  it("Chart.yaml 의 dependencies: 정확한 버전만 version, 범위는 빈 문자열", () => {
    const text = `apiVersion: v2
name: app
dependencies:
  - name: ingress-nginx
    version: 4.10.0
    repository: https://kubernetes.github.io/ingress-nginx
  - name: redis
    version: "^17.0.0"
    repository: oci://registry-1.docker.io/bitnamicharts
  - name: pg
    version: ">=1.0.0 <2.0.0"
  - name: star
    version: 1.x
  - name: noversion
  - version: 1.0.0
`;
    expect(extractHelm(text)).toEqual([
      {
        name: "ingress-nginx",
        version: "4.10.0",
        repository: "https://kubernetes.github.io/ingress-nginx",
        raw: "ingress-nginx@4.10.0",
      },
      { name: "redis", version: "", repository: "oci://registry-1.docker.io/bitnamicharts", raw: "redis@^17.0.0" },
      { name: "pg", version: "", repository: "", raw: "pg@>=1.0.0 <2.0.0" },
      { name: "star", version: "", repository: "", raw: "star@1.x" },
      { name: "noversion", version: "", repository: "", raw: "noversion" },
    ]);
  });

  it("Chart.lock·requirements.yaml 도 읽고 YAML 오류는 예외", () => {
    const lock = "dependencies:\n- name: redis\n  repository: https://x.io\n  version: 17.1.0\ndigest: sha256:abc\n";
    expect(extractSource("helm", "Chart.lock", lock).charts?.[0]).toMatchObject({ name: "redis", version: "17.1.0" });
    expect(() => extractHelm("a: [")).toThrow();
    expect(extractHelm("name: x\n")).toEqual([]);
  });
});

describe("[SG-33] terraform module", () => {
  const tf = `
terraform {
  required_version = ">= 1.0"
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.8.1"
  name    = "main"
  tags = {
    source = "ignored"
    version = "9.9.9"
  }
}

module "range" {
  source  = "terraform-aws-modules/eks/aws//modules/node"
  version = "~> 20.0"
}

module "git" {
  source = "git::https://github.com/org/mod.git//sub/dir?ref=v1.2.3"
}

module "gitversion" {
  source = "git::https://github.com/org/mod2.git?ref=v1.0.0"
  version = "2.0.0"
}

module "local" {
  source = "./modules/local"
}

module "up" {
  source = "../modules/up"
}

module "tricky" {
  description = "}{ \\" } module \\"fake\\" {"
  source = "hashicorp/consul/aws"
  # source = "commented/out/x"
  version = "0.1.0" // 끝 주석
}

module "oneline" { source = "a/b/c" }

resource "x" "y" {
  source = "not-a-module"
}
`;

  it("source·version 을 모듈의 최상위에서 읽고 //하위경로·?쿼리를 이름에서 떼고 ?ref 는 version 으로 쓴다", () => {
    expect(extractTerraform(tf)).toEqual([
      { name: "terraform-aws-modules/vpc/aws", version: "5.8.1", raw: "terraform-aws-modules/vpc/aws" },
      { name: "terraform-aws-modules/eks/aws", version: "", raw: "terraform-aws-modules/eks/aws//modules/node" },
      {
        name: "git::https://github.com/org/mod.git",
        version: "v1.2.3",
        raw: "git::https://github.com/org/mod.git//sub/dir?ref=v1.2.3",
      },
      {
        name: "git::https://github.com/org/mod2.git",
        version: "2.0.0",
        raw: "git::https://github.com/org/mod2.git?ref=v1.0.0",
      },
      { name: "hashicorp/consul/aws", version: "0.1.0", raw: "hashicorp/consul/aws" },
      { name: "a/b/c", version: "", raw: "a/b/c" },
    ]);
  });

  it("heredoc 안의 중괄호는 블록의 깊이에 영향을 주지 않는다", () => {
    const text = `module "a" {
  source = "x/y/z"
  policy = <<EOT
  } } }
  module "inner" {
  EOT
  version = "1.2.3"
}
module "b" {
  source = "q/r/s"
}
`;
    expect(extractTerraform(text).map((item) => `${item.name}@${item.version}`)).toEqual(["x/y/z@1.2.3", "q/r/s@"]);
  });

  it("닫히지 않은 블록·긴 입력도 예외 없이 빠르게 끝난다", () => {
    const started = Date.now();
    expect(extractTerraform('module "a" {\n source = "x/y/z"\n')).toEqual([]);
    expect(extractTerraform("{".repeat(300_000))).toEqual([]);
    expect(extractTerraform('module "a" {'.repeat(50_000))).toEqual([]);
    expect(() => extractTerraform(`module "a" {\n${'source = "'.repeat(100_000)}\n}`)).not.toThrow();
    const many = Array.from({ length: 6000 }, (_, i) => `module "m${i}" {\n source = "a/b${i}/c"\n}`).join("\n");
    expect(extractTerraform(many)).toHaveLength(5000);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe("[SG-34] registry 설정", () => {
  it(".npmrc: 공식이 아닌 registry 의 host(포트 포함), 토큰은 이름만", () => {
    const text = `; 주석
registry=https://registry.npmjs.org/
@acme:registry=https://Npm.Acme.io:4873/
@gh:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=ghp_abcdefghijklmnop
//npm.acme.io/:_authToken=\${ACME_TOKEN}
_auth=short
_password="c2VjcmV0c2VjcmV0"
`;
    const result = extractRegistryConfig(".npmrc", text);
    expect(result.registryHosts).toEqual(["npm.acme.io:4873", "npm.pkg.github.com"]);
    expect(result.tokenKeys).toEqual(["_authToken", "_password"]);
    expect(JSON.stringify(result)).not.toContain("ghp_");
    expect(JSON.stringify(result)).not.toContain("c2VjcmV0");
  });

  it(".yarnrc.yml: npmAuthToken 의 값이 있으면 이름만 보고한다", () => {
    expect(extractRegistryConfig(".yarnrc.yml", 'npmAuthToken: "abcdefghijkl"\nnpmRegistryServer: "https://x.io"\n')).toEqual({
      registryHosts: [],
      tokenKeys: ["npmAuthToken"],
    });
    expect(extractRegistryConfig(".yarnrc.yml", "npmAuthToken: ${YARN_TOKEN}\n").tokenKeys).toEqual([]);
  });

  it("pip.conf: index-url·extra-index-url(여러 줄 포함), pypi.org·files.pythonhosted.org 는 제외", () => {
    const text = `[global]
index-url = https://pypi.org/simple
extra-index-url = https://pypi.internal.io/simple
    https://user:pw@other.io:8443/simple
[install]
trusted-host = pypi.internal.io
`;
    expect(extractRegistryConfig("pip.conf", text).registryHosts).toEqual(["other.io:8443", "pypi.internal.io"]);
    expect(extractRegistryConfig("pip.ini", "[global]\nindex-url=https://files.pythonhosted.org/x\n").registryHosts).toEqual([]);
  });

  it("uv.toml·pyproject.toml: index 표와 index-url·extra-index-url, poetry source", () => {
    const uv = `index-url = "https://a.example/simple"
extra-index-url = ["https://b.example/simple", "https://pypi.org/simple"]
[[index]]
name = "x"
url = "https://c.example/simple"
`;
    expect(extractRegistryConfig("uv.toml", uv).registryHosts).toEqual(["a.example", "b.example", "c.example"]);
    const pyproject = `[tool.uv]
index-url = "https://d.example/simple"
[[tool.uv.index]]
url = "https://e.example/simple"
[[tool.poetry.source]]
name = "f"
url = "https://f.example/simple"
`;
    expect(extractRegistryConfig("pyproject.toml", pyproject).registryHosts).toEqual(["d.example", "e.example", "f.example"]);
    expect(() => extractRegistryConfig("pyproject.toml", "[x")).toThrow();
  });

  it("requirements.txt: --index-url·--extra-index-url·-i 줄", () => {
    const text = `--index-url https://a.example/simple
--extra-index-url=https://b.example/simple
-i https://c.example/simple
-r other.txt
requests==2.0 # --index-url https://no.example
# --extra-index-url https://comment.example
`;
    expect(extractRegistryConfig("requirements.txt", text).registryHosts).toEqual([
      "a.example",
      "b.example",
      "c.example",
    ]);
  });

  it("extractSource 가 facts 에 담는다", () => {
    expect(extractSource("registry-config", ".npmrc", "registry=https://r.io/\n").registryHosts).toEqual(["r.io"]);
  });
});

describe("[SG-35] .gitmodules", () => {
  it("url 만 읽고 자격 증명은 떼고 200자로 자른다", () => {
    const text = `[submodule "a"]
\tpath = a
\turl = https://github.com/my-org/a.git
[submodule "b"]
\turl=https://user:pw@gitlab.com/x/b.git
[submodule "c"]
\turl = ../c
[submodule "d"]
\turl = git@github.com:other/d.git
[submodule "e"]
\turl = https://example.com/${"x".repeat(300)}
`;
    const urls = extractGitmodules(text);
    expect(urls.slice(0, 4)).toEqual([
      "https://github.com/my-org/a.git",
      "https://gitlab.com/x/b.git",
      "../c",
      "git@github.com:other/d.git",
    ]);
    expect(urls[4]).toHaveLength(200);
    expect(JSON.stringify(urls)).not.toContain("pw@");
  });
});
