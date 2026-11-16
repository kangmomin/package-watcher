import { ECOSYSTEM_RULES, type Ecosystem } from "@pw/shared";

/**
 * GitHub Advisory 의 종류 → 이 도구의 종류. 여기에 없는 종류(SWIFT 등)는 건너뛴다. GitHub 에는 CocoaPods 의 malware 종류가 없다.
 * 종류를 더하려면 이 표와 아래 `FORMATTERS` 에 한 줄씩 넣는다.
 */
export const GHSA_ECOSYSTEMS: Readonly<Record<string, Ecosystem>> = {
  NPM: "npm",
  PIP: "pypi",
  NUGET: "nuget",
  RUST: "cargo",
  GO: "go",
  MAVEN: "maven",
  PUB: "pub",
  ACTIONS: "actions",
  RUBYGEMS: "rubygems",
  COMPOSER: "composer",
};

type Operator = "=" | ">=" | "<=" | ">" | "<";
interface Comparator {
  op: Operator;
  version: string;
}

/** 원문이 이보다 길면 잘못된 데이터로 보고 건너뛴다 */
const MAX_RAW_LENGTH = 500;
const MAX_NAME_LENGTH = 255;
const COMPARATOR = /^(>=|<=|>|<|=)\s*(\S+)$/;
const ZERO = /^0(?:\.0)*$/;

/** `>= 1.0, < 2.0` → 비교식 목록. 읽을 수 없으면 null */
function parseComparators(raw: string): Comparator[] | null {
  const parts = raw.split(",").map((part) => part.trim());
  const out: Comparator[] = [];
  for (const part of parts) {
    const match = COMPARATOR.exec(part);
    if (!match) return null;
    out.push({ op: match[1] as Operator, version: match[2] as string });
  }
  return out;
}

/** `>= 0`·`> 0` 은 아무 제약이 아니다(GitHub 는 둘 다 "모든 버전"으로 쓴다). 다른 비교식과 함께 있으면 뺀다 (`>= 0, < 3` = `< 3`). */
function dropZeroLower(comparators: Comparator[]): Comparator[] {
  return comparators.filter((item) => !((item.op === ">=" || item.op === ">") && ZERO.test(item.version)));
}

type Formatter = (comparators: Comparator[]) => string | null;

const joinWith = (separator: string, render: (item: Comparator) => string): Formatter => (comparators) =>
  comparators.map(render).join(separator);

/** nuget·maven 의 구간 표기. 하한 1개, 상한 1개까지만 안다. */
const interval: Formatter = (comparators) => {
  const exact = comparators.filter((item) => item.op === "=");
  if (exact.length > 0) return comparators.length === 1 ? `[${exact[0]?.version}]` : null;
  const lowers = comparators.filter((item) => item.op === ">" || item.op === ">=");
  const uppers = comparators.filter((item) => item.op === "<" || item.op === "<=");
  if (lowers.length > 1 || uppers.length > 1) return null;
  const lower = lowers[0];
  const upper = uppers[0];
  const open = lower ? `${lower.op === ">=" ? "[" : "("}${lower.version}` : "(";
  const close = upper ? `${upper.version}${upper.op === "<=" ? "]" : ")"}` : ")";
  return `${open},${close}`;
};

const semverText = joinWith(" ", (item) => (item.op === "=" ? item.version : `${item.op}${item.version}`));
const vPrefixed = (version: string): string => (version.startsWith("v") ? version : `v${version}`);

const FORMATTERS: Partial<Record<Ecosystem, Formatter>> = {
  npm: semverText,
  pub: semverText,
  pypi: joinWith(",", (item) => `${item.op === "=" ? "==" : item.op}${item.version}`),
  cargo: joinWith(",", (item) => `${item.op}${item.version}`),
  go: joinWith(" ", (item) => `${item.op}${vPrefixed(item.version)}`),
  nuget: interval,
  maven: interval,
  // gem 의 요구식은 GitHub 의 표기와 같다 (`>= 1.0, < 2.0`, `= 1.0.1`).
  rubygems: joinWith(", ", (item) => `${item.op} ${item.version}`),
  composer: semverText,
  // GitHub Action 의 버전은 순서가 없는 tag 라서 정확한 값 1개만 안다.
  actions: (comparators) => (comparators.length === 1 && comparators[0]?.op === "=" ? (comparators[0].version) : null),
};

export interface ConvertedAdvisory {
  ecosystem: Ecosystem;
  /** 그 종류의 `normalizeName` 을 적용한 값 */
  name: string;
  /** null = 모든 버전 */
  versionRange: string | null;
}

/**
 * GitHub Advisory 의 (종류, 이름, 범위) 1개를 이 도구의 항목 모양으로 바꾼다.
 * 지원하지 않는 종류, 읽을 수 없는 범위, 그 종류의 규칙(`validateName`·`validateRange`)을 통과하지 못하는 값은 null(건너뜀).
 * 절대 throw 하지 않는다 — 입력은 외부 응답이다.
 */
export function convertAdvisory(ghsaEcosystem: string, name: string, rawRange: string): ConvertedAdvisory | null {
  try {
    const ecosystem = Object.hasOwn(GHSA_ECOSYSTEMS, ghsaEcosystem) ? GHSA_ECOSYSTEMS[ghsaEcosystem] : undefined;
    const format = ecosystem ? FORMATTERS[ecosystem] : undefined;
    if (!ecosystem || !format) return null;
    if (typeof name !== "string" || typeof rawRange !== "string") return null;
    if (name.length > MAX_NAME_LENGTH || name.includes("*") || rawRange.length > MAX_RAW_LENGTH) return null;

    const rule = ECOSYSTEM_RULES[ecosystem];
    if (rule.validateName(name) !== null) return null;
    const comparators = parseComparators(rawRange);
    if (!comparators) return null;
    const effective = dropZeroLower(comparators);

    let versionRange: string | null = null;
    if (effective.length > 0) {
      versionRange = format(effective);
      if (versionRange === null || rule.validateRange(versionRange) !== null) return null;
    }
    return { ecosystem, name: rule.normalizeName(name), versionRange };
  } catch {
    return null;
  }
}
