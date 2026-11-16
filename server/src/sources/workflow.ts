import { parse as parseYaml } from "yaml";
import { isPlainObject } from "../lockfiles/common.ts";
import { extractCommandPackages } from "./commands.ts";
import { hasCurlPipeShell } from "./curlPipe.ts";
import { MAX_REF_LENGTH, parseImageRef, parseUses } from "./images.ts";
import type { SourceRefs } from "./types.ts";

/** 알 수 없는 tag(`!override` 등)의 경고를 stderr 에 내지 않고, `<<: *anchor` 병합을 푼다. */
const YAML_OPTIONS = { logLevel: "error", merge: true } as const;

/** `uses` 값 1개를 모은다(action 또는 docker:// 이미지). */
export function collectUses(value: unknown, out: SourceRefs): void {
  if (typeof value !== "string") return;
  const parsed = parseUses(value);
  if (!parsed) return;
  if ("action" in parsed) out.actions.push(parsed.action);
  else out.images.push(parsed.image);
}

function collectImage(value: unknown, out: SourceRefs): void {
  if (typeof value !== "string" || value.length > MAX_REF_LENGTH || value.includes("${{")) return;
  const image = parseImageRef(value);
  if (image) out.images.push(image);
}

/** 모든 step 에서 `uses`(action·docker://)와 `run`(명령 패키지)을 모은다. */
export function collectSteps(steps: unknown, out: SourceRefs): void {
  if (!Array.isArray(steps)) return;
  for (const step of steps) {
    if (!isPlainObject(step)) continue;
    collectUses(step.uses, out);
    if (typeof step.run === "string") {
      for (const pkg of extractCommandPackages(step.run)) out.commands.push(pkg);
      if (!out.curlPipe && hasCurlPipeShell(step.run)) out.curlPipe = true;
    }
  }
}

/**
 * workflow 에서 명령(`steps[].run`), action(`steps[].uses`, job 의 `uses`), 이미지(`docker://`, `container`,
 * `services.*.image`)를 모은다. YAML 문법 오류는 그대로 throw 한다.
 */
export function extractWorkflow(content: string): SourceRefs {
  return extractWorkflowFacts(content).refs;
}

/**
 * `extractWorkflow` + permissions 판정. 최상위 `permissions` 가 있거나, job 이 1개 이상이고 모두 `permissions` 가 있으면
 * 통과다. jobs 가 없는 파일(빈 파일, workflow 가 아닌 YAML)은 판정할 수 없으므로 missing 이 아니다.
 */
export function extractWorkflowFacts(content: string): { refs: SourceRefs; missingPermissions: boolean } {
  const out: SourceRefs = { commands: [], actions: [], images: [] };
  const data: unknown = parseYaml(content, YAML_OPTIONS);
  if (!isPlainObject(data) || !isPlainObject(data.jobs)) return { refs: out, missingPermissions: false };
  const jobs = Object.values(data.jobs);
  const missingPermissions =
    !("permissions" in data) && !(jobs.length > 0 && jobs.every((job) => isPlainObject(job) && "permissions" in job));
  for (const job of jobs) {
    if (!isPlainObject(job)) continue;
    collectUses(job.uses, out);
    collectSteps(job.steps, out);
    collectImage(isPlainObject(job.container) ? job.container.image : job.container, out);
    if (isPlainObject(job.services)) {
      for (const service of Object.values(job.services)) {
        if (isPlainObject(service)) collectImage(service.image, out);
      }
    }
  }
  return { refs: out, missingPermissions };
}

/** `action.yml`: composite 의 `runs.steps` 와 docker action 의 `runs.image: docker://…`. */
export function extractActionFile(content: string): SourceRefs {
  const out: SourceRefs = { commands: [], actions: [], images: [] };
  const data: unknown = parseYaml(content, YAML_OPTIONS);
  if (!isPlainObject(data) || !isPlainObject(data.runs)) return out;
  collectSteps(data.runs.steps, out);
  if (typeof data.runs.image === "string" && data.runs.image.startsWith("docker://")) {
    collectImage(data.runs.image.slice("docker://".length), out);
  }
  return out;
}

/** compose 의 `services.*.image`. `${VAR:-기본값}` 은 기본값으로 풀고 풀 수 없으면 건너뛴다. */
export function extractComposeImages(content: string): SourceRefs {
  const out: SourceRefs = { commands: [], actions: [], images: [] };
  const data: unknown = parseYaml(content, YAML_OPTIONS);
  if (!isPlainObject(data) || !isPlainObject(data.services)) return out;
  for (const service of Object.values(data.services)) {
    if (!isPlainObject(service) || typeof service.image !== "string") continue;
    if (service.image.length > MAX_REF_LENGTH) continue;
    const resolved = service.image.replace(/\$\{[A-Za-z_]\w*:?-([^}]{0,256})\}/g, "$1");
    if (resolved.includes("$")) continue;
    collectImage(resolved, out);
  }
  return out;
}
