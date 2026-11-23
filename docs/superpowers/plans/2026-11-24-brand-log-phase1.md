# 브랜드 로그 1단계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자 전용 `log.html`에서 평문으로 하루를 쓰면 AI가 작업·판매로 나눠 확인 카드를 띄우고, 저장하면 연간 달력(12 × 31)에 칸·막대·스티커가 채워지며 브랜드 레벨(0~100)이 0.1 단위로 오른다.

**Architecture:** 빌드 없는 정적 사이트에 페이지 하나(`log.html`)와 ES 모듈 몇 개를 더한다. 계산(날짜, 레벨, 통계, 스티커)은 DOM을 모르는 순수 모듈로 분리해 `node --test`로 검사하고, 화면 모듈은 그 결과만 그린다. 데이터는 Supabase 새 테이블(관리자 전용 RLS) + 원자적 저장 함수, AI는 Supabase Edge Function이 Claude API를 부른다. `?local` 연습 모드는 localStorage + 규칙 기반 가짜 파서로 같은 인터페이스를 흉내 낸다.

**Tech Stack:** 순수 HTML/CSS/JS(ES 모듈), `@supabase/supabase-js@2`(기존과 같은 CDN), Supabase Postgres + Edge Functions(Deno), `npm:@anthropic-ai/sdk`, Node 26 내장 테스트 러너.

**Spec:** `docs/superpowers/specs/2026-11-23-brand-log-design.md` (승인됨). 1단계 범위 = 스펙 §8의 1번.

## Global Constraints

- 관리자 로그인 뒤에만 보인다. 새 테이블은 전부 `public.is_admin()`으로 읽기·쓰기를 막는다. 원본 기록은 공개하지 않는다.
- 날짜 경계는 **한국 시간(Asia/Seoul) 자정**. 날짜 문자열은 `YYYY-MM-DD`.
- 금액은 원 단위 정수, 시간은 분 단위 정수.
- 색: 격자·칸·막대·별·숫자는 흑백(칸 진하기는 회색 단계). **색은 상품 누끼 사진 스티커에서만.**
- 연간 보기: 가로 1~31일 × 세로 1~12월. 없는 날(2월 30일 등)은 칸을 지운다. 폰 세로 화면은 가로 1~12월 × 세로 1~31일.
- 레벨 표시는 소수점 한 자리. 레벨은 내려가지 않는다(역대 최고 기반).
- 판매처 기본값: `DM`, `스마트스토어`, `후르츠패밀리`.
- 포트폴리오 개수는 `kind = 'product'`이고 숨기지 않은 상품만 센다.
- AI 키는 Edge Function 비밀값(`ANTHROPIC_API_KEY`)에만 둔다. 모델 `claude-opus-5-5`.
- 노션 연결 없음. SNS, 그래프, 사이트 조회수·좋아요, 공개 스위치, 월 보기(원형 날짜)는 2단계 이후.
- 새 JS 파일은 `js/` 바로 아래에 둔다(`tools/bump.py`가 하위 폴더를 못 봄). 모듈끼리의 import는 기존처럼 `./파일.js?v=번호` 형식.
- `?local` 연습 모드에서도 전부 돌아가야 한다.

## Review Focus

1. **"3만원", "30,000원", "만오천원" 같은 금액 표현** → 원 단위 정수 30000 / 30000 / 15000. AI 결과든 가짜 파서든 `normalizeParse`를 거쳐 정수가 아니거나 음수면 `null`(확인 카드에 물음표). → Task 3 테스트.
2. **한국 시간 자정 직후(00:30 KST = 전날 15:30 UTC)에 기록** → 오늘 날짜는 KST 기준 새 날짜. → Task 1 테스트.
3. **윤년과 짧은 달** → 2028-02-29는 칸이 있고 2026-02-29, 4월 31일은 없음. → Task 1 테스트.
4. **판매·스티커가 가리키던 상품이 나중에 삭제됨** → 판매 기록은 남고(item_id는 null, title 유지), 스티커는 사진 대신 이름 태그로 그린다. → Task 4 테스트, Task 2 외래키 `on delete set null`.
5. **AI 호출 실패·시간 초과 또는 저장 버튼 두 번 누름** → 빈 확인 카드가 열려 직접 채울 수 있고, 저장은 한 번만 된다. → Task 7 확인 단계.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `js/log-dates.js` | KST 날짜, 달 길이, 날짜 더하기·빼기 (순수) |
| `js/log-level.js` | 수치별 레벨 곡선, 브랜드 레벨, 10단위 가이드 문구 (순수) |
| `js/log-stats.js` | 기록 → 날짜별 포트폴리오 개수, 매출 창, 최고 기록, 연속 기록, 칸 진하기, 막대, 스티커, 날짜별 레벨 (순수) |
| `js/log-parse-local.js` | AI 결과 정리(`normalizeParse`) + 연습 모드용 가짜 파서 (순수) |
| `js/log-api.js` | Supabase / localStorage 두 구현, 같은 메서드 |
| `js/log-calendar.js` | 연간 달력 DOM |
| `js/log-entry.js` | 평문 입력 + 확인 카드 DOM |
| `js/log.js` | 페이지 시작, 레벨 머리글, 최고 기록 카드, 날짜 상세, 설정, 축하 애니메이션 |
| `log.html`, `css/log.css` | 페이지 뼈대와 스타일 |
| `supabase/log.sql` | 1단계 DB 변경 기록 (적용한 SQL 그대로) |
| `supabase/functions/log-parse/index.ts` | Claude 호출 Edge Function |
| `tests/*.test.mjs` | 순수 모듈 테스트 |

