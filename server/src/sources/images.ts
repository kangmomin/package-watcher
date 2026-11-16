import { ECOSYSTEM_RULES, normalizeImageName } from "@pw/shared";
import type { ActionRef, ImageRef } from "./types.ts";

const TAG = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const DIGEST = /^([a-z0-9]+):[0-9a-f]+$/i;
/** 이보다 긴 토큰은 치환·분해 전에 건너뛴다(중첩 변수의 이차 비용 방지) */
export const MAX_REF_LENGTH = 512;
/** 패턴 문자는 저장된 항목의 이름에만 쓴다. 파일에서 읽은 이름에 있으면 항목의 패턴과 섞일 수 있다. */
const hasWildcard = (name: string): boolean => /[*?]/.test(name);

/**
 * `[registry[:port]/]repo[:tag][@sha256:…]` 를 나눈다. 마지막 `/` 뒤의 `:` 만 tag 의 구분자다
 * (`host:5000/img` 의 포트와 구분). 이름이 docker 규칙을 통과하지 못하면(변수 등) null.
 */
export function parseImageRef(raw: string): ImageRef | null {
  let rest = raw.trim();
  if (rest === "" || rest.length > MAX_REF_LENGTH || /\s/.test(rest)) return null;
  let digest = "";
  const at = rest.indexOf("@");
  if (at >= 0) {
    digest = rest.slice(at + 1);
    const algorithm = DIGEST.exec(digest)?.[1];
    if (algorithm === undefined) return null;
    // sha256 이 아닌 digest 는 비교할 수 없으므로 버리고 이름과 tag 는 살린다.
    digest = algorithm.toLowerCase() === "sha256" ? digest.toLowerCase() : "";
    rest = rest.slice(0, at);
  }
  let tag = "";
  const colon = rest.indexOf(":", rest.lastIndexOf("/") + 1);
  if (colon >= 0) {
    tag = rest.slice(colon + 1);
    rest = rest.slice(0, colon);
    if (!TAG.test(tag)) return null;
  }
  const name = normalizeImageName(rest);
  if (hasWildcard(name) || ECOSYSTEM_RULES.docker.validateName(name) !== null) return null;
  return { name, tag: tag === "" && digest === "" ? "latest" : tag, digest, raw: raw.trim() };
}

/** `uses:` 의 값. 로컬 경로·표현식(`${{`)·형식 오류는 null 을 낸다. */
export function parseUses(value: string): { action: ActionRef } | { image: ImageRef } | null {
  const raw = value.trim();
  if (raw === "" || raw.length > MAX_REF_LENGTH || raw.includes("${{") || raw.startsWith(".")) return null;
  if (raw.startsWith("docker://")) {
    const image = parseImageRef(raw.slice("docker://".length));
    return image ? { image } : null;
  }
  const at = raw.indexOf("@");
  const parts = (at >= 0 ? raw.slice(0, at) : raw).split("/");
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  const name = `${parts[0]}/${parts[1]}`.toLowerCase();
  if (hasWildcard(name) || ECOSYSTEM_RULES.actions.validateName(name) !== null) return null;
  return { action: { name, ref: at >= 0 ? raw.slice(at + 1) : "", raw } };
}
