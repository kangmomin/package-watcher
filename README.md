# package-watcher

GitHub org 의 repo 를 주기적으로 스캔해서, 블랙리스트에 올린 패키지(npm, Go, PyPI, NuGet, Cargo, pub, Maven)가 의존성에 들어왔는지 감시한다.

- npm 은 `package.json`(dependencies / devDependencies / optionalDependencies / peerDependencies)과 lockfile 4종(`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`)을 읽는다. 다른 종류의 파일은 "블랙리스트 규칙"의 표를 본다.
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

## 스캔 화면

스캔 이력 표는 스캔마다 대상 repo 수 중 몇 건이 어떻게 끝났는지 보여 준다(`진행`, `통과`, `이슈`, `실패`, `건너뜀`). 행을 펼치면 repo 별 진행 상황(상태·검출 수·읽은 파일 수·실패 원인)을 상태와 이름으로 걸러서 볼 수 있다. 스캔이 진행 중이면 5초마다 갱신한다.

| 상태 | 뜻 |
|------|----|
| 통과 | 검사를 끝냈고 `open` 검출이 0건(무시한 검출만 있어도 통과) |
| 이슈 | 검사를 끝냈고 `open` 검출이 1건 이상(이번 스캔이 새로 만든 검출이 없어도 기존 `open` 검출이 있으면 이슈) |
| 실패 | 검사하지 못함(오류 메시지가 표시된다) |
| 건너뜀 | 검사할 파일이 없음(모든 종류의 선언 파일이 0개) |
| 대기·진행 중 | 스캔이 진행 중일 때만 나온다 |

archived·fork repo 는 검사하지 않으므로 대상 수에 들어가지 않는다. repo 별 기록은 **최근 30회의 스캔만 보관**한다(스캔 시작 때 오래된 기록을 지운다). 그 이전 스캔은 집계만 남고 repo 별 표는 비어 있다. 이 기능 이전의 스캔은 집계가 없어서 이전 표시(`repo 수`, 실패한 repo 목록)로 나온다.
`GET /api/scans/:id/repos`(`status`, `q`, `page`, `limit`)가 같은 내용을 준다.

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
| `ecosystem` | 패키지 종류(`npm`, `go`, `pypi`, `nuget`, `cargo`, `pub`, `maven`, 기본 `npm`). 같은 이름·버전 범위라도 종류가 다르면 다른 항목이다. **등록한 뒤에는 바꿀 수 없다**(PUT 으로 다른 종류를 보내면 400, 새 항목으로 등록한다) |
| `name` | 패키지 이름 또는 `*` 패턴. 종류마다 이름 규칙과 비교 방법이 다르다(아래 표) |
| `versionRange` | 그 종류의 범위 문법(아래 표). 비우면 모든 버전 |
| `severity` | `critical` > `high` > `medium` > `low`. 기본 `medium`. 대시보드는 심각도가 높은 검출부터 보여 준다 |
| `enabled` | 끄면 검사에서 제외하고, 그 항목의 검출(무시한 것 포함)은 즉시 `resolved` 가 된다. 다시 켜면 다음 스캔에서 새 검출(과 메일)이 생긴다 |
| `expiresAt` | 만료일(`YYYY-MM-DD`, KST). 만료일 당일까지 검사하고 다음 날 00:00(KST)부터 `만료`로 보고 끈 것과 같이 처리한다. 비우면 만료 없음 |
| `reason` | 사유 |

**종류별 파일, 이름, 범위 문법:**

