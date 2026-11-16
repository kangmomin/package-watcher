import { ECOSYSTEM_RULES } from "@pw/shared";
import type { CommandPackage } from "./types.ts";

// ---------------------------------------------------------------- 셸 토큰화

/** 구분자(`&&`, `||`, `;`, `|`, `&`, 줄바꿈)로 명령을 나누고 공백으로 토큰을 나눈다. 따옴표는 벗긴다. */
function tokenize(text: string): string[][] {
  const source = text.replace(/\\\r?\n/g, " ");
  const commands: string[][] = [];
  let tokens: string[] = [];
  let token = "";
  let hasToken = false;
  const endToken = (): void => {
    if (hasToken) tokens.push(token);
    token = "";
    hasToken = false;
  };
  const endCommand = (): void => {
    endToken();
    if (tokens.length > 0) commands.push(tokens);
    tokens = [];
  };

  let i = 0;
  while (i < source.length) {
    const char = source[i] as string;
    const next = source[i + 1];
    if (char === "'") {
      const end = source.indexOf("'", i + 1);
      const stop = end === -1 ? source.length : end;
      token += source.slice(i + 1, stop);
      hasToken = true;
      i = stop + 1;
    } else if (char === '"') {
      i += 1;
      hasToken = true;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === "\\" && i + 1 < source.length) i += 1;
        token += source[i];
        i += 1;
      }
      i += 1;
    } else if (char === "$" && (next === "(" || next === "{")) {
      // `$(…)`, `${…}`, `${{ … }}` 는 안의 공백과 구분자를 포함해 토큰 1개로 둔다. 패키지로는 쓰지 않는다.
      let depth = 0;
      let j = i + 1;
      for (; j < source.length; j += 1) {
        const c = source[j];
        if (c === "(" || c === "{") depth += 1;
        else if ((c === ")" || c === "}") && --depth === 0) break;
      }
      token += source.slice(i, j + 1);
      hasToken = true;
      i = j + 1;
    } else if (char === "\\" && next !== undefined && next !== "\n") {
      token += next;
      hasToken = true;
      i += 2;
    } else if (char === "\n" || char === ";" || char === "|") {
      endCommand();
      i += char === "|" && next === "|" ? 2 : 1;
    } else if (char === "&") {
      // `2>&1`, `&>` 의 & 는 리다이렉션이다.
      if (source[i - 1] === ">" || next === ">") {
        token += char;
        hasToken = true;
        i += 1;
      } else {
        endCommand();
        i += next === "&" ? 2 : 1;
      }
    } else if (char === " " || char === "\t" || char === "\r") {
      endToken();
      i += 1;
    } else {
      token += char;
      hasToken = true;
      i += 1;
    }
  }
  endCommand();
  return commands;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const PREFIXES = new Set(["sudo", "time", "env", "nohup", "exec", "command"]);

/** `sudo`, `env X=1`, `time`, `FOO=1` 같은 접두를 건너뛴다. */
function stripPrefixes(tokens: string[]): string[] {
  let at = 0;
  while (at < tokens.length) {
    const token = tokens[at] as string;
    if (ASSIGNMENT.test(token)) at += 1;
    else if (PREFIXES.has(token)) {
      at += 1;
      while (at < tokens.length && (tokens[at] as string).startsWith("-")) at += 1;
    } else break;
  }
  return tokens.slice(at);
}

// ---------------------------------------------------------------- 인자 읽기

interface ArgSpec {
  /** 값을 따로 받는 플래그 (`--prefix dir`) */
  valueFlags: ReadonlySet<string>;
  /** 값이 패키지이고 위치 인자를 대신하는 플래그 (`-p pkg`, `--from pkg`) */
  replaceFlags?: ReadonlySet<string>;
  /** 값이 패키지이고 위치 인자에 더해지는 플래그 (`--with pkg`) */
  extraFlags?: ReadonlySet<string>;
  /** 첫 위치 인자에서 멈춘다 (그 뒤는 실행하는 명령의 인자) */
  stopAtFirst: boolean;
}

interface Args {
  replace: string[];
  extra: string[];
  positionals: string[];
}

const REDIRECT = /^\d*(?:>>?|<)/;

