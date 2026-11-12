// 추가/수정 공용 Dialog.
// 필드: 이름*, 버전 범위(placeholder "비우면 모든 버전"), 사유*. 제출 전 shared 스키마로 검증.
// 요청 중 [저장] 비활성 + 닫기 불가. 성공 → 닫기 + reset.
// VALIDATION_ERROR·DUPLICATE_ENTRY·INTERNAL_ERROR·NETWORK_ERROR → 열어 두고 입력 보존.
// DUPLICATE_ENTRY → name 필드 아래에 message. NOT_FOUND → 닫기 + toast + blacklist 재조회.
// toast 로 알리고 Dialog 를 열어 두는 오류는 Dialog 안에도 role="alert" 로 표시한다(다음 제출 시도·닫기에 지운다).
import {
  blacklistCreateSchema,
  blacklistUpdateSchema,
  type BlacklistEntry,
  type BlacklistInput,
} from "@pw/shared";
import { useId, useState, type FormEvent } from "react";
import { useForm } from "react-hook-form";
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
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCreateBlacklistEntry, useUpdateBlacklistEntry } from "@/features/blacklist/hooks";
import type { ApiRequestError } from "@/lib/api";
import { errorToastMessage, hasErrorCode } from "@/lib/errors";
import { applyServerFieldErrors, errorId, fieldErrorAria, schemaResolver } from "@/lib/form";

export interface BlacklistDialogProps {
  open: boolean;
  /** null = 추가, 값 = 그 항목 수정 */
  entry: BlacklistEntry | null;
  onOpenChange: (open: boolean) => void;
}

interface FormValues {
  name: string;
  versionRange: string;
  reason: string;
}

interface SaveCallbacks {
  onSuccess: () => void;
  onError: (error: ApiRequestError) => void;
}

interface BlacklistFormProps {
  entry: BlacklistEntry | null;
  isPending: boolean;
  onClose: () => void;
  onSave: (input: BlacklistInput, callbacks: SaveCallbacks) => void;
}

const FORM_FIELDS = ["name", "versionRange", "reason"] as const;

export function BlacklistDialog({ open, entry, onOpenChange }: BlacklistDialogProps) {
  const create = useCreateBlacklistEntry();
  const update = useUpdateBlacklistEntry();
  const isPending = create.isPending || update.isPending;

  const handleOpenChange = (next: boolean) => {
    // 요청 중에는 Esc·바깥 클릭·[취소] 로 닫지 않는다.
    if (!next && isPending) return;
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false}>
        {/* Content 는 닫히면 unmount 된다. 열 때마다 그 항목의 값으로 폼을 새로 만든다.
            key: 닫히는 애니메이션 중에 다른 항목(또는 추가)으로 다시 열어도 이전 폼을 재사용하지 않는다. */}
        <BlacklistForm
          key={entry?.id ?? "new"}
          entry={entry}
          isPending={isPending}
          onClose={() => onOpenChange(false)}
          onSave={(input, callbacks) => {
            if (entry) update.mutate({ id: entry.id, input }, callbacks);
            else create.mutate(input, callbacks);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function BlacklistForm({ entry, isPending, onClose, onSave }: BlacklistFormProps) {
  const id = useId();
  const form = useForm<FormValues, unknown, BlacklistInput>({
    // PUT 은 versionRange 키가 필수인 전체 교체 스키마로 검증한다 (A-12).
    resolver: schemaResolver(entry ? blacklistUpdateSchema : blacklistCreateSchema),
    defaultValues: {
      name: entry?.name ?? "",
      versionRange: entry?.versionRange ?? "",
      reason: entry?.reason ?? "",
    },
  });
  const { errors } = form.formState;
  // Dialog 를 열어 둔 채 toast 로 알린 오류. toast 는 곧 사라지므로 Dialog 안에도 남긴다.
  const [submitError, setSubmitError] = useState<string>();

  const handleError = (error: ApiRequestError) => {
    if (hasErrorCode(error, "DUPLICATE_ENTRY")) {
      form.setError("name", { type: "server", message: error.message }, { shouldFocus: true });
      return;
    }
    if (hasErrorCode(error, "NOT_FOUND")) {
      toast.error(error.message);
      onClose();
      return;
    }
    if (applyServerFieldErrors(form.setError, error, FORM_FIELDS)) return;
    const message = errorToastMessage(error);
    toast.error(message);
    setSubmitError(message);
  };

  const submit = form.handleSubmit((input) => {
    onSave(input, {
      onSuccess: () => {
        toast.success(entry ? "항목을 수정했습니다" : "항목을 추가했습니다");
        form.reset();
        onClose();
      },
      onError: handleError,
    });
  });

  const fieldIds = {
    name: `${id}-name`,
    versionRange: `${id}-range`,
    reason: `${id}-reason`,
  };
  const errorAria = (field: keyof FormValues) => fieldErrorAria(errors[field], errorId(fieldIds[field]));

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    setSubmitError(undefined);
    void submit(event);
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{entry ? "블랙리스트 항목 수정" : "블랙리스트 항목 추가"}</DialogTitle>
        <DialogDescription>이름과 버전 범위가 같은 항목은 하나만 둘 수 있습니다.</DialogDescription>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">* 표시는 필수 항목입니다</p>
      <FieldGroup className="gap-4">
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor={fieldIds.name}>
            이름<span aria-hidden="true">*</span>
          </FieldLabel>
          <Input
            id={fieldIds.name}
            autoComplete="off"
            aria-required="true"
            {...errorAria("name")}
            {...form.register("name")}
          />
          <FieldError id={errorId(fieldIds.name)} errors={[errors.name]} />
        </Field>
        <Field data-invalid={errors.versionRange ? true : undefined}>
          <FieldLabel htmlFor={fieldIds.versionRange}>버전 범위</FieldLabel>
          <Input
            id={fieldIds.versionRange}
            autoComplete="off"
            placeholder="비우면 모든 버전"
            {...errorAria("versionRange")}
            {...form.register("versionRange")}
          />
          <FieldError id={errorId(fieldIds.versionRange)} errors={[errors.versionRange]} />
        </Field>
        <Field data-invalid={errors.reason ? true : undefined}>
          <FieldLabel htmlFor={fieldIds.reason}>
            사유<span aria-hidden="true">*</span>
          </FieldLabel>
          <Textarea
            id={fieldIds.reason}
            rows={3}
            aria-required="true"
            {...errorAria("reason")}
            {...form.register("reason")}
          />
          <FieldError id={errorId(fieldIds.reason)} errors={[errors.reason]} />
        </Field>
      </FieldGroup>
      {submitError && (
        <p role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={isPending} onClick={onClose}>
          취소
        </Button>
        <Button type="submit" disabled={isPending}>
          저장
        </Button>
      </DialogFooter>
    </form>
  );
}
