import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { isPlainObject, normalizeText } from "../lockfiles/common.ts";
import { MAX_ITEMS } from "./limits.ts";
import type { VscodeExtension } from "./types.ts";

const EXTENSION_ID = /^[A-Za-z0-9][A-Za-z0-9-]*\.[A-Za-z0-9][A-Za-z0-9._-]*$/;

function listOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * `.vscode/extensions.json` 의 `recommendations`, devcontainer.json 의 `customizations.vscode.extensions` 와 옛 형식 `extensions`.
 * JSONC(주석·후행 쉼표) 허용. 문법 오류는 throw. `publisher.name` 형식이 아닌 항목은 건너뛴다.
 */
export function extractVscode(content: string): VscodeExtension[] {
  const errors: ParseError[] = [];
  const data: unknown = parseJsonc(normalizeText(content), errors, { allowTrailingComma: true });
  if (errors.length > 0) throw new Error("VS Code 설정을 JSON 으로 읽을 수 없습니다");
  if (!isPlainObject(data)) return [];
  const customizations = isPlainObject(data.customizations) ? data.customizations : {};
  const vscode = isPlainObject(customizations.vscode) ? customizations.vscode : {};
  const raws = [...listOf(data.recommendations), ...listOf(vscode.extensions), ...listOf(data.extensions)];
  const found: VscodeExtension[] = [];
  for (const raw of raws) {
    if (found.length >= MAX_ITEMS) break;
    const at = raw.indexOf("@");
    const id = at === -1 ? raw : raw.slice(0, at);
    if (!EXTENSION_ID.test(id)) continue;
    found.push({ name: id.toLowerCase(), version: at === -1 ? "" : raw.slice(at + 1).trim(), raw });
  }
  return found;
}
