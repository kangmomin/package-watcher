import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../logger.ts";

/** 파일 1개가 이보다 크면(바이트) 디스크에 두지 않는다 */
export const DISK_CACHE_MAX_FILE_BYTES = 5 * 1024 * 1024;
/** 마지막 사용이 이보다 오래된 파일은 정리에서 지운다 */
export const DISK_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** 전체가 이보다 크면(바이트) 오래된 것부터 지운다 */
export const DISK_CACHE_MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

const SHA_PATTERN = /^[0-9a-f]{40,64}$/;
/** 쓰다 만 임시 파일은 이 시간이 지나면 지운다 */
const TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** 자격 증명이 든 URL(`scheme://사용자:값@host`). 길이를 제한한 문자 집합이라 선형으로 끝난다 */
const CREDENTIAL_URL = /:\/\/[^\s/@:]{1,100}:[^\s/@]{1,200}@/;

/** git 이 blob 에 붙이는 sha: `hash("blob <바이트 수>\0<내용>")` (40자 = sha1, 64자 = sha256) */
export function gitBlobSha(content: Buffer, length: number): string {
  return createHash(length === 64 ? "sha256" : "sha1")
    .update(`blob ${content.length}\0`)
    .update(content)
    .digest("hex");
}

/** 내용에 자격 증명이 든 URL 이 있는가 — lock 의 `resolved` 등에 `https://user:token@registry/…` 가 들어 있는 경우 */
export const hasCredentialUrl = (content: string): boolean => CREDENTIAL_URL.test(content);

/**
 * blob 의 디스크 캐시. blob 의 내용은 sha 가 같으면 바뀌지 않으므로(content-addressed) 다음 스캔이 요청 없이 쓴다.
 * 파일 = 내용의 바이트 그대로. 읽을 때 git blob sha 를 다시 계산해서 파일 이름과 다르면(깨진 파일) 캐시 미스다.
 * 파일은 `0o600`, 폴더는 `0o700` 으로 만든다(repo 의 파일 내용이 평문으로 남는다).
 */
export interface DiskBlobCache {
  /** 이 sha 가 디스크에 있는가(동기, 상한 계산용). 깨진 파일은 읽어야 알 수 있어서 true 일 수 있다. 형식이 맞지 않는 sha 는 false */
  has(sha: string): boolean;
  /** 없거나 읽을 수 없거나 깨졌으면 null (미스). 읽으면 마지막 사용 시각을 갱신한다 */
  read(sha: string): Promise<string | null>;
  /**
   * 저장하지 않는 것: 형식이 맞지 않는 sha, 큰 파일, 내용의 git sha 가 이름과 다른 것(잘못된 UTF-8 이라 원본 바이트가 아닌 것),
   * 자격 증명이 든 URL 이 있는 것. 쓰기가 실패해도 throw 하지 않는다
   */
  write(sha: string, content: string): Promise<void>;
  /** 캐시 적중 수(읽기 성공) */
  hits(): number;
  /** 쓰기 실패 수 */
  writeFailures(): number;
  /** 오래된 파일과 용량 초과분을 지운다. 파일 하나의 오류로 멈추지 않는다 */
  prune(): Promise<void>;
}

export interface DiskBlobCacheOptions {
  dir: string;
  logger: Logger;
  maxFileBytes?: number;
  maxAgeMs?: number;
  maxTotalBytes?: number;
  /** 정리의 기준 시각(ms) */
  now?: () => number;
  /** 읽고 쓸 때 git blob sha 로 내용을 확인한다(기본 true). 실제 git sha 가 아닌 sha 를 쓰는 테스트용 */
  verifySha?: boolean;
}

export function createDiskBlobCache(options: DiskBlobCacheOptions): DiskBlobCache {
  const { dir, logger } = options;
  const maxFileBytes = options.maxFileBytes ?? DISK_CACHE_MAX_FILE_BYTES;
  const maxAgeMs = options.maxAgeMs ?? DISK_CACHE_MAX_AGE_MS;
  const maxTotalBytes = options.maxTotalBytes ?? DISK_CACHE_MAX_TOTAL_BYTES;
  const now = options.now ?? Date.now;
  const verify = options.verifySha ?? true;
  let hits = 0;
  let failures = 0;
  let warned = false;

  // 이미 있는 폴더도 권한을 좁힌다(없거나 실패하면 무시)
  void chmod(dir, 0o700).catch(() => undefined);

  const warnOnce = (message: string, error: unknown): void => {
    if (warned) return;
    warned = true;
    logger.warn(`blob 디스크 캐시 오류: ${message}`, error);
  };
  const pathOf = (sha: string): string => join(dir, sha.slice(0, 2), sha);

  return {
    has: (sha) => SHA_PATTERN.test(sha) && existsSync(pathOf(sha)),
    async read(sha) {
      if (!SHA_PATTERN.test(sha)) return null;
      const path = pathOf(sha);
      try {
        const bytes = await readFile(path);
        if (verify && gitBlobSha(bytes, sha.length) !== sha) return null;
        hits += 1;
        const at = new Date(now());
        await utimes(path, at, at).catch(() => undefined);
        return bytes.toString("utf8");
      } catch {
        return null;
      }
    },
    async write(sha, content) {
      if (!SHA_PATTERN.test(sha)) return;
      const bytes = Buffer.from(content, "utf8");
      if (bytes.length > maxFileBytes) return;
      if (verify && gitBlobSha(bytes, sha.length) !== sha) return;
      if (hasCredentialUrl(content)) return;
      const path = pathOf(sha);
      const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
      try {
        await mkdir(join(dir, sha.slice(0, 2)), { recursive: true, mode: 0o700 });
        await writeFile(temp, bytes, { mode: 0o600 });
        await rename(temp, path);
      } catch (error) {
        failures += 1;
        await rm(temp, { force: true }).catch(() => undefined);
        warnOnce(`${sha} 를 저장하지 못했습니다`, error);
      }
    },
    hits: () => hits,
    writeFailures: () => failures,
    async prune() {
      try {
        const files: { path: string; size: number; mtime: number }[] = [];
        for (const sub of await readdir(dir).catch(() => [] as string[])) {
          const subDir = join(dir, sub);
          for (const name of await readdir(subDir).catch(() => [] as string[])) {
            const path = join(subDir, name);
            const info = await stat(path).catch(() => null);
            if (!info?.isFile()) continue;
            files.push({ path, size: info.size, mtime: info.mtimeMs });
          }
        }
        // 지우기 직전에 mtime 을 다시 본다 — 그 사이에 읽히거나 쓰인 파일은 지우지 않는다.
        const remove = async (file: { path: string; mtime: number }): Promise<boolean> => {
          try {
            const info = await stat(file.path);
            if (info.mtimeMs !== file.mtime) return false;
            await rm(file.path, { force: true });
            return true;
          } catch (error) {
            warnOnce(`${file.path} 를 지우지 못했습니다`, error);
            return false;
          }
        };
        const current = now();
        const keep: typeof files = [];
        for (const file of files) {
          const limit = file.path.endsWith(".tmp") ? TEMP_MAX_AGE_MS : maxAgeMs;
          if (current - file.mtime > limit && (await remove(file))) continue;
          keep.push(file);
        }
        let total = keep.reduce((sum, file) => sum + file.size, 0);
        keep.sort((a, b) => a.mtime - b.mtime);
        for (const file of keep) {
          if (total <= maxTotalBytes) break;
          if (await remove(file)) total -= file.size;
        }
      } catch (error) {
        logger.warn("blob 디스크 캐시를 정리하지 못했습니다", error);
      }
    },
  };
}
