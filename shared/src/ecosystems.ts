// 종류(ecosystem)별 규칙: 이름, 정규화, 블랙리스트의 범위 문법, 버전 비교.
// 서버(검증·스캔)와 화면(제출 전 검증·안내)이 함께 쓴다.
// 브라우저 번들에 들어가므로 Node 전용 모듈을 import 하지 않는다.
import {
  satisfies as pep440Satisfies,
  valid as pep440Valid,
  validRange as pep440ValidRange,
} from "@renovatebot/pep440";
import semverParse from "semver/functions/parse.js";
import semverSatisfies from "semver/functions/satisfies.js";
import semverValidRange from "semver/ranges/valid.js";
import type { Ecosystem } from "./contract.ts";

export interface EcosystemRule {
  /** 화면의 안내에 쓰는 이름 예시 */
  nameExample: string;
  /** 화면의 안내에 쓰는 범위 문법 예시 1줄 */
  rangeExample: string;
  /** 저장·비교용 정규화. pypi = PEP 503, nuget = 소문자, 그 외 = 그대로. 패턴의 `*` 는 보존한다. */
  normalizeName(name: string): string;
  /** 이름(`*` 가 있으면 패턴)의 오류 메시지. 문제없으면 null. */
  validateName(name: string): string | null;
  /** 범위 문자열(null 아님, trim 됨)의 오류 메시지. 문제없으면 null. */
  validateRange(range: string): string | null;
  /** 정확한 버전이 범위에 드는가. 버전이나 범위를 읽을 수 없으면 false (예외 없음). */
  satisfies(version: string, range: string): boolean;
  /** 선언 파일의 spec 이 고정된 정확한 버전이면 그 버전을, 범위면 null 을 돌려준다. */
  exactVersionOf(spec: string): string | null;
}

// ---------------------------------------------------------------- 이름

const ALNUM = /[A-Za-z0-9]/g;

interface NameSpec {
  /** `*` 가 없는 이름 전체의 모양 */
  shape: RegExp;
  /** 패턴에 쓸 수 있는 문자 (이름의 문자 + `*`) */
  patternChars: RegExp;
  maxLength: number;
  invalidMessage: string;
}

function nameValidator(spec: NameSpec): (name: string) => string | null {
  return (name) => {
    if (typeof name !== "string" || name === "") return "패키지 이름을 입력하십시오";
    if (name.length > spec.maxLength) return `패키지 이름은 ${spec.maxLength}자 이하입니다`;
    if (!name.includes("*")) return spec.shape.test(name) ? null : spec.invalidMessage;
    // 패턴에는 이름의 모양 제한을 적용하지 않고 문자만 검사한다.
    if (!spec.patternChars.test(name)) return "패턴에 쓸 수 없는 문자가 있습니다";
    // `*`, `@*/*` 처럼 거의 모든 패키지와 일치하는 패턴을 막는다.
    if ((name.match(ALNUM)?.length ?? 0) < 2) return "패턴에 영문자·숫자가 2자 이상 있어야 합니다";
    return null;
  };
}

const identity = (name: string): string => name;

// ---------------------------------------------------------------- 버전 비교 공통

/** 인자가 문자열이 아니거나 구현이 예외를 던져도 false 다 (스캔이 패키지 1개 때문에 멈추지 않는다). */
function safeSatisfies(fn: (version: string, range: string) => boolean) {
  return (version: string, range: string): boolean => {
    if (typeof version !== "string" || typeof range !== "string") return false;
    try {
      return fn(version.trim(), range.trim());
    } catch {
      return false;
    }
  };
}

function safeExact(fn: (spec: string) => string | null) {
  return (spec: string): string | null => {
    if (typeof spec !== "string") return null;
    const trimmed = spec.trim();
    return trimmed === "" ? null : fn(trimmed);
  };
}

/** 숫자만 있는 문자열 2개를 수로 비교한다. 자릿수 제한이 없도록 Number 로 바꾸지 않는다. */
function compareDigits(a: string, b: string): number {
  const x = a.replace(/^0+(?=\d)/, "");
  const y = b.replace(/^0+(?=\d)/, "");
  if (x.length !== y.length) return x.length < y.length ? -1 : 1;
  return x === y ? 0 : x < y ? -1 : 1;
}

