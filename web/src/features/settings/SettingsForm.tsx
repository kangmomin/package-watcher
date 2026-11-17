// 설정 폼.
// 필드: org(null → 빈 입력, 안내 "org를 바꾸면 현재 검출이 모두 resolved로 바뀝니다"), interval(시간),
// 요약 시각 + "Asia/Seoul", 수신자 chip. 제출 전 shared 스키마로 검증.
// 폼 reset 은 첫 로드와 저장 성공(응답 값) 때만. 저장 중 [저장] 비활성.
// 첫 로드: 캐시 값으로 폼을 만들었으면 마운트 후 처음 도착한 새 응답에서 dirty 가 아닐 때 한 번 reset 한다.
// 수신자 입력란에 [추가] 하지 않은 주소가 남아 있으면 저장하지 않고 그 필드에 오류를 표시한다(S-20).
// [테스트 메일] 비활성: 서버 recipients 0명, smtpConfigured=false, 폼 dirty("저장 후 테스트할 수 있습니다"), 요청 중.
import {
  BRANCH_SCAN_DAYS_MAX,
  BRANCH_SCAN_MAX_BRANCHES,
  CVE_MIN_SCORE_MAX,
  entryStatusOf,
  SEVERITIES,
  SEVERITY_RANK,
  settingsInputSchema,
  type Settings,
  type SettingsInput,
  type Severity,
} from "@pw/shared";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useBlacklist } from "@/features/blacklist/hooks";
import { FeedSection } from "@/features/settings/FeedSection";
import { ConnectionStatus } from "@/features/settings/ConnectionStatus";
import { useSaveSettings, useTestEmail } from "@/features/settings/hooks";
import { RecipientsInput } from "@/features/settings/RecipientsInput";
import { errorToastMessage } from "@/lib/errors";
import { applyServerFieldErrors, errorId, fieldErrorAria, schemaResolver } from "@/lib/form";

export interface SettingsFormProps {
  settings: Settings;
  /**
   * settings 가 이 화면에 들어온 뒤 받은 응답인지 (useQuery 의 isFetchedAfterMount). 생략하면 true.
   * false 면 캐시에 남은 예전 값이므로, 처음 도착한 새 응답에서 폼이 dirty 가 아니면 그 값으로 reset 한다.
   */
  isFetchedAfterMount?: boolean;
}

/** 폼 값 = 저장 스키마의 입력 모양(검증 전). 스키마에 필드가 생기면 toFormValues 가 타입 오류로 알려 준다. */
type FormValues = z.input<typeof settingsInputSchema> & {
  notifyMinSeverity: Severity;
  feedEnabled: boolean;
  branchScanDays: number;
  cveMinScore: number;
};

interface FormRowProps {
  label: string;
  htmlFor: string;
  isRequired?: boolean;
  children: ReactNode;
}

const FORM_FIELDS = [
  "org",
  "scanIntervalHours",
  "digestTime",
  "recipients",
  "notifyMinSeverity",
  "feedEnabled",
  "branchScanDays",
  "cveMinScore",
] as const;

/** 수신자 입력란에 [추가] 하지 않은 주소가 남은 채 저장하려 할 때의 recipients 필드 오류 */
const PENDING_RECIPIENT_ERROR = "pendingRecipient";
const PENDING_RECIPIENT_MESSAGE = "[추가]를 눌러 수신자에 넣거나 입력란을 비우십시오";

function toFormValues(settings: Settings): FormValues {
  return {
    org: settings.org ?? "",
    scanIntervalHours: settings.scanIntervalHours,
    digestTime: settings.digestTime,
    recipients: [...settings.recipients],
    notifyMinSeverity: settings.notifyMinSeverity,
    feedEnabled: settings.feedEnabled,
    branchScanDays: settings.branchScanDays,
    cveMinScore: settings.cveMinScore,
  };
}

