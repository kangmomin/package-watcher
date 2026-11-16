import { createHash } from "node:crypto";
import { POLICY_CHECK_IDS, POLICY_ECOSYSTEM, type BlacklistEntry, type PolicyCheckId } from "@pw/shared";
import type { Logger } from "../logger.ts";
import { isRunCommand, type SourceFacts, type SourceKind } from "../sources/index.ts";
import { isExcludedPath } from "../ecosystems/index.ts";
import { cleanVersion } from "./common.ts";
import { MAX_INDICATOR_MATCHES, createLimiter, type IndicatorMatch } from "./scanIndicators.ts";


/** 검사 1개가 repo 1개에서 만드는 검출의 상한은 `scanIndicators` 의 `MAX_INDICATOR_MATCHES` 와 같다 (createLimiter) */
export type PolicyMatch = IndicatorMatch;

/** `package.json` 1개의 사실 */
export interface PolicyManifest {
  path: string;
  /** 직접 의존성 (dev·optional·peer 포함). `name` 은 실제 패키지 이름 */
  dependencies: { name: string; spec: string }[];
  /** 담당 lock 파일이 있다 (`assignLockfiles` 의 결과) */
  locked: boolean;
}

export interface PolicyInput {
  org: string;
  repo: string;
  /** tree 전체의 경로 (node_modules 포함) */
  treePaths: readonly string[];
  manifests: readonly PolicyManifest[];
  /** 받아서 해석에 성공한 보조 파일. 파싱에 실패한 파일은 넣지 않는다 (오탐을 만들지 않는다) */
  sources: readonly SourceFacts[];
  /** `package.json` 의 설치 script (preinstall·install·postinstall 만, 내용이 있는 것) */
  packageScripts?: readonly { path: string; scripts: Readonly<Record<string, string>> }[];
  /** lock 파일이 공식이 아닌 주소에서 받는 host (공식뿐이면 항목이 없다) */
  lockHosts?: readonly { path: string; hosts: readonly string[] }[];
}

/** 설치할 때 npm 이 실행하는 script 의 이름 */
export const INSTALL_SCRIPT_NAMES = ["preinstall", "install", "postinstall"] as const;

/** `package.json` 의 `scripts` 에서 설치 script 의 (이름 → 내용) */
export function installScriptsOf(raw: Record<string, unknown>): Record<string, string> {
  const scripts = raw.scripts;
  const found: Record<string, string> = {};
  if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) return found;
  for (const name of INSTALL_SCRIPT_NAMES) {
    const body = (scripts as Record<string, unknown>)[name];
    if (typeof body === "string" && body.trim() !== "") found[name] = body;
  }
  return found;
}

export interface PolicyRules {
  /** 활성(켜짐·만료 안 됨) 검사의 id. 비어 있으면 평가할 것이 없다 */
  active: ReadonlySet<string>;
  /** 활성 검사를 모두 평가한다. 검사마다 정렬한 앞의 100건만 낸다 */
  evaluate(input: PolicyInput, logger: Logger): Promise<PolicyMatch[]>;
}

/** 검사가 필요로 하는 보조 파일의 종류. 이 종류의 파일은 활성 검사가 있으면 받는다. */
const CHECK_SOURCE_KINDS: Partial<Record<PolicyCheckId, readonly SourceKind[]>> = {
  "unpinned-action": ["workflow", "action"],
  "workflow-no-permissions": ["workflow", "action"],
  "curl-pipe-shell": ["workflow", "action", "dockerfile"],
  "unpinned-exec": ["workflow", "action", "dockerfile", "mcp"],
  "unpinned-image": ["workflow", "action", "dockerfile", "compose"],
  "custom-registry": ["registry-config"],
  "npmrc-token": ["registry-config"],
  "external-submodule": ["gitmodules"],
};

