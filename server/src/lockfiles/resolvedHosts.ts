import { isPlainObject, normalizeText } from "./common.ts";
import type { LockfileKind } from "./index.ts";

/** 공식 npm registry 의 host */
export const OFFICIAL_NPM_HOSTS: ReadonlySet<string> = new Set(["registry.npmjs.org", "registry.yarnpkg.com"]);

const MAX_HOSTS = 1000;

/** http(s) URL 이고 공식 registry 가 아니면 그 host(소문자, 포트 포함) */
function externalHost(url: string, found: Set<string>): void {
  if (found.size >= MAX_HOSTS || !/^https?:\/\//i.test(url)) return;
  try {
    const host = new URL(url).host.toLowerCase();
    if (host !== "" && !OFFICIAL_NPM_HOSTS.has(host)) found.add(host);
  } catch {
    // URL 이 아니면 건너뛴다
  }
}

/** package-lock.json: `packages`(v2·v3)와 중첩된 `dependencies`(v1)의 `resolved`. 반복문으로 깊이 제한이 없다. */
function npmHosts(content: string, found: Set<string>): void {
  const data: unknown = JSON.parse(normalizeText(content));
  if (!isPlainObject(data)) return;
  const stack: unknown[] = [data.packages, data.dependencies];
  while (stack.length > 0) {
    const table = stack.pop();
    if (!isPlainObject(table)) continue;
    for (const node of Object.values(table)) {
      if (!isPlainObject(node)) continue;
      if (typeof node.resolved === "string") externalHost(node.resolved, found);
      if (node.dependencies !== undefined) stack.push(node.dependencies);
    }
  }
}

const URL_IN_TEXT = /https?:\/\/[^\s"'#,}]+/;

/** yarn.lock: classic 의 `resolved "URL"` 와 berry 의 `resolution: "name@URL"` */
function yarnHosts(content: string, found: Set<string>): void {
  for (const raw of normalizeText(content).split("\n")) {
    const line = raw.trimStart();
    if (!line.startsWith("resolved") && !line.startsWith("resolution")) continue;
    const url = URL_IN_TEXT.exec(line)?.[0];
    if (url !== undefined) externalHost(url, found);
  }
}

/** pnpm-lock.yaml: `tarball: URL` (인라인 `{tarball: …}` 도 같은 형태) */
function pnpmHosts(content: string, found: Set<string>): void {
  for (const raw of normalizeText(content).split("\n")) {
    const at = raw.indexOf("tarball:");
    if (at === -1) continue;
    const url = URL_IN_TEXT.exec(raw.slice(at))?.[0];
    if (url !== undefined) externalHost(url, found);
  }
}

/**
 * lock 파일에서 받는 주소 중 공식 registry 가 아닌 host(정렬·중복 없음). 선형이고 bun 은 읽지 않는다.
 * package-lock.json 의 JSON 오류는 throw 한다(호출 쪽이 이 파일만 건너뛴다).
 */
export function resolvedHostsOf(kind: LockfileKind, content: string): string[] {
  const found = new Set<string>();
  if (kind === "npm") npmHosts(content, found);
  else if (kind === "yarn") yarnHosts(content, found);
  else if (kind === "pnpm") pnpmHosts(content, found);
  return [...found].sort();
}
