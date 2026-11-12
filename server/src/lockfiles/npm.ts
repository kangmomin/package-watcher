import {
  errorMessage,
  isPlainObject,
  LockfileParseError,
  requireContent,
  splitNameAndRest,
} from "./common.ts";
import type { LockPackage } from "./index.ts";

const NODE_MODULES = "node_modules/";

/**
 * `package-lock.json`.
 * - v2/v3: `packages` 만 읽는다(v2 의 `dependencies` 무시). 루트 `""` 와 `link: true` 제외.
 *   이름 = 항목의 `name`, 없으면 마지막 `node_modules/` 뒤 경로.
 * - v1: `dependencies` 를 재귀로 읽는다. `version: "npm:real@1.2.3"` 별칭 분해.
 *   버전이 semver 가 아닌 항목(git, tarball)은 이름 + 원문 버전.
 * 공통: UTF-8 BOM 제거, CRLF → LF. 파싱 실패·빈 입력은 예외.
 */
export function parseNpmLock(content: string): LockPackage[] {
  const text = requireContent(content, "package-lock.json");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new LockfileParseError(`package-lock.json 을 JSON 으로 읽을 수 없습니다: ${errorMessage(error)}`);
  }
  if (!isPlainObject(data) || !("lockfileVersion" in data)) {
    throw new LockfileParseError("package-lock.json 에 형식 표지(lockfileVersion)가 없습니다");
  }
  // v2/v3 는 항상 packages 를 가진다. v1 에는 packages 가 없다.
  if (isPlainObject(data.packages)) return readPackages(data.packages);
  const packages: LockPackage[] = [];
  if (isPlainObject(data.dependencies)) readV1Dependencies(data.dependencies, packages);
  return packages;
}

function readPackages(entries: Record<string, unknown>): LockPackage[] {
  const packages: LockPackage[] = [];
  for (const [key, value] of Object.entries(entries)) {
    if (key === "" || !isPlainObject(value) || value.link === true) continue;
    const marker = key.lastIndexOf(NODE_MODULES);
    // node_modules 밖의 키는 workspace 디렉터리 항목이다. 설치된 의존성이 아니므로 건너뛴다(S-13).
    if (marker === -1) continue;
    const version = value.version;
    if (typeof version !== "string" || version === "") continue;
    const name =
      typeof value.name === "string" && value.name !== ""
        ? value.name
        : key.slice(marker + NODE_MODULES.length);
    packages.push({ name, version });
  }
  return packages;
}

function readV1Dependencies(dependencies: Record<string, unknown>, out: LockPackage[]): void {
  for (const [key, value] of Object.entries(dependencies)) {
    if (!isPlainObject(value)) continue;
    const version = value.version;
    if (typeof version === "string" && version !== "") out.push(resolveV1Entry(key, version));
    if (isPlainObject(value.dependencies)) readV1Dependencies(value.dependencies, out);
  }
}

function resolveV1Entry(key: string, version: string): LockPackage {
  if (!version.startsWith("npm:")) return { name: key, version };
  const alias = splitNameAndRest(version.slice("npm:".length));
  return { name: alias.name, version: alias.rest ?? "" };
}
