# Spec: 블랙리스트 동적 등록·관리 (규칙 확장, 여러 언어, 일괄 관리)

- 상태: 구현 준비 완료
- 유형·도메인: 수정 · fullstack
- 작성: 2026-11-12, ready-for-impl 인터뷰 (질문 4회 + 레이아웃 확인 1회)

### 작업 계약
- 대상: 저장소 `C:\workspace\package-watcher`, base 브랜치 `master`(`5c2263e`, v1 머지 완료), remote `github.com/kangmomin/package-watcher`. 수정 대상의 중심은 `shared/src/contract.ts:88,197,203`, `server/src/db/schema.ts:5-13`, `server/src/matcher.ts:9,22`, `server/src/services/blacklistService.ts:79-97`, `server/src/services/scanService.ts`, `server/src/mcp/server.ts:110`, `web/src/features/blacklist/*`, `web/src/features/findings/*`, `web/src/features/settings/*`.
- 기준: 이 Spec > v1 계약(`docs/20261112-package-watcher-plan.md`의 Integration Contract v1.3과 보충 S-1~S-20) > v1 Spec. 이 Spec이 바꾸지 않은 v1 규칙은 그대로 유효하다. 참조 구현은 v1 코드 자체다.
- 범위: 아래 묶음 3개 / 제외: 외부 취약점 DB(OSV, GitHub Advisory) 연동, 스캔이 발견한 패키지 목록(인벤토리) 화면, 새 화면 추가, 로그인, 여러 org, Playwright E2E, `go.sum` 검사, Gradle의 변수 버전과 전이 의존성.
- 완료: 묶음마다 해당 AC·EC가 통과한다. 증거 = 단위 테스트(매처, 파서, 가져오기 파서) + API 통합 테스트(가짜 GitHub·SMTP) + 수동 확인(실행 중인 Docker 인스턴스의 데이터가 업그레이드 후 유지되는지). README의 env 표·알려진 한계 갱신. 커밋·push·PR 범위는 `start-workflow`에서 정한다(묶음마다 PR 1개).
- 승인: 이 Spec 내용 확정까지만. 구현·원격 작업은 승인되지 않음.
- 미결: 없음
- 묶음: 1/3 규칙 확장 → 2/3 여러 언어 → 3/3 일괄 관리 · 선행 묶음: 없음(1/3 기준). 2/3은 1/3의, 3/3은 2/3의 Workflow Report가 선행이다.

## 기능 목표
블랙리스트 항목에 종류·패턴·심각도·켜기/끄기·만료일을 지정하면 Node 외 6개 언어의 의존성까지 검사해야 하고, 여러 항목을 파일과 일괄 작업으로 한 번에 등록·수정·삭제할 수 있어야 한다.

## 현재 상황 (As-Is)
| 파일 | 역할 | 수정 필요 |
|------|------|----------|
| `shared/src/contract.ts:88,197,203` | 블랙리스트·검출·설정 스키마 (필드: 이름, 범위, 사유) | 필드 추가, 종류별 검증 |
| `server/src/db/schema.ts:5-13` | `blacklist_entries` (unique: name + version_range), `CREATE IF NOT EXISTS`만 있음 | 컬럼 추가, unique 변경, 버전 있는 마이그레이션 도입 |
| `server/src/matcher.ts:9,22` | npm semver 매칭 | 종류별 매처, glob 이름 매칭 |
| `server/src/lockfiles/*`, `server/src/workspaces.ts` | npm 계열 lockfile 4종 | 6개 종류의 파서 추가 |
| `server/src/services/scanService.ts` | `package.json`이 없는 repo는 건너뜀 | 종류별 파일 수집, 켜진 항목만 매칭 |
| `server/src/services/blacklistService.ts:79-97` | 1건씩 등록·수정·삭제 | 일괄 작업, 가져오기·내보내기 |
| `server/src/services/notifier.ts`, `scheduler.ts` | 모든 신규 검출을 즉시 메일 | 심각도 임계값, 만료 처리 |
| `server/src/mcp/server.ts:110` | tool 10개 | 필드 추가, tool 3개 추가 |
| `web/src/features/blacklist/*` | 표 + 추가/수정 Dialog + 삭제 확인 | 필터, 선택, 일괄 버튼, 가져오기·내보내기 |
| `web/src/features/findings/*`, `settings/*` | 대시보드, 설정 | 열·필터 추가, 설정 1줄 추가 |

### 참조 구현
- `server/src/lockfiles/npm.ts`, `lockfiles/common.ts` → 새 파서도 같은 모양(입력 = 파일 문자열, 출력 = `{name, version}[]`, 빈 입력·형식 표지 없음은 예외)을 따른다.
- `server/src/services/blacklistService.ts:97-103` (삭제 → 활성 검출 `resolved`) → 끄기·만료·일괄 삭제가 같은 처리를 쓴다.
- `server/src/services/scanService.ts:410-424` (스캔 중 바뀐 항목의 결과를 버림) → 일괄 변경과 가져오기에도 그대로 적용된다.
- `web/src/features/blacklist/BlacklistDialog.tsx`, `web/src/lib/form.ts` → 새 필드도 shared 스키마 + `toDetails`로 검증한다.

