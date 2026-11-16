import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeLogger } from "../test/logger.ts";
import { createDiskBlobCache, gitBlobSha } from "./diskBlobCache.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 내용의 진짜 git blob sha */
const shaOf = (content: string): string => gitBlobSha(Buffer.from(content, "utf8"), 40);
const make = (options: { maxFileBytes?: number; maxTotalBytes?: number; now?: () => number; dir?: string } = {}) => {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), "pw-blob-"));
  if (!options.dir) dirs.push(dir);
  const logger = new FakeLogger();
  return { dir, logger, cache: createDiskBlobCache({ ...options, dir, logger }) };
};
const fileOf = (dir: string, sha: string): string => join(dir, sha.slice(0, 2), sha);

describe("blob 디스크 캐시", () => {
  it("[SH-30] 저장한 내용을 읽고(적중 수 +1) 읽으면 마지막 사용 시각을 갱신한다", async () => {
    const { dir, cache } = make();
    const content = "한글 내용\n둘째 줄";
    const sha = shaOf(content);
    await cache.write(sha, content);
    const old = new Date("2020-01-01T00:00:00Z");
    utimesSync(fileOf(dir, sha), old, old);

    expect(cache.has(sha)).toBe(true);
    expect(await cache.read(sha)).toBe(content);
    expect(cache.hits()).toBe(1);
    expect(statSync(fileOf(dir, sha)).mtimeMs).toBeGreaterThan(old.getTime() + 1000);
    expect(await cache.read(shaOf("없는 내용"))).toBeNull();
    expect(readdirSync(join(dir, sha.slice(0, 2)))).toEqual([sha]); // 임시 파일이 남지 않는다
  });

  it("[SH-31] 깨진 파일(내용이 sha 와 다름, 옛 형식, 폴더)은 미스이고 다시 쓰면 덮어쓴다", async () => {
    const { dir, cache } = make();
    const sha = shaOf("content");
    mkdirSync(join(dir, sha.slice(0, 2)), { recursive: true });
    writeFileSync(fileOf(dir, sha), "garbage");
    expect(await cache.read(sha)).toBeNull();
    writeFileSync(fileOf(dir, sha), `${"0".repeat(40)}\ncontent`); // 옛 형식(검사값 줄 + 내용)
    expect(await cache.read(sha)).toBeNull();
    const other = shaOf("dir");
    mkdirSync(join(dir, other.slice(0, 2), other), { recursive: true });
    expect(await cache.read(other)).toBeNull();

    await cache.write(sha, "content");
    expect(await cache.read(sha)).toBe("content");
  });

  it("[SH-32] sha 형식이 맞지 않으면 저장도 읽기도 하지 않는다 (경로 조작 방지)", async () => {
    const { dir, cache } = make();
    for (const bad of ["../evil", "a".repeat(39), "A".repeat(40), `${"a".repeat(40)}/x`, "g".repeat(40), ""]) {
      await cache.write(bad, "x");
      expect(await cache.read(bad)).toBeNull();
      expect(cache.has(bad)).toBe(false);
    }
    expect(readdirSync(dir)).toEqual([]);
  });

  it("[SH-33] 5MB 를 넘는 파일은 저장하지 않는다", async () => {
    const { cache } = make({ maxFileBytes: 10 });
    const big = "x".repeat(11);
    const small = "y".repeat(10);
    await cache.write(shaOf(big), big);
    await cache.write(shaOf(small), small);
    expect(cache.has(shaOf(big))).toBe(false);
    expect(cache.has(shaOf(small))).toBe(true);
  });

  it("[SH-34] 정리: 마지막 사용이 30일보다 오래된 파일과 오래된 임시 파일을 지운다", async () => {
    const now = Date.parse("2026-11-16T00:00:00Z");
    const { dir, cache } = make({ now: () => now });
    const [oldSha, newSha] = [shaOf("old"), shaOf("new")];
    await cache.write(oldSha, "old");
    await cache.write(newSha, "new");
    const day = 24 * 3600 * 1000;
    utimesSync(fileOf(dir, oldSha), new Date(now - 31 * day), new Date(now - 31 * day));
    utimesSync(fileOf(dir, newSha), new Date(now - 29 * day), new Date(now - 29 * day));
    const temp = `${fileOf(dir, newSha)}.dead.tmp`;
    writeFileSync(temp, "partial");
    utimesSync(temp, new Date(now - 2 * day), new Date(now - 2 * day));

    await cache.prune();

    expect(existsSync(fileOf(dir, oldSha))).toBe(false);
    expect(existsSync(fileOf(dir, newSha))).toBe(true);
    expect(existsSync(temp)).toBe(false);
  });

  it("[SH-35] 정리: 전체가 상한을 넘으면 오래된 것부터 지운다", async () => {
    const now = Date.parse("2026-11-16T00:00:00Z");
    const { dir, cache } = make({ now: () => now, maxTotalBytes: 40 });
    const contents = ["1", "2", "3"].map((c) => c.repeat(30));
    for (const [index, content] of contents.entries()) {
      await cache.write(shaOf(content), content);
      const at = new Date(now - (3 - index) * 1000);
      utimesSync(fileOf(dir, shaOf(content)), at, at);
    }

    await cache.prune();

    expect(contents.map((content) => existsSync(fileOf(dir, shaOf(content))))).toEqual([false, false, true]);
  });

  it("[SH-36] 정리가 실패해도 throw 하지 않는다 (없는 폴더는 빈 캐시)", async () => {
    const { cache } = make({ dir: join(tmpdir(), "pw-blob-not-exist-xyz") });
    await expect(cache.prune()).resolves.toBeUndefined();
  });
});