| 종류 | 읽는 파일 | 이름 비교 | `versionRange` 문법 (예) |
|------|-----------|-----------|--------------------------|
| `npm` | `package.json`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock` | 대소문자 구분 | semver range: `<4.17.21`, `>=1.0.0 <2.0.0` |
| `go` | `go.mod` | 모듈 경로(`github.com/a/b`), 대소문자 구분 | `v` 접두 비교식: `<v0.4.30`, `>=v1.0.0 <v2.0.0`, `=v1.2.3` |
| `pypi` | `pyproject.toml`(PEP 621, PEP 735, poetry), `requirements*.txt`, `uv.lock`, `poetry.lock` | PEP 503 정규화(소문자, `-`·`_`·`.` 의 연속 → `-`). 저장할 때도 정규화한다(`Foo_Bar` → `foo-bar`) | PEP 440: `<1.0,>=0.5`, `==1.2.3` |
| `nuget` | `*.csproj`, `packages.config`, `Directory.Packages.props`, `packages.lock.json` | 대소문자 무시. 소문자로 저장한다 | 구간 표기: `[1.0,2.0)`, `(,1.5]`. 정확한 버전은 `[1.2.3]`(괄호 없는 `1.2.3` 은 "이상"이라는 뜻이라 거부한다) |
| `cargo` | `Cargo.toml`, `Cargo.lock` | 대소문자 구분 | Cargo 요구식: `<1.2.0`, `>=1, <2`, `=1.2.3` (연산자 없는 `1.2` 는 `^1.2`) |
| `pub` | `pubspec.yaml`, `pubspec.lock` | 대소문자 구분 | pub 제약: `>=1.0.0 <2.0.0`, `^1.2.3` |
| `maven` | `gradle/libs.versions.toml`, `build.gradle`, `build.gradle.kts` | `group:name`, 대소문자 구분 | 구간 표기: `[1.0,2.0)`, `(,1.5]`, `[1.2.3]` |

`*` 패턴은 종류의 이름 규칙으로 정규화한 이름 전체와 비교한다(pypi·nuget 은 대소문자 무시).

**스캔이 파일을 읽는 방법:**
- 위 표의 선언 파일이 1개라도 있는 repo 는 검사 대상이다. 모든 종류의 선언 파일이 0개인 repo 만 `건너뜀`이다.
- **블랙리스트에 활성 항목(켜짐, 만료 전)이 있는 종류의 파일만 받는다.** 예를 들어 `npm` 항목만 있으면 `go.mod` 의 내용은 받지 않고, 그 파일만 있는 repo 는 `통과`다. 화면의 "읽은 파일 수"는 실제로 받은 파일 수다.
- lock 파일이 있으면 lock 의 정확한 버전으로 비교한다. lock 이 담당하는 선언 파일은 같은 폴더와, 같은 종류의 lock 이 없는 하위 폴더의 선언 파일이다(하위 폴더에 같은 종류의 lock 이 있으면 그 lock 이 담당한다). lock 의 패키지는 담당 선언 파일에 이름이 있으면 `direct`, 없으면 `transitive` 다(`packages.lock.json` 과 `pubspec.lock` 은 lock 이 알려 주는 값을 쓴다). `go.mod` 에서 `// indirect` 가 붙은 줄은 `transitive` 다.
- lock 이 없거나 lock 에 없는 선언은 선언 파일의 버전으로 비교한다.

**이름 패턴:** `name` 에 `*` 가 있으면 패턴이다. `*` 는 `/` 를 포함한 임의의 문자열(0자 이상)과 일치하고, 패키지 이름 전체를 대소문자 구분해서 비교한다. 예: `@evil/*`, `@*/evil`, `*-malware`, `left-pad*`.
영문자·숫자가 2자 이상 있어야 한다(`*`, `@*/*`, `a*` 는 거부). 연속한 `*` 는 1개로 저장한다. 한 패키지가 항목 여러 개와 일치하면 항목마다 검출이 생긴다.
로컬 `file:` 의존성과 org 가 직접 배포한 패키지도 패턴에 걸릴 수 있다. lockfile 이 없는 `package.json` 을 range 로 검사할 때는, 같은 repo 안의 다른 `package.json` 의 `name`(내부 workspace 패키지)을 가리키는 의존성은 패턴과 비교하지 않는다. 정확한 이름 항목은 그대로 비교한다.

**알림 임계값:** 설정의 "즉시 알림 최소 심각도"(`notifyMinSeverity`, 기본 `low`)보다 낮은 신규 검출은 스캔 직후 메일에서 빠지고 일일 요약에만 들어간다.
임계값 이상인 검출이 없으면 즉시 메일을 보내지 않는다. 빠진 검출은 `notifiedAt` 이 비어 있어서, 임계값을 낮추거나 항목의 심각도를 올리면 다음 스캔 종료 메일에 들어간다.
**업그레이드 직전에 만든 기존 항목은 모두 `medium` 이다.** 임계값을 `high` 이상으로 올리기 전에 항목마다 심각도를 지정하지 않으면 즉시 메일이 조용히 끊긴다(설정 화면이 이 항목 수를 경고로 알려 준다).
메일 본문은 심각도 높은 순으로 정렬하고 각 행에 `[심각도][종류]` 를 붙인다.

