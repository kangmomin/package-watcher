import { parse as parseYaml } from "yaml";
import { isPlainObject } from "../lockfiles/common.ts";
import { extractCommandPackages } from "./commands.ts";
import type { CommandPackage } from "./types.ts";

/** 모든 job 의 `steps[].run` 에서 명령 패키지를 모은다. YAML 문법 오류는 그대로 throw 한다. */
export function extractWorkflowCommands(content: string): CommandPackage[] {
  const data: unknown = parseYaml(content);
  if (!isPlainObject(data) || !isPlainObject(data.jobs)) return [];
  const found: CommandPackage[] = [];
  for (const job of Object.values(data.jobs)) {
    if (!isPlainObject(job) || !Array.isArray(job.steps)) continue;
    for (const step of job.steps) {
      if (!isPlainObject(step) || typeof step.run !== "string") continue;
      for (const pkg of extractCommandPackages(step.run)) found.push(pkg);
    }
  }
  return found;
}
