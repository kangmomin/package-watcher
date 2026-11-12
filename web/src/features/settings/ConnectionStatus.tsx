// 연결 상태 (읽기 전용).
// GitHub 토큰 = env / gh CLI / 없음, SMTP = 설정됨 / 없음.
import type { Settings } from "@pw/shared";
import { useId } from "react";
import { cn } from "@/lib/utils";

export interface ConnectionStatusProps {
  githubTokenSource: Settings["githubTokenSource"];
  smtpConfigured: boolean;
}

const TOKEN_LABELS: Record<Settings["githubTokenSource"], string> = {
  env: "env",
  gh: "gh CLI",
  none: "없음",
};

export function ConnectionStatus({ githubTokenSource, smtpConfigured }: ConnectionStatusProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <h2 id={titleId} className="text-sm font-medium">
        연결 상태
      </h2>
      <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <StatusItem label="GitHub 토큰" ok={githubTokenSource !== "none"} value={TOKEN_LABELS[githubTokenSource]} />
        <StatusItem label="SMTP" ok={smtpConfigured} value={smtpConfigured ? "설정됨" : "없음"} />
      </dl>
      <p className="text-xs text-muted-foreground">값은 서버 환경 변수로 정합니다 (읽기 전용).</p>
    </section>
  );
}

function StatusItem({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1.5">
        <span aria-hidden="true" className={cn("size-2 rounded-full", ok ? "bg-emerald-500" : "bg-zinc-400")} />
        <span>{value}</span>
      </dd>
    </div>
  );
}
