/** 파일 내용을 해석할 수 없다. 스캔은 그 repo 를 failedRepos 에 기록한다(EC-13). */
export class LockfileParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockfileParseError";
  }
}

const BOM = "﻿";

/** UTF-8 BOM 제거, CRLF → LF */
export function normalizeText(content: string): string {
  const text = content.startsWith(BOM) ? content.slice(1) : content;
  return text.replace(/\r\n?/g, "\n");
}

/** 정규화한 내용. 비어 있으면 예외. */
export function requireContent(content: string, file: string): string {
  const text = normalizeText(content);
  if (text.trim() === "") throw new LockfileParseError(`${file} 이 비어 있습니다`);
  return text;
}

/**
 * yarn 이름 규칙: `@` 로 시작하면 두 번째 `@` 앞, 아니면 첫 `@` 앞이 이름이다.
 * `rest` 는 `@` 뒤의 나머지(버전·range·프로토콜)이고 `@` 가 없으면 null.
 */
export function splitNameAndRest(spec: string): { name: string; rest: string | null } {
  const at = spec.indexOf("@", spec.startsWith("@") ? 1 : 0);
  if (at <= 0) return { name: spec, rest: null };
  return { name: spec.slice(0, at), rest: spec.slice(at + 1) };
}

/** `npm:real@1.2.3` 별칭이면 실제 이름과 나머지로 분해한다. */
export function unwrapNpmAlias(name: string, rest: string): { name: string; rest: string } {
  if (!rest.startsWith("npm:")) return { name, rest };
  const inner = splitNameAndRest(rest.slice("npm:".length));
  return { name: inner.name, rest: inner.rest ?? "" };
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 배열이면 문자열 원소만, 아니면 `[]` */
export function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
