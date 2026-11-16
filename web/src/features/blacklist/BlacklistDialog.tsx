// 추가/수정 공용 Dialog.
// 필드: 종류*, 이름*, 버전 범위(placeholder "비우면 모든 버전"), 심각도*, 만료일, 켜기, 사유*. 제출 전 shared 스키마로 검증.
// 만료일 입력이 불완전하면(validity.badInput) 제출하지 않는다: 불완전한 값은 ""(= 만료 해제)로 읽히기 때문이다.
// 요청 중 [저장] 비활성 + 닫기 불가. 성공 → 닫기 + reset.
// VALIDATION_ERROR·DUPLICATE_ENTRY·INTERNAL_ERROR·NETWORK_ERROR → 열어 두고 입력 보존.
// DUPLICATE_ENTRY → name 필드 아래에 message. NOT_FOUND → 닫기 + toast + blacklist 재조회.
// toast 로 알리고 Dialog 를 열어 두는 오류는 Dialog 안에도 role="alert" 로 표시한다(다음 제출 시도·닫기에 지운다).
import {
  blacklistCreateSchema,
  blacklistUpdateSchema,
  categoryOf,
  ECOSYSTEM_RULES,
  kstDateOf,
  SEVERITIES,
  SEVERITY_RANK,
  SUPPORTED_ECOSYSTEMS,
  usesVersionRange,
  type BlacklistEntry,
  type BlacklistInput,
  type Ecosystem,
  type Severity,
} from "@pw/shared";
import { useId, useRef, useState, type FormEvent } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { EcosystemSelectItems } from "@/components/EcosystemSelectItems";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateBlacklistEntry, useUpdateBlacklistEntry } from "@/features/blacklist/hooks";
import { useSettings } from "@/features/settings/hooks";
import type { ApiRequestError } from "@/lib/api";
import { errorToastMessage, hasErrorCode } from "@/lib/errors";
import {
  applyServerFieldErrors,
  errorId,
  fieldErrorAria,
  isIncompleteDate,
  schemaResolver,
} from "@/lib/form";

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
  ecosystem: Ecosystem;
  severity: Severity;
  enabled: boolean;
  /** `YYYY-MM-DD`. 비우면 "" (스키마가 null 로 바꾼다) */
  expiresAt: string;
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

const FORM_FIELDS = [
  "name",
  "versionRange",
  "reason",
  "ecosystem",
  "severity",
  "enabled",
  "expiresAt",
] as const;

// 침해의 흔적 종류의 이름 입력: 라벨과 안내. 패키지·CI 종류는 기본 라벨("이름")과 `*` 안내를 쓴다.
const INDICATOR_NAME_UI: Partial<Record<Ecosystem, { label: string; hint: string }>> = {
  path: {
    label: "파일 경로 또는 패턴",
    hint: "`*`는 임의의 문자열입니다. `/`가 없으면 파일 이름과도 비교합니다.",
  },
  content: {
    label: "찾을 문자열",
    hint: "글자 그대로 찾습니다(대소문자 무시). 스캔이 읽는 파일(의존성 파일, workflow, Dockerfile 등)에서만 찾습니다.",
  },
  branch: {
    label: "브랜치 이름 또는 패턴",
    hint: "`*`는 임의의 문자열입니다. 이 종류의 항목이 있으면 스캔이 repo마다 브랜치 목록을 받습니다.",
  },
};