## 변경 사항 (To-Be)

### 용어
- 종류(`ecosystem`): `npm` | `go` | `pypi` | `nuget` | `cargo` | `pub` | `maven`
- 심각도(`severity`): `critical` > `high` > `medium` > `low`

### 묶음 1/3 — 규칙 확장
- 항목 필드 추가: `ecosystem`(이 묶음에서는 `npm`만 허용), `severity`, `enabled`, `expiresAt`. 이름에 glob 패턴(`*`) 허용.
- 검출에 `ecosystem`, `severity` 추가. 대시보드에 종류·심각도 열과 필터. 정렬 = 심각도 높은 순 → 최신 순.
- 설정에 `notifyMinSeverity` 추가.
- DB 마이그레이션 도입(`PRAGMA user_version`). 기존 데이터를 보존한다.

### 묶음 2/3 — 여러 언어
| 종류 | 선언 파일 | lock 파일 | 이름 비교 | 범위 문법 (블랙리스트에 적는 형식) |
|------|-----------|-----------|-----------|------------------------------------|
| `npm` | `package.json` | v1의 4종 | 대소문자 구분 | semver range (v1 그대로) |
| `go` | `go.mod` (`// indirect` = 전이) | 없음 | 대소문자 구분 | `<v0.4.30`, `>=v1.0.0 <v2.0.0` (`v` 접두 비교식) |
| `pypi` | `pyproject.toml`, `requirements*.txt` | `uv.lock`, `poetry.lock` | PEP 503 정규화(소문자, `-_.` → `-`) | PEP 440: `<1.0,>=0.5`, `==1.2.3` |
| `nuget` | `*.csproj`, `packages.config`, `Directory.Packages.props` | `packages.lock.json` | 대소문자 무시 | NuGet 구간: `[1.0,2.0)`, `(,1.5]`, `[1.2.3]` |
| `cargo` | `Cargo.toml` | `Cargo.lock` | 대소문자 구분 | Cargo 요구식: `<1.2.0`, `>=1, <2` |
| `pub` | `pubspec.yaml` | `pubspec.lock` | 대소문자 구분 | pub 제약: `>=1.0.0 <2.0.0`, `^1.2.3` |
| `maven` | `gradle/libs.versions.toml`, `build.gradle(.kts)`의 `"group:name:version"` 문자열 | 없음 | `group:name`, 대소문자 구분 | Maven 구간: `[1.0,2.0)`, `(,1.5]` |

- `package.json`이 없어도 위 파일이 1개라도 있으면 그 repo를 검사한다.
- 검출의 `filePath`는 검출된 파일 경로, `htmlUrl`은 v1 규칙 그대로다.

### 묶음 3/3 — 일괄 관리
- 블랙리스트 화면: 필터(종류, 상태, 이름), 행 선택, 일괄 [켜기] [끄기] [삭제], [가져오기], [내보내기].
- API: `POST /api/blacklist/bulk`, `POST /api/blacklist/import`, `GET /api/blacklist/export`.
- MCP: tool 3개 추가(`bulk_update_blacklist`, `import_blacklist`, `export_blacklist`) → 총 13개.

## Feature Matrix
| ID | 묶음 | 사용자 흐름 | 프론트 책임 | 백엔드 책임 | 완료 조건 |
|----|------|------------|------------|------------|----------|
| F-01 | 1/3 | 확장 필드로 항목 등록·수정 | Dialog에 종류·심각도·만료일·켜기, 표에 열 추가 | 스키마·DB·검증, glob 매칭 | AC-01, AC-02, EC-01~05 |
| F-02 | 1/3 | 항목 끄기·만료 | 표의 상태 표시 | 즉시 `resolved`, 스캔에서 제외, 만료 tick | AC-04, AC-05 |
| F-03 | 1/3 | 심각도별 조회와 알림 | 대시보드 열·필터, 설정 1줄 | 검출 필드·정렬·필터, 알림 임계값 | AC-03, AC-06, AC-07, EC-16 |
| F-04 | 1/3 | 기존 데이터 유지 | 없음 | DB 마이그레이션 | AC-08 |
| F-05 | 2/3 | 6개 언어 검사 | Dialog의 종류 선택과 문법 예시, 종류 필터 | 파서, 종류별 매처, 스캔 대상 확대 | AC-09~14, EC-06~09 |
| F-06 | 3/3 | 파일 가져오기·내보내기 | 가져오기 Dialog(미리 보기), 내보내기 메뉴 | import·export API, CSV/JSON 파서 | AC-15~17, EC-10~12, EC-15 |
| F-07 | 3/3 | 일괄 켜기·끄기·삭제, MCP | 행 선택과 일괄 버튼 | bulk API, MCP tool 3개 | AC-18, AC-19, EC-13, EC-14 |

