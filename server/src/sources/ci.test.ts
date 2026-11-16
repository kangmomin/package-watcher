import { describe, expect, it } from "vitest";
import { extractSource, sourceKindOf } from "./index.ts";
import { parseImageRef } from "./images.ts";

const refs = (kind: Parameters<typeof extractSource>[0], path: string, content: string) => {
  const facts = extractSource(kind, path, content);
  return {
    actions: facts.actions.map((action) => `${action.name}@${action.ref}`),
    images: facts.images.map((image) => `${image.name}:${image.tag}${image.digest ? `@${image.digest}` : ""}`),
  };
};

const DIGEST = `sha256:${"a".repeat(64)}`;

describe("parseImageRef", () => {
  it("[SB-20] tag·digest 를 나누고 registry 의 포트와 구분한다", () => {
    expect(parseImageRef("node:20-alpine")).toMatchObject({ name: "node", tag: "20-alpine", digest: "" });
    expect(parseImageRef("node")).toMatchObject({ name: "node", tag: "latest", digest: "" });
    expect(parseImageRef("host:5000/team/img")).toMatchObject({ name: "host:5000/team/img", tag: "latest" });
    expect(parseImageRef("host:5000/team/img:1.2")).toMatchObject({ name: "host:5000/team/img", tag: "1.2" });
    expect(parseImageRef(`ghcr.io/Org/App:v1@${DIGEST}`)).toMatchObject({
      name: "ghcr.io/org/app",
      tag: "v1",
      digest: DIGEST,
    });
    expect(parseImageRef(`node@${DIGEST}`)).toMatchObject({ name: "node", tag: "", digest: DIGEST });
  });

  it("[SB-21] 이름을 정규화하고 형식이 아니면 null", () => {
    expect(parseImageRef("docker.io/library/Node:20")?.name).toBe("node");
    expect(parseImageRef("docker.io/foo/bar")?.name).toBe("foo/bar");
    for (const bad of ["", "$IMAGE", "${A}:1", "a b", "node:", "node@bad", "-x"]) {
      expect(parseImageRef(bad), bad).toBeNull();
    }
  });
});

describe("보조 파일 판정: action.yml", () => {
  it("[SB-22] 어느 폴더의 action.yml·action.yaml 도 action 이다 (제외 폴더 안은 아니다)", () => {
    expect(sourceKindOf("action.yml")).toBe("action");
    expect(sourceKindOf("a/b/action.yaml")).toBe("action");
    expect(sourceKindOf("my-action.yml")).toBeNull();
    expect(sourceKindOf("node_modules/x/action.yml")).toBeNull();
  });
});

describe("workflow 의 action·이미지", () => {
  const wf = `
jobs:
  build:
    runs-on: ubuntu-latest
    container: Node:20
    services:
      db:
        image: postgres:16
      cache:
        image: \${{ matrix.image }}
    steps:
      - uses: actions/checkout@v4
      - uses: Aquasecurity/Trivy-Action/sub/dir@0123456789abcdef0123456789abcdef01234567
      - uses: ./local-action
      - uses: docker://ghcr.io/org/tool:1.0
      - uses: owner/\${{ matrix.name }}@v1
      - uses: owner/noref
  reuse:
    uses: org/shared/.github/workflows/ci.yml@main
  obj:
    container:
      image: redis:7
    steps:
      - run: echo
`;

  it("[SB-23] steps 와 job 의 uses, docker://, container, services.*.image 를 읽고 로컬·표현식은 건너뛴다", () => {
    expect(refs("workflow", ".github/workflows/ci.yml", wf)).toEqual({
      actions: [
        "actions/checkout@v4",
        "aquasecurity/trivy-action@0123456789abcdef0123456789abcdef01234567",
        "owner/noref@",
        "org/shared@main",
      ],
      images: ["ghcr.io/org/tool:1.0", "node:20", "postgres:16", "redis:7"],
    });
  });

  it("[SB-24] steps 가 없거나 잘못된 YAML 구조여도 예외 없이 빈 결과, 문법 오류는 throw", () => {
    expect(refs("workflow", "w.yml", "jobs:\n  a:\n    uses: 1\n  b: x\n")).toEqual({ actions: [], images: [] });
    expect(refs("workflow", "w.yml", "- 1\n")).toEqual({ actions: [], images: [] });
    expect(() => extractSource("workflow", "w.yml", "a: [1,\n")).toThrow();
  });
});