## 일괄 작업, 가져오기, 내보내기

목록 필터: `GET /api/blacklist` 는 `ecosystem`, `enabled`, `q` 외에 `status`(`active` 켜짐·만료 전 / `disabled` 꺼짐·만료 전 / `expired` 만료, 꺼짐 여부와 무관)로 거른다. 만료가 끔보다 우선한다.

**일괄 작업** — `POST /api/blacklist/bulk` `{ "action": "enable" | "disable" | "delete", "ids": [1, 2] }` → `{ action, count }`.
- `ids` 는 1~1000개이고 중복은 1개로 센다. 없는 id 가 1개라도 있으면 404 이고 아무것도 바꾸지 않는다. 트랜잭션 1개로 처리한다.
- `disable`·`delete` 는 그 항목의 활성 검출을 `resolved` 로 바꾼다. `enable` 은 검출을 만들지 않는다(다음 스캔이 만든다).
- 값이 이미 같은 항목(이미 켜진 항목의 `enable` 등)은 수정하지 않는다. `count` 는 요청한 id 의 수다.

**내보내기** — `GET /api/blacklist/export?format=json|csv` + 목록과 같은 필터(`ecosystem`, `enabled`, `q`, `status`). `name` → `id` 순서이고, 0건이어도 200 이다. 파일 이름은 `blacklist-YYYYMMDD.json|csv`(KST 날짜)이다.

**가져오기** — `POST /api/blacklist/import` `{ "format": "json" | "csv", "content": "<파일 내용>", "dryRun": true }`.
- `dryRun` 의 기본값은 `true`(미리 보기, 저장하지 않음)다. 적용하려면 `false` 를 보낸다.
- 응답: `{ applied, created, updated, unchanged, errors: [{ row, field, message }] }`. `row` 는 1부터 시작하는 데이터 행 번호(머리글 제외)이고 `field` 는 필드 이름 또는 `null` 이다.
- 행마다 1건 등록과 같은 검증(종류별 이름·범위 규칙, 이름 정규화)을 한다. 행의 키(정규화한 종류·이름·버전 범위)가 같은 기존 항목이 있으면 나머지 필드를 갱신하고(`updated`), 모두 같으면 `unchanged`, 없으면 추가한다(`created`). 파일에 없는 기존 항목은 그대로 둔다.
- **오류가 1건이라도 있으면 `dryRun: false` 여도 아무것도 저장하지 않는다**(`applied: false`). 이때의 `created`·`updated`·`unchanged` 는 오류가 없는 행의 수다. 적용은 트랜잭션 1개이고, 갱신된 항목은 1건 수정과 같이 처리한다(활성 검출의 사유·심각도 갱신, 꺼지면 `resolved`).
- 파일 안에서 같은 키가 2번 나오면 두 번째 행이 오류다. 과거의 `expiresAt` 은 새 항목이면 오류이고, 기존 항목의 저장된 값과 같으면 허용한다(내보낸 파일을 그대로 다시 가져올 수 있다).
- 파일을 읽을 수 없거나(JSON 문법 오류, 닫히지 않은 CSV 따옴표), 필수 열이 없거나, 한도를 넘으면 400 `VALIDATION_ERROR` 다.

**한도:** `content` 1 MB(UTF-8 바이트), 5000행, 일괄 작업 `ids` 1000개. 가져오기 요청 본문은 4 MB 까지다.

**파일 형식** (가져오기와 내보내기가 같다):

JSON:

```json
{
  "version": 1,
  "items": [
    {
      "ecosystem": "npm",
      "name": "evil-pkg",
      "versionRange": "<4.17.21",
      "severity": "high",
      "reason": "악성 코드",
      "enabled": true,
      "expiresAt": "2027-01-01"
    }
  ]
}
```

CSV (UTF-8, RFC 4180):

