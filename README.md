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

## 블랙리스트 규칙

항목의 필드:

| 필드 | 설명 |
|------|------|
| `ecosystem` | 패키지 종류. 지금은 `npm` 만 검사한다(기본 `npm`). 같은 이름·버전 범위라도 종류가 다르면 다른 항목이다 |
| `name` | 패키지 이름 또는 `*` 패턴 |
| `versionRange` | semver range. 비우면 모든 버전 |
| `severity` | `critical` > `high` > `medium` > `low`. 기본 `medium`. 대시보드는 심각도가 높은 검출부터 보여 준다 |
| `enabled` | 끄면 검사에서 제외하고, 그 항목의 검출(무시한 것 포함)은 즉시 `resolved` 가 된다. 다시 켜면 다음 스캔에서 새 검출(과 메일)이 생긴다 |
| `expiresAt` | 만료일(`YYYY-MM-DD`, KST). 만료일 당일까지 검사하고 다음 날 00:00(KST)부터 `만료`로 보고 끈 것과 같이 처리한다. 비우면 만료 없음 |
| `reason` | 사유 |

**이름 패턴:** `name` 에 `*` 가 있으면 패턴이다. `*` 는 `/` 를 포함한 임의의 문자열(0자 이상)과 일치하고, 패키지 이름 전체를 대소문자 구분해서 비교한다. 예: `@evil/*`, `@*/evil`, `*-malware`, `left-pad*`.
영문자·숫자가 2자 이상 있어야 한다(`*`, `@*/*`, `a*` 는 거부). 연속한 `*` 는 1개로 저장한다. 한 패키지가 항목 여러 개와 일치하면 항목마다 검출이 생긴다.
로컬 `file:` 의존성과 org 가 직접 배포한 패키지도 패턴에 걸릴 수 있다. lockfile 이 없는 `package.json` 을 range 로 검사할 때는, 같은 repo 안의 다른 `package.json` 의 `name`(내부 workspace 패키지)을 가리키는 의존성은 패턴과 비교하지 않는다. 정확한 이름 항목은 그대로 비교한다.

**알림 임계값:** 설정의 "즉시 알림 최소 심각도"(`notifyMinSeverity`, 기본 `low`)보다 낮은 신규 검출은 스캔 직후 메일에서 빠지고 일일 요약에만 들어간다.
임계값 이상인 검출이 없으면 즉시 메일을 보내지 않는다. 빠진 검출은 `notifiedAt` 이 비어 있어서, 임계값을 낮추거나 항목의 심각도를 올리면 다음 스캔 종료 메일에 들어간다.
**업그레이드 직전에 만든 기존 항목은 모두 `medium` 이다.** 임계값을 `high` 이상으로 올리기 전에 항목마다 심각도를 지정하지 않으면 즉시 메일이 조용히 끊긴다(설정 화면이 이 항목 수를 경고로 알려 준다).
메일 본문은 심각도 높은 순으로 정렬하고 각 행에 `[심각도][종류]` 를 붙인다.

## 업그레이드와 백업

새 버전을 처음 띄울 때 기존 DB 는 **자동으로 마이그레이션**된다(항목·검출·설정과 `id` 는 그대로, 새 필드는 `npm`/`medium`/켬/만료 없음). 마이그레이션 직전에 같은 폴더에 백업 파일을 만든다:

- `package-watcher.db.v0-backup` — Docker 에서는 volume 의 `/data/package-watcher.db.v0-backup`. 파일 이름의 `v0` 은 이전 버전(v1) 이미지의 DB 라는 뜻이다. 이미 있으면 새 내용으로 덮어쓴다.
- 마이그레이션을 했다는 로그 한 줄(`DB 를 v0 에서 v2 로 마이그레이션했습니다. 백업: …`)이 남는다.

**시작 거부:** 백업이나 마이그레이션이 실패하거나, DB 가 이 서버보다 새로운 버전이면 서버가 시작하지 않는다(DB 는 바꾸지 않는다). Docker 에서는 컨테이너가 종료와 재시작을 반복하는 것으로 보인다. `docker compose logs` 로 원인을 확인한다. 백업 파일이 있는 디렉터리에 쓸 수 없는 경우가 대표적이다.

**수동 백업:** 컨테이너를 멈춘 뒤 `package-watcher.db` 를 복사한다. SQLite 는 WAL 모드라서 실행 중에 복사하면 최근 변경이 빠진 불완전한 파일이 될 수 있다.

