// 심각도 배지: 영문 값 그대로 + 색 (색만으로 구분하지 않는다).
import type { Severity } from "@pw/shared";
import { Badge } from "@/components/ui/badge";

export interface SeverityBadgeProps {
  severity: Severity;
}

const SEVERITY_CLASSES: Record<Severity, string> = {
  critical: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  low: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
};

export function SeverityBadge({ severity }: SeverityBadgeProps) {
  return (
    <Badge variant="secondary" className={SEVERITY_CLASSES[severity]}>
      {severity}
    </Badge>
  );
}