const DIGITS = /^\d+$/;

// ---------------------------------------------------------------- semver 계열 (npm, pub, cargo, go)

const SEMVER_OPTIONS = { includePrerelease: true } as const;

function semverRule(invalidRangeMessage: string): Pick<EcosystemRule, "validateRange" | "satisfies"> {
  return {
    validateRange: (range) => (semverValidRange(range) === null ? invalidRangeMessage : null),
    satisfies: safeSatisfies((version, range) => semverSatisfies(version, range, SEMVER_OPTIONS)),
  };
}

const CARGO_REQUIREMENT =
  /^(=|<=|>=|<|>|~|\^)?\s*(\*|\d+(?:\.(?:\d+|\*)){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;

/** Cargo 요구식을 semver 범위로 바꾼다. 읽을 수 없으면 null. */
function cargoToSemver(range: string): string | null {
  const comparators: string[] = [];
  for (const part of range.split(",")) {
    const match = CARGO_REQUIREMENT.exec(part.trim());
    if (!match) return null;
    const operator = match[1];
    const version = match[2] as string;
    if (version.includes("*")) {
      if (operator !== undefined) return null;
      comparators.push(version);
    } else {
      // 연산자 없는 값은 Cargo 에서 caret 이다 (npm 은 "정확히").
      comparators.push(`${operator ?? "^"}${version}`);
    }
  }
  const converted = comparators.join(" ");
  return semverValidRange(converted) === null ? null : converted;
}

const GO_COMPARATOR = /^(=|<=|>=|<|>)?v(\d.*)$/;

/** `v` 접두 비교식을 semver 범위로 바꾼다. `v` 가 없거나 버전이 3마디가 아니면 null. */
function goToSemver(range: string): string | null {
  const comparators: string[] = [];
  // `< v1.0.0` 처럼 연산자 뒤에 공백을 둔 입력을 한 토큰으로 붙인다.
  for (const token of range.replace(/([<>=])\s+/g, "$1").split(/\s+/)) {
    const match = GO_COMPARATOR.exec(token);
    const parsed = match ? semverParse(match[2]) : null;
    if (!match || !parsed) return null;
    // `+incompatible` 같은 build 정보는 순서에 영향이 없으므로 뗀다.
    comparators.push(`${match[1] ?? "="}${parsed.version}`);
  }
  return comparators.length === 0 ? null : comparators.join(" ");
}

/** `v1.2.3`, pseudo-version, `+incompatible` → semver 버전. */
function goVersion(version: string): string | null {
  const match = /^v(\d.*)$/.exec(version);
  return match ? (semverParse(match[1])?.version ?? null) : null;
}

// ---------------------------------------------------------------- 구간 표기 (nuget, maven)

interface Interval<V> {
  lower: V | null;
  lowerInclusive: boolean;
  upper: V | null;
  upperInclusive: boolean;
}

const INTERVAL = /^([[(])([^,[\]()]*)(?:(,)([^,[\]()]*))?([\])])$/;

/** `[1.0,2.0)`, `(,1.5]`, `[1.0,)`, `[1.2.3]`. 읽을 수 없거나 빈 구간이면 null. */
function parseInterval<V>(
  range: string,
  parseVersion: (text: string) => V | null,
  compare: (a: V, b: V) => number,
): Interval<V> | null {
  const match = INTERVAL.exec(range.trim());
  if (!match) return null;
  const lowerInclusive = match[1] === "[";
  const upperInclusive = match[5] === "]";
  const lowerText = (match[2] ?? "").trim();

  if (match[3] === undefined) {
    // 쉼표 없는 `[1.2.3]` = 정확히 그 버전. `(1.2.3)` 은 빈 구간이다.
    const exact = lowerInclusive && upperInclusive ? parseVersion(lowerText) : null;
    return exact === null
      ? null
      : { lower: exact, lowerInclusive: true, upper: exact, upperInclusive: true };
  }

  const upperText = (match[4] ?? "").trim();
  if (lowerText === "" && upperText === "") return null;
  const lower = lowerText === "" ? null : parseVersion(lowerText);
  const upper = upperText === "" ? null : parseVersion(upperText);
  if ((lowerText !== "" && lower === null) || (upperText !== "" && upper === null)) return null;
  if (lower !== null && upper !== null) {
    const order = compare(lower, upper);
    if (order > 0 || (order === 0 && !(lowerInclusive && upperInclusive))) return null;
  }
  return { lower, lowerInclusive, upper, upperInclusive };
}

function intervalRule<V>(
  label: string,
  parseVersion: (text: string) => V | null,
  compare: (a: V, b: V) => number,
): Pick<EcosystemRule, "validateRange" | "satisfies"> {
  // 괄호 없는 값은 이 생태계에서 "이상"을 뜻해서 npm 의 "정확히"와 반대다. 그래서 받지 않고 형식을 안내한다.
  const message = `${label} 구간 표기가 아닙니다 (예: [1.0,2.0), (,1.5]). 정확한 버전은 [1.2.3] 형식으로 적으십시오`;
  return {
    validateRange: (range) =>
      typeof range === "string" && parseInterval(range, parseVersion, compare) ? null : message,
    satisfies: safeSatisfies((versionText, range) => {
      const interval = parseInterval(range, parseVersion, compare);
      const version = parseVersion(versionText);
      if (!interval || version === null) return false;
      if (interval.lower !== null) {
        const order = compare(version, interval.lower);
        if (order < 0 || (order === 0 && !interval.lowerInclusive)) return false;
      }
      if (interval.upper !== null) {
        const order = compare(version, interval.upper);
        if (order > 0 || (order === 0 && !interval.upperInclusive)) return false;
      }
      return true;
    }),
  };
}

// NuGet: 숫자 마디 1~4개 + 선택적 `-prerelease` + 무시하는 `+metadata`.
interface NugetVersion {
  parts: string[];
  prerelease: string[];
}

const NUGET_VERSION =
  /^(\d+(?:\.\d+){0,3})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseNugetVersion(text: string): NugetVersion | null {
  const match = NUGET_VERSION.exec(text);
  if (!match) return null;
  return {
    parts: (match[1] as string).split("."),
    prerelease: match[2] === undefined ? [] : match[2].toLowerCase().split("."),
  };
}

function compareNugetVersions(a: NugetVersion, b: NugetVersion): number {
  for (let i = 0; i < 4; i += 1) {
    const order = compareDigits(a.parts[i] ?? "0", b.parts[i] ?? "0");
    if (order !== 0) return order;
  }
  // prerelease 가 없는 쪽(릴리스)이 크다.
  const aRelease = a.prerelease.length === 0;
  const bRelease = b.prerelease.length === 0;
  if (aRelease || bRelease) return aRelease === bRelease ? 0 : aRelease ? 1 : -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < length; i += 1) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNumeric = DIGITS.test(x);
    const yNumeric = DIGITS.test(y);
    if (xNumeric && yNumeric) {
      const order = compareDigits(x, y);
      if (order !== 0) return order;
    } else if (xNumeric !== yNumeric) {
      return xNumeric ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

// Maven: `.` 과 `-`, 숫자와 문자의 경계로 마디를 나눈다. 마디는 숫자 문자열 또는 소문자 수식어다.
// ComparableVersion 의 흔한 형태만 구현한다 (`.` 과 `-` 를 구분하지 않는다).
const MAVEN_VERSION = /^\d[0-9A-Za-z]*(?:[.-][0-9A-Za-z]+)*$/;
const MAVEN_SHORT_QUALIFIERS: Record<string, string> = { a: "alpha", b: "beta", m: "milestone" };
const MAVEN_RELEASE_QUALIFIERS = new Set(["ga", "final", "release"]);
/** "" = 릴리스. 여기 없는 수식어는 sp 보다 뒤이고 서로는 문자열 순이다. */
const MAVEN_QUALIFIER_RANK: Record<string, number> = {
  alpha: 1,
  beta: 2,
  milestone: 3,
  rc: 4,
  snapshot: 5,
  "": 6,
  sp: 7,
};
const MAVEN_UNKNOWN_RANK = 8;

function parseMavenVersion(text: string): string[] | null {
  if (!MAVEN_VERSION.test(text)) return null;
  const tokens = text
    .toLowerCase()
    .split(/[.-]/)
    .flatMap((part) => part.match(/\d+|[a-z]+/g) ?? [])
    .map((token, index, all) => {
      // `a1`, `b2`, `m3` 처럼 숫자가 바로 붙을 때만 줄임말이다.
      const short = MAVEN_SHORT_QUALIFIERS[token];
      if (short !== undefined && DIGITS.test(all[index + 1] ?? "")) return short;
      if (token === "cr") return "rc";
      return MAVEN_RELEASE_QUALIFIERS.has(token) ? "" : token;
    });
  // `1.0.0-rc1` = `1-rc1`, `1.0` = `1`: 수식어나 끝 앞의 0 과 릴리스 수식어는 뜻이 없으므로 지운다.
  const items: string[] = [];
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i] as string;
    const next = items[0];
    const empty = token === "" || /^0+$/.test(token);
    if (empty && (next === undefined || !DIGITS.test(next))) continue;
    items.unshift(token);
  }
  return items;
}

function compareMavenQualifiers(a: string, b: string): number {
  const rankA = MAVEN_QUALIFIER_RANK[a] ?? MAVEN_UNKNOWN_RANK;
  const rankB = MAVEN_QUALIFIER_RANK[b] ?? MAVEN_UNKNOWN_RANK;
  if (rankA !== rankB) return rankA < rankB ? -1 : 1;
  if (rankA !== MAVEN_UNKNOWN_RANK || a === b) return 0;
  return a < b ? -1 : 1;
}

/** 없는 마디(undefined)는 숫자 0, 수식어 ""(릴리스)와 같다. 숫자 마디는 수식어보다 크다. */
function compareMavenItems(a: string | undefined, b: string | undefined): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return -compareMavenItems(b, undefined);
  const aNumeric = DIGITS.test(a);
  if (b === undefined) return aNumeric ? compareDigits(a, "0") : compareMavenQualifiers(a, "");
  const bNumeric = DIGITS.test(b);
  if (aNumeric && bNumeric) return compareDigits(a, b);
  if (aNumeric !== bNumeric) return aNumeric ? 1 : -1;
  return compareMavenQualifiers(a, b);
}

