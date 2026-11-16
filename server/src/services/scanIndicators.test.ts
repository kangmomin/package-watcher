import type { BlacklistEntry } from "@pw/shared";
import { describe, expect, it } from "vitest";
import { FakeLogger } from "../test/logger.ts";
import { createIndicatorRules } from "./scanIndicators.ts";

const entry = (id: number, ecosystem: string, name: string): BlacklistEntry =>
  ({ id, ecosystem, name, versionRange: null }) as unknown as BlacklistEntry;

describe("대규모 경로의 매칭", () => {
  it("[SC-77] 경로 10만 개 × 패턴 300개(* 로 시작 포함, 일치 0건)가 3초 안에 끝나고 이벤트 루프에 양보한다", async () => {
    const entries: BlacklistEntry[] = [];
    for (let i = 0; i < 150; i += 1) entries.push(entry(i + 1, "path", `*zzq${i}-trace*.sh`));
    for (let i = 0; i < 150; i += 1) entries.push(entry(1000 + i, "path", `dir/zzw${i}/*/end${i}.js`));
    const rules = createIndicatorRules(entries);
    const treePaths = Array.from({ length: 100_000 }, (_, i) => `src/pkg${i % 500}/module-${i}/index.ts`);

    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 1);
    const started = Date.now();
    const found = await rules.matchPaths("svc", "o/svc", treePaths, new FakeLogger());
    clearInterval(timer);

    expect(found).toEqual([]);
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(ticks).toBeGreaterThan(0);
  });

  it("[SC-78] 사전 필터를 거쳐도 일치는 그대로다(* 사이의 가장 긴 조각)", async () => {
    const rules = createIndicatorRules([entry(1, "path", "a*bcd*e"), entry(2, "path", "*.ci-run.sh")]);

    const found = await rules.matchPaths("svc", "o/svc", ["x/abcde", "x/abce", "q/.ci-run.sh"], new FakeLogger());

    expect(found.map((m) => `${m.blacklistEntryId}:${m.filePath}`).sort()).toEqual([
      "1:x/abcde",
      "2:q/.ci-run.sh",
    ]);
  });
});