```csv
ecosystem,name,versionRange,severity,reason,enabled,expiresAt
npm,evil-pkg,<4.17.21,high,악성 코드,true,2027-01-01
pypi,foo-bar,">=1.0,<2.0",medium,"쉼표, ""큰따옴표""",false,
```

- 내보낼 때 CSV 는 BOM 으로 시작하고 줄 끝은 CRLF 다. 읽을 때는 BOM 과 LF·CRLF 를 모두 받는다. 쉼표·줄바꿈·큰따옴표가 있는 값은 `"…"` 로 감싸고 큰따옴표는 `""` 로 쓴다.
- 빈 `versionRange`·`expiresAt` 은 `null`(모든 버전, 만료 없음)이다. `enabled` 는 `true`/`false` 다.
- 가져올 때 `name`·`reason` 열(JSON 은 키)만 필수다. 나머지를 생략하면 기본값(`npm`, `medium`, `true`, `null`)을 쓴다. 열 순서는 자유이고 모르는 열·키는 무시한다. 머리글은 대소문자를 구분한다. JSON 의 `version` 은 `1` 이어야 한다.
- CSV 의 완전히 빈 줄은 건너뛴다. 열 수가 머리글과 다른 행은 그 행의 오류다. JSON 의 객체가 아닌 항목도 그 행의 오류다.

**주의:** 내보낸 CSV 를 스프레드시트에서 열면 `=`·`@` 등으로 시작하는 값(예: 버전 범위 `=1.2.3`, 이름 `@scope/pkg`)이 수식으로 읽힐 수 있다. 다시 가져올 수 있게 값을 그대로 내보내므로 수식 방지 접두어를 붙이지 않는다. 스프레드시트에서 편집할 때는 텍스트 열로 열고, 다시 저장한 CSV 의 값이 그대로인지 가져오기 미리 보기로 확인한다.

## 업그레이드와 백업

새 버전을 처음 띄울 때 기존 DB 는 **자동으로 마이그레이션**된다(항목·검출·설정과 `id` 는 그대로, DB 버전은 3). v1 DB 의 새 필드는 `npm`/`medium`/켬/만료 없음이고, 예전 스캔은 repo 별 기록 없이 남는다. 마이그레이션 직전에 같은 폴더에 백업 파일을 만든다:

- `package-watcher.db.v{n}-backup` — Docker 에서는 volume 의 `/data/package-watcher.db.v{n}-backup`. 파일 이름의 `v{n}` 은 마이그레이션 직전 DB 의 버전이다(v1 이미지의 DB 는 `v0`, 이전 버전(v2) 이미지의 DB 는 `v2`). 같은 이름이 이미 있으면 새 내용으로 덮어쓴다.
- 마이그레이션을 했다는 로그 한 줄(`DB 를 v2 에서 v3 로 마이그레이션했습니다. 백업: …`)이 남는다.

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
| `list_blacklist` | 블랙리스트 목록 (`ecosystem?`, `enabled?`, `q?`, `status?`). `enabled=true` 는 사용자가 켠 항목이라서 만료된 항목도 포함된다. 만료 여부는 각 항목의 `isExpired` 로 본다 |
| `add_blacklist_entry` | 블랙리스트 항목 추가 (`name`, `versionRange?`, `reason`, `ecosystem?`, `severity?`, `enabled?`, `expiresAt?`). `severity` 기본값은 `medium`, 즉시 메일 기준은 `get_settings` 의 `notifyMinSeverity` |
| `update_blacklist_entry` | 블랙리스트 항목 수정 (`id`, `name`, `versionRange`, `reason`, `ecosystem?`, `severity?`, `enabled?`, `expiresAt?`). `name`·`versionRange`·`reason` 은 전체 교체, 나머지 필드는 생략하면 유지. `expiresAt: null` 은 만료 해제 |
| `remove_blacklist_entry` | 블랙리스트 항목 삭제 (`id`). 그 항목의 검출은 `resolved` 가 된다 |
| `bulk_update_blacklist` | 항목 여러 개를 한 번에 켜기·끄기·삭제 (`action`: `enable`/`disable`/`delete`, `ids`). 없는 id 가 있으면 아무것도 바꾸지 않고 `NOT_FOUND` |
| `import_blacklist` | 파일 형식으로 가져오기 (`items` 배열 또는 `format` + `content` 중 하나, `dryRun?`). `dryRun` 을 생략하면 미리 보기이고 적용하려면 `false`. 행 오류는 결과의 `errors` 로 돌려준다 |
| `export_blacklist` | 파일 형식으로 내보내기 (`format`, `ecosystem?`, `enabled?`, `q?`, `status?`). 결과는 JSON 으로 감싸지 않은 파일 내용 문자열이다 |
| `trigger_scan` | 수동 스캔 시작 |
| `list_scans` | 스캔 이력 (`page`, `limit`) |
| `get_scan` | 스캔 1건 + 실패한 repo 목록 + repo 별 집계 `repoStats` (`id`). `list_scans` 의 결과에도 `repoStats` 가 들어간다 |
| `get_settings` | 설정과 연결 상태 조회(읽기 전용) |

