# package-watcher

GitHub org 의 Node.js repo 를 주기적으로 스캔해서, 블랙리스트에 올린 npm 패키지가 의존성에 들어왔는지 감시한다.

- `package.json`(dependencies / devDependencies / optionalDependencies / peerDependencies)과 lockfile 4종(`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`)을 읽는다.
- 검출은 SQLite 에 저장하고, 신규 검출은 즉시, 미해결 검출은 매일 요약 메일(SMTP)로 알린다.
- GUI(대시보드, 블랙리스트, 스캔 이력, 설정), REST API(`/api/*`), MCP 서버(`/mcp`)를 컨테이너 1개, 포트 1개(3000)로 제공한다.

## 실행 방법 (Docker)

`docker compose` 는 포트를 `127.0.0.1:3000` 에만 연다. 로그인이 없으므로 이 PC 에서만 접속한다.
컨테이너 안에는 `gh` 로그인이 없으니 GitHub 토큰은 셸에서 env 로 넘긴다.

bash:

```bash
cp .env.example .env    # 필요한 값만 채운다 (선택)
GITHUB_TOKEN=$(gh auth token) docker compose up --build
```

PowerShell:

```powershell
Copy-Item .env.example .env    # 필요한 값만 채운다 (선택)
$env:GITHUB_TOKEN = gh auth token; docker compose up --build
```

브라우저에서 <http://localhost:3000> 을 연다. 설정 화면에서 GitHub org, 스캔 주기, 요약 시각, 메일 수신자를 저장하면 자동 스캔이 시작된다.
데이터(SQLite)는 named volume `pw-data`(컨테이너의 `/data/package-watcher.db`)에 남는다. `docker compose down` 후 다시 올려도 유지되고, 지우려면 `docker compose down -v` 를 쓴다.

GitHub 토큰에는 org 의 repo 를 읽을 권한이 필요하다(classic 토큰: `repo`, `read:org` / fine-grained 토큰: 대상 org 의 Contents·Metadata read).

## 로컬 실행 (개발)

Node.js 24 이상이 필요하다.

```bash
npm ci
npm run dev        # server(tsx watch, :3000) + web(vite, :5173). vite 가 /api, /mcp 를 3000 으로 넘긴다
```

운영 빌드를 로컬에서 실행하려면:

```bash
npm run build      # web → server 순서로 빌드
npm start          # node server/dist/index.js (http://127.0.0.1:3000)
```

로컬에서는 `GITHUB_TOKEN` 이 없으면 `gh auth token` 의 결과를 쓴다.
`npm test`, `npm run lint`, `npm run typecheck` 로 검사한다.

## 환경 변수

빈 문자열은 "설정하지 않음"과 같다. boolean 값은 `true` 또는 `1` 만 참이다. `.env.example` 에 예시가 있다.

| 이름 | 기본값 | 설명 |
|------|--------|------|
| `PORT` | `3000` | listen 포트 |
| `HOST` | `127.0.0.1` (Docker 이미지: `0.0.0.0`) | listen 주소 |
| `DATA_DIR` | `./data` (Docker 이미지: `/data`) | SQLite 파일(`package-watcher.db`)을 두는 디렉터리. 없으면 만든다 |
| `WEB_DIST_DIR` | 번들 위치 기준 `../../web/dist` (Docker 이미지: `/app/web/dist`) | 빌드된 GUI 위치. 없으면 정적 파일 제공을 건너뛴다 |
| `GITHUB_TOKEN` | (없음) | GitHub 토큰. 없으면 `gh auth token` 을 실행하고, 그것도 없으면 토큰 없음(스캔 불가). 서버 시작 시 1회 해석한다 |
| `GITHUB_ORG` | (없음) | 설정 초기값: 스캔할 GitHub org |
| `SCAN_INTERVAL_HOURS` | `24` | 설정 초기값: 스캔 주기(시간, 1~168) |
| `DIGEST_TIME` | `09:00` | 설정 초기값: 일일 요약 시각(`HH:mm`, Asia/Seoul) |
| `EMAIL_RECIPIENTS` | (없음) | 설정 초기값: 메일 수신자(쉼표 구분) |
| `SMTP_HOST` | (없음) | SMTP 서버. `SMTP_HOST` 와 `SMTP_FROM` 이 모두 있어야 메일 발송이 켜진다 |
| `SMTP_PORT` | `587` (`SMTP_SECURE` 가 참이면 `465`) | SMTP 포트 |
| `SMTP_USER` | (없음) | SMTP 인증 사용자. 없으면 인증하지 않는다 |
| `SMTP_PASS` | (없음) | SMTP 인증 비밀번호 |
| `SMTP_FROM` | (없음) | 보내는 사람 주소 |
| `SMTP_SECURE` | `SMTP_PORT` 가 `465` 이면 참 | 처음부터 TLS 로 연결할지 여부 |

