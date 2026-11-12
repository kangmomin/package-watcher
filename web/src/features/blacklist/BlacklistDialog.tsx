// 추가/수정 공용 Dialog.
// 필드: 이름*, 버전 범위(placeholder "비우면 모든 버전"), 사유*. 제출 전 shared 스키마로 검증.
// 요청 중 [저장] 비활성 + 닫기 불가. 성공 → 닫기 + reset.
// VALIDATION_ERROR·DUPLICATE_ENTRY·INTERNAL_ERROR·NETWORK_ERROR → 열어 두고 입력 보존.
// DUPLICATE_ENTRY → name 필드 아래에 message. NOT_FOUND → 닫기 + toast + blacklist 재조회.
import {
  blacklistCreateSchema,
  blacklistUpdateSchema,
  type BlacklistEntry,
  type BlacklistInput,
} from "@pw/shared";
import { useId } from "react";
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
import { Field, FieldError as FieldErrorText, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCreateBlacklistEntry, useUpdateBlacklistEntry } from "@/features/blacklist/hooks";
import type { ApiRequestError } from "@/lib/api";
import { errorToastMessage, formFieldErrors, hasErrorCode } from "@/lib/errors";
import { errorId, schemaResolver } from "@/lib/form";

export interface BlacklistDialogProps {
  open: boolean;
  /** null = 추가, 값 = 그 항목 수정 */
  entry: BlacklistEntry | null;
  onOpenChange: (open: boolean) => void;
}

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
        {/* Content 는 닫히면 unmount 된다. 열 때마다 그 항목의 값으로 폼을 새로 만든다. */}
        <BlacklistForm
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

interface FormValues {
  name: string;
  versionRange: string;
  reason: string;
}

const FORM_FIELDS = ["name", "versionRange", "reason"] as const;

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
    const fieldErrors = Object.entries(formFieldErrors(error, FORM_FIELDS)) as [keyof FormValues, string][];
    if (fieldErrors.length > 0) {
      for (const [field, message] of fieldErrors) form.setError(field, { type: "server", message });
      return;
    }
    toast.error(errorToastMessage(error));
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
  const describedBy = (field: keyof FormValues) => (errors[field] ? errorId(fieldIds[field]) : undefined);

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{entry ? "블랙리스트 항목 수정" : "블랙리스트 항목 추가"}</DialogTitle>
        <DialogDescription>이름과 버전 범위가 같은 항목은 하나만 둘 수 있습니다.</DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-4">
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor={fieldIds.name}>
            이름<span aria-hidden="true">*</span>
          </FieldLabel>
          <Input
            id={fieldIds.name}
            autoComplete="off"
            aria-required="true"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={describedBy("name")}
            {...form.register("name")}
          />
          <FieldMessage id={errorId(fieldIds.name)} error={errors.name} />
        </Field>
        <Field data-invalid={errors.versionRange ? true : undefined}>
          <FieldLabel htmlFor={fieldIds.versionRange}>버전 범위</FieldLabel>
          <Input
            id={fieldIds.versionRange}
            autoComplete="off"
            placeholder="비우면 모든 버전"
            aria-invalid={errors.versionRange ? true : undefined}
            aria-describedby={describedBy("versionRange")}
            {...form.register("versionRange")}
          />
          <FieldMessage id={errorId(fieldIds.versionRange)} error={errors.versionRange} />
        </Field>
        <Field data-invalid={errors.reason ? true : undefined}>
          <FieldLabel htmlFor={fieldIds.reason}>
            사유<span aria-hidden="true">*</span>
          </FieldLabel>
          <Textarea
            id={fieldIds.reason}
            rows={3}
            aria-required="true"
            aria-invalid={errors.reason ? true : undefined}
            aria-describedby={describedBy("reason")}
            {...form.register("reason")}
          />
          <FieldMessage id={errorId(fieldIds.reason)} error={errors.reason} />
        </Field>
      </FieldGroup>
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

function FieldMessage({ id, error }: { id: string; error: { message?: string } | undefined }) {
  if (!error?.message) return null;
  return <FieldErrorText id={id}>{error.message}</FieldErrorText>;
}
