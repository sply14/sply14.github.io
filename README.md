# Catalog

모더니즘 가구 카탈로그 형식의 포트폴리오 겸 판매 사이트. 빌드 과정 없는 정적 사이트 + Supabase.

- `index.html` — 카탈로그 (사진만 보이고, 마우스를 올리면 가격, 클릭하면 상세 팝업)
- `admin.html` — 관리자 편집기 (로그인 후 드래그로 배치·크기 조절, 상품 정보 수정)
- `js/common.js` — Supabase 주소와 공개 키, 그리드 칸 수 설정
- `supabase/schema.sql` — 데이터베이스 구조 기록

## 로컬에서 보기

```bash
python3 -m http.server 4388
```

- 카탈로그: http://localhost:4388/
- 관리자: http://localhost:4388/admin.html
- 연습 모드(실제 데이터에 영향 없음): 주소 끝에 `?local` — 예: http://localhost:4388/admin.html?local

## 배포

GitHub Pages에서 저장소 루트를 그대로 배포하면 됩니다 (Settings → Pages → Branch: main / root).

코드를 고친 뒤에는 푸시 전에 아래 명령을 실행합니다. CSS/JS 주소 뒤의 버전 번호를 바꿔서, 방문자 브라우저가 옛 파일을 캐시에서 꺼내 쓰지 않게 합니다.

```bash
python3 tools/bump.py
```
