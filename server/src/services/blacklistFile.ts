import {
  BLACKLIST_FILE_COLUMNS,
  BLACKLIST_FILE_REQUIRED_COLUMNS,
  BLACKLIST_FILE_VERSION,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  type BlacklistEntry,
  type BlacklistFile,
  type BlacklistFileFormat,
  type BlacklistFileItem,
} from "@pw/shared";
import { AppError } from "../errors.ts";

/** 가져오기 파일의 데이터 행 1개. 값의 검증은 서비스가 `blacklistCreateSchema` 로 한다. */
export type ParsedRow =
  | { row: number; raw: Record<string, unknown> }
  | { row: number; error: { field: string | null; message: string } };

const BOM = "\uFEFF";

const fileError = (message: string): AppError => new AppError("VALIDATION_ERROR", message);

const stripBom = (text: string): string => (text.startsWith(BOM) ? text.slice(BOM.length) : text);

/**
 * RFC 4180 의 CSV 를 읽는다. 인용된 값 안의 쉼표·줄바꿈·`""` 를 받고 CRLF·LF 를 모두 받는다.
 * 인용되지 않은 빈 줄은 건너뛴다. 닫히지 않은 따옴표는 VALIDATION_ERROR.
 */
export function parseCsv(input: string): string[][] {
  const text = stripBom(input);
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let wasQuoted = false; // 인용된 빈 값("")을 빈 줄과 구분한다
  let inQuotes = false;

  const endField = (): void => {
    record.push(field);
    field = "";
    wasQuoted = false;
  };
  const endRecord = (): void => {
    const blankLine = record.length === 0 && field === "" && !wasQuoted;
    if (!blankLine) {
      endField();
      records.push(record);
    }
    record = [];
    field = "";
    wasQuoted = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (inQuotes) {
      if (ch !== '"') field += ch;
      else if (text.charAt(i + 1) === '"') {
        field += '"';
        i += 1;
      } else inQuotes = false;
    } else if (ch === '"' && field === "" && !wasQuoted) {
      inQuotes = true;
      wasQuoted = true;
    } else if (ch === ",") endField();
    else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text.charAt(i + 1) === "\n") i += 1;
      endRecord();
    } else field += ch;
  }
  if (inQuotes) throw fileError("CSV 의 따옴표가 닫히지 않았습니다");
  if (record.length > 0 || field !== "" || wasQuoted) endRecord();
  return records;
}

const needsQuote = /[",\r\n]/;
const quoteCell = (value: string): string => (needsQuote.test(value) ? `"${value.replaceAll('"', '""')}"` : value);

/** 모든 레코드를 CRLF 로 끝낸다. 쉼표·줄바꿈·큰따옴표가 있는 값만 인용한다. */
export function toCsv(rows: string[][]): string {
  return rows.map((row) => `${row.map(quoteCell).join(",")}\r\n`).join("");
}

function csvValue(column: string, value: string): unknown {
  if (column === "versionRange" || column === "expiresAt") return value === "" ? null : value;
  if (column === "enabled") {
    if (value === "") return undefined;
    return value === "true" ? true : value === "false" ? false : value;
  }
  if (column === "ecosystem" || column === "severity") return value === "" ? undefined : value;
  return value;
}

function parseCsvRows(content: string): ParsedRow[] {
  const [header, ...records] = parseCsv(content);
  if (!header) throw fileError("CSV 에 머리글이 없습니다");
  const missing = BLACKLIST_FILE_REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) throw fileError(`CSV 머리글에 필수 열이 없습니다 (${missing.join(", ")})`);
  if (records.length > IMPORT_MAX_ROWS) throw fileError(`행은 ${IMPORT_MAX_ROWS}개 이하입니다`);

  const columns = BLACKLIST_FILE_COLUMNS.flatMap((column) => {
    const index = header.indexOf(column);
    return index < 0 ? [] : [{ column, index }];
  });
  return records.map((record, offset): ParsedRow => {
    const row = offset + 1;
    if (record.length !== header.length) {
      return {
        row,
        error: { field: null, message: `열 수가 머리글과 다릅니다 (머리글 ${header.length}개, 행 ${record.length}개)` },
      };
    }
    const raw: Record<string, unknown> = {};
    for (const { column, index } of columns) {
      const value = csvValue(column, record[index] ?? "");
      if (value !== undefined) raw[column] = value;
    }
    return { row, raw };
  });
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseJsonRows(content: string): ParsedRow[] {
  let data: unknown;
  try {
    data = JSON.parse(stripBom(content));
  } catch {
    throw fileError("JSON 형식이 올바르지 않습니다");
  }
  if (!isPlainObject(data) || data.version !== BLACKLIST_FILE_VERSION) {
    throw fileError(`version 이 ${BLACKLIST_FILE_VERSION} 인 { version, items } 형식이어야 합니다`);
  }
  const items = data.items;
  if (!Array.isArray(items)) throw fileError("items 는 배열이어야 합니다");
  if (items.length > IMPORT_MAX_ROWS) throw fileError(`항목은 ${IMPORT_MAX_ROWS}개 이하입니다`);
  return items.map(
    (item: unknown, offset): ParsedRow =>
      isPlainObject(item)
        ? { row: offset + 1, raw: item }
        : { row: offset + 1, error: { field: null, message: "항목이 객체가 아닙니다" } },
  );
}

/**
 * 파일 수준의 오류(크기, 행 수, 읽을 수 없음, 머리글·version)는 VALIDATION_ERROR 로 던지고,
 * 행 수준의 오류는 그 행의 `error` 로 돌려준다. 행 번호는 1부터 시작하고 머리글·빈 줄을 세지 않는다.
 */
export function parseImportContent(format: BlacklistFileFormat, content: string): ParsedRow[] {
  if (Buffer.byteLength(content, "utf8") > IMPORT_MAX_BYTES) {
    throw fileError(`파일은 ${IMPORT_MAX_BYTES / (1024 * 1024)} MB 이하입니다`);
  }
  return format === "csv" ? parseCsvRows(content) : parseJsonRows(content);
}

function toFileItem(entry: BlacklistEntry): BlacklistFileItem {
  return {
    ecosystem: entry.ecosystem,
    name: entry.name,
    versionRange: entry.versionRange,
    severity: entry.severity,
    reason: entry.reason,
    enabled: entry.enabled,
    expiresAt: entry.expiresAt,
  };
}

/** CSV 는 BOM 을 붙인다(스프레드시트가 UTF-8 로 읽게). 값은 그대로 쓴다 — 수식 방지 접두어를 붙이면 다시 가져올 수 없다. */
export function serializeExport(format: BlacklistFileFormat, entries: BlacklistEntry[]): string {
  const items = entries.map(toFileItem);
  if (format === "json") {
    const file: BlacklistFile = { version: BLACKLIST_FILE_VERSION, items };
    return `${JSON.stringify(file, null, 2)}\n`;
  }
  return (
    BOM +
    toCsv([
      [...BLACKLIST_FILE_COLUMNS],
      ...items.map((item) => [
        item.ecosystem,
        item.name,
        item.versionRange ?? "",
        item.severity,
        item.reason,
        String(item.enabled),
        item.expiresAt ?? "",
      ]),
    ])
  );
}