describe("blob 디스크 캐시 — 안전", () => {
  it("[SH-50] 자격 증명이 든 URL(`://사용자:값@`)이 있는 내용은 저장하지 않는다", async () => {
    const { cache } = make();
    const secret = '{"resolved": "https://user:s3cret@registry.example.com/x/-/x-1.0.0.tgz"}';
    const plain = '{"resolved": "https://registry.npmjs.org/x/-/x-1.0.0.tgz", "git": "ssh://git@github.com:22/o/r.git"}';
    await cache.write(shaOf(secret), secret);
    await cache.write(shaOf(plain), plain);

    expect(cache.has(shaOf(secret))).toBe(false);
    expect(cache.has(shaOf(plain))).toBe(true);
  });

  it("[SH-51] 읽은 내용의 git blob sha 가 이름과 다르면 미스, 잘못된 UTF-8 이라 원본 바이트가 아닌 내용은 저장하지 않는다", async () => {
    const { dir, cache } = make();
    const sha = shaOf("original");
    mkdirSync(join(dir, sha.slice(0, 2)), { recursive: true });
    writeFileSync(fileOf(dir, sha), "tampered");
    expect(await cache.read(sha)).toBeNull();

    const lossy = Buffer.from([0x61, 0xff, 0x62]); // 잘못된 UTF-8: 문자열로 바꾸면 U+FFFD 가 된다
    const lossySha = gitBlobSha(lossy, 40);
    await cache.write(lossySha, lossy.toString("utf8"));
    expect(cache.has(lossySha)).toBe(false);
  });

  it.skipIf(process.platform === "win32")("[SH-52] 파일은 0600, 폴더는 0700 으로 만든다", async () => {
    const { dir, cache } = make();
    const sha = shaOf("perm");
    await cache.write(sha, "perm");

    expect(statSync(fileOf(dir, sha)).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, sha.slice(0, 2))).mode & 0o777).toBe(0o700);
  });

  it("[SH-53] 정리는 지우기 직전에 다시 읽은 파일(mtime 이 바뀐 것)을 지우지 않는다", async () => {
    const day = 24 * 3600 * 1000;
    const nowMs = Date.parse("2026-11-16T00:00:00Z");
    let touch: () => void = () => undefined;
    const { dir, cache } = make({
      now: () => {
        touch(); // 목록을 만든 뒤, 지우기 전에 다른 스캔이 읽은 것을 흉내 낸다
        return nowMs;
      },
    });
    const [a, b] = [shaOf("a-old"), shaOf("b-old")];
    await cache.write(a, "a-old");
    await cache.write(b, "b-old");
    for (const sha of [a, b]) utimesSync(fileOf(dir, sha), new Date(nowMs - 40 * day), new Date(nowMs - 40 * day));
    touch = () => utimesSync(fileOf(dir, a), new Date(nowMs - 1000), new Date(nowMs - 1000));

    await cache.prune();

    expect(existsSync(fileOf(dir, a))).toBe(true);
    expect(existsSync(fileOf(dir, b))).toBe(false);
  });

  it("[SH-54] 쓰기 실패는 throw 하지 않고 횟수로 세며 warn 은 1번만 남긴다", async () => {
    const blocker = mkdtempSync(join(tmpdir(), "pw-blob-"));
    dirs.push(blocker);
    const file = join(blocker, "not-a-dir");
    writeFileSync(file, "x");
    const { cache, logger } = make({ dir: file });

    await cache.write(shaOf("one"), "one");
    await cache.write(shaOf("two"), "two");

    expect(cache.writeFailures()).toBe(2);
    expect(logger.texts("warn").filter((text) => text.includes("blob 디스크 캐시 오류"))).toHaveLength(1);
  });
});