/** 이 종류의 보조 파일을 활성 policy 검사가 필요로 하는가 */
export function policyNeedsSourceKind(kind: SourceKind, activeChecks: ReadonlySet<string>): boolean {
  for (const check of activeChecks) {
    if (CHECK_SOURCE_KINDS[check as PolicyCheckId]?.includes(kind)) return true;
  }
  return false;
}

/** 경로 이 개수마다 이벤트 루프에 양보한다 (큰 tree 가 HTTP 서버를 멈추지 않게) */
const YIELD_EVERY_PATHS = 2000;
const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

interface Candidate {
  filePath: string;
  packageName: string;
  version: string;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const compareCandidates = (a: Candidate, b: Candidate): number =>
  compare(a.filePath, b.filePath) || compare(a.packageName, b.packageName) || compare(a.version, b.version);

const SHA_1 = /^[0-9a-f]{40}$/i;
/** 보이지 않거나 방향을 바꾸는 유니코드: 서식 문자(Cf: U+202A-202E, U+2066-2069, U+200B-200F, U+FEFF 등)와 줄·문단 구분자 */
const INVISIBLE_UNICODE = /[\p{Cf}\p{Zl}\p{Zp}]/u;

/** 경로에 ASCII 제어 문자(0x20 미만, 0x7f)나 보이지 않는 유니코드가 있는가. ZWJ(U+200D)도 잡는다. */
function hasSuspiciousChar(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return INVISIBLE_UNICODE.test(text);
}

/** `user/repo`, `user/repo#ref` 축약형 (npm 이 GitHub 으로 읽는다) */
const GITHUB_SHORTHAND = /^[A-Za-z0-9][\w.-]*\/[\w.-]+(?:#\S*)?$/;
/** `github.com/user/repo` 처럼 호스트(점이 든 첫 조각)로 시작하는 경로 */
const HOST_PATH = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\/[\w.~%-]+(?:\/[\w.~%-]+)*(?:#\S*)?$/;
const REGISTRY_PREFIXES = [
  "git+",
  "git://",
  "git@",
  "ssh://",
  "http://",
  "https://",
  "github:",
  "gitlab:",
  "bitbucket:",
];
const EXCLUDED_PREFIXES = ["workspace:", "link:", "npm:"];
const ARCHIVE_SUFFIX = /\.(?:tgz|tar\.gz)$/;

/** `#해시`·`?쿼리`를 뗀 앞부분 */
function withoutFragment(text: string): string {
  const cut = [text.indexOf("#"), text.indexOf("?")].filter((index) => index >= 0);
  return cut.length === 0 ? text : text.slice(0, Math.min(...cut));
}

/** registry 밖에서 받는 spec 인가: git·URL·`user/repo`·`host.tld/u/r`, 그리고 `.tgz` 파일 (`file:` 폴더는 제외) */
export function isNonRegistrySpec(spec: string): boolean {
  const trimmed = spec.trim();
  const lower = trimmed.toLowerCase();
  if (EXCLUDED_PREFIXES.some((prefix) => lower.startsWith(prefix))) return false;
  if (REGISTRY_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  if (GITHUB_SHORTHAND.test(trimmed) || HOST_PATH.test(trimmed)) return true;
  return ARCHIVE_SUFFIX.test(withoutFragment(lower));
}

/**
 * 실행 파일(bin) 이름 → 그 bin 을 내는 패키지. `npx <bin>` 은 패키지 이름이 아니라 bin 이름이라서,
 * 그 패키지가 선언돼 있으면 로컬 실행 파일로 보고 제외한다. 이름으로만 판정한다.
 */
export const BIN_PACKAGES: Readonly<Record<string, readonly string[]>> = {
  tsc: ["typescript"],
  tsserver: ["typescript"],
  ng: ["@angular/cli"],
  nest: ["@nestjs/cli"],
  sb: ["storybook"],
  storybook: ["storybook"],
  babel: ["@babel/cli"],
  jest: ["jest"],
  vitest: ["vitest"],
  eslint: ["eslint"],
  prettier: ["prettier"],
  turbo: ["turbo"],
  vite: ["vite"],
  next: ["next"],
  nuxt: ["nuxt", "nuxi"],
  nuxi: ["nuxt", "nuxi"],
  webpack: ["webpack", "webpack-cli"],
  rollup: ["rollup"],
  tsx: ["tsx"],
  playwright: ["@playwright/test", "playwright"],
  cap: ["@capacitor/cli"],
  expo: ["expo"],
  "react-native": ["react-native", "@react-native-community/cli"],
  prisma: ["prisma"],
  "drizzle-kit": ["drizzle-kit"],
  wrangler: ["wrangler"],
  firebase: ["firebase-tools"],
  supabase: ["supabase"],
  vercel: ["vercel"],
  tailwindcss: ["tailwindcss"],
  cypress: ["cypress"],
  mocha: ["mocha"],
  tsup: ["tsup"],
  esbuild: ["esbuild"],
  nx: ["nx"],
  lerna: ["lerna"],
  "ts-node": ["ts-node"],
  nodemon: ["nodemon"],
  "semantic-release": ["semantic-release"],
};

const depthOf = (path: string): number => path.split("/").length;
const isShallower = (a: string, b: string): boolean => depthOf(a) < depthOf(b) || (depthOf(a) === depthOf(b) && a < b);

/** `node_modules/<x>/package.json` 꼴이면 그 `node_modules` 폴더의 경로. 아니면 null (정규식 없이 조각으로 본다) */
function committedNodeModulesFolder(path: string): string | null {
  if (!path.endsWith("/package.json")) return null;
  const segments = path.split("/");
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] !== "node_modules") continue;
    const rest = segments.length - index - 1; // node_modules 뒤의 조각 수
    const scoped = (segments[index + 1] as string).startsWith("@");
    if (rest === 2 || (scoped && rest === 3)) return segments.slice(0, index + 1).join("/");
  }
  return null;
}

/** 원문 토큰의 버전 부분 (`pkg@latest` → `latest`). 없으면 "" */
function versionPartOf(raw: string): string {
  const at = raw.lastIndexOf("@");
  return at > 0 ? raw.slice(at + 1) : "";
}

function unpinnedActions(input: PolicyInput): Candidate[] {
  const org = input.org.toLowerCase();
  const found: Candidate[] = [];
  for (const source of input.sources) {
    if (source.kind !== "workflow" && source.kind !== "action") continue;
    for (const action of source.actions) {
      const owner = action.name.slice(0, action.name.indexOf("/"));
      if (owner === "actions" || owner === "github" || owner === org) continue;
      if (SHA_1.test(action.ref)) continue;
      found.push({ filePath: source.path, packageName: action.name, version: cleanVersion(action.ref) });
    }
  }
  return found;
}

function missingLockfiles(input: PolicyInput): Candidate[] {
  return input.manifests
    .filter((manifest) => !manifest.locked && manifest.dependencies.length > 0 && !isExcludedPath(manifest.path))
    .map((manifest) => ({ filePath: manifest.path, packageName: "package.json", version: "" }));
}

function nonRegistryDependencies(input: PolicyInput): Candidate[] {
  const found: Candidate[] = [];
  for (const manifest of input.manifests) {
    for (const dep of manifest.dependencies) {
      if (isNonRegistrySpec(dep.spec)) {
        found.push({ filePath: manifest.path, packageName: dep.name, version: cleanVersion(dep.spec) });
      }
    }
  }
  return found;
}

function unpinnedExecs(input: PolicyInput): Candidate[] {
  // 같은 repo 의 package.json 에 선언된 패키지가 내는 실행 파일은 로컬 실행 파일이다 (`npx vitest`, `npx tsc`).
  const declared = new Set(input.manifests.flatMap((manifest) => manifest.dependencies.map((dep) => dep.name)));
  const scopedTails = new Set([...declared].filter((name) => name.startsWith("@")).map((name) => name.slice(name.indexOf("/") + 1)));
  const isLocal = (name: string): boolean =>
    declared.has(name) || scopedTails.has(name) || (Object.hasOwn(BIN_PACKAGES, name) && (BIN_PACKAGES[name] ?? []).some((pkg) => declared.has(pkg)));
  const found: Candidate[] = [];
  for (const source of input.sources) {
    for (const command of source.commands) {
      if (!isRunCommand(command) || command.version !== "" || isLocal(command.name)) continue;
      const version = versionPartOf(command.raw);
      // `pkg@${VERSION}` 은 변수로 고정한 것이다. 버전 없음이 아니다.
      if (version.includes("$")) continue;
      found.push({ filePath: source.path, packageName: command.name, version: cleanVersion(version) });
    }
  }
  return found;
}

function curlPipes(input: PolicyInput): Candidate[] {
  return input.sources
    .filter((source) => source.hasCurlPipeShell)
    .map((source) => ({ filePath: source.path, packageName: "curl | sh", version: "" }));
}

function workflowsWithoutPermissions(input: PolicyInput): Candidate[] {
  return input.sources
    .filter((source) => source.kind === "workflow" && source.missingPermissions)
    .map((source) => ({ filePath: source.path, packageName: "permissions", version: "" }));
}

function unpinnedImages(input: PolicyInput): Candidate[] {
  const found: Candidate[] = [];
  for (const source of input.sources) {
    for (const image of source.images) {
      if (image.digest === "" && image.tag === "latest") {
        found.push({ filePath: source.path, packageName: image.name, version: "latest" });
      }
    }
  }
  return found;
}

/** 내용이 바뀌면 다른 검출이 되도록 script 내용의 SHA-256 앞 12자를 버전으로 쓴다 */
const hashOf = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 12);

