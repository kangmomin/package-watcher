import { afterEach, describe, expect, it } from "vitest";
import { createEntryIndex } from "../matcher.ts";
import { createRepositories } from "../repositories/index.ts";
import { cleanupTestApps, createTestApp } from "../test/testApp.ts";
import { createCompositeIndex, createFeedIndex } from "./index.ts";

afterEach(cleanupTestApps);

const TOTAL = 150_000;
/** 실제 분포(npm 12.5만, PyPI 1.7만, NuGet 4.5천, 나머지)를 따른다 */
const ECOSYSTEMS: [string, number][] = [
  ["npm", 125_000],
  ["pypi", 17_500],
  ["nuget", 4_500],
  ["cargo", 3_000],
];

describe("feed index (15만 건)", () => {
  it("[SE-70] 생성 2초 이내, 조회는 Map 이라 빠르다. 생성 시간과 메모리를 기록한다", () => {
    const t = createTestApp();
    const { db } = t.instance;
    const insert = db.prepare(
      `INSERT INTO feed_entries (external_id, ecosystem, name, version_range, raw_range, severity, summary, url, updated_at)
       VALUES (?, ?, ?, ?, ?, 'critical', ?, ?, ?)`,
    );
    db.transaction(() => {
      let n = 0;
      for (const [ecosystem, count] of ECOSYSTEMS) {
        for (let i = 0; i < count; i += 1) {
          n += 1;
          insert.run(
            `GHSA-${n.toString(36).padStart(4, "0")}-aaaa-bbbb`,
            ecosystem,
            `malicious-package-name-${ecosystem}-${i}`,
            i % 3 === 0 ? "" : `<${i % 50}.0.0`,
            i % 3 === 0 ? ">= 0" : `< ${i % 50}.0.0`,
            `Malware in malicious-package-name-${ecosystem}-${i} that steals credentials from the build environment`,
            `https://github.com/advisories/GHSA-${n}`,
            "2026-11-01T00:00:00.000Z",
          );
        }
      }
    })();
    const repos = createRepositories(db);
    expect(repos.feed.count()).toBe(TOTAL);

    globalThis.gc?.();
    const heapBefore = process.memoryUsage().heapUsed;
    const started = performance.now();
    const index = createFeedIndex(repos.feed.iterateIndexRows());
    const elapsed = performance.now() - started;
    const heapMb = (process.memoryUsage().heapUsed - heapBefore) / (1024 * 1024);

    console.info(`[SE-70] feed index ${index.size}건: 생성 ${elapsed.toFixed(0)}ms, 힙 증가 약 ${heapMb.toFixed(0)}MB (gc ${globalThis.gc ? "있음" : "없음"})`);
    expect(index.size).toBe(TOTAL);
    expect(elapsed).toBeLessThan(2_000);
    expect(heapMb).toBeLessThan(400);
    expect([...index.ecosystems].sort()).toEqual(["cargo", "npm", "nuget", "pypi"]);

    // 합성 index 의 조회: lock 파일 패키지 10만 개 (일치 1,000개)
    const composite = createCompositeIndex(createEntryIndex([]), index, new Set());
    const lookupStarted = performance.now();
    let hits = 0;
    for (let i = 0; i < 100_000; i += 1) {
      const name = i % 100 === 0 ? `malicious-package-name-npm-${i}` : `ordinary-package-${i}`;
      hits += composite.match("npm", name).length;
    }
    const lookupMs = performance.now() - lookupStarted;
    console.info(`[SE-70] 조회 10만 회 ${lookupMs.toFixed(0)}ms, 일치 ${hits}건`);
    expect(hits).toBe(1_000);
    expect(lookupMs).toBeLessThan(2_000);
  });

  it("[SE-71] 같은 키의 항목은 blocked 로 뺀다 (이름이 같아도 범위가 다르면 남긴다)", () => {
    const index = createFeedIndex([
      { id: 1, ecosystem: "npm", name: "evil", versionRange: null },
      { id: 2, ecosystem: "npm", name: "evil", versionRange: "<1.0.0" },
    ]);
    const blocked = new Set(["npm\u0000evil\u0000"]);

    const composite = createCompositeIndex(createEntryIndex([]), index, blocked);

    expect(composite.match("npm", "evil").map((entry) => entry.id)).toEqual([-2]);
    expect(composite.match("pypi", "evil")).toEqual([]);
  });

  it("[SE-72] 이름은 그 종류의 규칙으로 정규화해서 찾는다 (pypi: PEP 503)", () => {
    const index = createFeedIndex([{ id: 7, ecosystem: "pypi", name: "evil-py", versionRange: null }]);

    const composite = createCompositeIndex(createEntryIndex([]), index, new Set());

    expect(composite.match("pypi", "Evil_Py").map((entry) => entry.id)).toEqual([-7]);
  });
});