function compareMavenVersions(a: string[], b: string[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const order = compareMavenItems(a[i], b[i]);
    if (order !== 0) return order;
  }
  return 0;
}

// ---------------------------------------------------------------- 정확한 값의 목록 (actions, docker)

const REF_TOKEN = /^[A-Za-z0-9_][A-Za-z0-9._:+/-]*$/;
const REF_MAX_LENGTH = 128;
const REF_MAX_COUNT = 50;
const HEX = /^[0-9a-f]+$/;

/** `v1, v2` → ["v1", "v2"]. 빈 조각이 있으면 null. */
function refTokens(range: string): string[] | null {
  if (typeof range !== "string") return null;
  const tokens = range.split(",").map((token) => token.trim());
  if (tokens.length === 0 || tokens.length > REF_MAX_COUNT) return null;
  return tokens.every((token) => token.length <= REF_MAX_LENGTH && REF_TOKEN.test(token)) ? tokens : null;
}

/**
 * tag·commit SHA·digest 는 순서가 없으므로 범위가 아니라 정확한 값의 목록으로 비교한다.
 * `isFull` 이 참인 버전(40자 SHA, sha256 digest)에는 `minPrefix` 자 이상의 앞부분도 일치로 본다 — 공지는 짧은 SHA 로 나온다.
 */
