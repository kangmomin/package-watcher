import type { BlacklistEntry } from "@pw/shared";
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS } from "@pw/shared";
import { describe, expect, it } from "vitest";
import { AppError } from "../errors.ts";
import { parseCsv, parseImportContent, serializeExport, toCsv } from "./blacklistFile.ts";

const HEADER = "ecosystem,name,versionRange,severity,reason,enabled,expiresAt";

function expectValidationError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("VALIDATION_ERROR");
    return error as AppError;
  }
  throw new Error("VALIDATION_ERROR 가 발생하지 않았습니다");
}

function entry(overrides: Partial<BlacklistEntry> = {}): BlacklistEntry {
  return {
    id: 1,
    source: "manual",
    externalId: null,
    ecosystem: "npm",
    name: "evil-pkg",
    versionRange: null,
    reason: "악성 코드",
    severity: "medium",
    enabled: true,
    expiresAt: null,
    isExpired: false,
    createdAt: "2026-11-12T00:00:00.000Z",
    updatedAt: "2026-11-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("parseCsv (RFC 4180)", () => {
  it("[BK-10] 인용되지 않은 값과 빈 값을 읽는다", () => {
    expect(parseCsv("a,b,c\n1,,3")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });

  it("[BK-10] 인용된 값 안의 쉼표·줄바꿈·큰따옴표(\"\")를 값으로 읽는다", () => {
    const text = 'a,b\r\n"x,y","line1\r\nline2"\r\n"say ""hi""",z\r\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b"],
      ["x,y", "line1\r\nline2"],
      ['say "hi"', "z"],
    ]);
  });

  it("[BK-10] BOM 을 버리고 CRLF·LF 를 모두 받으며 마지막 줄의 줄바꿈은 있어도 없어도 같다", () => {
    const expected = [
      ["a", "b"],
      ["1", "2"],
    ];
    expect(parseCsv("\uFEFFa,b\r\n1,2\r\n")).toEqual(expected);
    expect(parseCsv("a,b\n1,2\n")).toEqual(expected);
    expect(parseCsv("a,b\r\n1,2")).toEqual(expected);
  });

  it("[BK-10] 완전히 빈 줄은 건너뛴다 (인용된 빈 값은 건너뛰지 않는다)", () => {
    expect(parseCsv("a\n\n1\n\n\n")).toEqual([["a"], ["1"]]);
    expect(parseCsv('a\n""\n')).toEqual([["a"], [""]]);
  });

  it("[BK-10] 닫히지 않은 따옴표 → VALIDATION_ERROR", () => {
    expectValidationError(() => parseCsv('a,b\n1,"2\n3'));
  });

  it("[BK-10] 빈 문자열은 레코드가 없다", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\uFEFF")).toEqual([]);
  });
});