function installScripts(input: PolicyInput): Candidate[] {
  const found: Candidate[] = [];
  for (const manifest of input.packageScripts ?? []) {
    if (isExcludedPath(manifest.path)) continue;
    for (const name of INSTALL_SCRIPT_NAMES) {
      const body = manifest.scripts[name];
      if (body !== undefined) found.push({ filePath: manifest.path, packageName: name, version: hashOf(body) });
    }
  }
  return found;
}

/** lock 파일 × host 마다 1건. 받은 패키지의 수는 넣지 않는다(수가 바뀔 때마다 새 검출이 되면 안 된다). */
function lockExternalSources(input: PolicyInput): Candidate[] {
  return (input.lockHosts ?? []).flatMap((lock) =>
    lock.hosts.map((host) => ({ filePath: lock.path, packageName: host, version: "" })),
  );
}

function customRegistries(input: PolicyInput): Candidate[] {
  return input.sources.flatMap((source) =>
    (source.registryHosts ?? []).map((host) => ({ filePath: source.path, packageName: host, version: "" })),
  );
}

/** 파일마다 1건. 키의 이름만 보고하고 토큰의 값은 검출에 넣지 않는다. */
function npmrcTokens(input: PolicyInput): Candidate[] {
  return input.sources.flatMap((source) => {
    const key = source.tokenKeys?.[0];
    return key === undefined ? [] : [{ filePath: source.path, packageName: key, version: "" }];
  });
}