const INCOMPLETE_DATE_ERROR = "incompleteDate";
const INCOMPLETE_DATE_MESSAGE = "날짜를 끝까지 입력하거나 모두 지우십시오";

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
      ecosystem: entry?.ecosystem ?? SUPPORTED_ECOSYSTEMS[0],
      severity: entry?.severity ?? "medium",
      enabled: entry?.enabled ?? true,
      expiresAt: entry?.expiresAt ?? "",
    },
  });
  const { errors } = form.formState;
  // Dialog 를 열어 둔 채 toast 로 알린 오류. toast 는 곧 사라지므로 Dialog 안에도 남긴다.
  const [submitError, setSubmitError] = useState<string>();
  const expiresAtRef = useRef<HTMLInputElement | null>(null);

  // min 은 힌트일 뿐이다(판정은 서버). 저장된 값이 이미 과거면 그 값이 무효로 보이지 않게 min 을 주지 않는다.
  const [minDate] = useState(() => {
    const today = kstDateOf(new Date());
    return entry?.expiresAt && entry.expiresAt < today ? undefined : today;
  });

  // 설정을 아직 못 읽었거나 실패했으면 안내만 생략한다(이 Dialog 의 오류가 아니다).
  const notifyMinSeverity = useSettings().data?.notifyMinSeverity;
  const [severity, enabled, ecosystem] = useWatch({
    control: form.control,
    name: ["severity", "enabled", "ecosystem"],
  });
  const rule = ECOSYSTEM_RULES[ecosystem];
  const showRange = usesVersionRange(ecosystem);
  const indicatorUi = INDICATOR_NAME_UI[ecosystem];
  const normalizesName = ecosystem === "pypi" || ecosystem === "nuget";

  // 종류가 바뀌면 이미 오류가 표시된 이름·범위만 새 종류의 규칙으로 다시 검증한다.
  // (제출 전에는 재검증이 돌지 않아 오류가 이전 종류의 것으로 남는다. 입력하지 않은 필드에는 오류를 새로 띄우지 않는다.)
  const revalidateAfterEcosystemChange = () => {
    const fields = (["name", "versionRange"] as const).filter(
      (field) =>
        form.getFieldState(field).error &&
        (field === "name" || usesVersionRange(form.getValues("ecosystem"))),
    );
    if (fields.length > 0) void form.trigger(fields);
  };
  const showSeverityHint =
    notifyMinSeverity !== undefined &&
    enabled &&
    SEVERITY_RANK[severity] < SEVERITY_RANK[notifyMinSeverity];

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
    ecosystem: `${id}-ecosystem`,
    severity: `${id}-severity`,
    enabled: `${id}-enabled`,
    expiresAt: `${id}-expires-at`,
  };
  const hintIds = {
    name: `${id}-name-hint`,
    ecosystem: `${id}-ecosystem-hint`,
    versionRange: `${id}-range-hint`,
    severity: `${id}-severity-hint`,
    enabled: `${id}-enabled-hint`,
    expiresAt: `${id}-expires-at-hint`,
  };
  const errorAria = (field: keyof FormValues, ...describedBy: (string | false | undefined)[]) =>
    fieldErrorAria(errors[field], errorId(fieldIds[field]), ...describedBy);

  const expiresAtField = form.register("expiresAt", {
    onChange: () => {
      // 제출 전에는 재검증이 돌지 않으므로 직접 지운다.
      if (form.getFieldState("expiresAt").error?.type === INCOMPLETE_DATE_ERROR)
        form.clearErrors("expiresAt");
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    setSubmitError(undefined);
    if (expiresAtRef.current && isIncompleteDate(expiresAtRef.current)) {
      event.preventDefault();
      form.setError(
        "expiresAt",
        { type: INCOMPLETE_DATE_ERROR, message: INCOMPLETE_DATE_MESSAGE },
        { shouldFocus: true },
      );
      return;
    }
    void submit(event);
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{entry ? "블랙리스트 항목 수정" : "블랙리스트 항목 추가"}</DialogTitle>
        <DialogDescription>
          종류·이름·버전 범위가 같은 항목은 하나만 둘 수 있습니다.
        </DialogDescription>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">* 표시는 필수 항목입니다</p>
      <FieldGroup className="gap-4">
        <Field data-invalid={errors.ecosystem ? true : undefined}>
          <FieldLabel htmlFor={fieldIds.ecosystem}>
            종류<span aria-hidden="true">*</span>
          </FieldLabel>
          <Controller
            control={form.control}
            name="ecosystem"
            render={({ field }) => (
              // react-hook-form 의 disabled 옵션은 값을 undefined 로 만들어 본문에서 빠뜨린다. Select 의 prop 으로만 끈다.
              <Select
                value={field.value}
                onValueChange={(value) => {
                  field.onChange(value);
                  // 범위를 쓰지 않는 종류로 바꾸면 입력해 둔 범위와 그 오류를 버린다(본문의 versionRange 는 null).
                  if (!usesVersionRange(value as Ecosystem)) {
                    form.setValue("versionRange", "");
                    form.clearErrors("versionRange");
                  }
                  revalidateAfterEcosystemChange();
                }}
                // 종류는 수정할 수 없다(서버도 400). 저장된 값은 계속 본문에 보낸다.
                disabled={entry !== null}
              >
                <SelectTrigger
                  id={fieldIds.ecosystem}
                  className="w-44"
                  aria-required="true"
                  {...errorAria("ecosystem", entry !== null && hintIds.ecosystem)}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <EcosystemSelectItems />
                </SelectContent>
              </Select>
            )}
          />
          {entry && (
            <FieldDescription id={hintIds.ecosystem}>
              종류는 바꿀 수 없습니다. 새 항목으로 등록하십시오
            </FieldDescription>
          )}
          <FieldError id={errorId(fieldIds.ecosystem)} errors={[errors.ecosystem]} />
        </Field>
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor={fieldIds.name}>
            {indicatorUi?.label ?? "이름"}
            <span aria-hidden="true">*</span>
          </FieldLabel>
          <Input
            id={fieldIds.name}
            autoComplete="off"
            aria-required="true"
            {...errorAria("name", hintIds.name)}
            {...form.register("name")}
          />
          <FieldDescription id={hintIds.name}>
            {indicatorUi ? (
              <span className="block">{indicatorUi.hint}</span>
            ) : (
              <span className="block">
                <code>*</code> 로 패턴을 쓸 수 있습니다
              </span>
            )}
            <span className="block">{`예: ${rule.nameExample}`}</span>
            {normalizesName && (
              <span className="block">저장할 때 이름을 소문자 표준 형태로 바꿉니다</span>
            )}
          </FieldDescription>
          <FieldError id={errorId(fieldIds.name)} errors={[errors.name]} />
        </Field>
        {showRange && (
          <Field data-invalid={errors.versionRange ? true : undefined}>
            <FieldLabel htmlFor={fieldIds.versionRange}>버전 범위</FieldLabel>
            <Input
              id={fieldIds.versionRange}
              autoComplete="off"
              placeholder="비우면 모든 버전"
              {...errorAria("versionRange", hintIds.versionRange)}
              {...form.register("versionRange")}
            />
            <FieldDescription id={hintIds.versionRange}>
              <span className="block">{`예: ${rule.rangeExample}`}</span>
              {categoryOf(ecosystem) === "ci" && (
                <span className="block">범위가 아니라 정확한 값을 쉼표로 나눠 적습니다</span>
              )}
            </FieldDescription>
            <FieldError id={errorId(fieldIds.versionRange)} errors={[errors.versionRange]} />
          </Field>
        )}
        <Field data-invalid={errors.severity ? true : undefined}>
          <FieldLabel htmlFor={fieldIds.severity}>
            심각도<span aria-hidden="true">*</span>
          </FieldLabel>
          <Controller
            control={form.control}
            name="severity"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger
                  id={fieldIds.severity}
                  className="w-40"
                  aria-required="true"
                  {...errorAria("severity", showSeverityHint && hintIds.severity)}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {showSeverityHint && (
            <FieldDescription id={hintIds.severity}>
              {`현재 즉시 알림 기준(${notifyMinSeverity})보다 낮아 일일 요약에만 포함됩니다`}
            </FieldDescription>
          )}
          <FieldError id={errorId(fieldIds.severity)} errors={[errors.severity]} />
        </Field>
        <Field data-invalid={errors.expiresAt ? true : undefined}>
          <FieldLabel htmlFor={fieldIds.expiresAt}>만료일</FieldLabel>
          <Input
            id={fieldIds.expiresAt}
            type="date"
            min={minDate}
            className="w-44"
            {...errorAria("expiresAt", entry?.isExpired && hintIds.expiresAt)}
            {...expiresAtField}
            ref={(element) => {
              expiresAtField.ref(element);
              expiresAtRef.current = element;
            }}
          />
          {entry?.isExpired && (
            <FieldDescription id={hintIds.expiresAt}>
              만료되어 검사에서 제외됩니다. 만료일을 바꾸거나 비우면 다음 스캔부터 다시 검사합니다
            </FieldDescription>
          )}
          <FieldError id={errorId(fieldIds.expiresAt)} errors={[errors.expiresAt]} />
        </Field>
        <Field data-invalid={errors.enabled ? true : undefined}>
          <div className="flex items-center gap-2">
            <Controller
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <Checkbox
                  id={fieldIds.enabled}
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  {...errorAria("enabled", hintIds.enabled)}
                />
              )}
            />
            <FieldLabel htmlFor={fieldIds.enabled}>켜기</FieldLabel>
          </div>
          <FieldDescription id={hintIds.enabled}>
            끄면 이 항목의 검출(무시 포함)이 resolved로 바뀌고, 다시 켜면 다음 스캔에서 새로
            검출됩니다
          </FieldDescription>
          <FieldError id={errorId(fieldIds.enabled)} errors={[errors.enabled]} />
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