describe("CSV 엄격함과 관대함 (BK-16)", () => {
  it("[BK-16] 닫는 따옴표 뒤에 ,·CR·LF·입력 끝이 아닌 문자가 오면 VALIDATION_ERROR (줄 번호 포함)", () => {
    for (const text of ['"npm-pkg"x,"사유"', 'a,b\n"a"b"c', '"a" ,b', '"a" ,b']) {
      const error = expectValidationError(() => parseCsv(text));
      expect(error.message).toContain("따옴표 뒤");
    }
    expect(expectValidationError(() => parseCsv('a,b\n"x"y,z')).message).toContain("2번째 줄");
    expectValidationError(() => parseImportContent("csv", 'name,reason\r\n"npm-pkg"x,"사유"\r\n'));
  });

  it("[BK-16] 정상적인 이스케이프(\"a\"\"b\")와 \"a\",b, 입력 끝의 닫는 따옴표는 그대로 읽는다", () => {
    expect(parseCsv('"a""b"')).toEqual([['a"b']]);
    expect(parseCsv('"a",b\r\n"c"')).toEqual([["a", "b"], ["c"]]);
    expect(parseCsv('"a"\r\n"b"\n')).toEqual([["a"], ["b"]]);
  });

  it("[BK-16] 머리글 셀은 앞뒤 공백을 지우고 비교한다 (대소문자는 구분한다)", () => {
    expect(parseImportContent("csv", " name , reason \r\na,b\r\n")).toEqual([
      { row: 1, raw: { name: "a", reason: "b" } },
    ]);
    expectValidationError(() => parseImportContent("csv", " Name , reason \r\na,b\r\n"));
  });

  it("[BK-16] CSV 의 enabled 는 trim + 소문자로 true/false 를 읽고, 그 외는 문자열 그대로 넘긴다", () => {
    const rows = parseImportContent(
      "csv",
      "name,reason,enabled\r\na,r,TRUE\r\nb,r,False\r\nc,r, true \r\nd,r,yes\r\n",
    );
    expect(rows.map((row) => ("raw" in row ? row.raw.enabled : "error"))).toEqual([true, false, true, "yes"]);
  });

  it("[BK-16] CSV 의 ecosystem·severity 는 trim + 소문자로 넘긴다. JSON 은 그대로다", () => {
    const [csv] = parseImportContent("csv", "name,reason,ecosystem,severity\r\na,r, NPM ,High\r\n");
    expect(csv).toEqual({ row: 1, raw: { name: "a", reason: "r", ecosystem: "npm", severity: "high" } });
    const [json] = parseImportContent(
      "json",
      JSON.stringify({ version: 1, items: [{ name: "a", reason: "r", ecosystem: "NPM", enabled: "TRUE" }] }),
    );
    expect(json).toEqual({ row: 1, raw: { name: "a", reason: "r", ecosystem: "NPM", enabled: "TRUE" } });
  });
});

describe("toCsv", () => {
  it("[BK-10] 쉼표·줄바꿈·큰따옴표가 있는 값만 인용하고, 모든 레코드는 CRLF 로 끝난다", () => {
    expect(
      toCsv([
        ["a", "b"],
        ["x,y", 'q"r'],
        ["l1\nl2", ""],
      ]),
    ).toBe('a,b\r\n"x,y","q""r"\r\n"l1\nl2",\r\n');
  });
});

