import { closeSync, fsyncSync, mkdirSync, openSync, readSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { LATEST_VERSION, migrateFrom } from "./schema.ts";

export type Db = Database.Database;

export interface OpenedDatabase {
  db: Db;
  /** 마이그레이션 전의 `user_version`. 마이그레이션이 없었으면 null */
  migratedFrom: number | null;
  /** 마이그레이션 직전의 자동 백업 파일. 백업이 없었으면 null */
  backupPath: string | null;
}

const RENAME_RETRIES = 5;
const RENAME_RETRY_MS = 100;
const MAX_ATTEMPTS = 5;
/** SQLite 파일 헤더의 `user_version`(offset 60, big-endian uint32) */
const HEADER_USER_VERSION_OFFSET = 60;

const userVersionOf = (db: Db): number => Number(db.pragma("user_version", { simple: true }));

const hasEntriesTable = (db: Db): boolean =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'blacklist_entries'").get() !==
  undefined;

/** 동기 함수라서 `Atomics.wait` 로 기다린다(busy loop 금지). */
const sleepSync = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/** SQLite 연결을 열지 않고 파일 헤더에서 읽는다. 연결을 열면 Windows 에서 rename 이 EBUSY 가 된다. */
function headerUserVersion(path: string): number {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(4);
    readSync(fd, buffer, 0, 4, HEADER_USER_VERSION_OFFSET);
    return buffer.readUInt32BE(0);
  } finally {
    closeSync(fd);
  }
}

function renameWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const transient = process.platform === "win32" && (code === "EPERM" || code === "EBUSY");
      if (!transient || attempt >= RENAME_RETRIES) throw error;
      sleepSync(RENAME_RETRY_MS);
    }
  }
}

/**
 * 마이그레이션 직전의 백업 `<db>.v{n}-backup`. 기존 백업은 덮어쓴다(현재 DB 가 항상 가장 최근의 마이그레이션 전 상태다).
 * `VACUUM INTO` → fsync → 헤더의 버전 확인 → rename. 그 사이에 다른 프로세스가 마이그레이션을 끝냈으면
 * (tmp 의 버전이 n 이 아니면) tmp 를 버리고 null 을 반환해서 호출자가 판정을 처음부터 다시 한다.
 * 실패하면 tmp 를 지우고 throw 한다.
 */
function backup(db: Db, dbPath: string, version: number): string | null {
  const finalPath = `${dbPath}.v${version}-backup`;
  const tmpPath = `${finalPath}.tmp`;
  try {
    rmSync(tmpPath, { force: true });
    db.prepare("VACUUM INTO ?").run(tmpPath);
    // Windows 는 읽기 전용 fd 의 fsync 가 EPERM 이라서 r+ 로 연다.
    const fd = openSync(tmpPath, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (headerUserVersion(tmpPath) !== version) {
      rmSync(tmpPath, { force: true });
      return null;
    }
    renameWithRetry(tmpPath, finalPath);
    return finalPath;
  } catch (error) {
    rmSync(tmpPath, { force: true });
    throw error;
  }
}

/** 트랜잭션 1개(`BEGIN IMMEDIATE`)로 올린다. 안에서 `user_version` 을 다시 읽어 다른 프로세스의 마이그레이션을 확인한다. */
function migrate(db: Db): boolean {
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = userVersionOf(db);
    if (current >= LATEST_VERSION) {
      db.exec("ROLLBACK");
      return false;
    }
    migrateFrom(db, current);
    db.pragma(`user_version = ${LATEST_VERSION}`);
    db.exec("COMMIT");
    return true;
  } catch (error) {
    if (db.inTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * 판정 순서(어떤 단계도 실행하기 전): ① `user_version` 이 최신보다 크면 거부 ② 같으면 끝
 * ③ `blacklist_entries` 가 있으면 기존 DB 라서 백업 ④ 마이그레이션.
 * `user_version` 은 새 DB 와 v1 DB 가 모두 0 이라서 기존 DB 여부는 테이블로 판정한다.
 */
function prepareSchema(db: Db, dbPath: string): Pick<OpenedDatabase, "migratedFrom" | "backupPath"> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const version = userVersionOf(db);
    if (version > LATEST_VERSION) {
      throw new Error(
        `DB 의 user_version(${version})이 이 서버가 아는 최신 버전(${LATEST_VERSION})보다 큽니다. 더 새로운 버전의 서버가 만든 DB 라서 시작하지 않습니다`,
      );
    }
    if (version === LATEST_VERSION) return { migratedFrom: null, backupPath: null };

    const existing = hasEntriesTable(db);
    let backupPath: string | null = null;
    if (existing) {
      backupPath = backup(db, dbPath, version);
      if (backupPath === null) continue;
    }
    // 새 DB 는 "마이그레이션"이 아니라 생성이라서 migratedFrom 이 null 이다(로그도 남기지 않는다).
    return migrate(db) && existing
      ? { migratedFrom: version, backupPath }
      : { migratedFrom: null, backupPath: null };
  }
  throw new Error(
    "DB 마이그레이션 전 백업의 버전을 확인하지 못했습니다. 다른 프로세스가 같은 DB 를 사용 중인지 확인하십시오",
  );
}

/**
 * SQLite 를 연다. 부모 디렉터리를 만들고 필요하면 백업 → 마이그레이션을 한다.
 * 백업·마이그레이션이 실패하거나 DB 가 더 새로운 버전이면 연결을 닫고 throw 한다(시작 거부).
 * 같은 경로로 다시 열면 서버 재시작과 같다.
 */
export function openDatabase(path: string): OpenedDatabase {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    return { db, ...prepareSchema(db, path) };
  } catch (error) {
    // 닫지 않으면 Windows 에서 임시 폴더 삭제가 EBUSY 로 실패한다.
    db.close();
    throw error;
  }
}
