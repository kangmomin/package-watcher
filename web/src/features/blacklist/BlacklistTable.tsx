// 블랙리스트 표.
// 열: 이름, 버전 범위(null = "(모든 버전)"), 사유, 수정, 삭제. 아이콘 버튼은 aria-label 로 이름을 준다.
// 접근성: 이름 셀이 행 헤더다. 수정·삭제 버튼은 이름을 바꾸지 않고 이름 셀을 설명으로 연결한다.
import type { BlacklistEntry } from "@pw/shared";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { useId } from "react";
import { RowHeaderCell } from "@/components/RowHeaderCell";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ALL_VERSIONS_LABEL } from "@/lib/format";

export interface BlacklistTableProps {
  items: BlacklistEntry[];
  onEdit: (entry: BlacklistEntry) => void;
  onDelete: (entry: BlacklistEntry) => void;
}

export function BlacklistTable({ items, onEdit, onDelete }: BlacklistTableProps) {
  const id = useId();
  return (
    <div className="rounded-lg border">
      <Table aria-label="블랙리스트">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">패키지 이름</TableHead>
            <TableHead scope="col">버전 범위</TableHead>
            <TableHead scope="col">사유</TableHead>
            <TableHead scope="col" className="w-16 text-center">
              수정
            </TableHead>
            <TableHead scope="col" className="w-16 text-center">
              삭제
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((entry) => {
            const nameId = `${id}-${entry.id}-name`;
            return (
              <TableRow key={entry.id}>
                <RowHeaderCell id={nameId} className="font-mono text-xs font-medium">
                  {entry.name}
                </RowHeaderCell>
                <TableCell className="font-mono text-xs">
                  {entry.versionRange ?? (
                    <span className="font-sans text-muted-foreground">{ALL_VERSIONS_LABEL}</span>
                  )}
                </TableCell>
                <TableCell className="max-w-96 whitespace-normal">{entry.reason}</TableCell>
                <TableCell className="text-center">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="수정"
                    aria-describedby={nameId}
                    title={`${entry.name} 수정`}
                    onClick={() => onEdit(entry)}
                  >
                    <PencilIcon aria-hidden="true" />
                  </Button>
                </TableCell>
                <TableCell className="text-center">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="삭제"
                    aria-describedby={nameId}
                    title={`${entry.name} 삭제`}
                    className="text-destructive hover:text-destructive"
                    onClick={() => onDelete(entry)}
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
