// Supabase 연결 정보. publishable 키는 브라우저에 공개되어도 되는 키입니다 (쓰기는 RLS로 관리자만 가능).
export const SUPABASE_URL = 'https://qnxamhvpgdycouwzrpyw.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_X1eUIDtYbmq4SJ4VS-OMcw_G0Sgofzu';

export const TABLE = 'catalog_items';
export const BUCKET = 'catalog';
export const COLS = 10;        // PC 화면 가로 칸 수
export const MOBILE_COLS = 5;  // 모바일 화면 가로 칸 수

// 연습 모드: 주소 끝에 ?local (예: admin.html?local) — Supabase를 건드리지 않고 이 브라우저 안에서만 동작
// 배포된 사이트에서도 켜짐: 데이터가 이 브라우저에만 저장되므로 실제 사이트에는 영향이 없음
export const LOCAL = new URLSearchParams(location.search).has('local');
export const LOCAL_KEY = 'catalog-local-items-v2';

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

export function formatPrice(item) {
  if (item.sold) return 'SOLD';
  if (item.price == null || item.price === '') return '';
  return '₩ ' + Number(item.price).toLocaleString('ko-KR');
}

export function safeUrl(u) {
  if (!u) return null;
  try {
    const p = new URL(u, location.href);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(p.protocol) ? p.href : null;
  } catch {
    return null;
  }
}

export async function loadLocal() {
  const raw = localStorage.getItem(LOCAL_KEY);
  if (raw) return JSON.parse(raw);
  const { demoItems } = await import('./demo.js?v=1795446898');
  const seed = demoItems();
  localStorage.setItem(LOCAL_KEY, JSON.stringify(seed));
  return seed;
}

export async function fetchItems() {
  if (LOCAL) return (await loadLocal()).filter((i) => !i.hidden);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=*&order=y.asc,x.asc`, {
    headers: { apikey: SUPABASE_KEY },
  });
  if (!res.ok) throw new Error(`catalog fetch failed: ${res.status}`);
  return res.json();
}

// 텍스트 블록에서 고를 수 있는 폰트
export const FONTS = {
  grotesk: 'Grotesk — Helvetica',
  condensed: 'Condensed — Barlow',
  didone: 'Didone — Bodoni',
  serif: 'Serif — Instrument',
  mono: 'Mono — IBM Plex',
};

// 텍스트 블록이 칸 밖으로 넘치면 글자 크기를 줄여 칸 안에 맞춤 (기기마다 폰트 폭이 달라도 넘치지 않게)
// 늘이기·기울이기로 커진 크기까지 계산에 넣음. 칸보다 작은 글자는 그대로 둠
export function fitText(box) {
  const t = box.querySelector('.t');
  if (!t) return;
  box.style.setProperty('--auto', 1);
  const cs = getComputedStyle(box);
  const availW = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = box.clientHeight * 0.96;
  const sx = Number(cs.getPropertyValue('--sx')) || 1;
  const sy = Number(cs.getPropertyValue('--sy')) || 1;
  const sk = Math.abs(Number(cs.getPropertyValue('--sk')) || 0);
  const h = t.scrollHeight * sy;
  const w = t.scrollWidth * sx + Math.tan((sk * Math.PI) / 180) * h;
  if (!w || !h || availW <= 0 || availH <= 0) return;
  const k = Math.min(1, availW / w, availH / h);
  if (k < 0.999) box.style.setProperty('--auto', k.toFixed(4));
}

// 화면 크기가 바뀌거나 웹폰트가 늦게 도착해도 다시 맞춤
export function fitAll(root, selector) {
  const run = () => root.querySelectorAll(selector).forEach(fitText);
  run();
  document.fonts?.ready.then(run);
  let raf = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(run);
  }).observe(root);
  return run;
}

// 상품 사진의 확대·위치, 텍스트의 폰트·굵기·기울임 등을 요소에 적용 (카탈로그와 관리자 화면 공용)
export function look(el, it) {
  const st = it.style || {};
  el.style.setProperty('--fit', Number(it.scale) || 1);
  if (it.kind === 'text') {
    el.dataset.font = FONTS[st.font] ? st.font : 'grotesk';
    el.style.setProperty('--fw', st.bold === false ? 400 : 700);
    el.style.setProperty('--fi', st.italic ? 'italic' : 'normal');
    el.dataset.align = ['left', 'right'].includes(st.align) ? st.align : 'center';
    el.toggleAttribute('data-outline', !!st.outline);
    if (/^#[0-9a-f]{6}$/i.test(st.color || '')) el.style.setProperty('--tc', st.color);
    else el.style.removeProperty('--tc');
    el.style.setProperty('--sx', Number(st.sx) || 1);
    el.style.setProperty('--sy', Number(st.sy) || 1);
    el.style.setProperty('--sk', Number(st.skew) || 0);
  } else {
    el.style.setProperty('--ox', `${(Number(st.ox) || 0) * 100}%`);
    el.style.setProperty('--oy', `${(Number(st.oy) || 0) * 100}%`);
  }
}