describe("parseImportContent — CSV", () => {
  it("[BK-10] 머리글은 대소문자 그대로 비교하고 열 순서는 자유다. 모르는 열은 무시한다", () => {
    const rows = parseImportContent("csv", "reason,extra,name\r\n사유,무시,lodash\r\n");
    expect(rows).toEqual([{ row: 1, raw: { reason: "사유", name: "lodash" } }]);
  });

  it("[BK-10] name 또는 reason 열이 없으면 VALIDATION_ERROR (머리글의 대소문자가 다르면 없는 것이다)", () => {
    expectValidationError(() => parseImportContent("csv", "name\r\nlodash\r\n"));
    expectValidationError(() => parseImportContent("csv", "reason\r\nr\r\n"));
    expectValidationError(() => parseImportContent("csv", "Name,Reason\r\na,b\r\n"));
    expectValidationError(() => parseImportContent("csv", ""));
  });

  it("[BK-10] 닫히지 않은 따옴표 → VALIDATION_ERROR", () => {
    expectValidationError(() => parseImportContent("csv", 'name,reason\r\n"a,b\r\n'));
  });

  it("[BK-10] 빈 versionRange·expiresAt 은 null, 빈 ecosystem·severity·enabled 는 생략(기본값), enabled 는 true/false 를 boolean 으로 읽는다", () => {
    const rows = parseImportContent(
      "csv",
      `${HEADER}\r\n,lodash,,,취약점,,\r\npypi,foo,>=1,high,r,false,2027-01-01\r\n`,
    );
    expect(rows).toEqual([
      { row: 1, raw: { name: "lodash", versionRange: null, reason: "취약점", expiresAt: null } },
      {
        row: 2,
        raw: {
          ecosystem: "pypi",
          name: "foo",
          versionRange: ">=1",
          severity: "high",
          reason: "r",
          enabled: false,
          expiresAt: "2027-01-01",
        },
      },
    ]);
  });

  it("[BK-10] enabled 가 true/false 가 아니면 문자열 그대로 넘겨 스키마가 거부하게 한다", () => {
    const [row] = parseImportContent("csv", "name,reason,enabled\r\na,b,yes\r\n");
    expect(row).toEqual({ row: 1, raw: { name: "a", reason: "b", enabled: "yes" } });
  });

  it("[BK-10] 열 수가 머리글과 다른 행은 그 행의 오류이고 다른 행은 읽는다. 행 번호는 머리글을 세지 않고 빈 줄도 세지 않는다", () => {
    const rows = parseImportContent("csv", "name,reason\r\na,b\r\n\r\nonly\r\nc,d\r\n");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ row: 1, raw: { name: "a", reason: "b" } });
    expect(rows[1]).toMatchObject({ row: 2, error: { field: null } });
    expect(rows[2]).toEqual({ row: 3, raw: { name: "c", reason: "d" } });
  });

  it("[BK-10] 크기 한도: UTF-8 바이트 수가 IMPORT_MAX_BYTES 를 넘으면 VALIDATION_ERROR (문자 수가 아니라 바이트)", () => {
    const prefix = "name,reason\r\n";
    // 한글 1자 = 3바이트. 문자 수는 한도 안이지만 바이트 수는 넘는다.
    const over = `${prefix}a,${"가".repeat(Math.ceil(IMPORT_MAX_BYTES / 3))}`;
    expect(over.length).toBeLessThan(IMPORT_MAX_BYTES);
    expectValidationError(() => parseImportContent("csv", over));
    const atLimit = `${prefix}a,${"x".repeat(IMPORT_MAX_BYTES - prefix.length - 2)}`;
    expect(Buffer.byteLength(atLimit)).toBe(IMPORT_MAX_BYTES);
    expect(parseImportContent("csv", atLimit)).toHaveLength(1);
  });

  it("[BK-10] 행 수 한도: 데이터 행이 5000 을 넘으면 VALIDATION_ERROR", () => {
    const body = (count: number) => `name,reason\n${"a,b\n".repeat(count)}`;
    expect(parseImportContent("csv", body(IMPORT_MAX_ROWS))).toHaveLength(IMPORT_MAX_ROWS);
    expectValidationError(() => parseImportContent("csv", body(IMPORT_MAX_ROWS + 1)));
  });
});

describe("parseImportContent — JSON", () => {
  it("[BK-10] version 1 과 items 배열을 읽고 모르는 키는 그대로 둔다 (스키마가 무시한다)", () => {
    const rows = parseImportContent(
      "json",
      JSON.stringify({ version: 1, items: [{ name: "a", reason: "r", extra: 1 }, { name: "b", reason: "s" }] }),
    );
    expect(rows).toEqual([
      { row: 1, raw: { name: "a", reason: "r", extra: 1 } },
      { row: 2, raw: { name: "b", reason: "s" } },
    ]);
  });

  it("[BK-10] 객체가 아닌 항목은 그 행의 오류다", () => {
    const rows = parseImportContent("json", JSON.stringify({ version: 1, items: [1, null, [], "x", { name: "a", reason: "r" }] }));
    expect(rows).toHaveLength(5);
    for (const index of [0, 1, 2, 3]) {
      expect(rows[index]).toMatchObject({ row: index + 1, error: { field: null } });
    }
    expect(rows[4]).toEqual({ row: 5, raw: { name: "a", reason: "r" } });
  });

  it("[BK-10] version 이 없거나 1 이 아니면, items 가 배열이 아니면, JSON 문법 오류면 VALIDATION_ERROR", () => {
    expectValidationError(() => parseImportContent("json", JSON.stringify({ items: [] })));
    expectValidationError(() => parseImportContent("json", JSON.stringify({ version: 2, items: [] })));
    expectValidationError(() => parseImportContent("json", JSON.stringify({ version: "1", items: [] })));
    expectValidationError(() => parseImportContent("json", JSON.stringify({ version: 1 })));
    expectValidationError(() => parseImportContent("json", JSON.stringify({ version: 1, items: {} })));
    expectValidationError(() => parseImportContent("json", JSON.stringify([])));
    expectValidationError(() => parseImportContent("json", "{not json"));
    expectValidationError(() => parseImportContent("json", ""));
  });

  it("[BK-10] BOM 이 붙은 JSON 도 읽는다", () => {
    expect(parseImportContent("json", `\uFEFF${JSON.stringify({ version: 1, items: [] })}`)).toEqual([]);
  });

  it("[BK-10] 크기·행 수 한도를 JSON 에도 적용한다", () => {
    const items = Array.from({ length: IMPORT_MAX_ROWS + 1 }, () => ({ name: "a", reason: "b" }));
    expectValidationError(() => parseImportContent("json", JSON.stringify({ version: 1, items })));
    const big = JSON.stringify({ version: 1, items: [{ name: "a", reason: "x".repeat(IMPORT_MAX_BYTES) }] });
    expectValidationError(() => parseImportContent("json", big));
  });
});

