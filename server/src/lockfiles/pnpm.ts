import { valid } from "semver";
import { parse as parseYaml } from "yaml";
import { errorMessage, isPlainObject, LockfileParseError, requireContent } from "./common.ts";
import type { LockPackage } from "./index.ts";

/**
 * `pnpm-lock.yaml`. `packages` 만 읽는다(v9 의 `snapshots` 무시).
 * 키 형식: v5 `/name/1.0.0_peer`, v6 `/name@1.0.0(peer)`, v9 `name@1.0.0(peer)` — peer suffix 를 뗀다.
 * git/tarball 항목은 `name`/`version` 필드에서 읽는다.
 * 공통: UTF-8 BOM 제거, CRLF → LF. 파싱 실패·빈 입력은 예외.
 */
export function parsePnpmLock(content: string): LockPackage[] {
  const text = requireContent(content, "pnpm-lock.yaml");
  let data: unknown;
  try {
    data = parseYaml(text);
  } catch (error) {
    throw new LockfileParseError(`pnpm-lock.yaml 을 해석할 수 없습니다: ${errorMessage(error)}`);
  }
  if (!isPlainObject(data) || data.lockfileVersion === undefined || data.lockfileVersion === null) {
    throw new LockfileParseError("pnpm-lock.yaml 에 형식 표지(lockfileVersion)가 없습니다");
  }
  if (data.packages === undefined || data.packages === null) return [];
  if (!isPlainObject(data.packages)) {
    throw new LockfileParseError("pnpm-lock.yaml 의 packages 형식이 올바르지 않습니다");
  }

  // v5 는 `/name/version` 키, v6 이상은 `name@version` 키를 쓴다.
  const slashKeys = Number.parseFloat(String(data.lockfileVersion)) < 6;
  const packages: LockPackage[] = [];
  for (const [key, value] of Object.entries(data.packages)) {
    const entry = readEntry(key, isPlainObject(value) ? value : {}, slashKeys);
    if (entry) packages.push(entry);
  }
  return packages;
}

function readEntry(
  key: string,
  fields: Record<string, unknown>,
  slashKeys: boolean,
): LockPackage | null {
  const fieldName = typeof fields.name === "string" && fields.name !== "" ? fields.name : null;
  const fieldVersion =
    typeof fields.version === "string" || typeof fields.version === "number"
      ? String(fields.version)
      : null;
  // git/tarball 항목은 키에 버전이 없고 name/version 필드를 가진다.
  if (fieldName && fieldVersion) return { name: fieldName, version: fieldVersion };

  const parsed = slashKeys ? parseSlashKey(key) : parseAtKey(key);
  if (!parsed) return null;
  if (valid(parsed.version)) return parsed;
  if (fieldVersion && valid(fieldVersion)) return { name: parsed.name, version: fieldVersion };
  // 이름과 버전을 확실히 알 수 없는 항목(v9 의 git 항목 등)은 건너뛴다(S-13).
  return null;
}

/** v5: `/name/1.0.0_peer`, `/@scope/name/1.0.0` */
function parseSlashKey(key: string): LockPackage | null {
  const parts = (key.startsWith("/") ? key.slice(1) : key).split("/");
  const scoped = parts[0]?.startsWith("@") ?? false;
  const name = scoped ? `${parts[0]}/${parts[1] ?? ""}` : parts[0];
  const rawVersion = scoped ? parts[2] : parts[1];
  if (!name || !rawVersion || name.endsWith("/")) return null;
  const version = rawVersion.split(/[_(]/)[0] ?? "";
  return version === "" ? null : { name, version };
}

/** v6: `/name@1.0.0(peer)`, v9: `name@1.0.0(peer)` */
function parseAtKey(key: string): LockPackage | null {
  const withoutSlash = key.startsWith("/") ? key.slice(1) : key;
  const paren = withoutSlash.indexOf("(");
  const base = paren === -1 ? withoutSlash : withoutSlash.slice(0, paren);
  const at = base.lastIndexOf("@");
  if (at <= 0) return null;
  const version = base.slice(at + 1);
  return version === "" ? null : { name: base.slice(0, at), version };
}
