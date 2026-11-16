import { parse as parseYaml } from "yaml";
import { isPlainObject } from "../lockfiles/common.ts";
import { extractCommandPackages } from "./commands.ts";
import { parseImageRef, parseUses } from "./images.ts";
import type { SourceRefs } from "./types.ts";

/** `uses` 값 1개를 모은다(action 또는 docker:// 이미지). */
export function collectUses(value: unknown, out: SourceRefs): void {
  if (typeof value !== "string") return;
  const parsed = parseUses(value);
  if (!parsed) return;
  if ("action" in parsed) out.actions.push(parsed.action);
  else out.images.push(parsed.image);
}

function collectImage(value: unknown, out: SourceRefs): void {
  if (typeof value !== "string" || value.includes("${{")) return;
  const image = parseImageRef(value);
  if (image) out.images.push(image);
}

/** 모든 step 에서 `uses`(action·docker://)와 `run`(명령 패키지)을 모은다. */
export function collectSteps(steps: unknown, out: SourceRefs): void {
  if (!Array.isArray(steps)) return;
  for (const step of steps) {
    if (!isPlainObject(step)) continue;
    collectUses(step.uses, out);
    if (typeof step.run === "string") for (const pkg of extractCommandPackages(step.run)) out.commands.push(pkg);
  }
}

/**
 * workflow 에서 명령(`steps[].run`), action(`steps[].uses`, job 의 `uses`), 이미지(`docker://`, `container`,
 * `services.*.image`)를 모은다. YAML 문법 오류는 그대로 throw 한다.
 */
export function extractWorkflow(content: string): SourceRefs {
  const out: SourceRefs = { commands: [], actions: [], images: [] };
  const data: unknown = parseYaml(content);
  if (!isPlainObject(data) || !isPlainObject(data.jobs)) return out;
  for (const job of Object.values(data.jobs)) {
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
  return out;
}

/** `action.yml`: composite 의 `runs.steps` 와 docker action 의 `runs.image: docker://…`. */
export function extractActionFile(content: string): SourceRefs {
  const out: SourceRefs = { commands: [], actions: [], images: [] };
  const data: unknown = parseYaml(content);
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
  const data: unknown = parseYaml(content);
  if (!isPlainObject(data) || !isPlainObject(data.services)) return out;
  for (const service of Object.values(data.services)) {
    if (!isPlainObject(service) || typeof service.image !== "string") continue;
    const resolved = service.image.replace(/\$\{[A-Za-z_]\w*:?-([^}]*)\}/g, "$1");
    if (resolved.includes("$")) continue;
    collectImage(resolved, out);
  }
  return out;
}
