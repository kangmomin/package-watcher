import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { applySchema } from "./schema.ts";

export type Db = Database.Database;

/**
 * SQLite 를 연다. 부모 디렉터리를 `mkdirSync(recursive)` 로 만들고 스키마(`applySchema`)를 적용한다.
 * 같은 경로로 다시 열면 서버 재시작과 같다.
 */
export function openDatabase(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  applySchema(db);
  return db;
}
