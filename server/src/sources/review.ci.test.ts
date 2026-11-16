import { describe, expect, it, vi } from "vitest";
import { extractSource } from "./index.ts";
import { parseImageRef, parseUses } from "./images.ts";

const images = (kind: Parameters<typeof extractSource>[0], path: string, content: string): string[] =>
  extractSource(kind, path, content).images.map((image) => `${image.name}:${image.tag}${image.digest ? `@${image.digest}` : ""}`);

const timed = (run: () => void): number => {
  const start = performance.now();
  run();
  return performance.now() - start;
};

describe("입력 상한과 선형 처리", () => {
  it("[SB-70] 1MB 의 `ARG aaaa…` 는 2초 안에 끝나고, 4096자를 넘는 ARG 줄은 건너뛴다", () => {
    const big = `ARG ${"a".repeat(1_000_000)}\nFROM node\n`;
    expect(timed(() => extractSource("dockerfile", "Dockerfile", big))).toBeLessThan(2000);
    const manyTokens = `ARG ${"a ".repeat(500_000)}\n`;
    expect(timed(() => extractSource("dockerfile", "Dockerfile", manyTokens))).toBeLessThan(2000);
    const longArg = `ARG V=1 ${"x".repeat(5000)}=2\nFROM node:$V\n`;
    expect(images("dockerfile", "Dockerfile", longArg)).toEqual([]);
  });

  it("[SB-71] 따옴표 값 안의 공백을 유지하고 여러 ARG 를 읽는다", () => {
    const file = `ARG A=1 B="x y" C='z'\nFROM n:$A\nFROM m:\${C}\n`;
    expect(images("dockerfile", "Dockerfile", file)).toEqual(["n:1", "m:z"]);
  });

  it("[SB-72] 중첩 ${a:-${a:-…} 1MB 는 Dockerfile·compose 모두 2초 안에 끝나고 건너뛴다", () => {
    const nested = "${a:-".repeat(200_000);
    expect(timed(() => expect(images("dockerfile", "Dockerfile", `FROM ${nested}\n`)).toEqual([]))).toBeLessThan(2000);
    expect(timed(() => expect(images("dockerfile", "Dockerfile", `COPY --from=${nested} /a /a\n`)).toEqual([]))).toBeLessThan(2000);
    const compose = `services:\n  a:\n    image: ${nested}\n`;
    expect(timed(() => expect(images("compose", "compose.yml", compose)).toEqual([]))).toBeLessThan(2000);
    const workflow = `jobs:\n  a:\n    container: ${nested}\n    steps:\n      - uses: docker://${nested}\n`;
    expect(images("workflow", ".github/workflows/a.yml", workflow)).toEqual([]);
  });

  it("[SB-73] 512자를 넘는 이미지·uses 는 null", () => {
    expect(parseImageRef(`${"a".repeat(513)}:1`)).toBeNull();
    expect(parseUses(`o/${"r".repeat(520)}@v1`)).toBeNull();
    expect(parseImageRef(`${"a".repeat(100)}:1`)).not.toBeNull();
  });
});

describe("YAML 옵션", () => {
  it("[SB-74] !override 같은 커스텀 tag 는 경고 없이 읽고 image 는 남는다", () => {
    const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    try {
      const compose = "services:\n  a:\n    image: nginx:1\n    command: !override [a]\n";
      expect(images("compose", "compose.yml", compose)).toEqual(["nginx:1"]);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("[SB-75] 앵커 병합(<<: *c)을 푼다 (compose, workflow)", () => {
    const compose = "x-common: &c {image: bad/img:1}\nservices:\n  a:\n    <<: *c\n";
    expect(images("compose", "compose.yml", compose)).toEqual(["bad/img:1"]);
    const workflow = "x: &c {image: bad/svc:2}\njobs:\n  a:\n    services:\n      s:\n        <<: *c\n";
    expect(images("workflow", ".github/workflows/a.yml", workflow)).toEqual(["bad/svc:2"]);
  });
});

describe("이름과 digest", () => {
  it("[SB-76] 이름에 * 또는 ? 가 있는 이미지·action 은 건너뛴다", () => {
    expect(images("compose", "compose.yml", "services:\n  a:\n    image: ev*il\n  b:\n    image: ev?il:1\n")).toEqual([]);
    expect(parseUses("o/re*po@v1")).toBeNull();
    expect(parseUses("o/re?po@v1")).toBeNull();
    expect(parseUses("o/repo@v1")).not.toBeNull();
  });

  it("[SB-77] sha256 이 아닌 digest 는 digest 를 비우고 이름과 tag 는 살린다", () => {
    expect(parseImageRef(`img:v1@sha512:${"a".repeat(128)}`)).toMatchObject({ name: "img", tag: "v1", digest: "" });
    expect(parseImageRef(`img@sha512:${"a".repeat(128)}`)).toMatchObject({ name: "img", tag: "latest", digest: "" });
    expect(parseImageRef("img@bad")).toBeNull();
  });
});

describe("Dockerfile 의 ARG 범위와 --mount", () => {
  it("[SB-78] 첫 FROM 앞의 ARG 만 FROM 에 쓰고 stage 안의 ARG 는 쓰지 않는다. 전역은 선언 순서대로", () => {
    const file = "ARG A=1\nARG A=2\nFROM x:$A AS s\nARG B=9\nFROM y:$B\nFROM z:$A\n";
    expect(images("dockerfile", "Dockerfile", file)).toEqual(["x:2", "z:2"]);
  });

  it("[SB-79] RUN --mount=from= 의 이미지를 읽고 stage 이름·숫자는 건너뛴다", () => {
    const file =
      "FROM golang:1 AS build\nRUN --mount=type=bind,from=ghcr.io/org/tool:v2,target=/t make\n" +
      "RUN --mount=type=cache,from=build,target=/c make\nRUN --mount=from=0,target=/x make\n";
    expect(images("dockerfile", "Dockerfile", file)).toEqual(["golang:1", "ghcr.io/org/tool:v2"]);
  });
});
