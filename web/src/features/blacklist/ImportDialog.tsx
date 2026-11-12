// 가져오기 Dialog.
// 파일을 고르면 확장자로 형식을 정하고, 크기를 검사한 뒤 바로 미리 보기(dryRun: true)를 요청한다.
// [적용] 은 같은 format·content 를 dryRun: false 로 다시 보낸다(미리 본 내용 그대로 적용).
// 파일을 다시 고르거나 Dialog 를 닫으면 이전 요청의 응답은 버린다(session 번호로 구분한다).
import { IMPORT_MAX_BYTES, type BlacklistFileFormat, type ImportResult } from "@pw/shared";
import { useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useImportBlacklist } from "@/features/blacklist/hooks";
import { errorToastMessage, hasErrorCode } from "@/lib/errors";

export interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Loaded {
  format: BlacklistFileFormat;
  content: string;
}

const MAX_SIZE_MESSAGE = "파일이 너무 큽니다 (최대 1 MB)";
const UNSUPPORTED_MESSAGE = "JSON 또는 CSV 파일을 선택하십시오";

function formatOf(fileName: string): BlacklistFileFormat | undefined {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".csv")) return "csv";
  return undefined;
}

export function ImportDialog({ open, onOpenChange }: ImportDialogProps) {
  const importer = useImportBlacklist();
  const session = useRef(0);
  const [loaded, setLoaded] = useState<Loaded>();
  const [result, setResult] = useState<ImportResult>();
  const [error, setError] = useState<string>();
  const [phase, setPhase] = useState<"idle" | "previewing" | "applying">("idle");

  const reset = () => {
    session.current += 1;
    setLoaded(undefined);
    setResult(undefined);
    setError(undefined);
    setPhase("idle");
  };

  const handleOpenChange = (next: boolean) => {
    // 닫을 때와 열 때 모두 초기 상태로 되돌린다.
    reset();
    onOpenChange(next);
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    reset();
    if (!file) return;
    const mine = session.current;

    const format = formatOf(file.name);
    if (!format) return setError(UNSUPPORTED_MESSAGE);
    if (file.size > IMPORT_MAX_BYTES) return setError(MAX_SIZE_MESSAGE);

    setPhase("previewing");
    let content: string;
    try {
      content = await file.text();
    } catch {
      if (session.current === mine) {
        setPhase("idle");
        setError("파일을 읽을 수 없습니다");
      }
      return;
    }
    if (session.current !== mine) return;
    setLoaded({ format, content });

    importer.mutate(
      { format, content, dryRun: true },
      {
        onSuccess: (data) => {
          if (session.current !== mine) return;
          setResult(data);
          setPhase("idle");
        },
        onError: (err) => {
          if (session.current !== mine) return;
          setPhase("idle");
          showError(err);
        },
      },
    );
  };

  // 400 은 Dialog 안에 보이고, 그 밖의 오류는 toast 로 알린다.
  const showError = (err: unknown) => {
    if (hasErrorCode(err, "VALIDATION_ERROR")) setError(errorToastMessage(err));
    else toast.error(errorToastMessage(err));
  };

  const apply = () => {
    if (!loaded) return;
    const mine = session.current;
    setPhase("applying");
    setError(undefined);
    importer.mutate(
      { ...loaded, dryRun: false },
      {
        onSuccess: (data) => {
          if (session.current !== mine) return;
          setPhase("idle");
          if (data.applied) {
            toast.success(
              `가져오기를 적용했습니다 (추가 ${data.created}건, 갱신 ${data.updated}건)`,
            );
            handleOpenChange(false);
          } else {
            // 미리 본 뒤에 목록이 바뀌어 적용되지 않았다. 새 결과를 보여 준다.
            setResult(data);
          }
        },
        onError: (err) => {
          if (session.current !== mine) return;
          setPhase("idle");
          // 400 이면 이 내용은 적용할 수 없다.
          if (hasErrorCode(err, "VALIDATION_ERROR")) setResult(undefined);
          showError(err);
        },
      },
    );
  };

  const busy = phase !== "idle";
  const canApply =
    !busy &&
    !error &&
    result !== undefined &&
    result.errors.length === 0 &&
    result.created + result.updated > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>가져오기</DialogTitle>
          <DialogDescription>
            JSON 또는 CSV 파일을 고르면 적용하기 전에 변경 내용을 미리 보여 줍니다.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="blacklist-import-file">파일 선택</Label>
          <Input
            id="blacklist-import-file"
            type="file"
            accept=".json,.csv"
            disabled={phase === "applying"}
            onChange={(event) => void handleFile(event)}
          />
        </div>
        <div role="status" className="text-sm" aria-busy={busy}>
          {phase === "previewing" && "미리 보기 중…"}
          {phase === "applying" && "적용 중…"}
          {phase === "idle" &&
            result &&
            `추가 ${result.created}건, 갱신 ${result.updated}건, 변경 없음 ${result.unchanged}건, 오류 ${result.errors.length}건`}
        </div>
        {phase === "idle" && result && result.errors.length > 0 && (
          <ul
            aria-label="오류 목록"
            className="max-h-48 overflow-y-auto rounded-md border p-2 text-sm"
          >
            {result.errors.map((item, index) => (
              <li key={index} className="flex gap-2 py-0.5">
                <span className="shrink-0 font-medium">{item.row}행</span>
                <span className="shrink-0 font-mono text-xs">{item.field ?? "-"}</span>
                <span>{item.message}</span>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            취소
          </Button>
          <Button disabled={!canApply} onClick={apply}>
            적용
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
