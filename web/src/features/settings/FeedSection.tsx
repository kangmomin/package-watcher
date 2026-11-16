// 설정의 "외부 목록" 구역.
// 켬·끔은 폼의 필드다([저장] 과 함께 저장). 상태와 [지금 동기화] 는 서버 상태라서 폼과 따로 움직인다.
// 상태는 폼과 따로 불러온다: 실패해도 폼은 그대로 쓸 수 있다.
import { ECOSYSTEMS, type FeedStatus } from "@pw/shared";
import { TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useFeedStatus, useSyncFeed } from "@/features/feed/hooks";
import { NOT_APPLICABLE_LABEL, ecosystemLabel, formatCardTime, formatCount } from "@/lib/format";
import { firstLoadState } from "@/lib/queryState";

export interface FeedSectionProps {
  /** 폼의 feedEnabled 값 */
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  /** 폼에 저장하지 않은 변경이 있다 — "목록 검색" 으로 이동하면 사라진다 */
  isFormDirty?: boolean;
}

const TOP_ECOSYSTEMS = 3;

/** 많은 순서로 `npm 125,762` 형태의 문구 목록. 알 수 없는 종류는 키 그대로 쓴다. */
function ecosystemParts(byEcosystem: FeedStatus["byEcosystem"]): string[] {
  return Object.entries(byEcosystem)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([key, count]) => {
      const known = ECOSYSTEMS.find((ecosystem) => ecosystem === key);
      return `${known ? ecosystemLabel(known) : key} ${formatCount(count)}`;
    });
}

export function FeedSection({ enabled, onEnabledChange, isFormDirty = false }: FeedSectionProps) {
  const id = useId();
  const status = useFeedStatus();
  const sync = useSyncFeed();
  const data = status.data;
  const { isError, isLoading } = firstLoadState(status);

  // 서버가 꺼 둔 동안은 동기화할 수 없다(폼의 저장 전 값이 아니라 서버의 값으로 판정한다).
  const isOff = data !== undefined && !data.enabled;
  const isSyncing = data?.syncing === true || sync.isPending;
  const syncBlocked = data === undefined || isOff || isSyncing;
  // 폼 값과 서버 값이 다르면(저장 전) 무엇이 바뀌는지 알린다. 버튼은 서버 값을 따른다.
  const pendingNote =
    data === undefined || enabled === data.enabled
      ? undefined
      : enabled
        ? "저장하면 동기화할 수 있습니다"
        : "저장하면 동기화가 꺼집니다";

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
        {isFormDirty && <p className="text-sm text-muted-foreground">저장하지 않은 변경이 있습니다</p>}
        {isOff && (
          <p className="text-sm text-muted-foreground">외부 목록이 꺼져 있어서 동기화할 수 없습니다</p>
        )}
        {pendingNote && <p className="text-sm text-muted-foreground">{pendingNote}</p>}
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
            <dd><EcosystemCounts parts={ecosystemParts(status.byEcosystem)} /></dd>
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
        // alert 가 아니다: 요청이 실패한 순간의 알림은 toast 가 하고, 이 줄은 화면을 열 때마다 읽히면 안 된다.
        <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-300">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {`마지막 동기화의 오류: ${status.lastError}`}
        </p>
      )}
    </div>
  );
}

/** 상위 3개 + "외 n종". 접힌 종류는 [모두 보기] 로 펼친다. */
function EcosystemCounts({ parts }: { parts: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const hidden = parts.length - TOP_ECOSYSTEMS;
  if (hidden <= 0) return <>{parts.join(" · ")}</>;
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span>{(expanded ? parts : parts.slice(0, TOP_ECOSYSTEMS)).join(" · ")}</span>
      {!expanded && <span>{`외 ${hidden}종`}</span>}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
        className="text-xs underline underline-offset-4"
      >
        {expanded ? "접기" : "모두 보기"}
      </button>
    </span>
  );
}
