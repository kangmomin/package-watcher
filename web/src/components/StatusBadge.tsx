// 상태 배지: 영문 값 그대로 + 색 (색만으로 구분하지 않는다).
import type { FindingStatus, ScanStatus } from "@pw/shared";
import { Badge } from "@/components/ui/badge";

type Status = FindingStatus | ScanStatus;

const STATUS_CLASSES: Record<Status, string> = {
  open: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  ignored: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  resolved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  running: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  success: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  partial: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <Badge variant="secondary" className={STATUS_CLASSES[status]}>
      {status}
    </Badge>
  );
}