/** 이 org 의 GitHub repo 인가 (https·ssh 주소, 대소문자 무시) 또는 상대 경로인가 */
function isInternalSubmodule(url: string, org: string): boolean {
  const lower = url.toLowerCase();
  if (lower.startsWith("./") || lower.startsWith("../")) return true;
  const name = org.toLowerCase();
  return [`https://github.com/${name}/`, `ssh://github.com/${name}/`, `git@github.com:${name}/`].some((prefix) =>
    lower.startsWith(prefix),
  );
}

function externalSubmodules(input: PolicyInput): Candidate[] {
  return input.sources.flatMap((source) =>
    (source.submodules ?? [])
      .filter((url) => !isInternalSubmodule(url, input.org))
      .map((url) => ({ filePath: source.path, packageName: url, version: "" })),
  );
}

/** package.json 과 보조 파일의 사실을 쓰는 검사 */
const SOURCE_CHECKS: Partial<Record<PolicyCheckId, (input: PolicyInput) => Candidate[]>> = {
  "unpinned-action": unpinnedActions,
  "missing-lockfile": missingLockfiles,
  "non-registry-dependency": nonRegistryDependencies,
  "unpinned-exec": unpinnedExecs,
  "curl-pipe-shell": curlPipes,
  "workflow-no-permissions": workflowsWithoutPermissions,
  "unpinned-image": unpinnedImages,
  "install-script": installScripts,
  "lock-external-source": lockExternalSources,
  "custom-registry": customRegistries,
  "npmrc-token": npmrcTokens,
  "external-submodule": externalSubmodules,
};

