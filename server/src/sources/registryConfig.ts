import { baseName, isPlainObject, readToml } from "../ecosystems/common.ts";
import { normalizeText } from "../lockfiles/common.ts";
import { OFFICIAL_NPM_HOSTS } from "../lockfiles/resolvedHosts.ts";
import { MAX_ITEMS } from "./limits.ts";

export interface RegistryConfigFacts {
  /** 공식이 아닌 registry 의 host (소문자, 포트 포함, 정렬·중복 없음) */
  registryHosts: string[];
  /** 토큰의 **값**이 적힌 키의 이름. 값은 어디에도 담지 않는다. */
  tokenKeys: string[];
}

const OFFICIAL_PYPI_HOSTS: ReadonlySet<string> = new Set(["pypi.org", "files.pythonhosted.org"]);
/** 이 길이 미만의 값은 토큰이 아니라 자리 표시로 본다 */
const MIN_TOKEN_LENGTH = 8;
const NPM_TOKEN_KEY = /(?:^|:)(_authToken|_auth|_password)$/;

const unquote = (value: string): string => value.trim().replace(/^(["'])(.*)\1$/, "$2");

/** URL 에 환경 변수가 들어 있어 host 를 알 수 없을 때의 표시 */
export const ENV_HOST = "(환경 변수)";
const HAS_ENV = /\$\{|\$[A-Za-z_]/;

/** http(s) URL 의 host(소문자, 포트 포함). 공식 registry 이거나 URL 이 아니면 null */
function customHost(text: string, official: ReadonlySet<string>): string | null {
  const value = unquote(text);
  if (HAS_ENV.test(value)) return ENV_HOST;
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    const host = new URL(value).host.toLowerCase();
    return host === "" || official.has(host) ? null : host;
  } catch {
    return null;
  }
}

/** 값이 `${ENV}` 치환이 아니고 8자 이상이면 토큰의 값이다 */
const isTokenValue = (value: string): boolean => {
  const text = unquote(value);
  return text.length >= MIN_TOKEN_LENGTH && !text.includes("${");
};

function lines(content: string): string[] {
  return normalizeText(content).split("\n").slice(0, 100_000);
}

function npmrc(content: string): RegistryConfigFacts {
  const hosts: string[] = [];
  const tokenKeys = new Set<string>();
  for (const raw of lines(content)) {
    const line = raw.trim();
    if (line === "" || line.startsWith(";") || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1);
    if (key === "registry" || key.endsWith(":registry")) {
      const host = customHost(value, OFFICIAL_NPM_HOSTS);
      if (host !== null) hosts.push(host);
      continue;
    }
    const tokenKey = NPM_TOKEN_KEY.exec(key)?.[1];
    if (tokenKey !== undefined && isTokenValue(value)) tokenKeys.add(tokenKey);
  }
  return { registryHosts: finish(hosts), tokenKeys: [...tokenKeys].sort() };
}

function yarnrc(content: string): RegistryConfigFacts {
  const tokenKeys = new Set<string>();
  const hosts: string[] = [];
  for (const raw of lines(content)) {
    const server = /^\s*npmRegistryServer\s*:\s*(.*)$/.exec(raw);
    if (server) {
      const text = server[1] as string;
      const comment = text.search(/\s#/);
      const host = customHost(comment === -1 ? text : text.slice(0, comment), OFFICIAL_NPM_HOSTS);
      if (host !== null) hosts.push(host);
      continue;
    }
    const match = /^\s*npmAuthToken\s*:\s*(.*)$/.exec(raw);
    if (!match) continue;
    const text = match[1] as string;
    const comment = text.search(/\s#/);
    const value = comment === -1 ? text : text.slice(0, comment);
    if (isTokenValue(value)) tokenKeys.add("npmAuthToken");
  }
  return { registryHosts: finish(hosts), tokenKeys: [...tokenKeys].sort() };
}

const PIP_KEYS = new Set(["index-url", "index_url", "extra-index-url", "extra_index_url"]);

/** pip.conf·pip.ini: INI. 값이 여러 줄이면 들여쓴 줄이 이어진다. */
function pip(content: string): RegistryConfigFacts {
  const hosts: string[] = [];
  let active = false;
  for (const raw of lines(content)) {
    if (raw.trim() === "" || /^\s*[;#]/.test(raw)) continue;
    let value: string | null = null;
    if (/^\s/.test(raw) && active) {
      value = raw;
    } else {
      const match = /^([A-Za-z_-]+)\s*[=:]\s*(.*)$/.exec(raw);
      active = match !== null && PIP_KEYS.has((match[1] as string).toLowerCase());
      value = active ? (match?.[2] ?? "") : null;
    }
    if (value === null) continue;
    for (const token of value.split(/\s+/)) {
      const host = customHost(token, OFFICIAL_PYPI_HOSTS);
      if (host !== null) hosts.push(host);
    }
  }
  return { registryHosts: finish(hosts), tokenKeys: [] };
}

const stringsOf = (value: unknown): string[] =>
  typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** `[{ url }]` 형태의 표 목록에서 url */
const urlsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.flatMap((item) => (isPlainObject(item) ? stringsOf(item.url) : [])) : [];

function toml(path: string, content: string): RegistryConfigFacts {
  const data = readToml(content, path, { allowEmpty: true });
  const urls: string[] = [];
  const addUv = (table: unknown): void => {
    if (!isPlainObject(table)) return;
    urls.push(...stringsOf(table["index-url"]), ...stringsOf(table["extra-index-url"]), ...urlsOf(table.index));
  };
  if (baseName(path) === "uv.toml") {
    addUv(data);
    addUv(data.pip);
  } else {
    const tool = isPlainObject(data.tool) ? data.tool : {};
    addUv(tool.uv);
    if (isPlainObject(tool.uv)) addUv(tool.uv.pip);
    if (isPlainObject(tool.poetry)) urls.push(...urlsOf(tool.poetry.source));
  }
  const hosts = urls.map((url) => customHost(url, OFFICIAL_PYPI_HOSTS)).filter((host): host is string => host !== null);
  return { registryHosts: finish(hosts), tokenKeys: [] };
}

function requirements(content: string): RegistryConfigFacts {
  const hosts: string[] = [];
  // 줄 끝의 `\` 는 다음 줄과 한 줄이다.
  const joined = normalizeText(content).replace(/\\\n/g, " ").split("\n").slice(0, 100_000);
  for (const raw of joined) {
    const line = raw.replace(/(^|\s)#.*$/, "").trim();
    const match = /^(?:--extra-index-url|--index-url|-i)\s*=?\s*(\S+)/.exec(line);
    const host = match ? customHost(match[1] as string, OFFICIAL_PYPI_HOSTS) : null;
    if (host !== null) hosts.push(host);
  }
  return { registryHosts: finish(hosts), tokenKeys: [] };
}

const finish = (hosts: string[]): string[] => [...new Set(hosts)].sort().slice(0, MAX_ITEMS);

/**
 * registry 설정 파일(.npmrc, .yarnrc.yml, pip.conf·pip.ini, uv.toml, pyproject.toml, requirements*.txt)에서
 * 공식이 아닌 registry 의 host 와 토큰이 적힌 키의 이름을 뽑는다. 토큰의 값은 반환하지 않는다. TOML 문법 오류는 throw.
 */
export function extractRegistryConfig(path: string, content: string): RegistryConfigFacts {
  const name = baseName(path);
  if (name === ".npmrc") return npmrc(content);
  if (name === ".yarnrc.yml") return yarnrc(content);
  if (name === "pip.conf" || name === "pip.ini") return pip(content);
  if (name === "uv.toml" || name === "pyproject.toml") return toml(path, content);
  return requirements(content);
}
