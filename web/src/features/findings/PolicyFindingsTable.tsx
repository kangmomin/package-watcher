// "위험한 설정" 탭의 표.
// 열: 검사(title) | repo | 파일 | 대상(packageName + version) | 심각도 | 상태 | 처음 본 시각 | 동작.
// 검출에는 검사 id 가 없다. blacklistEntryId 로 블랙리스트의 policy 항목을 찾고, 그 항목의 이름(= 검사 id)으로 title 을 구한다.
// 목록을 못 받았으면 "위험한 설정"으로 표시한다.
import type { Finding } from "@pw/shared";
import { useId } from "react";
import { RowHeaderCell } from "@/components/RowHeaderCell";
import { SeverityBadge } from "@/components/SeverityBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBlacklist } from "@/features/blacklist/hooks";
import { FileLabel, RowMenu } from "@/features/findings/FindingsTable";
import { usePendingFindingIds, useSetFindingStatus } from "@/features/findings/hooks";
import { POLICY_FALLBACK_LABEL, formatTableTime, policyCheckTitle } from "@/lib/format";

export interface PolicyFindingsTableProps {
  items: Finding[];
}

const POLICY_ENTRIES_FILTER = { ecosystem: "policy" } as const;

export function PolicyFindingsTable({ items }: PolicyFindingsTableProps) {
  const id = useId();
  const setStatus = useSetFindingStatus();
  const pendingIds = usePendingFindingIds();
  const entries = useBlacklist(POLICY_ENTRIES_FILTER).data?.items;
  const titleOf = (finding: Finding): string => {
    const entry = entries?.find((candidate) => candidate.id === finding.blacklistEntryId);
    return entry ? policyCheckTitle(entry.name) : POLICY_FALLBACK_LABEL;
  };

  return (
    <div className="rounded-lg border">
      <Table aria-label="위험한 설정 목록">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">검사</TableHead>
            <TableHead scope="col">repo</TableHead>
            <TableHead scope="col">파일</TableHead>
            <TableHead scope="col">대상</TableHead>
            <TableHead scope="col">심각도</TableHead>
            <TableHead scope="col">상태</TableHead>
            <TableHead scope="col">처음 본 시각</TableHead>
            <TableHead scope="col" className="w-12">
              동작
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((finding) => {
            const repoId = `${id}-${finding.id}-repo`;
            const targetId = `${id}-${finding.id}-target`;
            const target = finding.version === "" ? finding.packageName : `${finding.packageName}@${finding.version}`;
            return (
              <TableRow key={finding.id}>
                <TableCell className="max-w-72 whitespace-normal">{titleOf(finding)}</TableCell>
                <RowHeaderCell id={repoId} className="font-medium">
                  {finding.repo}
                </RowHeaderCell>
                <TableCell className="max-w-64 truncate" title={finding.filePath}>
                  <FileLabel finding={finding} />
                </TableCell>
                <TableCell id={targetId} className="max-w-72 truncate font-mono text-xs" title={target}>
                  {target}
                </TableCell>
                <TableCell>
                  <SeverityBadge severity={finding.severity} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={finding.status} />
                </TableCell>
                <TableCell className="font-mono text-xs">{formatTableTime(finding.firstSeenAt)}</TableCell>
                <TableCell>
                  <RowMenu
                    finding={finding}
                    isDisabled={pendingIds.has(finding.id)}
                    describedBy={`${repoId} ${targetId}`}
                    onChangeStatus={(status) => setStatus.mutate({ id: finding.id, status })}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
