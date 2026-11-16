import { POLICY_CHECKS, POLICY_ECOSYSTEM } from "@pw/shared";
import type { Clock } from "../clock.ts";
import type { Repositories } from "../repositories/index.ts";
import { toIso } from "./common.ts";
import { todayKst } from "./entryActivity.ts";

/**
 * 내장 검사(`POLICY_CHECKS`)의 항목을 없는 것만 만든다. 있는 항목은 건드리지 않는다 —
 * 사용자가 바꾼 켬·끔·심각도·사유를 시작할 때마다 되돌리면 안 된다. 멱등이다. 만든 개수를 반환한다.
 */
export function seedPolicyEntries(repos: Repositories, clock: Clock): number {
  const now = toIso(clock.now());
  const today = todayKst(clock);
  return repos.transaction(() => {
    let created = 0;
    for (const check of POLICY_CHECKS) {
      if (repos.blacklist.findByKey(POLICY_ECOSYSTEM, check.id, null, today)) continue;
      repos.blacklist.insert(
        {
          ecosystem: POLICY_ECOSYSTEM,
          name: check.id,
          versionRange: null,
          reason: check.description,
          severity: check.severity,
          enabled: true,
          expiresAt: null,
        },
        now,
        today,
      );
      created += 1;
    }
    return created;
  });
}
