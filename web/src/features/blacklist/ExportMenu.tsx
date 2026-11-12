// 내보내기 메뉴: [JSON] [CSV]. 지금의 필터를 붙인 export URL 로 내려받는 링크다(선택 상태는 쓰지 않는다).
import { BLACKLIST_FILE_FORMATS } from "@pw/shared";
import { ChevronDownIcon, DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportBlacklistUrl, type BlacklistFilter } from "@/lib/api";

export function ExportMenu({ filter }: { filter: BlacklistFilter }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <DownloadIcon aria-hidden="true" />
          내보내기
          <ChevronDownIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {BLACKLIST_FILE_FORMATS.map((format) => (
          <DropdownMenuItem key={format} asChild>
            <a href={exportBlacklistUrl(format, filter)} download>
              {format.toUpperCase()}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