## API
| Method | Path | 설명 | 묶음 | 인증 |
|--------|------|------|------|------|
| GET | `/api/blacklist` | query 추가: `ecosystem?`, `enabled?`(`true`\|`false`), `q?`(이름 부분 일치) | 1, 2 | 없음 |
| POST | `/api/blacklist` | 필드 추가 | 1 | 없음 |
| PUT | `/api/blacklist/:id` | 필드 추가 | 1 | 없음 |
| GET | `/api/findings` | query 추가: `ecosystem?`, `severity?`. 정렬 변경 | 1 | 없음 |
| GET/PUT | `/api/settings` | `notifyMinSeverity` 추가 | 1 | 없음 |
| POST | `/api/blacklist/bulk` | 여러 항목을 켜기·끄기·삭제 | 3 | 없음 |
| POST | `/api/blacklist/import` | 파일 내용으로 미리 보기 또는 적용 | 3 | 없음 |
| GET | `/api/blacklist/export` | JSON 또는 CSV 파일 내려받기 | 3 | 없음 |

### Request
| 대상 | 필드 | 타입 | 필수 | 검증 |
|------|------|------|------|------|
| blacklist POST | `ecosystem` | 종류 enum | 아니오 (기본 `npm`) | 묶음 1에서는 `npm`만, 묶음 2부터 7개 |
| | `name` | string | 예 | `*`가 없으면 그 종류의 이름 규칙. `*`가 있으면 패턴이고 `*`가 아닌 문자가 2자 이상 |
| | `versionRange` | string \| null | 아니오 (기본 null) | 그 종류의 범위 문법. null·빈 값 = 모든 버전 |
| | `severity` | 심각도 enum | 아니오 (기본 `medium`) | |
| | `reason` | string | 예 | 1~500자 (v1 그대로) |
| | `enabled` | boolean | 아니오 (기본 true) | |
| | `expiresAt` | `YYYY-MM-DD` \| null | 아니오 (기본 null) | 오늘(KST) 이후의 날짜 |
| blacklist PUT | 위와 같음 | | `name`, `versionRange`, `reason`은 필수 키(v1 그대로). 새 필드 4개는 생략하면 기존 값 유지 | |
| findings query | `ecosystem`, `severity` | enum | 아니오 | 값이 enum 밖이면 400 |
| settings PUT | `notifyMinSeverity` | 심각도 enum | 아니오 (생략하면 기존 값 유지) | |
| bulk | `action` | `enable` \| `disable` \| `delete` | 예 | |
| | `ids` | integer[] | 예 | 1~1000개, 중복 제거 |
| import | `format` | `json` \| `csv` | 예 | |
| | `content` | string | 예 | 최대 1 MB, 최대 5000행 |
| | `dryRun` | boolean | 아니오 (기본 true) | true = 미리 보기 |
| export query | `format` | `json` \| `csv` | 예 | |
| | `ecosystem`, `enabled`, `q` | 목록 필터와 같음 | 아니오 | |

### Response
| 대상 | 필드 | 타입 | nullable | 설명 |
|------|------|------|----------|------|
| BlacklistEntry (추가) | `ecosystem`, `severity` | enum | 아니오 | |
| | `enabled` | boolean | 아니오 | 사용자가 정한 값 |
| | `expiresAt` | `YYYY-MM-DD` | 예 | |
| | `isExpired` | boolean | 아니오 | 서버가 KST 기준으로 계산. 만료일 다음 날 00:00부터 true |
| Finding (추가) | `ecosystem`, `severity` | enum | 아니오 | `severity`는 항목을 수정하면 활성 검출의 값도 갱신 |
| Settings (추가) | `notifyMinSeverity` | 심각도 enum | 아니오 | 기본 `low` |
| bulk | `action`, `count` | string, integer | 아니오 | 200. `count` = 처리한 항목 수 |
| import | `applied` | boolean | 아니오 | 200. `dryRun`이거나 오류가 있으면 false |
| | `created`, `updated`, `unchanged` | integer | 아니오 | |
| | `errors` | `{row, field, message}[]` | 아니오 (`field`만 null 가능) | `row` = 1부터 시작하는 데이터 행 번호 |
| export | 파일 본문 | JSON 또는 CSV | - | 200, `Content-Disposition: attachment` |

- 파일 형식(가져오기 = 내보내기):
  - JSON: `{ "version": 1, "items": [ { ecosystem, name, versionRange, severity, reason, enabled, expiresAt } ] }`
  - CSV: 머리글 `ecosystem,name,versionRange,severity,reason,enabled,expiresAt`, UTF-8(BOM 포함해 내보내고 BOM이 있어도 읽음), RFC 4180 인용. 빈 `versionRange`·`expiresAt` = null.
