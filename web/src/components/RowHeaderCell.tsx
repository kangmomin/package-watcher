// 표의 행 헤더 셀 `<th scope="row">`. 행을 식별하는 셀(repo, 이름, 시작 시각)에 쓴다.
// 스크린 리더가 다른 셀을 읽을 때 이 셀을 행 이름으로 함께 읽는다. 시각 스타일은 일반 셀(TableCell)과 같다.
import type { ComponentProps } from "react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function RowHeaderCell({ className, ...props }: ComponentProps<typeof TableHead>) {
  return <TableHead scope="row" className={cn("h-auto p-2 font-normal", className)} {...props} />;
}
