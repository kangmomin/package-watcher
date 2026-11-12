// 설정 폼.
// 필드: org(null → 빈 입력, 안내 "org를 바꾸면 현재 검출이 모두 resolved로 바뀝니다"), interval(시간),
// 요약 시각 + "Asia/Seoul", 수신자 chip. 제출 전 shared 스키마로 검증.
// 폼 reset 은 첫 로드와 저장 성공(응답 값) 때만. 저장 중 [저장] 비활성.
// [테스트 메일] 비활성: 서버 recipients 0명, smtpConfigured=false, 폼 dirty("저장 후 테스트할 수 있습니다"), 요청 중.
import { settingsInputSchema, type Settings, type SettingsInput } from "@pw/shared";
import { useId, type ReactNode } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FieldDescription, FieldError as FieldErrorText, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ConnectionStatus } from "@/features/settings/ConnectionStatus";
import { useSaveSettings, useTestEmail } from "@/features/settings/hooks";
import { RecipientsInput } from "@/features/settings/RecipientsInput";
import { errorToastMessage, formFieldErrors } from "@/lib/errors";
import { schemaResolver } from "@/lib/form";

export interface SettingsFormProps {
  settings: Settings;
}

interface FormValues {
  org: string;
  scanIntervalHours: number;
  digestTime: string;
  recipients: string[];
}

const FORM_FIELDS = ["org", "scanIntervalHours", "digestTime", "recipients"] as const;

function toFormValues(settings: Settings): FormValues {
  return {
    org: settings.org ?? "",
    scanIntervalHours: settings.scanIntervalHours,
    digestTime: settings.digestTime,
    recipients: [...settings.recipients],
  };
}

function joinIds(...ids: (string | false | undefined)[]): string | undefined {
  const joined = ids.filter(Boolean).join(" ");
  return joined === "" ? undefined : joined;
}

export function SettingsForm({ settings }: SettingsFormProps) {
  const id = useId();
  const save = useSaveSettings();
  const testEmail = useTestEmail();
  // defaultValues 는 첫 마운트 때만 쓰인다. 이후 settings 재조회는 폼을 덮어쓰지 않는다.
  const form = useForm<FormValues, unknown, SettingsInput>({
    resolver: schemaResolver(settingsInputSchema),
    defaultValues: toFormValues(settings),
  });
  const { errors, isDirty } = form.formState;

  const ids = {
    org: `${id}-org`,
    orgHint: `${id}-org-hint`,
    interval: `${id}-interval`,
    digestTime: `${id}-digest-time`,
    timezone: `${id}-timezone`,
    recipients: `${id}-recipients`,
    testEmailHint: `${id}-test-email-hint`,
  };
  const errorIdOf = (field: keyof FormValues) => `${id}-${field}-error`;
  const describedByError = (field: keyof FormValues) => (errors[field] ? errorIdOf(field) : undefined);

  const submit = form.handleSubmit((input) => {
    save.mutate(input, {
      onSuccess: (saved) => {
        form.reset(toFormValues(saved));
        toast.success("설정을 저장했습니다");
      },
      onError: (error) => {
        const fieldErrors = Object.entries(formFieldErrors(error, FORM_FIELDS)) as [keyof FormValues, string][];
        if (fieldErrors.length === 0) {
          toast.error(errorToastMessage(error));
          return;
        }
        for (const [field, message] of fieldErrors) form.setError(field, { type: "server", message });
      },
    });
  });

  const testEmailBlocked = settings.recipients.length === 0 || !settings.smtpConfigured;

  return (
    <form onSubmit={submit} noValidate className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-5">
        <FormRow label="GitHub org" htmlFor={ids.org}>
          <Input
            id={ids.org}
            autoComplete="off"
            className="max-w-72"
            aria-invalid={errors.org ? true : undefined}
            aria-describedby={joinIds(ids.orgHint, describedByError("org"))}
            {...form.register("org")}
          />
          <FieldDescription id={ids.orgHint}>org를 바꾸면 현재 검출이 모두 resolved로 바뀝니다</FieldDescription>
          <FieldMessage id={errorIdOf("org")} error={errors.org} />
        </FormRow>

        <FormRow label="스캔 interval(시간)" htmlFor={ids.interval}>
          <Input
            id={ids.interval}
            type="number"
            inputMode="numeric"
            min={1}
            max={168}
            step={1}
            className="max-w-28"
            aria-invalid={errors.scanIntervalHours ? true : undefined}
            aria-describedby={describedByError("scanIntervalHours")}
            {...form.register("scanIntervalHours", { valueAsNumber: true })}
          />
          <FieldMessage id={errorIdOf("scanIntervalHours")} error={errors.scanIntervalHours} />
        </FormRow>

        <FormRow label="일일 요약 시각" htmlFor={ids.digestTime}>
          <div className="flex items-center gap-2">
            <Input
              id={ids.digestTime}
              type="time"
              className="max-w-32"
              aria-invalid={errors.digestTime ? true : undefined}
              aria-describedby={joinIds(ids.timezone, describedByError("digestTime"))}
              {...form.register("digestTime")}
            />
            <span id={ids.timezone} className="text-sm text-muted-foreground">
              {settings.digestTimezone}
            </span>
          </div>
          <FieldMessage id={errorIdOf("digestTime")} error={errors.digestTime} />
        </FormRow>

        <FormRow label="이메일 수신자" htmlFor={ids.recipients}>
          <Controller
            control={form.control}
            name="recipients"
            render={({ field, fieldState }) => (
              <RecipientsInput
                id={ids.recipients}
                value={field.value}
                onChange={field.onChange}
                aria-invalid={fieldState.invalid || undefined}
                aria-describedby={describedByError("recipients")}
              />
            )}
          />
          <FieldMessage id={errorIdOf("recipients")} error={errors.recipients} />
        </FormRow>
      </div>

      <Separator />
      <ConnectionStatus githubTokenSource={settings.githubTokenSource} smtpConfigured={settings.smtpConfigured} />

      <div className="flex flex-wrap items-center justify-end gap-3">
        {isDirty && (
          <p id={ids.testEmailHint} className="text-sm text-muted-foreground">
            저장 후 테스트할 수 있습니다
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={testEmailBlocked || isDirty || testEmail.isPending}
          aria-describedby={isDirty ? ids.testEmailHint : undefined}
          onClick={() => testEmail.mutate()}
        >
          테스트 메일
        </Button>
        <Button type="submit" disabled={save.isPending}>
          저장
        </Button>
      </div>
    </form>
  );
}

function FormRow({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 md:grid-cols-[11rem_1fr] md:items-start">
      <FieldLabel htmlFor={htmlFor} className="md:pt-2">
        {label}
      </FieldLabel>
      <div className="flex min-w-0 flex-col gap-1.5">{children}</div>
    </div>
  );
}

function FieldMessage({ id, error }: { id: string; error: { message?: string } | undefined }) {
  if (!error?.message) return null;
  return <FieldErrorText id={id}>{error.message}</FieldErrorText>;
}