describe("action.yml", () => {
  it("[SB-25] composite 의 uses·run, docker action 의 runs.image", () => {
    const composite = `
runs:
  using: composite
  steps:
    - uses: actions/setup-node@v4
    - run: npx evil-cli@1.0.0
      shell: bash
`;
    const facts = extractSource("action", "action.yml", composite);
    expect(facts.actions.map((a) => a.name)).toEqual(["actions/setup-node"]);
    expect(facts.commands.map((c) => c.name)).toEqual(["evil-cli"]);
    expect(refs("action", "x/action.yaml", "runs:\n  using: docker\n  image: docker://alpine:3.19\n").images).toEqual([
      "alpine:3.19",
    ]);
    expect(refs("action", "action.yml", "runs:\n  using: docker\n  image: Dockerfile\n").images).toEqual([]);
  });

  it("[SB-26] runs.using 이 없거나 runs 가 없는 YAML 은 빈 결과", () => {
    expect(refs("action", "action.yml", "name: x\n")).toEqual({ actions: [], images: [] });
    expect(refs("action", "action.yml", "runs:\n  steps: nope\n")).toEqual({ actions: [], images: [] });
    expect(refs("action", "action.yml", "")).toEqual({ actions: [], images: [] });
  });
});

describe("Dockerfile 의 이미지", () => {
  it("[SB-27] FROM: --platform, AS, digest, 앞 stage 와 scratch 는 건너뛴다", () => {
    const file = `
FROM --platform=linux/amd64 node:20 AS build
FROM build AS test
FROM scratch
FROM Alpine@${DIGEST}
FROM ghcr.io/org/base:1.0 as final
FROM final
`;
    expect(refs("dockerfile", "Dockerfile", file).images).toEqual([
      "node:20",
      `alpine:@${DIGEST}`,
      "ghcr.io/org/base:1.0",
    ]);
  });

  it("[SB-28] ARG 의 기본값으로 풀고 풀 수 없으면 건너뛴다", () => {
    const file = `
ARG NODE=20
ARG REG
FROM node:\${NODE}
FROM $REG/app:1
FROM \${BASE:-debian}:12
FROM ${"${UNKNOWN}"}
FROM busybox:$NODE AS x
`;
    expect(refs("dockerfile", "Dockerfile", file).images).toEqual(["node:20", "debian:12", "busybox:20"]);
  });

  it("[SB-29] COPY --from=image 는 읽고 stage 이름·숫자는 건너뛴다", () => {
    const file = `
FROM golang:1.22 AS builder
FROM alpine:3
COPY --from=builder /out /out
COPY --from=0 /a /a
COPY --from=nginx:1.25 /etc /etc
COPY --chown=1:1 --from=ghcr.io/org/tool:v2 /t /t
COPY ./src /src
`;
    expect(refs("dockerfile", "Dockerfile", file).images).toEqual([
      "golang:1.22",
      "alpine:3",
      "nginx:1.25",
      "ghcr.io/org/tool:v2",
    ]);
  });

  it("[SB-30] 줄 이어 쓰기와 heredoc 안의 FROM 모양은 이미지가 아니다", () => {
    const file = "FROM \\\n  node:20\nRUN cat <<EOF\nFROM evil:1\nEOF\n";
    expect(refs("dockerfile", "Dockerfile", file).images).toEqual(["node:20"]);
  });
});

describe("compose 의 이미지", () => {
  it("[SB-31] services.*.image, ${VAR:-기본값} 은 풀고 풀 수 없으면 건너뛴다", () => {
    const file = `
services:
  a:
    image: nginx:1.25
  b:
    image: \${REG:-ghcr.io/org}/app:\${TAG:-latest}
  c:
    image: \${ONLY_VAR}
  d:
    image: \${V:-}:1
  e:
    build: .
`;
    expect(refs("compose", "docker-compose.yml", file).images).toEqual([
      "nginx:1.25",
      "ghcr.io/org/app:latest",
    ]);
    expect(refs("compose", "compose.yml", "services: []\n").images).toEqual([]);
  });
});