- 오류 본문은 v1의 `ApiError` 그대로다. 새 에러 코드는 없다.

### MCP tool (묶음 3)
| tool | 입력 | 결과 |
|------|------|------|
| `bulk_update_blacklist` | `action`, `ids` | bulk 응답과 같음 |
| `import_blacklist` | `items`(JSON 배열) 또는 `format` + `content`, `dryRun?` | import 응답과 같음 |
| `export_blacklist` | `format`, 필터 | 파일 내용 문자열 |

- 기존 tool `add_blacklist_entry`, `update_blacklist_entry`는 새 필드를 선택 입력으로 받는다(묶음 1). `list_blacklist`, `list_findings`는 새 필터를 받는다.

## 비즈니스 규칙
**이름 매칭**
- 이름에 `*`가 없음 → 그 종류의 이름 비교 규칙으로 정확히 일치.
- `*`가 있음 → `*`는 `/`를 포함한 임의의 문자열. 같은 종류의 패키지 이름 전체와 비교한다. 검출의 `packageName`은 실제 패키지 이름이다.
- 한 패키지가 항목 여러 개와 일치 → 항목마다 검출 1건(v1의 검출 키 그대로).

**버전 매칭**
- 정확한 버전이 있음(lock 파일, 또는 선언 파일의 고정 버전) → 그 종류의 버전 순서 규칙으로 범위와 비교.
- 선언 파일의 범위 spec만 있음: `npm`은 v1 그대로(범위 겹침). 그 외 종류는 범위가 null("모든 버전")인 항목에만 일치.
- 버전 문자열을 그 종류의 규칙으로 읽을 수 없음 → 불일치(예외 없음).

**켜기·끄기·만료**
- 스캔은 `enabled = true`이고 만료되지 않은 항목만 사용한다.
- `enabled`를 false로 바꿈(PUT 또는 bulk) → 그 항목의 활성 검출을 즉시 `resolved`.
- 스케줄러 tick에서 만료를 확인 → 새로 만료된 항목의 활성 검출을 `resolved`.
- 다시 켜거나 만료일을 미래로 바꿈 → 검출은 다음 스캔에서 새 `open`으로 생긴다(v1 D-31과 같음: 수정은 스캔을 자동 실행하지 않는다).

**알림**
- 스캔 종료 시 `notifiedAt`이 null인 `open` 검출 중 `severity >= notifyMinSeverity`인 것만 즉시 메일에 넣고 `notifiedAt`을 기록한다.
- 임계값보다 낮은 검출 → 즉시 메일 없음, `notifiedAt`은 null 유지, 일일 요약에는 포함.
- 메일 본문 정렬: 심각도 높은 순 → v1의 순서. 각 행에 종류와 심각도를 표시한다.

**가져오기**
- 행의 키 = 정규화한 (`ecosystem`, `name`, `versionRange`). 키가 같은 기존 항목 → 나머지 필드를 갱신. 없음 → 추가. 값이 모두 같음 → `unchanged`.
- 파일에 없는 기존 항목 → 그대로 둔다.
- 오류가 1건 이상 → `applied = false`, 아무것도 저장하지 않는다. 적용은 트랜잭션 1개다.
- 갱신으로 `enabled`가 false가 된 항목 → 끄기 규칙을 적용한다.

**일괄 작업**
- `ids` 중 1개라도 없음 → 404, 아무것도 바꾸지 않는다. 처리는 트랜잭션 1개다.
- `delete` → v1 삭제 규칙(활성 검출 `resolved`). `disable` → 끄기 규칙.

## DB 변경
- [ ] 마이그레이션 방식 도입: `PRAGMA user_version`. 시작 시 현재 버전부터 순서대로 적용, 버전마다 트랜잭션 1개.
- [ ] v2(묶음 1): `blacklist_entries`에 `ecosystem TEXT NOT NULL DEFAULT 'npm'`, `severity TEXT NOT NULL DEFAULT 'medium'`, `enabled INTEGER NOT NULL DEFAULT 1`, `expires_at TEXT NULL`. unique를 (`ecosystem`, `name`, `version_range`)로 변경(테이블 재생성, `id` 보존).
- [ ] v2(묶음 1): `findings`에 `ecosystem TEXT NOT NULL DEFAULT 'npm'`, `severity TEXT NOT NULL DEFAULT 'medium'`. settings 키 `notify_min_severity`.
- [ ] 묶음 2, 3: DB 변경 없음.

## Breaking Changes
- `GET /api/findings`의 정렬이 "최신 순"에서 "심각도 높은 순 → 최신 순"으로 바뀐다(v1 CT-02). 기존 항목은 모두 `medium`이라서 업그레이드 직후의 순서는 같다.
- MCP tool 수가 10개 → 13개(v1 CT-11의 "정확히 10개"). v1 tool의 이름과 필수 입력은 그대로다.
- `package.json`이 없는 repo가 검사 대상이 된다(v1에서는 건너뜀). `repoCount`의 정의는 그대로다.
- 응답에 필드가 추가된다. v1 클라이언트(필드를 더 받는 쪽)는 그대로 동작한다. 요청의 새 필드는 모두 선택이다.

