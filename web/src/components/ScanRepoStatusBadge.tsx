// repo 상태 배지: 한글 라벨 + 색 (색만으로 구분하지 않는다).
import type { ScanRepoStatus } from "@pw/shared";
import { Badge } from "@/components/ui/badge";
import { scanRepoStatusLabel } from "@/lib/format";

export interface ScanRepoStatusBadgeProps {
  status: ScanRepoStatus;
}

const ZINC = "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200";

const STATUS_CLASSES: Record<ScanRepoStatus, string> = {
  passed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  issue: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  failed: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  running: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  pending: ZINC,
  skipped: ZINC,
};

export function ScanRepoStatusBadge({ status }: ScanRepoStatusBadgeProps) {
  return (
    <Badge variant="secondary" className={STATUS_CLASSES[status]}>
      {scanRepoStatusLabel(status)}
    </Badge>
  );
}
