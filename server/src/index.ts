import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createApp, hasWebDist } from "./app.ts";
import { systemClock } from "./clock.ts";
import { loadConfig, readGhAuthToken } from "./config.ts";
import { createOctokitClient } from "./github/client.ts";
import { consoleLogger } from "./logger.ts";
import { createSmtpMailer, unconfiguredMailer } from "./services/notifier.ts";

const DB_FILE_NAME = "package-watcher.db";
/** 종료 신호 후 실행 중인 스캔을 기다리는 최대 시간. 넘으면 그대로 끝낸다(다음 시작 때 running → failed). */
const SHUTDOWN_TIMEOUT_MS = 10_000;

function main(): void {
  const logger = consoleLogger;
  const config = loadConfig(process.env, readGhAuthToken);

  const instance = createApp({
    dbPath: join(config.dataDir, DB_FILE_NAME),
    github: config.github.token ? createOctokitClient({ token: config.github.token }) : null,
    githubTokenSource: config.github.source,
    mailer: config.smtp ? createSmtpMailer(config.smtp) : unconfiguredMailer,
    smtpConfigured: config.smtp !== null,
    clock: systemClock,
    logger,
    initialSettings: config.initialSettings,
    // 없으면 createApp 이 정적 파일 제공을 건너뛴다.
    webDistDir: config.webDistDir,
  });

  logger.info(`GitHub 토큰: ${config.github.source}, SMTP: ${config.smtp ? "설정됨" : "없음"}`);
  if (!hasWebDist(config.webDistDir)) {
    logger.info(`web 빌드(${config.webDistDir})가 없어 정적 파일 제공을 건너뜁니다`);
  }

  const server = serve(
    { fetch: instance.app.fetch, port: config.port, hostname: config.host },
    (info) => logger.info(`package-watcher listening on http://${config.host}:${info.port}`),
  );
  instance.scheduler.start();

  // 종료 신호는 SIGTERM/SIGINT 이고 SHUTDOWN_TIMEOUT_MS 만큼만 기다린다 — 근거: Spec 에 종료 처리 규칙이 없다(A-7 은 재시작 보정만 정한다).
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} 를 받아 종료합니다`);
    instance.scheduler.stop();
    server.close();
    setTimeout(() => {
      logger.warn("실행 중인 스캔이 끝나지 않아 기다리지 않고 종료합니다");
      process.exit(0);
    }, SHUTDOWN_TIMEOUT_MS).unref();
    instance.close().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error("종료 처리 중 오류", error);
        process.exit(1);
      },
    );
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

try {
  main();
} catch (error) {
  consoleLogger.error("package-watcher 를 시작하지 못했습니다", error);
  process.exit(1);
}