## 화면/컴포넌트
- 위치: `/blacklist`, `/`(대시보드), `/settings`. `/scans`는 변경 없음.
- 구성: 블랙리스트 = 필터 3개, 선택 체크박스, 일괄 버튼 3개, [가져오기] Dialog, [내보내기] 메뉴, 표 열 추가(종류, 심각도, 상태, 만료일), Dialog 필드 추가. 대시보드 = 종류·심각도 필터와 열. 설정 = "즉시 알림 최소 심각도" select.
- 필요한 shadcn 컴포넌트: `checkbox`(추가 설치). 그 외는 v1에 설치된 것.

## 레이아웃 (확정)
```
[2] 블랙리스트  /blacklist                         (To-Be)
 종류[전체 v] 상태[전체 v] 이름[검색___]
            [가져오기] [내보내기 v] [+ 항목 추가]
 선택 2건: [켜기] [끄기] [삭제]     <- 선택했을 때만 표시
 |[ ]|종류 |이름      |버전 범위 |심각도 |상태|만료일    |사유  |✎|🗑|
 |[x]|npm  |lodash    |<4.17.21  |high   |켬 |-         |취약점|✎|🗑|
 |[x]|npm  |@evil/*   |(모든버전)|critical|켬 |-         |악성  |✎|🗑|
 |[ ]|go   |…/cloudkit|<v0.4.30  |medium |끔 |2027-01-31|구버전|✎|🗑|
 추가/수정 Dialog: 종류*, 이름*(* 패턴 가능), 버전 범위,
   심각도*, 사유*, 만료일, [x] 켜기         [취소][저장]
   버전 범위 아래: 선택한 종류의 문법 예시 1줄
 가져오기 Dialog: 파일 선택(JSON/CSV) -> 미리 보기
   '추가 12건, 갱신 3건, 오류 0건' + 오류 행 목록
   오류 1건 이상이면 [적용] 비활성       [취소][적용]
 내보내기: [JSON] [CSV] (현재 필터 적용)

[1] 대시보드  /                                    (To-Be)
 카드 4개: v1 그대로
 상태[open v] 종류[전체 v] 심각도[전체 v]
 repo[검색__] 패키지[검색__]
 |repo|파일 경로|종류|패키지@버전|심각도|직접/전이|상태|⋮|
 |api |go.mod   |go  |…/x@v0.3.1 |high  |직접     |open|⋮|
 정렬: 심각도 높은 순 -> 최신 순.  페이저: v1 그대로

[4] 설정  /settings                               (To-Be)
 v1 항목 그대로 + 아래 1줄 추가
 즉시 알림 최소 심각도 [low v]
   안내: 이보다 낮은 검출은 일일 요약에만 포함합니다
```
- 상태 열의 값: `켬` / `끔` / `만료`(`isExpired`가 true이면 `enabled`와 관계없이 `만료`).
- As-Is는 v1 Spec(`docs/20261112-package-watcher-spec.md`)의 "레이아웃 (확정)"이다.

## 데이터 연동
| API | 사용 필드 | 호출 시점 | 캐시 무효화 |
|-----|----------|----------|------------|
| `GET /api/blacklist` | 추가 필드 5개 | 진입, 필터 변경(이름은 300ms debounce) | 추가·수정·삭제·bulk·import 적용 성공 후 |
| `POST /api/blacklist/bulk` | `count` | 일괄 버튼 | `blacklist`, `findings`, `summary` |
| `POST /api/blacklist/import` | 전체 | 파일 선택 직후(`dryRun: true`), [적용](`dryRun: false`) | 적용 성공 후 `blacklist`, `findings`, `summary` |
| `GET /api/blacklist/export` | 파일 | [내보내기] 선택 | 없음 |
| `GET /api/findings` | `ecosystem`, `severity` | v1 + 필터 2개 | v1 그대로 |
| `GET/PUT /api/settings` | `notifyMinSeverity` | v1 그대로 | v1 그대로 |

## UI 상태
| 상태 | 표현 |
|------|------|
| loading | v1 그대로(`Skeleton`). 가져오기 미리 보기 중에는 Dialog 안에 진행 표시, [적용] 비활성 |
| empty | 필터 결과가 0건: "조건에 맞는 항목이 없습니다". 전체가 0건: v1 문구 |
| success | toast: "n건을 켰습니다" / "n건을 껐습니다" / "n건을 삭제했습니다" / "가져오기를 적용했습니다 (추가 a건, 갱신 b건)" |
| error | v1 Error Contract 그대로. 가져오기 오류 행은 Dialog 안의 목록(행 번호, 필드, 메시지). 일괄 삭제는 확인 Dialog(건수 표시) 후 실행 |

