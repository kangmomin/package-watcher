import { ECOSYSTEM_RULES, normalizeImageName } from "@pw/shared";
import type { ActionRef, ImageRef } from "./types.ts";

const TAG = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]+$/i;

/**
 * `[registry[:port]/]repo[:tag][@sha256:…]` 를 나눈다. 마지막 `/` 뒤의 `:` 만 tag 의 구분자다
 * (`host:5000/img` 의 포트와 구분). 이름이 docker 규칙을 통과하지 못하면(변수 등) null.
 */
export function parseImageRef(raw: string): ImageRef | null {
  let rest = raw.trim();
  if (rest === "" || /\s/.test(rest)) return null;
  let digest = "";
  const at = rest.indexOf("@");
  if (at >= 0) {
    digest = rest.slice(at + 1);
    if (!DIGEST.test(digest)) return null;
    digest = digest.toLowerCase();
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
  if (ECOSYSTEM_RULES.docker.validateName(name) !== null) return null;
  return { name, tag: tag === "" && digest === "" ? "latest" : tag, digest, raw: raw.trim() };
}

/** `uses:` 의 값. 로컬 경로·표현식(`${{`)·형식 오류는 null 을 낸다. */
export function parseUses(value: string): { action: ActionRef } | { image: ImageRef } | null {
  const raw = value.trim();
  if (raw === "" || raw.includes("${{") || raw.startsWith(".")) return null;
  if (raw.startsWith("docker://")) {
    const image = parseImageRef(raw.slice("docker://".length));
    return image ? { image } : null;
  }
  const at = raw.indexOf("@");
  const parts = (at >= 0 ? raw.slice(0, at) : raw).split("/");
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  const name = `${parts[0]}/${parts[1]}`.toLowerCase();
  if (ECOSYSTEM_RULES.actions.validateName(name) !== null) return null;
  return { action: { name, ref: at >= 0 ? raw.slice(at + 1) : "", raw } };
}
