import type { Finding, TestEmailResult } from "@pw/shared";
import { createTransport } from "nodemailer";
import type { Clock } from "../clock.ts";
import type { SmtpConfig } from "../config.ts";
import { AppError } from "../errors.ts";
import type { Logger } from "../logger.ts";
import type { Repositories } from "../repositories/index.ts";
import { readStoredSettings, toIso, toKst } from "./common.ts";

/** 메일 본문 최대 행 수. 넘으면 "외 N건, GUI에서 확인" 을 붙인다. */
export const MAIL_MAX_ROWS = 200;
/** SMTP connection·greeting·socket 타임아웃 */
export const SMTP_TIMEOUT_MS = 30_000;

export interface MailMessage {
  to: string[];
  subject: string;
  /** 일반 텍스트 본문 (repo, 파일 경로, 패키지@버전, 사유) */
  text: string;
}

export interface MailResult {
  accepted: string[];
  rejected: string[];
}

/** 발송 수단. 수신자 중 1명 이상이 수락(`accepted`)하면 성공이다. */
export interface Mailer {
  send(message: MailMessage): Promise<MailResult>;
}

function addressOf(value: string | { address: string }): string {
  return typeof value === "string" ? value : value.address;
}

/** nodemailer 구현 */
export function createSmtpMailer(smtp: SmtpConfig): Mailer {
  const transport = createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass ?? "" } : undefined,
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  });
  return {
    async send(message) {
      const info = await transport.sendMail({
        from: smtp.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
      return {
        accepted: info.accepted.map(addressOf),
        rejected: info.rejected.map(addressOf),
      };
    },
  };
}

/** SMTP 가 설정되지 않았을 때 쓰는 Mailer. 알림 경로는 `smtpConfigured` 로 먼저 막는다. */
export const unconfiguredMailer: Mailer = {
  send: () => Promise.reject(new Error("SMTP 가 설정되지 않았습니다")),
};

export interface Notifier {
  /**
   * `notifiedAt` 이 null 인 `open` 검출을 repo 별로 묶어 메일로 보낸다(최대 MAIL_MAX_ROWS 행).
   * 발송 성공 시에만 그 검출의 `notifiedAt` 을 기록한다. 수신자 0명이면 보내지 않는다.
   * SMTP 실패는 throw 하지 않는다(로그만).
   */
  notifyNewFindings(): Promise<void>;
  /** 일일 요약: `open` 검출만. 0건 또는 수신자 0명이면 보내지 않는다. */
  sendDigest(): Promise<void>;
  /** 저장된 수신자에게 테스트 메일. `NO_RECIPIENTS` / `SMTP_NOT_CONFIGURED` / `SMTP_FAILED` (AppError) */
  sendTestEmail(): Promise<TestEmailResult>;
}

export interface NotifierDeps {
  repos: Repositories;
  mailer: Mailer;
  smtpConfigured: boolean;
  clock: Clock;
  logger: Logger;
}

const SUBJECT_PREFIX = "[package-watcher]";

const typeLabel = (finding: Finding): string =>
  finding.dependencyType === "direct" ? "직접" : "전이";

// repo 안의 행은 파일 경로 → 패키지 → 버전 → id 순이다 — 근거: Spec 은 "repo 별로 묶음" 만 정한다.
function compareFindings(a: Finding, b: Finding): number {
  return (
    a.repo.localeCompare(b.repo) ||
    a.filePath.localeCompare(b.filePath) ||
    a.packageName.localeCompare(b.packageName) ||
    a.version.localeCompare(b.version) ||
    a.id - b.id
  );
}

/** repo 별로 묶은 검출 목록. 검출 행은 최대 MAIL_MAX_ROWS 개(repo 제목 행은 세지 않는다, S-2). */
export function renderFindings(findings: Finding[]): string {
  const sorted = [...findings].sort(compareFindings);
  const shown = sorted.slice(0, MAIL_MAX_ROWS);
  const lines: string[] = [];
  let currentRepo: string | null = null;
  for (const finding of shown) {
    if (finding.repo !== currentRepo) {
      if (currentRepo !== null) lines.push("");
      lines.push(`[${finding.repo}]`);
      currentRepo = finding.repo;
    }
    lines.push(
      `- ${finding.filePath}: ${finding.packageName}@${finding.version} (${typeLabel(finding)}) — 사유: ${finding.reason}`,
      `  ${finding.htmlUrl}`,
    );
  }
  const hidden = sorted.length - shown.length;
  if (hidden > 0) lines.push("", `외 ${hidden}건, GUI에서 확인`);
  return lines.join("\n");
}

export function createNotifier(deps: NotifierDeps): Notifier {
  const { repos, mailer, smtpConfigured, clock, logger } = deps;

  /** 수신자 중 1명 이상이 수락하면 true. 실패는 로그만 남긴다. */
  async function trySend(kind: string, message: MailMessage): Promise<boolean> {
    try {
      const result = await mailer.send(message);
      if (result.accepted.length > 0) return true;
      logger.warn(`${kind} 메일을 모든 수신자가 거부했습니다`, result.rejected);
      return false;
    } catch (error) {
      logger.error(`${kind} 메일 발송에 실패했습니다`, error);
      return false;
    }
  }

  /** 발송 전제(SMTP 설정, 수신자). 없으면 null */
  function recipientsForMail(kind: string): string[] | null {
    if (!smtpConfigured) {
      logger.warn(`SMTP 가 설정되지 않아 ${kind} 메일을 보내지 않습니다`);
      return null;
    }
    const { recipients } = readStoredSettings(repos.settings);
    return recipients.length > 0 ? recipients : null;
  }

  return {
    async notifyNewFindings() {
      const findings = repos.findings.listUnnotifiedOpen();
      if (findings.length === 0) return;
      const to = recipientsForMail("신규 검출");
      if (!to) return;
      const sent = await trySend("신규 검출", {
        to,
        subject: `${SUBJECT_PREFIX} 블랙리스트 패키지 신규 검출 ${findings.length}건`,
        text: `블랙리스트 패키지가 새로 검출되었습니다 (${findings.length}건).\n\n${renderFindings(findings)}\n`,
      });
      if (!sent) return;
      const now = toIso(clock.now());
      repos.transaction(() =>
        repos.findings.markNotified(
          findings.map((finding) => finding.id),
          now,
        ),
      );
    },

    async sendDigest() {
      const findings = repos.findings.listOpen();
      if (findings.length === 0) return;
      const to = recipientsForMail("일일 요약");
      if (!to) return;
      const { date } = toKst(clock.now());
      await trySend("일일 요약", {
        to,
        subject: `${SUBJECT_PREFIX} 일일 요약 (${date}): 미해결 검출 ${findings.length}건`,
        text: `미해결(open) 블랙리스트 검출이 ${findings.length}건 있습니다.\n\n${renderFindings(findings)}\n`,
      });
    },

    async sendTestEmail() {
      const { recipients } = readStoredSettings(repos.settings);
      if (recipients.length === 0) {
        throw new AppError("NO_RECIPIENTS", "저장된 이메일 수신자가 없습니다. 수신자를 저장한 뒤 다시 시도하십시오");
      }
      if (!smtpConfigured) {
        throw new AppError(
          "SMTP_NOT_CONFIGURED",
          "SMTP 가 설정되지 않았습니다. SMTP_HOST 와 SMTP_FROM 환경 변수를 설정한 뒤 서버를 다시 시작하십시오",
        );
      }
      const sent = await trySend("테스트", {
        to: recipients,
        subject: `${SUBJECT_PREFIX} 테스트 메일`,
        text: "package-watcher 의 테스트 메일입니다. 이 메일을 받았다면 SMTP 설정이 정상입니다.\n",
      });
      if (!sent) {
        // SMTP 오류 원문에는 계정 정보가 섞일 수 있어 응답에는 넣지 않고 로그로만 남긴다.
        throw new AppError("SMTP_FAILED", "테스트 메일을 보내지 못했습니다. SMTP 설정과 서버 로그를 확인하십시오");
      }
      return { ok: true };
    },
  };
}
