import { normalizeText } from "../lockfiles/common.ts";
import { MAX_ITEMS } from "./limits.ts";

const URL_LINE = /^url\s*=\s*(.*)$/;
const USERINFO = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/@\s]*@/;
const MAX_URL = 200;

/** `.gitmodules` 의 submodule url. `scheme://user:pass@host` 의 자격 증명은 떼고 200자로 자른다. */
export function extractGitmodules(content: string): string[] {
  const urls: string[] = [];
  for (const raw of normalizeText(content).split("\n")) {
    if (urls.length >= MAX_ITEMS) break;
    const match = URL_LINE.exec(raw.trim());
    const url = match?.[1]?.trim().replace(/^"(.*)"$/, "$1") ?? "";
    if (url === "") continue;
    urls.push(url.replace(USERINFO, "$1").slice(0, MAX_URL));
  }
  return urls;
}
