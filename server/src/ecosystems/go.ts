import { baseName, fail, requireText } from "./common.ts";
import type { DeclaredDependency, EcosystemSupport } from "./types.ts";

/** 인용부호로 감싼 모듈 경로("a/b")를 푼다 */
const unquote = (token: string): string => token.replace(/^["`](.*)["`]$/, "$1");

function toDependency(name: string, version: string, comment: string): DeclaredDependency {
  return {
    name: unquote(name),
    spec: version,
    dependencyType: /^\s*indirect\b/.test(comment) ? "transitive" : "direct",
  };
}

/**
 * go.mod 의 `require` 만 읽는다 (한 줄과 블록). `// indirect` 는 transitive.
 * replace·exclude·retract 는 읽지 않는다 — 어느 버전이 실제로 빌드에 쓰이는지는 go.sum 과 빌드가 정한다.
 */
export function parseGoMod(content: string, file = "go.mod"): DeclaredDependency[] {
  const text = requireText(content, file);
  const deps: DeclaredDependency[] = [];
  let block: string | null = null;
  let hasModule = false;

  for (const raw of text.split("\n")) {
    const commentAt = raw.indexOf("//");
    const code = (commentAt === -1 ? raw : raw.slice(0, commentAt)).trim();
    const comment = commentAt === -1 ? "" : raw.slice(commentAt + 2);
    if (code === "") continue;

    if (block !== null) {
      if (code === ")") {
        block = null;
        continue;
      }
      if (block !== "require") continue;
      const parts = code.split(/\s+/);
      if (parts.length !== 2) fail(file, `require 항목을 읽을 수 없습니다: ${code}`);
      deps.push(toDependency(parts[0] as string, parts[1] as string, comment));
      continue;
    }

    const open = /^(\w+)\s*\($/.exec(code);
    if (open) {
      block = open[1] as string;
      if (block === "module") hasModule = true;
      continue;
    }
    const parts = code.split(/\s+/);
    if (parts[0] === "module") hasModule = true;
    if (parts[0] === "require") {
      if (parts.length !== 3) fail(file, `require 항목을 읽을 수 없습니다: ${code}`);
      deps.push(toDependency(parts[1] as string, parts[2] as string, comment));
    }
  }
  if (block !== null) fail(file, `${block} 블록이 닫히지 않았습니다`);
  // module 지시어가 없으면 go.mod 가 아니다(형식 표지).
  if (!hasModule) fail(file, "module 지시어가 없습니다");
  return deps;
}

export const goSupport: EcosystemSupport = {
  ecosystem: "go",
  roleOf: (path) => (baseName(path) === "go.mod" ? "manifest" : null),
  parseManifest: (path, content) => parseGoMod(content, path),
  parseLock: () => [],
};