tool 은 모두 13개다. 결과는 JSON 문자열(text content)이고(`export_blacklist` 만 파일 내용 그대로), 오류는 `isError: true` 와 `{ code, message, details? }` JSON 이다.

## 알려진 한계

- GitHub 가 파일 트리를 잘라서(`truncated`) 돌려주는 대형 repo 와, `package.json`, lockfile, `pnpm-workspace.yaml` 을 해석할 수 없는 repo 는 매 스캔 실패 repo 로 기록되어 스캔이 `partial` 이 된다. 주석이나 끝 쉼표가 있는 `package.json`(JSONC)과 YAML 문서가 여러 개인 `pnpm-lock.yaml`(pnpm 11)은 읽는다. 파일 1개라도 읽지 못하면 그 repo 는 실패다(일부만 검사하고 통과로 표시하지 않는다).
- `bun.lockb`(바이너리)는 읽지 않는다. `bun.lock` 이 없으면 lockfile 이 없는 것으로 보고 `package.json` 의 range 로만 검사하며 경고 로그를 남긴다.
- lockfile 이 없는 `package.json` 은 range 겹침으로 검사한다. `latest` 같은 dist-tag, `workspace:`, git URL 처럼 semver range 가 아닌 spec 은 "모든 버전" 항목에만 검출된다.
- **여러 종류(go, pypi, nuget, cargo, pub, maven)의 한계:**
  - 블랙리스트에 활성 항목이 있는 종류의 파일만 읽는다. 항목이 없는 종류의 파일은 받지 않으므로, 그 종류의 파일만 있는 repo 는 `통과`다. 항목을 새 종류로 처음 등록하면 다음 스캔부터 그 종류의 파일을 받아서 GitHub 요청 수가 늘어난다.
  - 읽는 파일은 위 표의 것뿐이다. `*.fsproj`·`*.vbproj`, Maven 의 `pom.xml`, `setup.py`·`Pipfile`, `requirements/` 폴더 안의 다른 이름의 파일, `go.sum` 은 읽지 않는다. `go.mod` 의 `replace`·`exclude` 도 읽지 않는다(`require` 의 버전을 그대로 쓴다).
  - 선언 파일의 고정 버전(`go.mod` 의 버전, `requirements` 의 `==`, `*.csproj` 의 `Version="1.2.3"`, Gradle 의 `"g:n:1.2.3"`, 카탈로그의 문자열 버전, `pubspec.yaml` 의 연산자 없는 버전)은 정확한 버전으로 비교한다. 그 외(`>=`, `^`, `~=`, Cargo 의 `"1.2"`, 구간)는 범위 spec 이라서 **버전 범위가 없는 항목에만** 검출되고, 검출의 버전은 spec 문자열이다. lock 이 있으면 lock 의 정확한 버전으로 비교한다.
  - Gradle 은 `build.gradle(.kts)` 안의 따옴표로 감싼 `"group:name:version"` 문자열만 읽는다. 변수(`$version`)가 든 것, 버전이 없는 것(BOM 이 관리), 변수로 조립하는 선언은 그 선언만 건너뛴다(repo 는 실패하지 않는다). 버전 카탈로그의 `version.ref` 가 가리키는 곳이 없으면 그 라이브러리도 건너뛴다. 빈 `requirements.txt`·`build.gradle` 은 의존성이 없는 정상 파일로 본다.
  - `*.csproj` 의 `Version="$(Prop)"` 처럼 MSBuild 속성이나 `2.*` 같은 부동 버전은 범위 spec 으로 취급한다. 버전이 없는 `PackageReference`(중앙 관리)는 버전 없이 이름만 비교하고, 버전은 `Directory.Packages.props` 의 `PackageVersion` 이 낸다.
  - `vendor`, `.venv`, `venv`, `site-packages`, `.dart_tool`, `Pods`(npm 은 `node_modules`) 폴더 아래의 파일은 읽지 않는다.
  - 읽을 수 없는 버전은 불일치로 처리하고 예외를 내지 않는다. 파일 자체를 해석할 수 없으면(빈 파일, 문법 오류, 형식 표지가 없는 lock) 그 repo 는 실패다.
  - Gradle 의 맵 표기(`group: 'g', name: 'n', version: 'v'`)는 읽지 않는다. 버전이 없는 Gradle 선언(BOM 이 관리)은 건너뛴다.
  - `Directory.Build.props`·`.targets` 의 `PackageReference` 는 읽지 않는다.
  - `pyproject.toml` 의 `[tool.uv] dev-dependencies` 와 `[tool.pdm.dev-dependencies]` 는 읽지 않는다(`uv.lock` 이 있으면 lock 이 잡는다).
  - Cargo 는 `serde_json` 과 `serde-json` 을 다른 이름으로 비교한다(crates.io 는 같은 이름으로 취급한다). `Cargo.lock` 에 적힌 이름으로 등록하는 것을 권장한다.
  - 선언 파일의 고정 버전이 담당 lock 의 버전과 다르면 둘 다 검사한다(선언 파일의 검출은 그 고정 버전, lock 의 검출은 lock 의 버전). 범위 spec 은 lock 에 이름이 있으면 lock 만 본다.
  - 빈 `pyproject.toml`·`libs.versions.toml` 은 정상으로 처리한다. UTF-8 이 아닌 파일(UTF-16 등)은 그 repo 를 실패로 기록한다.
  - PyPI: `<1.0` 은 PEP 440 대로 `1.0rc1` 같은 prerelease 를 포함하지 않는다. prerelease 끼리의 `<`·`>` 비교는 라이브러리의 한계로 정확하지 않으므로 `<=`·`>=` 를 권장한다.
  - Cargo: 범위는 prerelease 를 포함해서 비교한다. 연산자 없는 값(`1.2`)은 Cargo 의 의미(`^1.2`)다.
  - Maven: `1.0-1` 과 `1.0.1` 을 같은 버전으로 보고, 여러 구간(`[1,2),[3,4)`)은 받지 않는다. NuGet·Maven 의 버전 순서는 흔한 형태(숫자 마디 + 알려진 수식어)만 구현했다.
  - pub: 제약 `any` 는 블랙리스트 범위로 받지 않는다(범위를 비우면 모든 버전이다). `pubspec.yaml` 의 버전이 따옴표 없이 `1.0` 처럼 숫자로 읽히면 `1` 로 읽는다.
- GitHub API primary rate limit 이 소진되면 기다리지 않고 남은 repo 를 `RATE_LIMITED` 실패로 기록한다. 다음 스캔에서 다시 검사한다.
- org 는 1개만 감시한다. org 를 바꾸면 현재 검출이 모두 `resolved` 가 된다.
- 대상 목록에서 빠진 repo 의 검출은 GitHub 에서 다시 확인한 뒤에만 `resolved` 로 바꾼다. repo 목록이 비거나 직전보다 절반 넘게 줄면 토큰 권한 축소로 보고 보류한다(그 repo 들은 실패 repo 로 기록된다).
- 스캔 결과를 저장한 뒤 알림 메일을 보내는 동안(보통 몇 초, 최대 약 30초)에는 화면의 [지금 스캔] 이 활성이어도 새 스캔 요청이 409 `SCAN_RUNNING` 으로 거절된다. 메일 발송이 끝난 뒤 다시 시도한다.
- 로그인·권한 관리가 없다. 외부에 노출하지 않는다.