## 통신 계약 (초안)
- v1의 에러 코드별 화면 처리를 그대로 쓴다.
- bulk의 404 `NOT_FOUND` → toast + `blacklist` 재조회 + 선택 해제.
- import의 400 `VALIDATION_ERROR`(파일을 읽을 수 없음, 크기 초과) → Dialog 안에 메시지, Dialog 유지.
- Integration Contract와 `CT-nn` 확정은 `start-workflow` 풀스택 Phase 2에서 한다(묶음마다).

## 정상 흐름
| ID | 묶음 | 시나리오 | 보장되는 결과 | HTTP |
|----|------|---------|--------------|------|
| AC-01 | 1 | `POST /api/blacklist`에 새 필드를 모두 넣음 / 모두 생략 | 응답에 넣은 값 / 기본값(`npm`, `medium`, `enabled: true`, `expiresAt: null`), `isExpired: false` | 201 |
| AC-02 | 1 | 항목 `@evil/*`(범위 null), repo의 lockfile에 `@evil/a`, `@evil/b` | `open` 검출 2건. `packageName`은 각각 `@evil/a`, `@evil/b` | - |
| AC-03 | 1 | 심각도가 다른 검출 3건, `GET /api/findings` / `?severity=high` | critical → high → low 순서 / high 검출만 | 200 |
| AC-04 | 1 | 활성 검출이 있는 항목을 PUT으로 `enabled: false` | 그 검출이 `resolved`, `resolvedAt` 기록. 다음 스캔은 그 항목으로 검출을 만들지 않음 | 200 |
| AC-05 | 1 | `expiresAt`이 어제가 된 뒤 스케줄러 tick | 항목의 `isExpired: true`. 활성 검출 `resolved`. 다음 스캔에서 제외 | - |
| AC-06 | 1 | `notifyMinSeverity = high`, 스캔이 신규 `low` 1건과 `high` 1건으로 끝남 | 즉시 메일 1통에 `high` 1건만. `low`의 `notifiedAt`은 null. 일일 요약에는 2건 | - |
| AC-07 | 1 | `PUT /api/settings`에 `notifyMinSeverity: "high"` / 키 생략 | 응답 `high` / 기존 값 유지 | 200 |
| AC-08 | 1 | v1 DB(항목과 검출이 있음)로 새 버전을 시작 | 항목과 검출의 수와 `id`가 같음. 항목은 `npm`, `medium`, `enabled: true`. `user_version = 2` | - |
| AC-09 | 2 | 6개 종류 각각: 블랙리스트 범위에 드는 버전이 그 종류의 파일에 있음 | 종류마다 `open` 검출 1건. `ecosystem`과 `filePath`가 맞음 | - |
| AC-10 | 2 | 종류마다 그 종류의 올바른 범위로 `POST /api/blacklist` | 저장됨 | 201 |
| AC-11 | 2 | `pypi` 항목 `foo-bar`, 파일에는 `Foo_Bar` / `nuget` 항목 `newtonsoft.json`, 파일에는 `Newtonsoft.Json` | 각각 검출 1건 | - |
| AC-12 | 2 | `go.mod`의 `// indirect` 줄에 블랙리스트 모듈 | `transitive` 검출. `// indirect`가 없으면 `direct` | - |
| AC-13 | 2 | `GET /api/findings?ecosystem=go`, `GET /api/blacklist?ecosystem=go` | `go`만 반환 | 200 |
| AC-14 | 2 | `package.json`이 없고 `go.mod`만 있는 repo | 검사 대상이 되고 일치하면 검출이 생김 | - |
| AC-15 | 3 | `GET /api/blacklist/export?format=csv&ecosystem=npm` → 그 파일을 그대로 `import`(`dryRun: false`) | 내보낸 행은 `npm`만. import 결과 `created: 0, updated: 0, unchanged: n` | 200 |
| AC-16 | 3 | `import`를 `dryRun: true`로 호출(추가 2건, 갱신 1건) | `applied: false, created: 2, updated: 1, errors: []`. DB는 그대로 | 200 |
| AC-17 | 3 | 같은 내용을 `dryRun: false`로 호출 | `applied: true`. `GET /api/blacklist`에 반영. 파일에 없는 기존 항목은 그대로 | 200 |
| AC-18 | 3 | `bulk`로 `disable` 2건 → `enable` 2건 → `delete` 2건 | 각각 `count: 2`. disable·delete 때 그 항목의 활성 검출 `resolved` | 200 |
| AC-19 | 3 | MCP `tools/list`, `import_blacklist`(`items` 2건, `dryRun: false`) | tool 13개. 항목 2건이 REST 목록에 나타남 | - |

