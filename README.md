# zun-board

서포터즈·대외활동 8개를 동시에 굴리기 위한 개인용 대시보드.

- **CLI (`zun`)** — 운영진 안내문 원문을 그대로 던지면 Claude Code CLI(구독 기반)로 파싱해 Supabase 에 넣는다. **쓰기 담당.**
- **웹 대시보드** — Cloudflare Pages 정적 배포. **읽기 + 진행상태 토글 + 산출물 기록 담당.**

파싱은 전부 `claude` CLI 서브프로세스로 처리한다. **Anthropic API 종량과금을 쓰지 않는다.**

```
├─ bin/zun.mjs                  CLI 엔트리
├─ src/db.mjs                   Supabase 클라이언트 (service_role)
├─ src/parse.mjs                claude CLI 호출 + JSON 추출
├─ src/prompt.mjs               파싱 프롬프트 템플릿
├─ src/render.mjs               터미널 표 + Asia/Seoul 날짜 유틸
├─ public/index.html            대시보드 (단일 파일, CDN만 사용)
└─ .claude/skills/zun-ingest/   Claude Code 세션 안에서 쓰는 버전
```

---

## 1. 준비

### service_role 키 받기

Supabase 대시보드 → **zungong** 프로젝트 → **Settings → API** → **`service_role`** 키 복사.

> 이 키는 RLS 를 우회합니다. 절대 깃에 올리거나 브라우저로 보내지 마세요.
> `.gitignore` 에 `.env` 가 들어 있습니다.

### .env 작성

```bash
cp .env.example .env
```

`.env` 를 열어 채웁니다:

```ini
SUPABASE_URL=https://rlisxmxytrvapkgcqkgf.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...            # 위에서 복사한 service_role
ZUN_DASHBOARD_URL=https://zun-board.pages.dev  # 배포 후 실제 주소로
```

### 설치 + 전역 등록

```bash
npm install
npm link          # 이제 어디서나 `zun` 을 쓸 수 있습니다
```

`npm link` 가 권한 문제로 막히면 `node bin/zun.mjs <명령>` 으로 그대로 쓸 수 있습니다.

### claude CLI 확인

```bash
which claude      # 경로가 나와야 합니다
```

없으면 `npm i -g @anthropic-ai/claude-code`.
다른 경로에 있으면 `.env` 에 `ZUN_CLAUDE_BIN=/path/to/claude` 를 추가하세요.

---

## 2. CLI 사용법

```bash
zun add                          # $EDITOR 열어서 원문 작성 → 파싱
zun add "9/18 금 10시 공공AX OT"   # 인자로 바로
cat 공지.txt | zun add             # 파이프
zun add -f 가이드북.txt             # 파일에서
zun add --activity teazr          # 활동 힌트 (선택)

zun save parsed.json             # 파싱 건너뛰고 JSON 직접 삽입 (스킬에서 호출)
zun ls                           # 다가오는 마감 30일치
zun ls 90                        # 90일치
zun done <검색어>                 # 제목 부분일치로 찾아 완료 토글
zun open                         # 배포된 대시보드 열기
```

**옵션**

| 옵션 | 뜻 |
|---|---|
| `-f, --file <경로>` | 원문 파일에서 읽기 |
| `--activity <slug>` | 활동 힌트 |
| `-y, --yes` | 확인 없이 진행 |
| `--dry-run` | 파싱·미리보기만 하고 저장하지 않음 |
| `--all` | (`ls`) 완료된 일정도 표시 |

### `zun add` 흐름

1. 원문 확보 (인자 / 파이프 / `-f` / `$EDITOR`)
2. 프롬프트 생성 — **현재 `sp_activity` 목록과 오늘 날짜(Asia/Seoul)를 주입**해서
   "이번 주 금요일" 같은 상대 날짜와 기존 활동 매칭이 되게 한다
3. `claude -p <프롬프트> --output-format text` 실행 (타임아웃 120초)
4. 출력에서 첫 ` ```json ` 블록을 추출해 파싱 (실패하면 원문을 보여주고 재시도를 묻는다)
5. 표로 미리보기 — 활동 / 제목 / 마감(요일) / 종류 / 필수 / 충돌
6. `[Enter] 저장  [e] 수정  [q] 취소` — `e` 는 JSON 을 `$EDITOR` 로 열어 고친 뒤 다시 미리보기
7. 저장 — 새 활동은 `sp_activity` 에 insert, 일정은 `sp_item` 에 insert,
   원문과 파싱 결과는 `sp_ingest` 에 보관
8. 중복 방지 — 같은 활동 + 같은 날짜 + 제목 유사도가 높으면 건너뛸지 묻는다

기존 활동의 정보는 **덮어쓰지 않는다.** 비어 있거나 "미정" 인 칸만 새 값으로 채운다.

### 고정 제약

**수요일·금요일 17–22시는 아르바이트.** 마감이 이 시간대에 걸리면
파싱 단계와 저장 단계 양쪽에서 `conflict` 로 표시되고, 대시보드에서 경고색으로 뜬다.

---

## 3. 대시보드

`public/index.html` 단일 파일. 빌드 스텝 없음.
`@supabase/supabase-js` 는 jsDelivr 에서 ESM 으로 불러온다.

anon 키는 클라이언트에 들어 있지만 RLS 로 보호된다 — 읽기, `sp_item` 체크오프,
`sp_output` 기록만 가능하고 일정 생성·삭제는 service_role(=CLI) 전용이다.

**구성**

1. 글로벌 내비 + 서브 내비 — 오늘 날짜, 다음 마감 카운트다운, 라이트/다크/시스템 토글
2. 이번 주 그리드 — 월~일 7칸, 수·금은 알바 시간대를 빗금으로, 오늘 칸 강조
3. 다가오는 마감 — 활동별 필터, 30일/전체 토글, D-day, 체크박스로 완료 토글
4. 활동별 카드 — 진행률 미터, 수료 조건, 혜택, 상태 배지, 누적 활동비
5. 산출물 기록 — 표 + 인라인 추가 폼, 활동별 누적 활동비 합계
6. 비어있는 정보 — `cadence` 가 "미정" 인 활동을 모아서 무엇을 물어봐야 하는지 보여줌

**디자인**

`DESIGN-apple_2.md` 의 Apple 디자인 언어를 따른다.

- 섹션은 전면 타일로 쌓이고 **색 변화 자체가 구분선** — parchment → white → near-black → white → parchment
- 인터랙션 색은 **Action Blue `#0066cc` 하나뿐** (다크 타일·다크 모드에서는 Sky Link Blue `#2997ff`).
  활동 색은 데이터 식별용 점·좌측 보더로만 쓰고 "누르는 것"에는 쓰지 않는다
