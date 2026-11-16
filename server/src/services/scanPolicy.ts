import { POLICY_CHECK_IDS, POLICY_ECOSYSTEM, type BlacklistEntry, type PolicyCheckId } from "@pw/shared";
import type { Logger } from "../logger.ts";
import { isRunCommand, type SourceFacts, type SourceKind } from "../sources/index.ts";
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
function hasControlChar(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
/** `user/repo`, `user/repo#ref` 축약형 (npm 이 GitHub 으로 읽는다) */
const GITHUB_SHORTHAND = /^[A-Za-z0-9][\w.-]*\/[\w.-]+(?:#\S*)?$/;
const REGISTRY_PREFIXES = ["git+", "git://", "http://", "https://", "github:", "gitlab:", "bitbucket:"];
const EXCLUDED_PREFIXES = ["workspace:", "link:", "npm:"];
const ARCHIVE_SUFFIX = /\.(?:tgz|tar\.gz)$/;
const RELATIVE_PATH = /^(?:\.{1,2}\/|~\/|\/)/;

/** registry 밖에서 받는 spec 인가: git·URL·`user/repo`, 그리고 `.tgz` 파일(`file:` 또는 상대 경로) */
export function isNonRegistrySpec(spec: string): boolean {
  const trimmed = spec.trim();
  const lower = trimmed.toLowerCase();
  if (EXCLUDED_PREFIXES.some((prefix) => lower.startsWith(prefix))) return false;
  if (REGISTRY_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  if (GITHUB_SHORTHAND.test(trimmed)) return true;
  return (lower.startsWith("file:") || RELATIVE_PATH.test(lower)) && ARCHIVE_SUFFIX.test(lower);
}

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
    .filter((manifest) => !manifest.locked && manifest.dependencies.length > 0)
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
  // 같은 repo 의 package.json 에 선언된 이름은 로컬 실행 파일이다 (`npx vitest`).
  const declared = new Set(input.manifests.flatMap((manifest) => manifest.dependencies.map((dep) => dep.name)));
  const found: Candidate[] = [];
  for (const source of input.sources) {
    for (const command of source.commands) {
      if (!isRunCommand(command) || command.version !== "" || declared.has(command.name)) continue;
      found.push({
        filePath: source.path,
        packageName: command.name,
        version: cleanVersion(versionPartOf(command.raw)),
      });
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

/** package.json 과 보조 파일의 사실을 쓰는 검사 */
const SOURCE_CHECKS: Partial<Record<PolicyCheckId, (input: PolicyInput) => Candidate[]>> = {
  "unpinned-action": unpinnedActions,
  "missing-lockfile": missingLockfiles,
  "non-registry-dependency": nonRegistryDependencies,
  "unpinned-exec": unpinnedExecs,
  "curl-pipe-shell": curlPipes,
  "workflow-no-permissions": workflowsWithoutPermissions,
  "unpinned-image": unpinnedImages,
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
          if (wantNodeModules && nodeModulesFolder === null) nodeModulesFolder = committedNodeModulesFolder(path);
          // 정렬했으므로 상한을 넘는 것은 앞에서 이미 정해졌다. 경고를 내려고 1건만 더 모은다.
          if (wantSuspicious && suspicious.length <= MAX_INDICATOR_MATCHES && hasControlChar(path)) {
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