**설정 env 는 첫 실행에만 적용된다.** `GITHUB_ORG`, `SCAN_INTERVAL_HOURS`, `DIGEST_TIME`, `EMAIL_RECIPIENTS` 는 DB 에 그 설정 값이 아직 없을 때만 초기값으로 들어간다(잘못된 값은 경고 로그를 남기고 기본값을 쓴다). 한 번 저장된 뒤에는 env 를 바꿔도 반영되지 않으니 GUI 의 설정 화면에서 바꾼다.
비밀값(GitHub 토큰, SMTP 정보)은 env 로만 받고 DB 와 API 응답에 넣지 않는다. 바꾸려면 env 를 고친 뒤 서버를 다시 시작한다.

Docker 로 실행할 때는 `.env` 에 `PORT`, `HOST`, `DATA_DIR`, `WEB_DIST_DIR` 를 넣지 않는다(이미지의 값과 volume 경로가 바뀐다).

## MCP 연결

`/mcp` 는 Streamable HTTP(stateless) MCP 서버다. 인증이 없고 URL 은 `http://localhost:3000/mcp` 다.

Claude Code:

```bash
claude mcp add --transport http package-watcher http://localhost:3000/mcp
```

HTTP 전송을 직접 지원하지 않는 클라이언트(예: Claude Desktop)는 `mcp-remote` 로 연결한다:

```json
{
  "mcpServers": {
    "package-watcher": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:3000/mcp"]
    }
  }
}
```

| tool | 동작 |
|------|------|
| `list_findings` | 검출 목록 (`status`, `repo`, `package`, `page`, `limit`) |
| `set_finding_status` | 검출을 `ignored` 또는 `open` 으로 변경 (`id`, `status`) |
| `list_blacklist` | 블랙리스트 목록 |
| `add_blacklist_entry` | 블랙리스트 항목 추가 (`name`, `versionRange?`, `reason`) |
| `update_blacklist_entry` | 블랙리스트 항목 전체 교체 (`id`, `name`, `versionRange`, `reason`) |
| `remove_blacklist_entry` | 블랙리스트 항목 삭제 (`id`). 그 항목의 검출은 `resolved` 가 된다 |
| `trigger_scan` | 수동 스캔 시작 |
| `list_scans` | 스캔 이력 (`page`, `limit`) |
| `get_scan` | 스캔 1건 + 실패한 repo 목록 (`id`) |
| `get_settings` | 설정과 연결 상태 조회(읽기 전용) |

결과는 JSON 문자열(text content)이고, 오류는 `isError: true` 와 `{ code, message, details? }` JSON 이다.

## 알려진 한계

- GitHub 가 파일 트리를 잘라서(`truncated`) 돌려주는 대형 repo 와, `package.json` 이나 lockfile 을 해석할 수 없는 repo 는 매 스캔 실패 repo 로 기록되어 스캔이 `partial` 이 된다.
- `bun.lockb`(바이너리)는 읽지 않는다. `bun.lock` 이 없으면 lockfile 이 없는 것으로 보고 `package.json` 의 range 로만 검사하며 경고 로그를 남긴다.
- lockfile 이 없는 `package.json` 은 range 겹침으로 검사한다. `latest` 같은 dist-tag, `workspace:`, git URL 처럼 semver range 가 아닌 spec 은 "모든 버전" 항목에만 검출된다.
- GitHub API primary rate limit 이 소진되면 기다리지 않고 남은 repo 를 `RATE_LIMITED` 실패로 기록한다. 다음 스캔에서 다시 검사한다.
- org 는 1개만 감시한다. org 를 바꾸면 현재 검출이 모두 `resolved` 가 된다.
- 대상 목록에서 빠진 repo 의 검출은 GitHub 에서 다시 확인한 뒤에만 `resolved` 로 바꾼다. repo 목록이 비거나 직전보다 절반 넘게 줄면 토큰 권한 축소로 보고 보류한다(그 repo 들은 실패 repo 로 기록된다).
- 로그인·권한 관리가 없다. 외부에 노출하지 않는다.