function readArgs(tokens: string[], start: number, spec: ArgSpec): Args {
  const out: Args = { replace: [], extra: [], positionals: [] };
  let i = start;
  let flagsEnded = false;
  while (i < tokens.length) {
    const token = tokens[i] as string;
    i += 1;
    if (REDIRECT.test(token)) {
      if (/^\d*(?:>>?|<)&?\d*$/.test(token)) i += 1;
      continue;
    }
    if (!flagsEnded && token === "--") {
      flagsEnded = true;
      continue;
    }
    if (!flagsEnded && token.startsWith("-") && token.length > 1) {
      const eq = token.indexOf("=");
      const flag = eq === -1 ? token : token.slice(0, eq);
      const inline = eq === -1 ? null : token.slice(eq + 1);
      const takesValue =
        spec.valueFlags.has(flag) || spec.replaceFlags?.has(flag) || spec.extraFlags?.has(flag);
      if (!takesValue) continue;
      const value = inline ?? tokens[i];
      if (inline === null) i += 1;
      if (value === undefined) continue;
      if (spec.replaceFlags?.has(flag)) out.replace.push(value);
      else if (spec.extraFlags?.has(flag)) out.extra.push(value);
      continue;
    }
    out.positionals.push(token);
    if (spec.stopAtFirst) break;
  }
  return out;
}

const set = (...items: string[]): ReadonlySet<string> => new Set(items);

// ---------------------------------------------------------------- 패키지 지정자

const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ARCHIVE = /\.(?:tgz|tar\.gz|tar|zip|whl|egg)$/i;

function npmPackage(raw: string, tool: string): CommandPackage | null {
  if (raw === "" || raw.includes("$") || raw.includes("`")) return null;
  if (/^[./~]/.test(raw) || raw.includes(":") || ARCHIVE.test(raw)) return null;
  if (!raw.startsWith("@") && raw.includes("/")) return null; // github 단축형(user/repo)
  const at = raw.lastIndexOf("@");
  const name = at > 0 ? raw.slice(0, at) : raw;
  const version = at > 0 ? raw.slice(at + 1) : "";
  if (ECOSYSTEM_RULES.npm.validateName(name) !== null) return null;
  return { ecosystem: "npm", name, version: EXACT_SEMVER.test(version) ? version : "", raw, tool };
}

const PYPI_SPEC = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*(.*)$/;

function pypiPackage(raw: string, tool: string): CommandPackage | null {
  if (raw === "" || raw.includes("$") || raw.includes("`")) return null;
  if (/^[./~-]/.test(raw) || raw.includes(":") || raw.includes("/") || raw.includes("\\") || ARCHIVE.test(raw)) {
    return null;
  }
  const spec = (raw.split(";")[0] ?? "").trim();
  const parsed = PYPI_SPEC.exec(spec);
  if (!parsed) return null;
  const name = parsed[1] as string;
  const rest = parsed[2] as string;
  let version = "";
  if (rest === "") {
    // 이름만 있다
  } else if (/^===?/.test(rest)) {
    const value = rest.replace(/^===?\s*/, "");
    if (/^[^,\s*]+$/.test(value)) version = value;
  } else if (!/^(?:~=|!=|<=|>=|<|>)/.test(rest)) {
    return null;
  }
  if (ECOSYSTEM_RULES.pypi.validateName(name) !== null) return null;
  return { ecosystem: "pypi", name, version, raw, tool };
}

function uvPackage(raw: string, tool: string): CommandPackage | null {
  const at = raw.indexOf("@");
  if (at > 0 && !raw.includes("==")) {
    const found = pypiPackage(raw.slice(0, at), tool);
    const version = raw.slice(at + 1);
    return found ? { ...found, raw, version: EXACT_SEMVER.test(version) || /^\d[\w.]*$/.test(version) ? version : "" } : null;
  }
  return pypiPackage(raw, tool);
}

// ---------------------------------------------------------------- 도구별 해석

const NPM_VALUE_FLAGS = set(
  "--prefix",
  "--registry",
  "--tag",
  "-w",
  "--workspace",
  "--cache",
  "--userconfig",
  "--loglevel",
  "--scope",
  "--filter",
  "-F",
  "-C",
  "--dir",
  "--cwd",
  "--otp",
  "--omit",
  "--install-strategy",
);
const NPX_FLAGS: ArgSpec = {
  valueFlags: set("-c", "--call", "--registry", "--cache", "--node-options", "--userconfig", "-w", "--workspace", "--prefix"),
  replaceFlags: set("-p", "--package"),
  stopAtFirst: true,
};
const DLX_FLAGS: ArgSpec = { valueFlags: NPM_VALUE_FLAGS, replaceFlags: set("-p", "--package"), stopAtFirst: true };
const INSTALL_FLAGS: ArgSpec = { valueFlags: NPM_VALUE_FLAGS, stopAtFirst: false };

