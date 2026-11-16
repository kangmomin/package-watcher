// 설정의 "외부 목록" 구역.
// 켬·끔은 폼의 필드다([저장] 과 함께 저장). 상태와 [지금 동기화] 는 서버 상태라서 폼과 따로 움직인다.
// 상태는 폼과 따로 불러온다: 실패해도 폼은 그대로 쓸 수 있다.
import { ECOSYSTEMS, type FeedStatus } from "@pw/shared";
import { Link } from "react-router";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useFeedStatus, useSyncFeed } from "@/features/feed/hooks";
import { NOT_APPLICABLE_LABEL, ecosystemLabel, formatCardTime, formatCount } from "@/lib/format";
import { firstLoadState } from "@/lib/queryState";

export interface FeedSectionProps {
  /** 폼의 feedEnabled 값 */
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

const TOP_ECOSYSTEMS = 3;

/** `npm 125,762 · pypi 17,529 · nuget 4,555 외 5종` — 많은 순서로 상위 몇 개만. */
function ecosystemSummary(byEcosystem: FeedStatus["byEcosystem"]): string {
  const entries = Object.entries(byEcosystem)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a);
  const top = entries.slice(0, TOP_ECOSYSTEMS).map(([key, count]) => {
    const known = ECOSYSTEMS.find((ecosystem) => ecosystem === key);
    return `${known ? ecosystemLabel(known) : key} ${formatCount(count)}`;
  });
  const rest = entries.length - top.length;
  return top.join(" · ") + (rest > 0 ? ` 외 ${rest}종` : "");
}

export function FeedSection({ enabled, onEnabledChange }: FeedSectionProps) {
  const id = useId();
  const status = useFeedStatus();
  const sync = useSyncFeed();
  const data = status.data;
  const { isError, isLoading } = firstLoadState(status);

  // 서버가 꺼 둔 동안은 동기화할 수 없다(폼의 저장 전 값이 아니라 서버의 값으로 판정한다).
  const isOff = data !== undefined && !data.enabled;
  const isSyncing = data?.syncing === true || sync.isPending;
  const syncBlocked = data === undefined || isOff || isSyncing;

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3">
      <h2 id={`${id}-title`} className="text-sm font-medium">
        외부 목록
      </h2>
      <p className="text-sm text-muted-foreground">
        GitHub Advisory의 악성 패키지 목록을 자동으로 가져와서 스캔에 씁니다. 일치한 패키지는 블랙리스트에 자동으로
        추가됩니다.
      </p>
      <div className="flex items-center gap-2">
        <Switch id={`${id}-enabled`} checked={enabled} onCheckedChange={onEnabledChange} />
        <label htmlFor={`${id}-enabled`} className="text-sm">
          외부 목록 사용
        </label>
      </div>

      {isLoading && (
        <p role="status" className="text-sm text-muted-foreground">
          상태를 불러오는 중
        </p>
      )}
      {isError && (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <p>상태를 불러오지 못했습니다</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void status.refetch()}>
            다시 시도
          </Button>
        </div>
      )}
      {data && <FeedStatusView status={data} />}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" disabled={syncBlocked} onClick={() => sync.mutate()}>
          지금 동기화
        </Button>
        <Link to="/feed" className="text-sm underline underline-offset-4">
          목록 검색
        </Link>
        {isOff && (
          <p className="text-sm text-muted-foreground">외부 목록이 꺼져 있어서 동기화할 수 없습니다</p>
        )}
      </div>
      {/* 진행 문구는 항상 있는 영역에 넣어서 스크린 리더가 변화를 읽게 한다 */}
      <div aria-live="polite" className="text-sm text-muted-foreground">
        {data?.syncing && <p>{`동기화 중 — ${formatCount(data.syncedSoFar)}건 받음`}</p>}
      </div>
    </section>
  );
}

function FeedStatusView({ status }: { status: FeedStatus }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[8rem_1fr]">
        <dt className="text-muted-foreground">항목 수</dt>
        <dd>{`${formatCount(status.entryCount)}건`}</dd>
        {Object.keys(status.byEcosystem).length > 0 && (
          <>
            <dt className="text-muted-foreground">종류별</dt>
            <dd>{ecosystemSummary(status.byEcosystem)}</dd>
          </>
        )}
        <dt className="text-muted-foreground">마지막 동기화</dt>
        <dd>{status.lastSyncedAt ? formatCardTime(status.lastSyncedAt) : NOT_APPLICABLE_LABEL}</dd>
        {status.skippedCount > 0 && (
          <>
            <dt className="text-muted-foreground">건너뜀</dt>
            <dd>{`${formatCount(status.skippedCount)}건 (범위를 바꿀 수 없는 항목)`}</dd>
          </>
        )}
      </dl>
      {!status.fullSyncDone && (
        <p className="text-amber-700 dark:text-amber-300">첫 동기화가 끝나지 않았습니다 — 목록이 일부입니다</p>
      )}
      {status.lastError && (
        <p role="alert" className="text-amber-700 dark:text-amber-300">
          {`마지막 동기화 오류: ${status.lastError}`}
        </p>
      )}
    </div>
  );
}