## 엣지 케이스
| ID | 묶음 | 케이스 | 기대 동작 | HTTP | 참조 구현 |
|----|------|--------|----------|------|----------|
| EC-01 | 1 | 이름이 `*` 또는 `@*/*`처럼 `*`가 아닌 문자가 2자 미만 | 저장하지 않음. `VALIDATION_ERROR`, `details.name` | 400 | `shared/src/contract.ts:172` |
| EC-02 | 1, 2 | 그 종류의 문법에 맞지 않는 범위(예: `pypi`에 `[1.0,2.0)`) | 저장하지 않음. `details.versionRange` | 400 | `shared/src/contract.ts:180` |
| EC-03 | 1, 2 | 같은 (`ecosystem`, `name`, `versionRange`) 재등록 / 이름·범위는 같고 종류만 다름 | `DUPLICATE_ENTRY` / 저장됨 | 409 / 201 | `server/src/services/blacklistService.ts:58-74` |
| EC-04 | 1 | `expiresAt`이 어제 이전, 또는 `2027-13-40` | 저장하지 않음. `details.expiresAt` | 400 | - |
| EC-05 | 1 | 알 수 없는 `ecosystem` 또는 `severity`. 묶음 1에서 `ecosystem: "go"` | 저장하지 않음. `VALIDATION_ERROR` | 400 | - |
| EC-06 | 2 | 새 종류의 파일을 파싱할 수 없음(깨진 `Cargo.lock` 등) | 그 repo를 `failedRepos`에 기록, 스캔 `partial`, 기존 검출 유지 | - | `server/src/services/scanService.ts:249-264` |
| EC-07 | 2 | `build.gradle`의 `"g:n:$version"`, `"g:n"`(버전 없음), 변수로 조립한 선언 | 그 선언만 건너뜀. repo 실패가 아님 | - | - |
| EC-08 | 2 | lock 파일 없이 선언 파일에 범위 spec(예: `requests>=2.0`), 항목은 범위 있음 / 범위 null | 검출 없음 / 검출 1건(`version` = spec 문자열) | - | `server/src/matcher.ts:22` |
| EC-09 | 2 | 그 종류의 규칙으로 읽을 수 없는 버전 문자열 | 불일치. 예외 없음. 다른 패키지는 계속 검사 | - | `server/src/matcher.ts:9` |
| EC-10 | 3 | `import`(`dryRun: false`)에 잘못된 행 1건 포함 | `applied: false`, `errors`에 행 번호·필드·메시지. 아무것도 저장하지 않음 | 200 | - |
| EC-11 | 3 | JSON/CSV로 읽을 수 없는 내용, 머리글 누락, 1 MB 초과, 5000행 초과 | `VALIDATION_ERROR` | 400 | - |
| EC-12 | 3 | 파일 안에서 같은 키가 2번 나옴 | 두 번째 행을 `errors`에 기록("파일 안에서 중복") | 200 | - |
| EC-13 | 3 | `bulk`의 `ids`에 없는 id 포함 | `NOT_FOUND`. 아무것도 바꾸지 않음 | 404 | - |
| EC-14 | 3 | 스캔 실행 중에 `bulk` 또는 `import` 적용 | 요청은 성공. 실행 중인 스캔은 바뀐 항목의 결과를 버림(v1 규칙) | 200 | `server/src/services/scanService.ts:410-424` |
| EC-15 | 3 | 사유에 쉼표·줄바꿈·큰따옴표가 있는 항목을 CSV로 내보내고 다시 가져옴 | 값이 그대로 보존됨. BOM이 있는 파일도 읽음 | 200 | - |
| EC-16 | 1 | `notifyMinSeverity`를 `high` → `low`로 낮춤 | 이전에 즉시 메일에서 빠졌던 `open` 검출이 다음 스캔 종료 메일에 포함됨 | - | `server/src/services/notifier.ts:149-164` |

권한·소유권: 해당 없음. 이유: v1과 같다(localhost 전용, 사용자 1명, 로그인 없음).

## 결정 로그
| ID | 항목 | 결정 | 근거 |
|----|------|------|------|
| D-01 | 유형·도메인 | 수정 · fullstack | 요청 + 기존 코드 |
| D-03 | 기준 브랜치 | `master`(`5c2263e`) | PR #1 머지 완료 |
| D-05 | 묶음 | PR 3개: 규칙 확장 → 여러 언어 → 일괄 관리 | 사용자 답(R2, R3) |
| D-07 | 언어 범위 | Go, Python, C#, Rust, Dart, Android(Gradle) | 사용자 답(R2) |
| D-08 | 외부 취약점 DB | 사용하지 않음. 4번째 묶음 삭제 | 사용자 답(R2, R3) |
| D-09 | 범위 문법 | 언어별 고유 문법 | 사용자 답(R3) |
| D-10 | 이름 패턴 | glob(`*`) | 사용자 답(R3) |
| D-11 | 끄기·만료 | 활성 검출을 즉시 `resolved` | 사용자 답(R3) |
| D-12 | 심각도 알림 | 임계값 설정(기본 low), 낮으면 일일 요약에만 | 사용자 답(R4) |
| D-13 | 가져오기 | 미리 보기 → 오류가 있으면 저장 안 함, 같은 키 갱신, 나머지 유지 | 사용자 답(R4) |
| D-14 | 파일 형식 | JSON + CSV | 사용자 답(R4) |
| D-15 | Gradle | 버전 카탈로그 + 문자열 선언 | 사용자 답(R4) |
| D-16 | 레이아웃 | 위 To-Be로 확정 | 사용자 답(레이아웃 확인) |

