// [지금 스캔].
// 비활성: summary loading 중, 스캔 실행 중(isScanRunning(summary)), 요청 중.
// ORG_NOT_SET / TOKEN_MISSING → toast + action "설정으로 이동".
import { LoaderCircleIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTriggerScan } from "@/features/scans/hooks";
import { isScanRunning, useSummary } from "@/features/summary/useSummary";

export function ScanNowButton() {
  const summary = useSummary();
  const trigger = useTriggerScan();
  const running = isScanRunning(summary.data);
  const disabled = summary.isPending || running || trigger.isPending;

  return (
    <Button disabled={disabled} onClick={() => trigger.mutate()}>
      {running || trigger.isPending ? (
        <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
      ) : (
        <RefreshCwIcon aria-hidden="true" />
      )}
      지금 스캔
    </Button>
  );
}