describe("serializeExport", () => {
  it("[BK-10] CSV = BOM + 머리글 + CRLF 줄 끝, 빈 범위·만료일은 빈 값, enabled 는 true/false", () => {
    const csv = serializeExport("csv", [
      entry(),
      entry({ id: 2, name: "foo", ecosystem: "pypi", versionRange: ">=1", severity: "high", enabled: false, expiresAt: "2027-01-01" }),
    ]);
    expect(csv).toBe(
      `\uFEFF${HEADER}\r\n` +
        "npm,evil-pkg,,medium,악성 코드,true,\r\n" +
        "pypi,foo,>=1,high,악성 코드,false,2027-01-01\r\n",
    );
  });

  it("[BK-10] 0건이면 CSV 는 머리글만, JSON 은 items 가 빈 배열이다", () => {
    expect(serializeExport("csv", [])).toBe(`\uFEFF${HEADER}\r\n`);
    expect(JSON.parse(serializeExport("json", []))).toEqual({ version: 1, items: [] });
  });

  it("[BK-10] JSON = { version: 1, items } 이고 항목에는 id·시각·isExpired 가 없다", () => {
    const parsed: unknown = JSON.parse(serializeExport("json", [entry({ versionRange: "^1.0.0", expiresAt: "2027-01-01" })]));
    expect(parsed).toEqual({
      version: 1,
      items: [
        {
          ecosystem: "npm",
          name: "evil-pkg",
          versionRange: "^1.0.0",
          severity: "medium",
          reason: "악성 코드",
          enabled: true,
          expiresAt: "2027-01-01",
        },
      ],
    });
  });
});

describe("왕복 (v2-EC-15)", () => {
  const tricky = entry({
    name: "@scope/pkg",
    versionRange: ">=1.0.0 <2.0.0",
    reason: '쉼표, 큰따옴표 "인용", 줄바꿈\n두 번째 줄\r\n세 번째 줄, 한글',
  });
  const plain = entry({ id: 2, name: "=weird", reason: "@시작", versionRange: "=1.2.3" });

  it("[v2-EC-15] CSV 로 내보낸 값이 그대로 다시 읽힌다", () => {
    const rows = parseImportContent("csv", serializeExport("csv", [tricky, plain]));
    expect(rows).toEqual([
      {
        row: 1,
        raw: {
          ecosystem: "npm",
          name: "@scope/pkg",
          versionRange: ">=1.0.0 <2.0.0",
          severity: "medium",
          reason: tricky.reason,
          enabled: true,
          expiresAt: null,
        },
      },
      {
        row: 2,
        raw: {
          ecosystem: "npm",
          name: "=weird",
          versionRange: "=1.2.3",
          severity: "medium",
          reason: "@시작",
          enabled: true,
          expiresAt: null,
        },
      },
    ]);
  });

  it("[v2-EC-15] JSON 으로 내보낸 값이 그대로 다시 읽힌다", () => {
    const rows = parseImportContent("json", serializeExport("json", [tricky]));
    expect(rows).toEqual([
      {
        row: 1,
        raw: {
          ecosystem: "npm",
          name: "@scope/pkg",
          versionRange: ">=1.0.0 <2.0.0",
          severity: "medium",
          reason: tricky.reason,
          enabled: true,
          expiresAt: null,
        },
      },
    ]);
  });
});
