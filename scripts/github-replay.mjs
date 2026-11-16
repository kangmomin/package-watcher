#!/usr/bin/env node
/* global process, console, fetch, Buffer, setInterval */
// GitHub API 의 응답을 1번 녹화하고, 그 뒤에는 저장한 응답으로 재생한다 (개발·확인용).
//
// 왜: 스캔 1회가 GitHub 요청 수천 회를 쓴다(시간당 한도 5,000). 실제 데이터로 여러 번 확인하려면 한도가 모자란다.
// 녹화한 응답에는 진짜 sha 와 진짜 파일이 들어 있어서, 재생으로도 실제와 같은 경로를 검증할 수 있다.
//
//   node scripts/github-replay.mjs record [--dir data/github-recording] [--port 3200]
//   node scripts/github-replay.mjs replay [--dir data/github-recording] [--port 3200] [--host 127.0.0.1]
//   서버: GITHUB_API_URL=http://localhost:3200 (Docker 안에서는 http://host.docker.internal:3200)
//
// 주의: 녹화 폴더에는 private repo 의 파일 내용, 커밋 메시지, 계정 이름이 들어간다. 커밋하지 않는다(`data/` 는 gitignore).
//       토큰(Authorization 헤더)은 저장하지 않는다.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const UPSTREAM = "https://api.github.com";
const [mode, ...rest] = process.argv.slice(2);
const option = (name, fallback) => {
  const at = rest.indexOf(`--${name}`);
  return at === -1 ? fallback : rest[at + 1];
};
const dir = option("dir", "data/github-recording");
const port = Number(option("port", "3200"));
if (mode !== "record" && mode !== "replay") {
  console.error("사용법: node scripts/github-replay.mjs <record|replay> [--dir 폴더] [--port 3200]");
  process.exit(2);
}
mkdirSync(dir, { recursive: true });

/**
 * 요청의 키. 시각에 따라 바뀌는 값(`since=…`)은 뺀다 — 재생할 때는 "지금"이 녹화 때와 다르다.
 * GraphQL 은 본문(query + variables)이 키에 들어간다.
 */
function keyOf(method, url, body) {
  const [path, query = ""] = url.split("?");
  const params = query
    .split("&")
    .filter((part) => part !== "" && !part.startsWith("since="))
    .sort()
    .join("&");
  const text = `${method} ${path}?${params}\n${body}`;
  return { text: `${method} ${path}?${params}`, hash: createHash("sha256").update(text).digest("hex") };
}

/** 쪽 나눔의 Link 헤더가 실제 GitHub 을 가리키면 클라이언트가 이 도구를 벗어난다. 이 도구의 주소로 바꾼다. */
function rewriteLink(value, origin) {
  return value ? value.split(UPSTREAM).join(origin) : value;
}

const stats = { requests: 0, hits: 0, misses: 0, recorded: 0, upstreamErrors: 0 };
const missed = new Map();

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function send(response, status, headers, body) {
  const payload = Buffer.from(body, "utf8");
  response.writeHead(status, { ...headers, "content-length": String(payload.length) });
  response.end(payload);
}

const server = createServer(async (request, response) => {
  const method = request.method ?? "GET";
  const url = request.url ?? "/";
  // 상태 조회 (녹화·재생의 대상이 아니다)
  if (url === "/__stats") {
    send(response, 200, { "content-type": "application/json" }, JSON.stringify({ mode, dir, ...stats, missedKinds: missed.size }));
    return;
  }
  stats.requests += 1;
  const origin = `http://${request.headers.host ?? `localhost:${port}`}`;
  try {
    const body = method === "GET" || method === "HEAD" ? "" : await readBody(request);
    const key = keyOf(method, url, body);
    const file = join(dir, `${key.hash}.json`);

    if (mode === "replay") {
      if (!existsSync(file)) {
        stats.misses += 1;
        missed.set(key.text, (missed.get(key.text) ?? 0) + 1);
        // 녹화에 없는 요청: 실제 GitHub 으로 가지 않는다. 클라이언트는 이것을 "없음"으로 처리한다.
        send(response, 404, { "content-type": "application/json" }, JSON.stringify({ message: "Not Found (녹화에 없음)" }));
        return;
      }
      stats.hits += 1;
      const saved = JSON.parse(readFileSync(file, "utf8"));
      send(
        response,
        saved.status,
        {
          "content-type": saved.contentType,
          ...(saved.link ? { link: rewriteLink(saved.link, origin) } : {}),
          // 재생은 한도가 없다. 클라이언트의 rate limit 처리가 끼어들지 않게 넉넉한 값을 준다.
          "x-ratelimit-limit": "5000",
          "x-ratelimit-remaining": "5000",
          "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
        },
        saved.body,
      );
      return;
    }

    // record: 실제 GitHub 으로 전달하고 응답을 저장한다. Authorization 은 전달만 하고 저장하지 않는다.
    const headers = {};
    for (const name of ["authorization", "accept", "content-type", "user-agent", "x-github-api-version"]) {
      const value = request.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    const upstream = await fetch(UPSTREAM + url, { method, headers, body: body === "" ? undefined : body });
    const text = await upstream.text();
    const contentType = upstream.headers.get("content-type") ?? "application/json";
    const link = upstream.headers.get("link");
    // 일시적인 오류(5xx, rate limit)는 저장하지 않는다 — 재생이 그 오류를 영원히 되풀이하면 안 된다.
    const transient = upstream.status >= 500 || upstream.status === 429 || (upstream.status === 403 && /rate limit/i.test(text));
    if (transient) {
      stats.upstreamErrors += 1;
    } else {
      const temp = `${file}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify({ request: key.text, status: upstream.status, contentType, link, body: text }));
      renameSync(temp, file);
      stats.recorded += 1;
    }
    const passthrough = { "content-type": contentType };
    if (link) passthrough.link = rewriteLink(link, origin);
    for (const name of ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "x-ratelimit-resource", "retry-after"]) {
      const value = upstream.headers.get(name);
      if (value !== null) passthrough[name] = value;
    }
    send(response, upstream.status, passthrough, text);
  } catch (error) {
    stats.upstreamErrors += 1;
    send(response, 502, { "content-type": "application/json" }, JSON.stringify({ message: `replay 도구의 오류: ${String(error)}` }));
  }
});

function report() {
  console.log(`[github-replay ${mode}] ${JSON.stringify(stats)}`);
  if (missed.size > 0) {
    const top = [...missed.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log(`  녹화에 없던 요청 ${missed.size}종 (상위): ${JSON.stringify(top)}`);
  }
}
setInterval(report, 60_000).unref();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    report();
    server.close(() => process.exit(0));
  });
}
// 기본은 이 PC 에서만 접속한다 — 재생은 private repo 의 내용을 인증 없이 돌려준다.
const host = option("host", "127.0.0.1");
server.listen(port, host, () => console.log(`[github-replay ${mode}] http://${host}:${port} → ${dir}`));