/** 활성 policy 항목(스냅샷에서 1번 만들어 repo 마다 쓴다). id 가 내장 검사가 아닌 항목은 무시한다. */
export function createPolicyRules(snapshot: BlacklistEntry[]): PolicyRules {
  const entries = new Map<PolicyCheckId, BlacklistEntry>();
  for (const entry of snapshot) {
    if (entry.ecosystem !== POLICY_ECOSYSTEM) continue;
    const id = POLICY_CHECK_IDS.find((checkId) => checkId === entry.name);
    if (id) entries.set(id, entry);
  }

  return {
    active: new Set(entries.keys()),

    async evaluate(input, logger) {
      const where = `${input.org}/${input.repo}`;
      const matches: PolicyMatch[] = [];
      const add = (id: PolicyCheckId, candidates: Candidate[]): void => {
        const entry = entries.get(id);
        if (!entry) return;
        // 정렬한 순서로 상한(100건)을 적용한다: 입력 순서와 무관하게 남는 검출이 같다.
        const allow = createLimiter(logger, where, id);
        const seen = new Set<string>();
        for (const candidate of [...candidates].sort(compareCandidates)) {
          const key = `${candidate.filePath}\u0000${candidate.packageName}\u0000${candidate.version}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (!allow(entry)) break;
          matches.push({
            repo: input.repo,
            ...candidate,
            dependencyType: "direct",
            blacklistEntryId: entry.id,
          });
        }
      };

      for (const [id, check] of Object.entries(SOURCE_CHECKS) as [PolicyCheckId, (input: PolicyInput) => Candidate[]][]) {
        if (!entries.has(id)) continue;
        add(id, check(input));
        await yieldToLoop();
      }

      // tree 만 쓰는 검사: 정렬한 순서로 한 번 훑는다.
      const wantNodeModules = entries.has("committed-node-modules");
      const wantSuspicious = entries.has("suspicious-filename");
      if (wantNodeModules || wantSuspicious) {
        const sorted = [...input.treePaths].sort();
        let nodeModulesFolder: string | null = null;
        const suspicious: Candidate[] = [];
        for (const [index, path] of sorted.entries()) {
          if (index > 0 && index % YIELD_EVERY_PATHS === 0) await yieldToLoop();
          if (wantNodeModules) {
            const folder = committedNodeModulesFolder(path);
            // 가장 얕은 폴더(조각 수가 적은 것), 같으면 정렬순. 폴더가 여러 개여도 검출 키는 1개로 고정한다.
            if (folder !== null && (nodeModulesFolder === null || isShallower(folder, nodeModulesFolder))) {
              nodeModulesFolder = folder;
            }
          }
          // 정렬했으므로 상한을 넘는 것은 앞에서 이미 정해졌다. 경고를 내려고 1건만 더 모은다.
          if (wantSuspicious && suspicious.length <= MAX_INDICATOR_MATCHES && hasSuspiciousChar(path)) {
            suspicious.push({ filePath: path, packageName: "제어 문자", version: "" });
          }
        }
        if (nodeModulesFolder !== null) add("committed-node-modules", [{ filePath: nodeModulesFolder, packageName: "node_modules", version: "" }]);
        add("suspicious-filename", suspicious);
      }
      return matches;
    },
  };
}
