import { normalizeText } from "../lockfiles/common.ts";
import { MAX_ITEMS } from "./limits.ts";

const URL_LINE = /^url\s*=\s*(.*)$/;
/** `scheme://user:p@ss@host` 의 userinfo 는 마지막 `@` 까지다 */
const USERINFO = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/\s]*@/;
const MAX_URL = 200;

/** 따옴표로 감싼 값은 그 안, 아니면 공백 뒤의 `;`·`#` 인라인 주석을 뗀 값 */
function valueOf(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1);
    return end === -1 ? trimmed.slice(1) : trimmed.slice(1, end);
  }
  const comment = trimmed.search(/\s[;#]/);
  return (comment === -1 ? trimmed : trimmed.slice(0, comment)).trim();
}

/** `.gitmodules` 의 submodule url. `scheme://user:pass@host` 의 자격 증명은 떼고 200자로 자른다. */
export function extractGitmodules(content: string): string[] {
  const urls: string[] = [];
  for (const raw of normalizeText(content).split("\n")) {
    if (urls.length >= MAX_ITEMS) break;
    const match = URL_LINE.exec(raw.trim());
    const url = valueOf(match?.[1] ?? "");
    if (url === "") continue;
    urls.push(url.replace(USERINFO, "$1").slice(0, MAX_URL));
  }
  return urls;
}