수정: `admin.html`(기록 버튼), `.githooks/pre-commit`(`*.html` 전부 add), `.claude/launch.json`(이 작업 폴더를 띄우는 설정), `README.md`(로그 페이지 한 줄).

---

### Task 1: 날짜 도구 + 테스트 환경

**Files:**
- Create: `js/log-dates.js`, `tests/log-dates.test.mjs`
- Modify: `.claude/launch.json`, `.githooks/pre-commit`

**Interfaces:**
- Produces:
  - `kstToday(now: Date = new Date()): string` → `'YYYY-MM-DD'`
  - `daysInMonth(year: number, month1to12: number): number`
  - `addDays(date: string, n: number): string`
  - `diffDays(a: string, b: string): number` (b − a, 일 단위)
  - `yearDates(year: number): string[]` (그해 모든 날짜, 오름차순)

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/log-dates.test.mjs`, `node:test` + `node:assert/strict`)
  - `kstToday(new Date('2026-11-23T15:30:00Z'))` → `'2026-11-24'`
  - `kstToday(new Date('2026-11-23T14:59:00Z'))` → `'2026-11-23'`
  - `daysInMonth(2026, 2)` → 28, `daysInMonth(2028, 2)` → 29, `daysInMonth(2026, 4)` → 30, `daysInMonth(2026, 12)` → 31
  - `addDays('2026-12-31', 1)` → `'2027-01-01'`, `addDays('2026-03-01', -1)` → `'2026-02-28'`
  - `diffDays('2026-11-01', '2026-11-24')` → 23
  - `yearDates(2026).length` → 365, `yearDates(2028).length` → 366
- [ ] **Step 2: 실패 확인** — `node --test tests/` → `Cannot find module` 로 FAIL
- [ ] **Step 3: 구현** — 날짜 연산은 UTC 정오 기준 `Date`로 해서 서머타임·시간대 영향을 없앤다. `kstToday`는 `now.getTime() + 9h`의 UTC 연월일.
- [ ] **Step 4: 통과 확인** — `node --test tests/` → 전부 PASS
- [ ] **Step 5: 도구 정리**
  - `.claude/launch.json`의 `configurations`에 추가: `{"name": "brand-log", "runtimeExecutable": "python3", "runtimeArgs": ["-m", "http.server", "4388", "--bind", "127.0.0.1", "--directory", "<이 작업 폴더 절대경로>"], "port": 4388}`
  - `.githooks/pre-commit`의 `git add index.html admin.html js/*.js` → `git add *.html js/*.js`
- [ ] **Step 6: Commit** — `git add js/log-dates.js tests/log-dates.test.mjs .claude/launch.json .githooks/pre-commit && git commit -m "Add KST date helpers and test setup for brand log"`

---

### Task 2: 데이터베이스

**Files:**
- Create: `supabase/log.sql`

**Interfaces:**
- Produces (테이블, 모두 RLS: select/insert/update/delete 전부 `(select public.is_admin())`):
  - `log_days(date date pk, checked_in_at timestamptz default now())`
  - `log_entries(id uuid pk default gen_random_uuid(), date date not null references log_days on delete cascade, text text not null, created_at timestamptz default now())`
  - `log_work(id uuid pk, date date not null references log_days on delete cascade, title text not null, minutes int check (minutes is null or minutes between 0 and 1440), span_key text, created_at timestamptz default now())`
  - `log_sales(id uuid pk, date date not null references log_days on delete cascade, item_id uuid references catalog_items(id) on delete set null, title text not null default '', channel text, amount bigint check (amount is null or amount >= 0), qty int not null default 1 check (qty >= 1), gift boolean not null default false, created_at timestamptz default now())`
  - `log_options(key text pk, value jsonb not null)` — 초기 행: `('channels', '["DM","스마트스토어","후르츠패밀리"]')`, `('settings', '{}')`
  - `catalog_events(id bigint generated always as identity pk, item_id uuid not null, event text not null check (event in ('added','hidden','shown','deleted')), at timestamptz not null default now())` — 외래키 없음(삭제 후에도 기록 유지)
  - 트리거 `catalog_items_log_events` (after insert/update of hidden/delete, `kind = 'product'`인 행만): insert → `added`(insert 시 hidden이면 `added` 다음 `hidden`), hidden false→true → `hidden`, true→false → `shown`, delete → `deleted`. 함수는 `security definer`, `search_path = ''`.
  - 처음 한 번: 기존 상품마다 `(id, 'added', created_at)`, 숨긴 상품은 이어서 `(id, 'hidden', updated_at)`.
  - `public.log_save_day(payload jsonb) returns void`, `security invoker`, `search_path = ''`: `payload = {date, text, work:[{title, minutes, span_key}], sales:[{item_id, title, channel, amount, qty, gift, mark_sold}]}`. 한 트랜잭션으로 `log_days` upsert → `text`가 비어 있지 않으면 `log_entries` insert → work/sales insert → `mark_sold`이고 `item_id`가 있는 판매는 `catalog_items.sold = true, updated_at = now()`. `anon`에서 execute 회수, `authenticated`에 grant.

- [ ] **Step 1: `supabase/log.sql` 작성** — 위 내용 그대로, 기존 `schema.sql` 문체(맨 위 한 줄 설명 주석)로.
- [ ] **Step 2: 적용 전 사용자 확인** — 실제 데이터베이스 변경이므로 사용자에게 "이 SQL을 Supabase 프로젝트 `qnxamhvpgdycouwzrpyw`에 적용"을 묻고 예를 받은 뒤 진행.
- [ ] **Step 3: 적용** — Supabase MCP `apply_migration`(name `brand_log_phase1`, 파일 내용).
- [ ] **Step 4: 확인** — `list_tables`에 새 테이블 6개와 RLS 켜짐. `execute_sql`로 `select count(*) from catalog_events` = 기존 상품 수(현재 0일 수 있음). `get_advisors`(security)에서 새 테이블 관련 경고 없음.
- [ ] **Step 5: Commit** — `git add supabase/log.sql && git commit -m "Add brand log tables, catalog event trigger and atomic save function"`

---

### Task 3: AI 결과 정리 + 가짜 파서

**Files:**
- Create: `js/log-parse-local.js`, `tests/log-parse.test.mjs`

**Interfaces:**
- Produces:
  - 타입 `Draft = { date: string, rest: boolean, work: {title: string, minutes: number|null, span_key: string|null}[], sales: {item_id: string|null, title: string, channel: string|null, amount: number|null, qty: number, gift: boolean, mark_sold: boolean}[] }`
  - `normalizeParse(raw: unknown, ctx: {today: string, items: {id, name}[], channels: string[]}): Draft` — 모양이 틀린 필드는 버리거나 `null`로. `date`가 형식에 안 맞거나 `today`보다 미래면 `today`. `item_id`가 `ctx.items`에 없으면 `null`. `channel`이 `ctx.channels`에 없으면 그대로 두되 앞뒤 공백 제거. `minutes`·`amount`는 0 이상 정수만(아니면 `null`). `qty` 기본 1. `mark_sold` 기본은 `item_id !== null`.
  - `parseKoreanAmount(s: string): number|null` — `'3만원'`→30000, `'30,000원'`→30000, `'만오천원'`→15000, `'1.5만'`→15000, `'삼만원'`→30000, 숫자 없음→`null`
  - `fakeParse(text: string, ctx): Draft` — 연습 모드용. 문장을 마침표·줄바꿈으로 나누고, `팔|판매` 가 있는 문장은 판매(금액은 `parseKoreanAmount`, 상품은 `ctx.items` 이름이 문장에 포함되면 연결, 판매처는 별칭 표 `{후르츠: '후르츠패밀리', 스스: '스마트스토어', 스마트스토어: '스마트스토어', 디엠: 'DM', dm: 'DM'}`), `쉼|쉬었` 만 있으면 `rest: true`, 나머지는 작업(시간은 `(\d+(\.\d+)?)\s*시간`·`(\d+)\s*분`·`반나절`=240·`하루 종일`=480). `어제`가 있으면 `date = addDays(today, -1)`.

- [ ] **Step 1: 실패하는 테스트 작성** — Review Focus 1의 금액 5가지, 그리고:
  - `fakeParse('카드지갑 패턴 2시간 수정. 지폐홀더 후르츠에서 3만원에 팔림', ctx)` (ctx.items에 `{id:'a', name:'심볼 지폐홀더'}`, 이름 매칭은 공백으로 나눈 단어 하나라도 포함되면) → work 1개 `{title:'카드지갑 패턴 2시간 수정', minutes:120}`, sales 1개 `{item_id:'a', channel:'후르츠패밀리', amount:30000, mark_sold:true}`
  - `fakeParse('어제 쉼', ctx)` → `{date: 어제, rest: true, work: [], sales: []}`
  - `normalizeParse({date:'2099-01-01', work:[{title:'x', minutes:-5}], sales:[{item_id:'zzz', title:'y', amount:'3만'}]}, ctx)` → date=today, minutes=null, item_id=null, amount=null, mark_sold=false
  - `normalizeParse(null, ctx)` → 빈 Draft (`work: [], sales: [], rest: false, date: today`)
- [ ] **Step 2: 실패 확인** — `node --test tests/` → FAIL
- [ ] **Step 3: 구현** — `addDays`는 `./log-dates.js?v=1`에서 import.
- [ ] **Step 4: 통과 확인** — `node --test tests/` → PASS
- [ ] **Step 5: Commit** — `git add js/log-parse-local.js tests/log-parse.test.mjs && git commit -m "Add parse normalizer and practice-mode parser for brand log"`

---

### Task 4: 레벨과 통계

**Files:**
- Create: `js/log-level.js`, `js/log-stats.js`, `tests/log-level.test.mjs`, `tests/log-stats.test.mjs`

**Interfaces:**
- Consumes: Task 1의 날짜 함수.
- Produces (`js/log-level.js`):
  - `DEFAULT_METRICS = { works: {baseline: 10000, p: 2.6, weight: 30, source: '구찌 온라인 상품 수 규모 추정치'}, revenue: {baseline: 11e12, p: 7, weight: 40, source: '케링 연차보고서 구찌 연매출 약 76억 유로(2024)'}, social: {baseline: 50_000_000, p: 5.7, weight: 30, source: '구찌 인스타그램 팔로워 약 5천만'} }` — 스펙이 "만들 때 조사해서 넣고 화면에서 고친다"고 한 값의 초기값. revenue p=7은 스펙 표 값.
  - `metricLevel(value: number, m: {baseline, p}): number` = `value <= 0 ? 0 : Math.min(100, 100 * (value / m.baseline) ** (1 / m.p))`
  - `brandLevel(values: {works, revenue, social}, metrics = DEFAULT_METRICS): {total: number, parts: {works, revenue, social}}` — 가중 평균, 가중치 합으로 나눔.
  - `floor1(x: number): number` — 소수 첫째 자리 내림(표시·비교용; 반올림하면 7.95가 8.0으로 보였다가 안 오른 것처럼 보이므로 내림).
  - `TIERS: {min: number, max: number, name: string, who: string}[]` — 스펙 §5-3-1 표 12행의 "이런 브랜드"를 `name`, "누가 아는가"를 `who`로 그대로 복사(문구 수정 금지).
  - `tierOf(level: number, tiers = TIERS)`, `nextTier(level, tiers = TIERS)` (100이면 `null`)
- Produces (`js/log-stats.js`):
  - 입력 타입 `LogData = { days: {date}[], work: {date, title, minutes, span_key}[], sales: {date, item_id, title, channel, amount, qty, gift}[], events: {item_id, event, at}[], items: {id, name, thumb_url, image_url, kind}[] }`
  - `portfolioByDate(events, fromDate, toDate): Map<string, number>` — 이벤트를 KST 날짜로 바꿔 누적(added/shown +1, hidden/deleted −1, 0 아래로 내려가지 않음).
  - `addedOn(events, date): string[]` — 그 KST 날짜에 `added`된 item_id 목록.
  - `levelByDate(data: LogData, fromDate, toDate, metrics?): Map<string, {total, parts}>` — 날짜마다 works = 그날까지 포트폴리오 개수의 최댓값, revenue = 그날까지 "끝나는 날 기준 365일 창 매출 합"의 최댓값(선물 제외, `amount × qty`, amount null은 0), social = 0.
  - `records(data, today): { portfolio, revenue28, revenueMonth, bestDay, workWeekMinutes, streak }` — 각 항목 `{value, best, brokeOn: string|null}` (`brokeOn` = 역대 최고를 마지막으로 경신한 날). `streak.value` = 오늘(없으면 어제)에서 거꾸로 `log_days`가 끊기지 않고 이어진 날 수.
  - `cellLevel(date, data): 'none'|'rest'|1|2|3` — `log_days`에 없으면 `'none'`, 있고 작업 분 합 0이면 `'rest'`, 1–59 → 1, 60–179 → 2, 180+ → 3.
  - `spans(work): {span_key, title, from, to}[]` — 같은 `span_key`가 연속된 날(빈 날 0일 허용) 2일 이상인 것만.
  - `stickers(data, levels: Map, from, to): {date, kind: 'product'|'sale'|'star'|'tier', item_id?, img?, label?, seed: number}[]` — 그날 `added` 이벤트의 상품 → `product`(img = thumb_url || image_url, 상품이 없으면 img 없이 label = '상품'), 그날 판매 → `sale`(상품이 없으면 img 없이 label = title, 금액 태그 `₩30,000`), `floor1(레벨)`이 전날보다 오른 날 → `star`(label `Lv 7.4`), 단계 `min`을 넘은 날 → `tier`(star 대신). `seed`는 `date + id` 문자열 해시(기울기 결정용).

- [ ] **Step 1: 레벨 테스트 작성** — 스펙 §5-3 매출 표 재현: revenue 30000→6.0±0.1, 1e8→19.0±0.1, 1e10→36.8±0.2, 1e12→71.0±0.2, 11e12→100. works 42→12.1±0.3. `floor1(7.39)`=7.3. `tierOf(9.9).min`=1, `tierOf(10).min`=10, `nextTier(100)`=null. `TIERS.length`=12.
- [ ] **Step 2: 통계 테스트 작성** — 
  - 이벤트 `[a added 11-01, b added 11-02, a hidden 11-03]` → 11-02: 2, 11-03: 1
  - 판매 2025-12-01 ₩1,000,000 + 2026-11-20 ₩30,000 → 2026-11-24의 revenue 값은 1,030,000; 2026-12-02에는 창에서 빠져도 levelByDate의 revenue 세부 레벨이 11-24보다 낮지 않음(레벨은 내려가지 않음)
  - 선물 판매는 매출 0
  - `cellLevel`: 기록 없음 `'none'`, "쉼" `'rest'`, 90분 → 2
  - streak: 11-22, 11-23, 11-24 기록 + today 11-24 → 3; today 11-25이고 11-25 기록 없음 → 3; 11-21 빠지고 11-20 있음 → 그래도 3
  - spans: 같은 span_key 11-01~11-03 → `{from:'2026-11-01', to:'2026-11-03'}`, 하루짜리는 제외
  - stickers: 판매의 item_id가 items에 없으면 `{kind:'sale', img: undefined, label: title}` (Review Focus 4)
  - `addedOn`: `at = '2026-11-23T15:30:00Z'`인 added 이벤트는 `'2026-11-24'`에 잡힘 (KST)
- [ ] **Step 3: 실패 확인** — `node --test tests/` → FAIL
- [ ] **Step 4: 구현** — `js/log-level.js`, `js/log-stats.js`. 매출 365일 창은 날짜별 매출 배열의 누적합 차이로 계산(연 단위 반복이 날짜 수 × 365가 되지 않게).
- [ ] **Step 5: 통과 확인** — `node --test tests/` → PASS
- [ ] **Step 6: Commit** — `git add js/log-level.js js/log-stats.js tests/log-level.test.mjs tests/log-stats.test.mjs && git commit -m "Add brand level curve, tiers, records and calendar stats"`

---

### Task 5: 데이터 계층

**Files:**
- Create: `js/log-api.js`

**Interfaces:**
- Consumes: `common.js`의 `SUPABASE_URL`, `SUPABASE_KEY`, `TABLE`, `LOCAL`, `loadLocal`; Task 3의 `normalizeParse`, `fakeParse`.
- Produces: `async function createLogApi(): LogApi`, 연습 모드면 localStorage(`brand-log-local-v1`) 구현, 아니면 Supabase 구현. 메서드:
  - `user(): Promise<object|null>`, `isAdmin(): Promise<boolean>` (admin.js와 같은 방식: `admins` 테이블 `maybeSingle`)
  - `load(): Promise<LogData & {channels: string[], settings: object}>` — 판매·작업·날짜는 전부(몇 년치도 하루 몇 줄이라 가벼움), items는 `catalog_items`에서 `id,name,thumb_url,image_url,kind`
  - `entries(date): Promise<{id, text, created_at}[]>`
  - `parse(text, ctx): Promise<Draft>` — Supabase: `sb.functions.invoke('log-parse', {body: {text, today: ctx.today, items: ctx.items.map(({id,name})=>({id,name})), channels: ctx.channels, openSpans}})` 후 `normalizeParse`; `openSpans` = 최근 7일 work 중 span_key 있는 것 `{span_key, title, last_date}`. 15초 넘으면 `AbortController`로 끊고 throw. 연습 모드: `fakeParse`.
  - `save(draft & {text}): Promise<void>` — Supabase: `sb.rpc('log_save_day', {payload})`. 연습 모드: 같은 의미로 localStorage 갱신(+ 연습 상품의 sold 표시는 `LOCAL_KEY` 데이터에 반영).
  - `updateWork(id, patch)`, `deleteWork(id)`, `updateSale(id, patch)`, `deleteSale(id)`, `saveSettings(settings)`
  - 연습 모드의 events는 연습 상품마다 오늘 기준 과거 날짜에 흩어진 `added` 이벤트를 만들어 둔다(달력에 스티커가 보이게).

- [ ] **Step 1: 구현** — Supabase 클라이언트는 admin.js와 같은 CDN import(`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm`). 같은 출처라 admin.html의 로그인 세션을 그대로 쓴다.
- [ ] **Step 2: 확인** — 연습 모드 브라우저 콘솔에서 `const api = await (await import('./js/log-api.js')).createLogApi(); await api.save({date:'2026-11-24', text:'t', rest:false, work:[{title:'x',minutes:30,span_key:null}], sales:[]}); (await api.load()).work.length` → 1 이상. (화면은 Task 6~8에서.)
- [ ] **Step 3: Commit** — `git add js/log-api.js && git commit -m "Add brand log data layer with Supabase and practice-mode backends"`

---

### Task 6: 페이지 뼈대 + 연간 달력

**Files:**
- Create: `log.html`, `css/log.css`, `js/log-calendar.js`, `js/log.js`
- Modify: `admin.html` (헤더 `#view` 앞에 `<a id="log-link" href="./log.html">기록 ↗</a>`; `?local`이면 링크에도 `?local` 유지 — admin.js에서 한 줄)

**Interfaces:**
- Consumes: Task 4 `cellLevel`, `spans`, `stickers`, `levelByDate`; Task 5 `createLogApi`.
- Produces: `renderYear(root: HTMLElement, year: number, data: LogData, levels: Map, opts: {vertical: boolean, today: string, onPick(date: string): void}): void`, 그리고 `highlightDay(root, date): Promise<void>`(Task 8 축하에서 씀: 칸 채우기 애니메이션이 끝나면 resolve).

- [ ] **Step 1: `log.html`** — admin.html과 같은 `<head>`(폰트, `css/style.css`) + `css/log.css`, `<meta name="robots" content="noindex">`. 영역: `#gate`(로그인 안 됐으면 "관리자 로그인이 필요합니다" + `admin.html` 링크), `#app` 안에 `header.lv`(레벨), `section#entry`, `section#records`, `section#year`, `dialog#day`, `dialog#settings`.
- [ ] **Step 2: `js/log.js` 시작 부분** — `createLogApi()` → 연습 모드가 아니면 `user()`·`isAdmin()` 확인, 아니면 `#gate`. 통과하면 `load()` 후 `renderYear`. 년도 이동 버튼(◀ 2026 ▶).
- [ ] **Step 3: `renderYear`** — CSS grid. 가로: 열 = 일(1~31) + 머리 열, 행 = 월 + 머리 행. `vertical`이면 행과 열을 바꾼다. `matchMedia('(max-width: 640px) and (orientation: portrait)')` 변화 때 다시 그림. 칸 상태는 `data-level`(none/rest/1/2/3)로 CSS가 회색 단계와 테두리를 그림. 없는 날은 칸을 만들지 않음. 주말은 아주 옅은 배경. 오늘은 얇은 검은 테두리. 미래는 비어 보임.
  - 막대: `spans` 결과마다 같은 행(세로면 같은 열) 안에서 시작~끝 칸을 덮는 절대 위치 막대(검정, 칸 높이의 30%). 달을 넘으면 달마다 나눠 그린다.
  - 스티커: 칸 위 겹침 레이어. `product`·`sale`은 누끼 사진(`img`)을 칸보다 약간 크게, `seed`로 −8°~+8° 회전, 같은 칸에 여러 개면 조금씩 어긋나게. 사진이 없으면 흑백 이름 태그. `sale`은 금액 태그. `star`는 뾰족한 별 SVG(흑백, 테두리만 + 레벨 글자), `tier`는 같은 별을 2배 크기로 칠해서.
  - 넓은 화면(≥1200px)에서는 칸 안에 그날 첫 작업 제목을 한 줄로 아주 작게.
  - 칸 클릭 → `onPick(date)`.
- [ ] **Step 4: 확인** — `preview_start {name: "brand-log"}` → `/log.html?local`. 확인: 12행 × 31열, 2월은 28칸, 연습 상품 스티커(컬러)가 보이고 나머지는 흑백, 콘솔 오류 없음. `resize_window` mobile(375×812) → 세로 형식(12열 × 31행), 가로 스크롤 없음. 스크린숏 두 장.
- [ ] **Step 5: Commit** — `git add log.html css/log.css js/log-calendar.js js/log.js admin.html js/admin.js && git commit -m "Add brand log page with yearly fill calendar, bars and stickers"`

---

### Task 7: 평문 입력과 확인 카드

**Files:**
- Create: `js/log-entry.js`
- Modify: `js/log.js`, `css/log.css`

**Interfaces:**
- Consumes: Task 5 `parse`, `save`, `load`; Task 4 `addedOn`(그날 추가된 상품 수 확인용).
- Produces: `mountEntry(root: HTMLElement, ctx: {api, getData(): LogData, today: string, onSaved(draft: Draft): void}): void`

- [ ] **Step 1: 입력 영역** — 날짜 표시(`11.24 화`), 큰 textarea(placeholder: `오늘 뭐 했어? 그냥 쓰면 돼. 예: 카드지갑 패턴 2시간 수정하고 지폐홀더 후르츠에서 3만원에 팔림`), `[기록하기]`. 누르면 버튼 잠그고 "읽는 중…".
- [ ] **Step 2: 확인 카드** — `parse` 결과 Draft를 줄 목록으로:
  - 날짜 줄(날짜 선택, 기본은 Draft.date)
  - 작업 줄: 제목 입력 + 시간 선택(30분·1시간·2시간·반나절·하루 종일·직접) — `minutes`가 null이면 `?` 표시
  - 판매 줄: 상품 선택(사이트 상품 목록 + "목록에 없음"), 판매처 선택(`channels`), 금액, 수량, 선물, "사이트에서 SOLD로 표시"(상품이 있을 때만, 기본 켬)
  - 자동 확인 줄: `addedOn(events, draft.date).length`가 1 이상이면 `상품 N개 추가됨 (자동 확인 ✓)` — AI 결과와 무관하게 DB 기준
  - `rest`면 "쉰 날로 기록" 한 줄
  - 줄마다 × 삭제, `+ 작업`, `+ 판매`
  - `[고치기]`(입력으로 돌아감, 원문 유지) / `[저장 ✓]`
- [ ] **Step 3: 실패 처리** — `parse`가 throw하거나 15초를 넘으면 "AI가 응답하지 않았어. 직접 채워 줘" 문구와 함께 빈 Draft(오늘 날짜, 작업 한 줄 빈칸)로 확인 카드를 연다.
- [ ] **Step 4: 저장** — `[저장]` 누르면 즉시 잠금(두 번 저장 방지), `save({...draft, text})`. 성공하면 입력 비우고 `onSaved(draft)`. 실패하면 잠금 풀고 카드 유지, 오류 한 줄.
- [ ] **Step 5: 확인 (연습 모드)** — `/log.html?local`에서
  1. `카드지갑 패턴 2시간 수정. 지폐홀더 후르츠에서 3만원에 팔림`(연습 상품 이름으로 바꿔서) → 카드에 작업 120분, 판매 ₩30,000 후르츠패밀리, 저장 후 오늘 칸이 채워짐
  2. `어제 쉼` → 날짜가 어제, 저장 후 어제 칸이 테두리만
  3. 개발자 도구에서 `api.parse`를 강제로 reject하게 바꿔 실행 → 빈 카드가 열림
  4. 저장 버튼 빠르게 두 번 클릭 → 기록 한 번만 늘어남
  각 결과를 `read_page`로 확인하고 1번 스크린숏.
- [ ] **Step 6: Commit** — `git add js/log-entry.js js/log.js css/log.css && git commit -m "Add free-text entry with AI parse and editable confirm card"`

---

### Task 8: 레벨 머리글, 최고 기록, 날짜 상세, 설정, 축하

**Files:**
- Modify: `js/log.js`, `css/log.css`

**Interfaces:**
- Consumes: Task 4 전부, Task 6 `highlightDay`, Task 5 `entries`, `update*`, `delete*`, `saveSettings`.

- [ ] **Step 1: 레벨 머리글** — `브랜드 Lv 7.3`(큰 숫자, `floor1`), 아래에 세부 레벨 3줄(작품·매출·소셜과 원래 값), 현재 단계 `name`·`who`, 다음 단계까지 `Lv 10 · 취미를 넘어선 1인 브랜드` 한 줄. 위쪽에 올해 요약: 기록한 날 수, 올해 오른 레벨(1/1 대비), 붙은 스티커 수.
- [ ] **Step 2: 최고 기록 카드** — `records()` 6개를 카드로: 포트폴리오, 28일 매출, 이번 달 매출, 하루 최고 매출, 이번 주 작업 시간, 연속 기록. 값이 역대 최고와 같고 `brokeOn`이 오늘이면 `★ 경신`.
- [ ] **Step 3: 날짜 상세(`dialog#day`)** — 칸 클릭 시: 그날 원문들(`entries`), 작업·판매 목록(시간·금액 바로 고치기, 삭제), 그날 스티커, "이 날에 더 쓰기"(입력 영역의 날짜를 그날로 바꾸고 닫기).
- [ ] **Step 4: 설정(`dialog#settings`)** — 수치 3개의 가중치·기준값·p와 출처, 12단계 문구(name, who)를 고치는 칸, 판매처 목록(추가·삭제·순서). `settings`에 저장하고 `brandLevel`·`TIERS` 대신 설정값을 쓴다. "기본값으로" 버튼.
- [ ] **Step 5: 축하** — `onSaved` 뒤: 저장 전 레벨(`floor1`)을 기억 → `load()` 다시 → 달력 다시 그림 → `highlightDay(date)`(칸이 아래에서 채워지는 0.4초 애니메이션) → 새 스티커가 0.25초 간격으로 톡 붙음(커졌다 줄어듦) → 레벨 숫자가 옛 값에서 새 값까지 0.1씩 올라감 + `▲`. 단계가 바뀌었으면 화면 가운데 큰 별과 새 단계 `name` 한 문장 2초. `prefers-reduced-motion`이면 애니메이션 없이 바로 결과.
- [ ] **Step 6: 확인 (연습 모드)** — 판매 ₩30,000 저장 → 레벨이 0.1 이상 오르고 별 스티커가 오늘 칸에 붙는지, 기록 카드에 `★ 경신`, 칸 클릭 시 상세가 열리고 금액 수정이 반영되는지, 설정에서 매출 가중치를 0으로 바꾸면 레벨이 바뀌는지. PC·폰 스크린숏 각 한 장.
- [ ] **Step 7: Commit** — `git add js/log.js css/log.css && git commit -m "Add level header, records, day detail, settings and save celebration"`

---

### Task 9: Edge Function (Claude)

**Files:**
- Create: `supabase/functions/log-parse/index.ts`

**Interfaces:**
- Consumes: 요청 본문 `{text, today, items: {id,name}[], channels: string[], openSpans: {span_key,title,last_date}[]}` (Task 5).
- Produces: 응답 `{date, rest, work: [{title, minutes, span_key}], sales: [{item_id, title, channel, amount, qty, gift}]}` — 클라이언트가 `normalizeParse`로 다시 검사하므로 여기서는 모양만 맞춘다.

- [ ] **Step 1: 함수 작성**
  - `Deno.serve`. CORS: `OPTIONS` 응답 + `Access-Control-Allow-Origin: https://sply14.github.io`(로컬 확인용으로 `http://127.0.0.1:4388`, `http://localhost:4388`도 허용), `Allow-Headers: authorization, x-client-info, apikey, content-type`.
  - 인증: `Authorization` 헤더로 `createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {global: {headers: {Authorization}}})` → admin.js와 같은 방식으로 `from('admins').select('user_id').maybeSingle()`이 행을 돌려주지 않으면 403.
  - `text` 길이 0 또는 4000자 초과면 400.
  - Claude 호출: `import Anthropic from "npm:@anthropic-ai/sdk"`, `client.beta.messages.create({ model: "claude-opus-5-5", max_tokens: 4000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", output_config: { effort: "medium", format: { type: "json_schema", schema } }, system, messages: [{role: "user", content: JSON.stringify({today, text, items, channels, openSpans})}] })`. `stop_reason`이 `refusal`이면 422, 아니면 첫 text 블록을 `JSON.parse`해서 반환.
  - `schema`: 위 응답 모양(`additionalProperties: false`, 모든 필드 required, `minutes`·`amount`·`item_id`·`channel`·`span_key`는 `["integer"|"string", "null"]`).
  - `system`(한국어, 짧게): 가죽 소품 브랜드 운영자의 하루 기록을 작업과 판매로 나눈다 / 금액은 원 단위 정수("3만원"=30000) / 시간은 분 단위, 말하지 않았으면 null / 판매처는 `channels` 중 가장 가까운 것, 없으면 null / 판매 상품은 `items` 이름과 뜻이 같으면 그 id, 아니면 null / "어제", "그저께"는 `today` 기준 날짜로, 언급 없으면 today / 쉬었다는 내용뿐이면 rest true / 이어지는 작업이면 `openSpans`의 span_key를 재사용, 새 작업이 여러 날 이어질 것 같으면 짧은 영문 소문자 key, 아니면 null / 문장에 없는 것을 지어내지 않는다.
- [ ] **Step 2: 배포 전 사용자 확인** — (1) 사용자가 Supabase 대시보드 → Edge Functions → Secrets에 `ANTHROPIC_API_KEY`를 직접 넣는다(키는 채팅으로 받지 않는다). (2) 배포해도 되는지 예를 받는다.
- [ ] **Step 3: 배포** — Supabase MCP `deploy_edge_function`(name `log-parse`, `verify_jwt: true`).
- [ ] **Step 4: 확인** — 사용자가 미리보기 창에서 `admin.html`로 로그인한 뒤 `log.html`(연습 모드 아님)에 `오늘 카드지갑 패턴 두 시간 수정하고 3만원짜리 하나 후르츠에서 팔림` → 확인 카드에 120분, ₩30,000, 후르츠패밀리. 로그아웃 상태에서 함수를 직접 부르면 401/403 (`read_network_requests`로 확인). 확인 카드에서 저장은 하지 않고 [고치기]로 닫는다(실제 기록이 남지 않게). 사용자가 실제로 첫 기록을 남기길 원하면 그때 저장.
- [ ] **Step 5: Commit** — `git add supabase/functions/log-parse/index.ts && git commit -m "Add log-parse edge function calling Claude with structured output"`

---

### Task 10: 마무리

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README** — 파일 목록에 `log.html — 브랜드 로그 (관리자 전용, 평문 기록·연간 달력·브랜드 레벨)`와 `supabase/log.sql`, `supabase/functions/log-parse` 한 줄씩. "테스트: `node --test tests/`" 한 줄.
- [ ] **Step 2: 전체 확인** — `node --test tests/` 전부 PASS. 미리보기에서 `index.html`(카탈로그)과 `admin.html?local`이 전처럼 동작(콘솔 오류 없음, 기록 링크 보임). `log.html?local` PC·폰.
- [ ] **Step 3: Commit** — `git add README.md && git commit -m "Document brand log"`

---

## 2단계로 넘긴 것 (이 계획에 없음)

추세 그래프(일·주·월, 28일 이동평균), 사이트 조회수·좋아요(`item_stats`), 월 보기(원형 날짜), SNS 숫자(`log_social`), 공개 스위치(`log_public`).