- 본문 17px / 행간 1.47 / 자간 −0.374px, 헤드라인은 weight 600 + 음수 자간. weight 500 은 쓰지 않는다
- 폰트는 `-apple-system` 우선(애플 기기에서 실제 SF Pro + Apple SD Gothic Neo) →
  그 외 환경은 **Pretendard** 하나로 라틴·한글을 모두 덮는다. 숫자 열은 `tabular-nums`.
  **Inter 는 쓰지 않는다** — SF Pro 대체로 흔히 쓰이지만 AI 생성물의 기본값처럼 보인다
- **그림자 없음.** 카드·버튼·글자에 그림자를 넣지 않고 1px hairline 과 표면 색 변화로만 구분한다.
  서브 내비만 `backdrop-filter` 로 떠 있다
- 반경 문법: 8px 유틸 / 11px pearl / 18px 카드 / pill(9999px) 은 액션 전용
- 누를 수 있는 것은 누를 때 `transform: scale(.95)`
- 640px 이하에서는 산출물 표가 카드 스택으로 바뀐다 (7열 표의 가로 스크롤 제거)

**마이크로 인터랙션 / 접근성**

그림자를 쓰지 않는 시스템이라 움직임은 표면색·테두리·투명도로만 만든다.

- 타일 진입(최초 1회), 행 hover, 카드·칩 테두리 전환, 버튼 press `scale(.95)`
- 완료 체크 시 해당 행을 Action Blue 로 한 번 훑고 지나가는 피드백
- `prefers-reduced-motion` 에서 애니메이션·트랜지션 전부 정지
- 명암비는 라이트·다크 양쪽 모두 WCAG AA 통과 (렌더된 페이지에서 실측).
  이를 위해 흐린 글자색을 `#7a7a7a` → `#6e6e73` 으로, 채워진 버튼 배경을
  다크에서도 `#0066cc` 로 고정했다 (`#2997ff` + 흰 글씨는 3.02:1 로 미달)
- 터치 타깃 44px — 체크박스는 44px 라벨로 감싸고, 세그먼트·삭제 버튼도 44px

### 로컬에서 보기

```bash
npm run serve     # http://localhost:5173
```

---

## 4. Cloudflare Pages 배포

1. 이 저장소를 GitHub (`djkdb`) 에 올린다.
2. Cloudflare 대시보드 → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
3. GitHub 계정을 연결하고 이 저장소를 선택한다.
4. 빌드 설정:
   - **Framework preset**: `None`
   - **Build command**: *(비워둠)*
   - **Build output directory**: `public`
5. **Save and Deploy**.
6. 배포된 주소(`https://<프로젝트>.pages.dev`)를 `.env` 의 `ZUN_DASHBOARD_URL` 에 넣으면
   `zun open` 으로 바로 열 수 있다.

이후 `main` 에 푸시할 때마다 자동 재배포된다. 환경변수 설정은 필요 없다 —
anon 키가 HTML 안에 들어 있고, 그게 의도된 구조다.

---

## 5. Claude Code 안에서 쓰기

Claude Code 세션에서 안내문을 그냥 붙여넣으면 `.claude/skills/zun-ingest` 스킬이
직접 파싱해서 `node bin/zun.mjs save` 로 저장한다. CLI 를 중첩 실행하지 않는다.

---

## 6. 데이터베이스

이미 만들어져 있다. **스키마를 새로 만들거나 마이그레이션하지 마세요.**

| 테이블 | 용도 | anon 권한 |
|---|---|---|
| `sp_activity` | 활동 8개 | SELECT |
| `sp_item` | 일정 | SELECT, UPDATE (체크오프) |
| `sp_output` | 산출물·활동비 | SELECT, INSERT, UPDATE, DELETE |
| `sp_ingest` | 원문 + 파싱 결과 보관 | 없음 (service_role 전용) |

같은 Supabase 프로젝트에 다른 앱 테이블(`items` 등)이 있다.
**`sp_` 접두사 테이블만 사용한다.**

---

## 7. 알아둘 점

대시보드는 URL 만 알면 누구나 열 수 있다. 일정 체크와 산출물 기록(활동비 포함)도 마찬가지다.
개인용이라 링크를 공유하지 않으면 실질적인 위험은 낮지만, 신경 쓰이면
Supabase Auth 매직링크를 붙이면 된다.
