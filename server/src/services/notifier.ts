import {
  CVE_SOURCE,
  POLICY_ECOSYSTEM,
  SEVERITY_RANK,
  policyCheckOf,
  usesVersionRange,
  type Finding,
  type TestEmailResult,
} from "@pw/shared";
import { createTransport } from "nodemailer";
import type { Clock } from "../clock.ts";
import type { SmtpConfig } from "../config.ts";
import { AppError } from "../errors.ts";
import type { Logger } from "../logger.ts";
import type { Repositories } from "../repositories/index.ts";
import { printable, readStoredSettings, toIso, toKst } from "./common.ts";
import { todayKst } from "./entryActivity.ts";

/** 메일 본문 최대 행 수. 넘으면 "외 N건, GUI에서 확인" 을 붙인다. */
export const MAIL_MAX_ROWS = 200;
/** SMTP connection·greeting·socket 타임아웃 */
export const SMTP_TIMEOUT_MS = 30_000;
/** 메일에 표시하는 브랜치 이름의 최대 길이 */
const BRANCH_MAIL_MAX = 200;

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
   * `notifiedAt` 이 null 인 `open` 검출 중 심각도가 `notifyMinSeverity` 이상인 것을 메일로 보낸다(최대 MAIL_MAX_ROWS 행).
   * 대상이 0건이면 보내지 않는다.
   * 발송 성공 시에만 그 검출의 `notifiedAt` 을 기록한다. 수신자 0명이면 보내지 않는다.
   * SMTP 실패는 throw 하지 않는다(로그만).
   */
  notifyNewFindings(): Promise<void>;
  /**
   * 일일 요약: `open` 검출만. 0건 또는 수신자 0명이면 보내지 않는다.
   * `policy`(위험한 설정)는 행에 넣지 않고 끝에 검사별 건수만 붙인다. policy 만 있으면 "보낼 것"이 없다.
   * 취약점(`source = cve`)도 행에 넣지 않고 끝에 1줄(`취약점: 총 n건, 패키지 m개`)만 붙인다. 취약점만 있으면 보내지 않는다.
   */
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

// 심각도 높은 순 → repo → 파일 경로 → 패키지 → 버전 → id. 200행 절단도 이 순서라서 심각한 검출이 "외 N건" 으로 잘리지 않는다.
function compareFindings(a: Finding, b: Finding): number {
  return (
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    a.repo.localeCompare(b.repo) ||
    a.ref.localeCompare(b.ref) ||
    a.filePath.localeCompare(b.filePath) ||
    a.packageName.localeCompare(b.packageName) ||
    a.version.localeCompare(b.version) ||
    a.id - b.id
  );
}

// 흔적 종류(path·content·branch)는 버전이 없어서 `name@` 로 끝나는 어색한 표시를 `-` 로 바꾼다. 기존 종류는 그대로다.
const versionLabel = (finding: Finding): string =>
  finding.version === "" && !usesVersionRange(finding.ecosystem) ? "-" : finding.version;

/** 커밋·PR 흔적의 위치(`commit/<sha>`, `pull/<n>`)는 읽기 쉬운 표시로 바꾼다. 종류로 판정한다(실제 파일 경로와 섞이지 않게) */
function locationLabel(finding: Finding): string {
  if (finding.ecosystem === "commit" && finding.filePath.startsWith("commit/")) {
    return `커밋 ${finding.filePath.slice("commit/".length, "commit/".length + 7)}`;
  }
  if (finding.ecosystem === "pr" && finding.filePath.startsWith("pull/")) return `PR #${finding.filePath.slice("pull/".length)}`;
  return finding.filePath;
}

/**
 * 즉시 메일과 일일 요약이 함께 쓰는 렌더러. 검출 행은 최대 MAIL_MAX_ROWS 개(repo 제목 행은 세지 않는다, S-2).
 * 심각도 순으로 정렬하므로 repo 제목은 repo 가 바뀔 때마다 출력한다(같은 repo 가 다시 나올 수 있다).
 */