function refListRule(
  message: string,
  full: {
    /** 버전이 전체 SHA·digest 이면 그 16진수 부분, 아니면 null */
    ofVersion: (version: string) => string | null;
    /** 목록의 값에서 비교할 16진수 부분 (앞부분일 수 있다), 아니면 null */
    ofToken: (token: string) => string | null;
    minPrefix: number;
  },
): Pick<EcosystemRule, "validateRange" | "satisfies" | "exactVersionOf"> {
  return {
    validateRange: (range) => (refTokens(range) === null ? message : null),
    satisfies: safeSatisfies((version, range) => {
      const tokens = refTokens(range);
      if (tokens === null || version === "") return false;
      const fullVersion = full.ofVersion(version.toLowerCase());
      return tokens.some((token) => {
        if (token === version) return true;
        if (fullVersion === null) return false;
        const prefix = full.ofToken(token.toLowerCase());
        return prefix !== null && prefix.length >= full.minPrefix && fullVersion.startsWith(prefix);
      });
    }),
    exactVersionOf: safeExact((spec) => spec),
  };
}

const COMMIT_SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:([0-9a-f]{64})$/;
const DIGEST_PREFIX = /^sha256:([0-9a-f]+)$/;

/** Docker 이미지 저장소의 저장 형태: 소문자, Docker Hub 의 기본 registry 와 `library/` 를 뗀다. */
export function normalizeImageName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(?:index\.)?docker\.io\//, "")
    .replace(/^library\//, "");
}