**이전 버전(v1) 이미지로 되돌리기:** v1 이미지는 `enabled`·`expiresAt` 을 무시한다. 꺼진 항목과 만료된 항목도 검사하고 메일을 보낸다. 되돌리려면 이미지만 바꾸지 말고 아래 절차로 백업 파일을 복원한다.

**복원 절차:**

1. 컨테이너를 멈춘다(`docker compose stop`).
2. `package-watcher.db-wal`, `package-watcher.db-shm` 을 삭제한다.
3. 백업 파일을 `package-watcher.db` 로 복사한다.
4. 이전 버전 이미지로 다시 띄운다. 백업 이후에 바뀐 항목·검출·설정은 사라진다.

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
| `list_findings` | 검출 목록 (`status`, `repo`, `package`, `ecosystem`, `severity`, `page`, `limit`). `severity` 는 정확히 일치하는 값만 거른다 |
| `set_finding_status` | 검출을 `ignored` 또는 `open` 으로 변경 (`id`, `status`) |
| `list_blacklist` | 블랙리스트 목록 (`ecosystem?`, `enabled?`, `q?`). `enabled=true` 는 사용자가 켠 항목이라서 만료된 항목도 포함된다. 만료 여부는 각 항목의 `isExpired` 로 본다 |
| `add_blacklist_entry` | 블랙리스트 항목 추가 (`name`, `versionRange?`, `reason`, `ecosystem?`, `severity?`, `enabled?`, `expiresAt?`). `severity` 기본값은 `medium`, 즉시 메일 기준은 `get_settings` 의 `notifyMinSeverity` |
| `update_blacklist_entry` | 블랙리스트 항목 수정 (`id`, `name`, `versionRange`, `reason`, `ecosystem?`, `severity?`, `enabled?`, `expiresAt?`). `name`·`versionRange`·`reason` 은 전체 교체, 나머지 필드는 생략하면 유지. `expiresAt: null` 은 만료 해제 |
| `remove_blacklist_entry` | 블랙리스트 항목 삭제 (`id`). 그 항목의 검출은 `resolved` 가 된다 |
| `trigger_scan` | 수동 스캔 시작 |
| `list_scans` | 스캔 이력 (`page`, `limit`) |
| `get_scan` | 스캔 1건 + 실패한 repo 목록 (`id`) |
| `get_settings` | 설정과 연결 상태 조회(읽기 전용) |

결과는 JSON 문자열(text content)이고, 오류는 `isError: true` 와 `{ code, message, details? }` JSON 이다.

## 알려진 한계

- GitHub 가 파일 트리를 잘라서(`truncated`) 돌려주는 대형 repo 와, `package.json`, lockfile, `pnpm-workspace.yaml` 을 해석할 수 없는 repo 는 매 스캔 실패 repo 로 기록되어 스캔이 `partial` 이 된다.
- `bun.lockb`(바이너리)는 읽지 않는다. `bun.lock` 이 없으면 lockfile 이 없는 것으로 보고 `package.json` 의 range 로만 검사하며 경고 로그를 남긴다.
- lockfile 이 없는 `package.json` 은 range 겹침으로 검사한다. `latest` 같은 dist-tag, `workspace:`, git URL 처럼 semver range 가 아닌 spec 은 "모든 버전" 항목에만 검출된다.
- GitHub API primary rate limit 이 소진되면 기다리지 않고 남은 repo 를 `RATE_LIMITED` 실패로 기록한다. 다음 스캔에서 다시 검사한다.
- org 는 1개만 감시한다. org 를 바꾸면 현재 검출이 모두 `resolved` 가 된다.
- 대상 목록에서 빠진 repo 의 검출은 GitHub 에서 다시 확인한 뒤에만 `resolved` 로 바꾼다. repo 목록이 비거나 직전보다 절반 넘게 줄면 토큰 권한 축소로 보고 보류한다(그 repo 들은 실패 repo 로 기록된다).
- 스캔 결과를 저장한 뒤 알림 메일을 보내는 동안(보통 몇 초, 최대 약 30초)에는 화면의 [지금 스캔] 이 활성이어도 새 스캔 요청이 409 `SCAN_RUNNING` 으로 거절된다. 메일 발송이 끝난 뒤 다시 시도한다.
- 로그인·권한 관리가 없다. 외부에 노출하지 않는다.