export function renderFindings(findings: Finding[]): string {
  const sorted = [...findings].sort(compareFindings);
  const shown = sorted.slice(0, MAIL_MAX_ROWS);
  const lines: string[] = [];
  let currentGroup: string | null = null;
  for (const finding of shown) {
    // 브랜치의 검출은 `repo@브랜치` 로 따로 묶는다. 기본 브랜치의 표시는 그대로다.
    const group = finding.ref === "" ? printable(finding.repo) : `${printable(finding.repo)}@${printable(finding.ref).slice(0, BRANCH_MAIL_MAX)}`;
    if (group !== currentGroup) {
      if (currentGroup !== null) lines.push("");
      lines.push(`[${group}]`);
      currentGroup = group;
    }
    lines.push(
      `- [${finding.severity}][${finding.ecosystem}] ${printable(locationLabel(finding))}: ${printable(finding.packageName)}@${printable(versionLabel(finding))} (${typeLabel(finding)}) — 사유: ${printable(finding.reason)}`,
      `  ${finding.htmlUrl}`,
    );
  }
  const hidden = sorted.length - shown.length;
  if (hidden > 0) lines.push("", `외 ${hidden}건, GUI에서 확인`);
  return lines.join("\n");
}

/** 위험한 설정의 구역: 총 건수와 검사별 건수(많은 순, 같으면 id 순). 0건인 검사는 생략한다. */
/** 취약점의 구역: 1줄. 패키지 수는 (종류, 이름)이 다른 것의 수다. */
function renderCveSection(cve: Finding[]): string {
  const packages = new Set(cve.map((finding) => `${finding.ecosystem}\u0000${finding.packageName}`));
  return `취약점: 총 ${cve.length}건, 패키지 ${packages.size}개`;
}

function renderPolicySection(policy: Finding[], titleOfEntry: ReadonlyMap<number, string>): string {
  const counts = new Map<number, number>();
  for (const finding of policy) {
    counts.set(finding.blacklistEntryId, (counts.get(finding.blacklistEntryId) ?? 0) + 1);
  }
  const rows = [...counts].map(([entryId, count]) => ({ title: titleOfEntry.get(entryId) ?? `검사 #${entryId}`, count }));
  rows.sort((x, y) => y.count - x.count || (x.title < y.title ? -1 : x.title > y.title ? 1 : 0));
  return [`위험한 설정: 총 ${policy.length}건`, ...rows.map((row) => `- ${printable(row.title)}: ${row.count}건`)].join("\n");
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
      // 임계값 미만은 notifiedAt 이 null 로 남아서, 임계값을 낮추거나 항목의 심각도를 올리면 다음 스캔 메일에 들어간다.
      const { notifyMinSeverity } = readStoredSettings(repos.settings);
      const findings = repos.findings.listUnnotifiedOpen(SEVERITY_RANK[notifyMinSeverity]);
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
      const open = repos.findings.listOpen();
      const cve = open.filter((finding) => finding.source === CVE_SOURCE);
      const findings = open.filter((finding) => finding.ecosystem !== POLICY_ECOSYSTEM && finding.source !== CVE_SOURCE);
      if (findings.length === 0) return;
      const to = recipientsForMail("일일 요약");
      if (!to) return;
      const { date } = toKst(clock.now());
      const policy = open.filter((finding) => finding.ecosystem === POLICY_ECOSYSTEM && finding.source !== CVE_SOURCE);
      let section = "";
      if (policy.length > 0) {
        const titles = new Map(
          repos.blacklist
            .list({ ecosystem: POLICY_ECOSYSTEM, q: undefined }, todayKst(clock))
            .map((entry) => [entry.id, policyCheckOf(entry.name)?.title ?? entry.name] as const),
        );
        section = `\n${renderPolicySection(policy, titles)}\n`;
      }
      if (cve.length > 0) section += `\n${renderCveSection(cve)}\n`;
      await trySend("일일 요약", {
        to,
        subject: `${SUBJECT_PREFIX} 일일 요약 (${date}): 미해결 검출 ${findings.length}건`,
        text: `미해결(open) 블랙리스트 검출이 ${findings.length}건 있습니다.\n\n${renderFindings(findings)}\n${section}`,
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
