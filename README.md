# Catalog

모더니즘 가구 카탈로그 형식의 포트폴리오 겸 판매 사이트. 빌드 과정 없는 정적 사이트 + Supabase.

- `index.html` — 카탈로그 (사진만 보이고, 마우스를 올리면 가격, 클릭하면 상세 팝업)
- `admin.html` — 관리자 편집기 (로그인 후 드래그로 배치·크기 조절, 상품 정보 수정)
- `js/common.js` — Supabase 주소와 공개 키, 그리드 칸 수 설정
- `log.html` — 브랜드 로그 (관리자 전용: 하루를 평문으로 쓰면 AI가 작업·판매로 나눠 기록, 연간 달력, 브랜드 레벨 0~100)
- `supabase/schema.sql` — 데이터베이스 구조 기록
- `supabase/log.sql` — 브랜드 로그용 데이터베이스 구조 기록
- `supabase/functions/log-parse` — 평문을 Claude로 나누는 서버 함수 (비밀값 `ANTHROPIC_API_KEY` 필요)
- 테스트: `node --test tests/` (날짜·레벨·통계·문장 정리 계산)

## 로컬에서 보기

```bash
python3 -m http.server 4388
```

- 카탈로그: http://localhost:4388/
- 관리자: http://localhost:4388/admin.html
- 연습 모드(실제 데이터에 영향 없음): 주소 끝에 `?local` — 예: http://localhost:4388/admin.html?local
  - 브랜드 로그도 같음: http://localhost:4388/log.html?local (AI 대신 간단한 규칙으로 나눔)
  - 배포된 사이트에서도 똑같이 쓸 수 있습니다. 연습 내용은 그 브라우저에만 저장됩니다.

## 배포

GitHub Pages에서 저장소 루트를 그대로 배포하면 됩니다 (Settings → Pages → Branch: main / root).

CSS/JS 주소 뒤의 버전 번호(`?v=...`)는 커밋할 때 자동으로 바뀝니다(`.githooks/pre-commit` → `tools/bump.py`). 방문자 브라우저가 옛 파일을 캐시에서 꺼내 쓰지 않게 하기 위한 것입니다. 저장소를 새로 내려받은 컴퓨터에서는 아래 명령을 한 번 실행해 이 장치를 켭니다.

```bash
git config core.hooksPath .githooks
```