// ---------------------------------------------------------------- 침해의 흔적 (path, content, branch)

const NO_RANGE_MESSAGE = "이 종류는 버전 범위를 쓰지 않습니다. 비워 두십시오";
const PATTERN_TOO_BROAD = "패턴에 영문자·숫자가 2자 이상 있어야 합니다";
const INVALID_PATTERN_CHARS = "패턴에 쓸 수 없는 문자가 있습니다";
/** 제어 문자(줄바꿈 포함)가 있는가. 정규식에 제어 문자를 적지 않으려고 코드 값으로 본다. */
function hasControlChar(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
// `?`(glob 으로 오해한다), `\` (경로 구분자는 `/` 만 쓴다)
const PATH_FORBIDDEN = /[?\\]/;
const BRANCH_CHARS = /^[A-Za-z0-9._/+@*-]+$/;
/** `content` 의 문자열 길이. 짧은 문자열은 거의 모든 파일과 일치한다. */
export const CONTENT_MIN_LENGTH = 6;
export const CONTENT_MAX_LENGTH = 200;

/** 범위를 쓰지 않는 종류의 공통 부분. 범위를 주면 오류이고 어떤 버전도 "만족"하지 않는다. */
const NO_RANGE: Pick<EcosystemRule, "rangeExample" | "validateRange" | "satisfies" | "exactVersionOf"> = {
  rangeExample: "",
  validateRange: () => NO_RANGE_MESSAGE,
  satisfies: () => false,
  exactVersionOf: () => null,
};

function indicatorPattern(options: { empty: string; maxLength: number; invalid: (name: string) => boolean }) {
  return (name: string): string | null => {
    if (typeof name !== "string" || name === "") return options.empty;
    if (name.length > options.maxLength) return `${options.maxLength}자 이하로 입력하십시오`;
    if (options.invalid(name)) return INVALID_PATTERN_CHARS;
    // `*`, `*/*` 처럼 거의 모든 것과 일치하는 값을 막는다 (패턴이 아니어도 2자는 있어야 한다).
    if ((name.match(ALNUM)?.length ?? 0) < 2) return PATTERN_TOO_BROAD;
    return null;
  };
}

// ---------------------------------------------------------------- 종류별 규칙

const PYPI_RANGE_MESSAGE = "PEP 440 범위가 아닙니다 (예: <1.0,>=0.5)";
const CARGO_RANGE_MESSAGE = "Cargo 버전 요구식이 아닙니다 (예: >=1, <2). 정확한 버전은 =1.2.3 형식으로 적으십시오";
const GO_RANGE_MESSAGE = "Go 버전 비교식이 아닙니다. 버전에 v 접두가 필요합니다 (예: <v0.4.30)";

export const ECOSYSTEM_RULES: Record<Ecosystem, EcosystemRule> = {
  npm: {
    nameExample: "lodash",
    rangeExample: "<4.17.21 또는 >=1.0.0 <2.0.0",
    normalizeName: identity,
    validateName: nameValidator({
      // 대문자는 과거에 등록된 패키지(예: JSONStream)에 있으므로 허용하고, 비교는 대소문자를 구분한다.
      shape: /^(?:@[A-Za-z0-9-~][A-Za-z0-9-._~]*\/)?[A-Za-z0-9-~][A-Za-z0-9-._~]*$/,
      patternChars: /^[A-Za-z0-9\-._~@/*]+$/,
      maxLength: 214,
      invalidMessage: "npm 패키지 이름 형식이 아닙니다",
    }),
    ...semverRule("유효한 semver 범위가 아닙니다"),
    // package.json 의 spec 은 범위 겹침(intersects) 경로가 따로 판정한다.
    exactVersionOf: () => null,
  },

  go: {
    nameExample: "github.com/evil/mod",
    rangeExample: "<v0.4.30 또는 >=v1.0.0 <v2.0.0 (정확히: =v1.2.3)",
    normalizeName: identity,
    validateName: nameValidator({
      shape: /^[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/,
      patternChars: /^[A-Za-z0-9._~/*-]+$/,
      maxLength: 255,
      invalidMessage: "Go 모듈 경로 형식이 아닙니다 (예: github.com/evil/mod)",
    }),
    validateRange: (range) =>
      typeof range === "string" && goToSemver(range) !== null ? null : GO_RANGE_MESSAGE,
    satisfies: safeSatisfies((version, range) => {
      const exact = goVersion(version);
      const converted = goToSemver(range);
      if (exact === null || converted === null) return false;
      return semverSatisfies(exact, converted, SEMVER_OPTIONS);
    }),
    // go.mod 의 버전은 항상 정확한 버전이다.
    exactVersionOf: safeExact((spec) => spec),
  },

  pypi: {
    nameExample: "requests",
    rangeExample: "<1.0,>=0.5 또는 ==1.2.3",
    // PEP 503. `*` 는 [-_.] 에 없으므로 패턴에서도 보존된다.
    normalizeName: (name) => name.toLowerCase().replace(/[-_.]+/g, "-"),
    validateName: nameValidator({
      shape: /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/,
      patternChars: /^[A-Za-z0-9._*-]+$/,
      maxLength: 255,
      invalidMessage: "PyPI 패키지 이름 형식이 아닙니다 (영문자, 숫자, - _ .)",
    }),
    validateRange: (range) =>
      typeof range === "string" && range.trim() !== "" && pep440ValidRange(range)
        ? null
        : PYPI_RANGE_MESSAGE,
    satisfies: safeSatisfies((version, range) => {
      // 라이브러리의 satisfies 는 읽을 수 없는 버전에서 예외를 던지고, 빈 범위를 "모든 버전"으로 읽는다.
      if (range === "" || pep440Valid(version) === null || !pep440ValidRange(range)) return false;
      // 블랙리스트는 prerelease 도 잡아야 하므로 `>=0.5` 가 `1.0rc1` 을 포함하게 한다.
      return pep440Satisfies(version, range, { prereleases: true });
    }),
    exactVersionOf: safeExact((spec) => {
      const match = /^==\s*([^\s,;*=]+)$/.exec(spec);
      return match && pep440Valid(match[1]) !== null ? (match[1] as string) : null;
    }),
  },

  nuget: {
    nameExample: "Newtonsoft.Json",
    rangeExample: "[1.0,2.0) 또는 (,1.5] (정확히: [1.2.3])",
    normalizeName: (name) => name.toLowerCase(),
    validateName: nameValidator({
      shape: /^[A-Za-z0-9_][A-Za-z0-9._-]*$/,
      patternChars: /^[A-Za-z0-9._*-]+$/,
      maxLength: 100,
      invalidMessage: "NuGet 패키지 이름 형식이 아닙니다 (영문자, 숫자, - _ .)",
    }),
    ...intervalRule("NuGet", parseNugetVersion, compareNugetVersions),
    exactVersionOf: safeExact((spec) => {
      const bracketed = /^\[([^,[\]()]+)\]$/.exec(spec);
      const value = bracketed ? (bracketed[1] as string).trim() : spec;
      return value === "" || /[[\]()*,]/.test(value) ? null : value;
    }),
  },

  cargo: {
    nameExample: "serde",
    rangeExample: "<1.2.0 또는 >=1, <2 (정확히: =1.2.3)",
    normalizeName: identity,
    validateName: nameValidator({
      shape: /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
      patternChars: /^[A-Za-z0-9_*-]+$/,
      maxLength: 64,
      invalidMessage: "Cargo crate 이름 형식이 아닙니다 (영문자, 숫자, - _)",
    }),
    validateRange: (range) =>
      typeof range === "string" && cargoToSemver(range) !== null ? null : CARGO_RANGE_MESSAGE,
    satisfies: safeSatisfies((version, range) => {
      const converted = cargoToSemver(range);
      return converted !== null && semverSatisfies(version, converted, SEMVER_OPTIONS);
    }),
    exactVersionOf: safeExact((spec) => {
      const match = /^=\s*(\d\S*)$/.exec(spec);
      return match && semverParse(match[1]) !== null ? (match[1] as string) : null;
    }),
  },

  pub: {
    nameExample: "http",
    rangeExample: ">=1.0.0 <2.0.0 또는 ^1.2.3",
    normalizeName: identity,
    validateName: nameValidator({
      shape: /^[a-z_][a-z0-9_]*$/,
      patternChars: /^[a-z0-9_*]+$/,
      maxLength: 255,
      invalidMessage: "pub 패키지 이름 형식이 아닙니다 (영문 소문자, 숫자, _)",
    }),
    ...semverRule("pub 버전 제약이 아닙니다 (예: >=1.0.0 <2.0.0)"),
    exactVersionOf: safeExact((spec) => (/^\d/.test(spec) && semverParse(spec) !== null ? spec : null)),
  },

  maven: {
    nameExample: "com.google.guava:guava",
    rangeExample: "[1.0,2.0) 또는 (,1.5] (정확히: [1.2.3])",
    normalizeName: identity,
    validateName: nameValidator({
      shape: /^[A-Za-z0-9._-]+:[A-Za-z0-9._-]+$/,
      patternChars: /^[A-Za-z0-9._:*-]+$/,
      maxLength: 255,
      invalidMessage: "Maven 좌표 형식이 아닙니다 (group:name, 예: com.google.guava:guava)",
    }),
    ...intervalRule("Maven", parseMavenVersion, compareMavenVersions),
    exactVersionOf: safeExact((spec) =>
      /^[[(]/.test(spec) || /[+$]/.test(spec) || spec.startsWith("latest.") ? null : spec,
    ),
  },

  actions: {
    nameExample: "aquasecurity/trivy-action",
    rangeExample: "v0.34.0, v0.34.1 또는 commit SHA (7자 이상)",
    // GitHub 의 owner 와 repo 이름은 대소문자를 구분하지 않는다.
    normalizeName: (name) => name.toLowerCase(),
    validateName: nameValidator({
      shape: /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/,
      patternChars: /^[A-Za-z0-9._/*-]+$/,
      maxLength: 140,
      invalidMessage: "GitHub Action 이름 형식이 아닙니다 (owner/repo, 예: aquasecurity/trivy-action)",
    }),
    ...refListRule("tag 또는 commit SHA 를 쉼표로 나눠 적으십시오 (예: v0.34.0, v0.34.1)", {
      ofVersion: (version) => (COMMIT_SHA.test(version) ? version : null),
      ofToken: (token) => (HEX.test(token) ? token : null),
      minPrefix: 7,
    }),
  },

  docker: {
    nameExample: "ghcr.io/berriai/litellm",
    rangeExample: "v1.107.0, latest 또는 sha256:… (digest)",
    normalizeName: normalizeImageName,
    validateName: (name) => {
      const error = nameValidator({
        shape: /^[A-Za-z0-9][A-Za-z0-9._:-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/,
        patternChars: /^[A-Za-z0-9._:/*-]+$/,
        maxLength: 255,
        invalidMessage: "Docker 이미지 이름 형식이 아닙니다 (예: ghcr.io/berriai/litellm, node)",
      })(name);
      if (error !== null) return error;
      // `:` 은 registry 의 포트(첫 조각)에만 쓴다. 마지막 조각의 `:` 는 tag 다.
      const last = name.slice(name.lastIndexOf("/") + 1);
      if (last.includes(":")) return "tag 와 digest 는 이름이 아니라 버전 범위에 적으십시오";
      // `docker.io/*`, `library/*` 는 접두를 떼면 `*` 가 되어 모든 이미지와 일치한다. 저장 형태로 다시 검사한다.
      const stored = normalizeImageName(name);
      if (stored.includes("*") && (stored.match(ALNUM)?.length ?? 0) < 2) {
        return "패턴에 영문자·숫자가 2자 이상 있어야 합니다";
      }
      return null;
    },
    ...refListRule("tag 또는 digest 를 쉼표로 나눠 적으십시오 (예: v1.107.0, latest)", {
      ofVersion: (version) => DIGEST.exec(version)?.[1] ?? null,
      ofToken: (token) => DIGEST_PREFIX.exec(token)?.[1] ?? null,
      minPrefix: 12,
    }),
  },

  path: {
    nameExample: ".github/workflows/github_actions_security.yml 또는 .ci-*.sh",
    // 경로는 대소문자를 구분한다.
    normalizeName: identity,
    validateName: indicatorPattern({
      empty: "파일 경로 또는 패턴을 입력하십시오",
      maxLength: 255,
      invalid: (name) => hasControlChar(name) || PATH_FORBIDDEN.test(name) || name.startsWith("/"),
    }),
    ...NO_RANGE,
  },

  content: {
    nameExample: "193.32.204.199 또는 git-tanstack.com",
    normalizeName: identity,
    validateName: (name) => {
      if (typeof name !== "string" || name === "") return "찾을 문자열을 입력하십시오";
      if (name.length < CONTENT_MIN_LENGTH || name.length > CONTENT_MAX_LENGTH) {
        return `문자열은 ${CONTENT_MIN_LENGTH}~${CONTENT_MAX_LENGTH}자입니다`;
      }
      if (hasControlChar(name)) return "문자열에 줄바꿈이나 제어 문자를 쓸 수 없습니다";
      // 부분 일치로 찾는 글자 그대로의 문자열이다. `*` 를 패턴으로 오해하지 않게 받지 않는다.
      if (name.includes("*")) return "문자열에 * 를 쓸 수 없습니다 (패턴이 아니라 글자 그대로 찾습니다)";
      if ((name.match(ALNUM)?.length ?? 0) < 2) return "문자열에 영문자·숫자가 2자 이상 있어야 합니다";
      return null;
    },
    ...NO_RANGE,
  },

  policy: {
    nameExample: "unpinned-action",
    normalizeName: identity,
    // 내장 검사의 id 인지는 서버가 확인한다 (contract.ts 가 이 파일을 import 하므로 여기서 목록을 볼 수 없다).
    validateName: (name) =>
      typeof name === "string" && /^[a-z][a-z0-9-]{1,63}$/.test(name)
        ? null
        : "내장 검사의 id 형식이 아닙니다 (예: unpinned-action)",
    ...NO_RANGE,
  },

  branch: {
    nameExample: "wfx-docs 또는 chore/*",
    normalizeName: identity,
    validateName: indicatorPattern({
      empty: "브랜치 이름 또는 패턴을 입력하십시오",
      maxLength: 255,
      invalid: (name) => !BRANCH_CHARS.test(name),
    }),
    ...NO_RANGE,
  },
};

// ---------------------------------------------------------------- 항목 단위 헬퍼

/**
 * 블랙리스트 항목의 이름과 범위를 그 종류의 규칙으로 검증한다. 오류가 있는 필드만 돌려준다.
 * 스키마(종류를 아는 입력)와 서버(PUT 을 저장된 종류와 병합한 뒤)가 같은 함수를 쓴다.
 */
export function validateEntryFields(
  ecosystem: Ecosystem,
  name: string,
  versionRange: string | null,
): { name?: string; versionRange?: string } {
  const rule = ECOSYSTEM_RULES[ecosystem];
  const errors: { name?: string; versionRange?: string } = {};
  const nameError = rule.validateName(name);
  if (nameError !== null) errors.name = nameError;
  const rangeError = versionRange === null ? null : rule.validateRange(versionRange);
  if (rangeError !== null) errors.versionRange = rangeError;
  return errors;
}

/** 저장·중복 비교에 쓰는 이름. 검증을 통과한 이름에 적용한다. */
export function normalizeEntryName(ecosystem: Ecosystem, name: string): string {
  return ECOSYSTEM_RULES[ecosystem].normalizeName(name);
}
