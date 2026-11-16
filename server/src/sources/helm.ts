import { parse as parseYaml } from "yaml";
import { isPlainObject, normalizeText } from "../lockfiles/common.ts";
import { MAX_ITEMS } from "./limits.ts";
import type { HelmChart } from "./types.ts";

/** 정확한 버전이다 (`1.2.3`, `v1.2.3-rc.1`). 범위(`^1.0`, `>=1`, `1.x`)는 아니다. */
const EXACT = /^v?\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?$/;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");

/** Chart.yaml·Chart.lock·requirements.yaml 의 `dependencies[]`. YAML 문법 오류는 throw. */
export function extractHelm(content: string): HelmChart[] {
  const data: unknown = parseYaml(normalizeText(content), { logLevel: "error" });
  if (!isPlainObject(data) || !Array.isArray(data.dependencies)) return [];
  const charts: HelmChart[] = [];
  for (const item of data.dependencies) {
    if (charts.length >= MAX_ITEMS) break;
    if (!isPlainObject(item)) continue;
    const name = text(item.name);
    if (name === "") continue;
    const rawVersion = text(item.version);
    charts.push({
      name,
      version: EXACT.test(rawVersion) ? rawVersion : "",
      repository: text(item.repository),
      raw: rawVersion === "" ? name : `${name}@${rawVersion}`,
    });
  }
  return charts;
}
