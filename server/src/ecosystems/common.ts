import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import {
  errorMessage,
  isPlainObject,
  LockfileParseError,
  normalizeText,
  requireContent,
} from "../lockfiles/common.ts";

export { isPlainObject, normalizeText, requireContent };

export function fail(file: string, detail: string): never {
  throw new LockfileParseError(`${file} 을 해석할 수 없습니다: ${detail}`);
}

export const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

type Obj = Record<string, unknown>;

/** 빈 내용·문법 오류는 예외, 결과는 항상 표(객체)다. */
export function readToml(content: string, file: string): Obj {
  const text = requireContent(content, file);
  try {
    return parseToml(text) as Obj;
  } catch (error) {
    return fail(file, errorMessage(error).split("\n")[0] ?? "TOML 문법 오류");
  }
}

export function readYaml(content: string, file: string): Obj {
  const text = requireContent(content, file);
  let data: unknown;
  try {
    data = parseYaml(text);
  } catch (error) {
    return fail(file, errorMessage(error).split("\n")[0] ?? "YAML 문법 오류");
  }
  if (!isPlainObject(data)) return fail(file, "최상위가 표가 아닙니다");
  return data;
}

export function readJson(content: string, file: string): Obj {
  const text = requireContent(content, file);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return fail(file, errorMessage(error));
  }
  if (!isPlainObject(data)) return fail(file, "최상위가 객체가 아닙니다");
  return data;
}

const XML = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

/** 문법 검사(XMLParser 는 깨진 문서를 조용히 읽는다)를 먼저 하고 읽는다. */
export function readXml(content: string, file: string): Obj {
  const text = requireContent(content, file);
  const valid = XMLValidator.validate(text);
  if (valid !== true) return fail(file, valid.err.msg);
  return XML.parse(text) as Obj;
}

export function asTable(value: unknown): Obj | null {
  return isPlainObject(value) ? value : null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** 값이 문자열 또는 숫자면 문자열로. 그 외 null. */
export function scalarText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}