## Assumption
- [Assumption] D-17: 종류의 이름은 `npm`, `go`, `pypi`, `nuget`, `cargo`, `pub`, `maven`이다. Android(Gradle)는 `maven`으로 적는다 — 근거: 패키지 저장소의 일반적인 이름.
- [Assumption] D-18: 새 필드의 기본값은 `ecosystem: npm`, `severity: medium`, `enabled: true`, `expiresAt: null`이다. PUT에서 새 필드를 생략하면 기존 값을 유지한다 — 근거: v1 클라이언트(MCP `update_blacklist_entry` 포함)가 그대로 동작해야 한다. v1의 "PUT은 전체 교체"는 `name`, `versionRange`, `reason`에만 유지한다.
- [Assumption] D-19: 심각도는 4단계(`critical`, `high`, `medium`, `low`)다 — 근거: R4 질문의 표기.
- [Assumption] D-20: Go에는 고유한 범위 문법이 없다. `v` 접두 버전의 비교식(`<v0.4.30`, `>=v1.0.0 <v2.0.0`)을 쓴다 — 근거: `go.mod`는 최소 버전만 적는다.
- [Assumption] D-21: 종류별 파일 목록은 "묶음 2/3" 표와 같다. `go.sum`은 읽지 않는다(실제로 쓰지 않는 버전도 들어 있어 오탐이 생긴다). Python은 `uv.lock`과 `poetry.lock`을 lock으로 읽는다 — 근거: 사용자가 붙여 준 org 스캔의 파일 종류(`uv.lock` 40개 repo).
- [Assumption] D-22: lock 파일이 없는 npm 외 종류에서, 선언 파일의 범위 spec은 "모든 버전" 항목에만 일치한다(EC-08) — 근거: v1 A-13과 같은 정책. 문법이 다른 범위끼리의 겹침 계산은 하지 않는다.
- [Assumption] D-23: npm 외 종류의 lock 파일은 같은 폴더와, 같은 종류의 lock이 없는 하위 폴더의 선언 파일을 담당한다. workspace 선언은 읽지 않는다 — 근거: uv·Cargo의 workspace는 루트에 lock 1개를 둔다. npm은 v1 규칙(A-1) 그대로다.
- [Assumption] D-24: `*`는 `/`를 포함한 임의의 문자열이다. 패턴에는 `*`가 아닌 문자가 2자 이상 있어야 한다(EC-01). `?` 같은 다른 glob 문자는 지원하지 않는다 — 근거: `github.com/evil/*`가 하위 경로까지 잡아야 한다. `*`만 있는 패턴은 모든 패키지와 일치해서 메일이 대량으로 나간다.
- [Assumption] D-25: 만료일은 날짜(`YYYY-MM-DD`)이고 KST 기준으로 그날 끝까지 유효하다. 만료는 스케줄러 tick(30초)이 처리한다. 과거 날짜로는 저장할 수 없다(EC-04) — 근거: v1의 시각 기준(Asia/Seoul).
- [Assumption] D-26: 임계값보다 낮은 검출은 `notifiedAt`을 기록하지 않는다. 임계값을 낮추면 다음 스캔 종료 메일에 들어간다(EC-16) — 근거: v1의 "미발송분 재시도" 규칙을 그대로 쓴다.
- [Assumption] D-27: 가져오기는 요청 본문에 파일 내용 문자열을 담는다(multipart 아님). 한도는 1 MB, 5000행이다. `dryRun`의 기본값은 true다 — 근거: MCP와 같은 형식을 쓸 수 있고, 실수로 바로 적용되는 것을 막는다.
- [Assumption] D-28: 새 에러 코드는 만들지 않는다. 가져오기의 행 오류는 200 응답의 `errors`로 돌려준다 — 근거: v1 `ApiError.details`는 필드 이름이 키라서 행 오류를 담을 수 없다.
- [Assumption] D-29: 검증은 v1과 같다(단위 + API 통합 + 수동 확인, Playwright 없음). 실제 org 스캔은 수동 확인 항목이다 — 근거: v1 D-24.
- [Assumption] D-30: 종류별 버전 비교는 검증된 라이브러리가 있으면 그것을 쓰고(예: PEP 440), 없으면 직접 구현한다. 선택은 구현 계획 단계에서 한다 — 근거: v1 D-34와 같은 방식.

## 미결
- 없음