export function SettingsForm({ settings, isFetchedAfterMount = true }: SettingsFormProps) {
  const id = useId();
  const save = useSaveSettings();
  const testEmail = useTestEmail();
  // defaultValues 는 첫 마운트 때만 쓰인다. 이후 settings 재조회는 폼을 덮어쓰지 않는다(아래 첫 새 응답 1회 제외).
  const form = useForm<FormValues, unknown, SettingsInput>({
    resolver: schemaResolver(settingsInputSchema),
    defaultValues: toFormValues(settings),
  });
  const { errors, isDirty } = form.formState;
  // 수신자 입력란에 남은 값([추가] 전). 저장할 때 확인한다(S-20).
  const [recipientDraft, setRecipientDraft] = useState("");

  // 경고는 블랙리스트 데이터가 있을 때만 그린다. loading·오류는 이 폼에 영향을 주지 않는다(조용히 생략).
  const blacklistItems = useBlacklist().data?.items;
  const selectedSeverity = useWatch({ control: form.control, name: "notifyMinSeverity" });
  const belowThresholdCount = blacklistItems?.filter(
    (entry) =>
      entryStatusOf(entry) === "active" &&
      // 취약점은 즉시 메일을 보내지 않는다(요약 메일만) — 이 기준과 상관없다.
      entry.source !== "cve" &&
      SEVERITY_RANK[entry.severity] < SEVERITY_RANK[selectedSeverity],
  ).length;

  // 캐시 값으로 폼을 만들었으면(다른 탭에서 바뀐 값을 모를 수 있다) 처음 도착한 새 응답을 1번 반영한다.
  const awaitingFreshSettings = useRef(!isFetchedAfterMount);
  useEffect(() => {
    if (!awaitingFreshSettings.current || !isFetchedAfterMount) return;
    awaitingFreshSettings.current = false;
    if (!form.formState.isDirty) form.reset(toFormValues(settings));
  }, [form, isFetchedAfterMount, settings]);

  const ids = {
    org: `${id}-org`,
    orgHint: `${id}-org-hint`,
    interval: `${id}-interval`,
    branchDays: `${id}-branch-days`,
    branchDaysHint: `${id}-branch-days-hint`,
    cveMinScore: `${id}-cve-min-score`,
    cveMinScoreHint: `${id}-cve-min-score-hint`,
    digestTime: `${id}-digest-time`,
    timezone: `${id}-timezone`,
    recipients: `${id}-recipients`,
    testEmailHint: `${id}-test-email-hint`,
    notifyMinSeverity: `${id}-notify-min-severity`,
    notifyMinSeverityHint: `${id}-notify-min-severity-hint`,
    notifyMinSeverityWarning: `${id}-notify-min-severity-warning`,
  };
  // 입력 중의 값(비었거나 NaN 이면 0 이 아니다)으로 "기본 브랜치만" 을 보인다.
  const branchScanDays = useWatch({ control: form.control, name: "branchScanDays" });
  const showThresholdWarning = belowThresholdCount !== undefined && belowThresholdCount > 0;
  const errorIdOf = (field: keyof FormValues) => errorId(`${id}-${field}`);
  const errorAria = (field: keyof FormValues, ...describedBy: (string | false | undefined)[]) =>
    fieldErrorAria(errors[field], errorIdOf(field), ...describedBy);

  /** 입력란에 [추가] 하지 않은 주소가 있으면 recipients 필드 오류로 표시하고 true (저장하지 않는다). */
  const flagPendingRecipient = (): boolean => {
    if (recipientDraft.trim() === "") return false;
    form.setError("recipients", {
      type: PENDING_RECIPIENT_ERROR,
      message: PENDING_RECIPIENT_MESSAGE,
    });
    return true;
  };

  const handleRecipientDraftChange = (draft: string) => {
    setRecipientDraft(draft);
    if (form.getFieldState("recipients").error?.type === PENDING_RECIPIENT_ERROR)
      form.clearErrors("recipients");
  };

  const submit = form.handleSubmit(
    (input) => {
      if (flagPendingRecipient()) return;
      save.mutate(input, {
        onSuccess: (saved) => {
          form.reset(toFormValues(saved));
          toast.success("설정을 저장했습니다");
        },
        onError: (error) => {
          if (!applyServerFieldErrors(form.setError, error, FORM_FIELDS))
            toast.error(errorToastMessage(error));
        },
      });
    },
    (invalid) => {
      // 다른 필드 오류와 함께 한 번에 보인다. 수신자 목록 자체의 오류가 있으면 그것을 먼저 보인다.
      if (!invalid.recipients) flagPendingRecipient();
    },
  );

  const testEmailBlocked = settings.recipients.length === 0 || !settings.smtpConfigured;

  return (
    <form onSubmit={submit} noValidate className="flex max-w-3xl flex-col gap-6">
      <p className="text-sm text-muted-foreground">* 표시는 필수 항목입니다</p>
      <div className="flex flex-col gap-5">
        <FormRow label="GitHub org" htmlFor={ids.org} isRequired>
          <Input
            id={ids.org}
            autoComplete="off"
            aria-required="true"
            className="max-w-72"
            {...errorAria("org", ids.orgHint)}
            {...form.register("org")}
          />
          <FieldDescription id={ids.orgHint}>
            org를 바꾸면 현재 검출이 모두 resolved로 바뀝니다
          </FieldDescription>
          <FieldError id={errorIdOf("org")} errors={[errors.org]} />
        </FormRow>

        <FormRow label="스캔 interval(시간)" htmlFor={ids.interval} isRequired>
          <Input
            id={ids.interval}
            type="number"
            inputMode="numeric"
            min={1}
            max={168}
            step={1}
            aria-required="true"
            className="max-w-28"
            {...errorAria("scanIntervalHours")}
            {...form.register("scanIntervalHours", { valueAsNumber: true })}
          />
          <FieldError id={errorIdOf("scanIntervalHours")} errors={[errors.scanIntervalHours]} />
        </FormRow>

        <FormRow label="브랜치 스캔 기간(일)" htmlFor={ids.branchDays} isRequired>
          <div className="flex items-center gap-2">
            <Input
              id={ids.branchDays}
              type="number"
              inputMode="numeric"
              min={0}
              max={BRANCH_SCAN_DAYS_MAX}
              step={1}
              aria-required="true"
              className="max-w-28"
              {...errorAria("branchScanDays", ids.branchDaysHint)}
              {...form.register("branchScanDays", { valueAsNumber: true })}
            />
            {branchScanDays === 0 && (
              <span className="text-sm text-muted-foreground">기본 브랜치만</span>
            )}
          </div>
          <FieldDescription id={ids.branchDaysHint}>
            최근 이 기간에 커밋이 있는 브랜치도 스캔합니다(repo당 최대 {BRANCH_SCAN_MAX_BRANCHES}개,
            기본 브랜치와 다른 파일만). 0이면 기본 브랜치만 스캔합니다.
          </FieldDescription>
          <FieldError id={errorIdOf("branchScanDays")} errors={[errors.branchScanDays]} />
        </FormRow>

        <FormRow label="일일 요약 시각" htmlFor={ids.digestTime} isRequired>
          <div className="flex items-center gap-2">
            <Input
              id={ids.digestTime}
              type="time"
              aria-required="true"
              className="max-w-32"
              {...errorAria("digestTime", ids.timezone)}
              {...form.register("digestTime")}
            />
            <span id={ids.timezone} className="text-sm text-muted-foreground">
              {settings.digestTimezone}
            </span>
          </div>
          <FieldError id={errorIdOf("digestTime")} errors={[errors.digestTime]} />
        </FormRow>

        <FormRow label="즉시 알림 최소 심각도" htmlFor={ids.notifyMinSeverity}>
          <Controller
            control={form.control}
            name="notifyMinSeverity"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger
                  id={ids.notifyMinSeverity}
                  className="w-40"
                  {...errorAria(
                    "notifyMinSeverity",
                    ids.notifyMinSeverityHint,
                    showThresholdWarning && ids.notifyMinSeverityWarning,
                  )}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((severity) => (
                    <SelectItem key={severity} value={severity}>
                      {severity}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FieldDescription id={ids.notifyMinSeverityHint}>
            이보다 낮은 검출은 일일 요약에만 포함합니다
          </FieldDescription>
          {showThresholdWarning && (
            <FieldDescription
              id={ids.notifyMinSeverityWarning}
              className="text-amber-700 dark:text-amber-300"
            >
              {`켜진 항목 ${belowThresholdCount}개는 이 기준보다 낮아 즉시 알림을 받지 않습니다`}
            </FieldDescription>
          )}
          <FieldError id={errorIdOf("notifyMinSeverity")} errors={[errors.notifyMinSeverity]} />
        </FormRow>

        <FormRow label="이메일 수신자" htmlFor={ids.recipients}>
          <Controller
            control={form.control}
            name="recipients"
            render={({ field }) => (
              <RecipientsInput
                id={ids.recipients}
                value={field.value}
                onChange={field.onChange}
                onDraftChange={handleRecipientDraftChange}
                {...errorAria("recipients")}
              />
            )}
          />
          <FieldError id={errorIdOf("recipients")} errors={[errors.recipients]} />
        </FormRow>
      </div>

      <Separator />
      <Controller
        control={form.control}
        name="feedEnabled"
        render={({ field }) => (
          <FeedSection
            enabled={field.value}
            onEnabledChange={(next) => {
              field.onChange(next);
              // 꺼진 동안 점수 입력은 쓸 수 없다. 고치지 못하는 오류가 저장을 막지 않게 저장된 값으로 되돌린다.
              if (!next) form.resetField("cveMinScore");
            }}
            isFormDirty={isDirty}
            cveScoreField={
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor={ids.cveMinScore}>취약점의 기준 점수</FieldLabel>
                <Controller
                  control={form.control}
                  name="cveMinScore"
                  render={({ field: scoreField }) => (
                    <Input
                      id={ids.cveMinScore}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={CVE_MIN_SCORE_MAX}
                      step={0.1}
                      className="max-w-28"
                      disabled={!field.value}
                      name={scoreField.name}
                      ref={scoreField.ref}
                      onBlur={scoreField.onBlur}
                      value={Number.isNaN(scoreField.value) ? "" : scoreField.value}
                      onChange={(event) =>
                        scoreField.onChange(event.target.value === "" ? Number.NaN : event.target.valueAsNumber)
                      }
                      {...errorAria("cveMinScore", ids.cveMinScoreHint)}
                    />
                  )}
                />
                <FieldDescription id={ids.cveMinScoreHint}>
                  CVSS 점수가 이 값 이상인 취약점을 대조합니다. 0 = 끔. 취약점은 즉시 메일을 보내지 않고 요약 메일에 건수만
                  들어갑니다.
                </FieldDescription>
                <FieldError id={errorIdOf("cveMinScore")} errors={[errors.cveMinScore]} />
              </div>
            }
          />
        )}
      />

      <Separator />
      <ConnectionStatus
        githubTokenSource={settings.githubTokenSource}
        smtpConfigured={settings.smtpConfigured}
      />

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

function FormRow({ label, htmlFor, isRequired = false, children }: FormRowProps) {
  return (
    <div className="grid gap-2 md:grid-cols-[11rem_1fr] md:items-start">
      <FieldLabel htmlFor={htmlFor} className="md:pt-2">
        {label}
        {isRequired && <span aria-hidden="true">*</span>}
      </FieldLabel>
      <div className="flex min-w-0 flex-col gap-1.5">{children}</div>
    </div>
  );
}