const PIP_VALUE_FLAGS = set(
  "-r",
  "--requirement",
  "-c",
  "--constraint",
  "-e",
  "--editable",
  "-i",
  "--index-url",
  "--extra-index-url",
  "--index",
  "--default-index",
  "-f",
  "--find-links",
  "-t",
  "--target",
  "--prefix",
  "--root",
  "--python",
  "-p",
  "--python-version",
  "--platform",
  "--implementation",
  "--abi",
  "--only-binary",
  "--no-binary",
  "--cache-dir",
  "--proxy",
  "--trusted-host",
  "--src",
  "--config-settings",
  "-C",
  "--global-option",
  "--install-option",
  "--progress-bar",
  "--report",
  "--upgrade-strategy",
  "--log",
  "--retries",
  "--timeout",
  "--cert",
  "--client-cert",
  "--exists-action",
  "--constraints",
  "--requirements",
  "--override",
  "--keyring-provider",
  "--resolution",
  "--index-strategy",
);
const PIP_FLAGS: ArgSpec = { valueFlags: PIP_VALUE_FLAGS, stopAtFirst: false };
const UVX_FLAGS: ArgSpec = {
  valueFlags: PIP_VALUE_FLAGS,
  replaceFlags: set("--from"),
  extraFlags: set("--with"),
  stopAtFirst: true,
};
const PIPX_RUN_FLAGS: ArgSpec = {
  valueFlags: set("--python", "--pip-args", "-i", "--index-url", "--suffix"),
  replaceFlags: set("--spec"),
  stopAtFirst: true,
};
const PIPX_INSTALL_FLAGS: ArgSpec = {
  valueFlags: set("--python", "--pip-args", "-i", "--index-url", "--suffix"),
  replaceFlags: set("--spec"),
  stopAtFirst: false,
};

const npmList = (list: string[], tool: string): CommandPackage[] =>
  list.flatMap((raw) => npmPackage(raw, tool) ?? []);
const pypiList = (list: string[], tool: string): CommandPackage[] =>
  list.flatMap((raw) => pypiPackage(raw, tool) ?? []);

/** 도구가 첫 위치 인자(또는 대체 플래그)를 패키지로 보는 실행형 */
function runPackages(args: Args, make: (raw: string) => CommandPackage | null): CommandPackage[] {
  const main = args.replace.length > 0 ? args.replace : args.positionals.slice(0, 1);
  return [...main, ...args.extra].flatMap((raw) => make(raw) ?? []);
}

function interpret(tokens: string[]): CommandPackage[] {
  const [tool, sub, third] = tokens;
  if (tool === undefined) return [];

  if (tool === "npx" || tool === "pnpx" || tool === "bunx") {
    return runPackages(readArgs(tokens, 1, NPX_FLAGS), (raw) => npmPackage(raw, tool));
  }
  if ((tool === "pnpm" || tool === "yarn") && sub === "dlx") {
    return runPackages(readArgs(tokens, 2, DLX_FLAGS), (raw) => npmPackage(raw, tool));
  }
  if (tool === "npm" || tool === "pnpm" || tool === "bun" || tool === "yarn") {
    const global = tool === "yarn" && sub === "global";
    const verb = global ? third : sub;
    const installs = tool === "yarn" ? verb === "add" : ["i", "install", "add"].includes(verb ?? "");
    if (!installs) return [];
    return npmList(readArgs(tokens, global ? 3 : 2, INSTALL_FLAGS).positionals, tool);
  }

  if (tool === "uvx") {
    return runPackages(readArgs(tokens, 1, UVX_FLAGS), (raw) => uvPackage(raw, tool));
  }
  if (tool === "uv") {
    if (sub === "tool" && (third === "run" || third === "install")) {
      const args = readArgs(tokens, 3, third === "run" ? UVX_FLAGS : { ...UVX_FLAGS, stopAtFirst: false });
      return runPackages(args, (raw) => uvPackage(raw, "uv"));
    }
    if (sub === "pip" && third === "install") {
      return pypiList(readArgs(tokens, 3, PIP_FLAGS).positionals, "uv");
    }
    return [];
  }
  if (tool === "pipx" && (sub === "run" || sub === "install")) {
    const args = readArgs(tokens, 2, sub === "run" ? PIPX_RUN_FLAGS : PIPX_INSTALL_FLAGS);
    return runPackages(args, (raw) => pypiPackage(raw, tool));
  }
  if (/^pip[\d.]*$/.test(tool) && sub === "install") {
    return pypiList(readArgs(tokens, 2, PIP_FLAGS).positionals, tool);
  }
  if (/^(?:python[\d.]*|py)$/.test(tool) && sub === "-m" && third !== undefined && /^pip[\d.]*$/.test(third)) {
    if (tokens[3] !== "install") return [];
    return pypiList(readArgs(tokens, 4, PIP_FLAGS).positionals, "pip");
  }
  return [];
}

/**
 * 셸 명령 문자열에서 npx·pip install 등이 실행·설치하는 패키지를 모은다. 예외를 던지지 않는다.
 * 변수가 든 토큰과 경로·URL 은 패키지가 아니고, 그 종류의 이름 규칙에 맞는 것만 낸다.
 */
export function extractCommandPackages(text: string): CommandPackage[] {
  try {
    return tokenize(text).flatMap((tokens) => interpret(stripPrefixes(tokens)));
  } catch {
    return [];
  }
}
