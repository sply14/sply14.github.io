// Supabase 연결 정보. publishable 키는 브라우저에 공개되어도 되는 키입니다 (쓰기는 RLS로 관리자만 가능).
export const SUPABASE_URL = 'https://qnxamhvpgdycouwzrpyw.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_X1eUIDtYbmq4SJ4VS-OMcw_G0Sgofzu';

export const TABLE = 'catalog_items';
export const BUCKET = 'catalog';
export const COLS = 10;        // PC 화면 가로 칸 수
export const MOBILE_COLS = 5;  // 모바일 화면 가로 칸 수

// 로컬 연습 모드: http://localhost:.../admin.html?local  — Supabase를 건드리지 않고 브라우저 안에서만 동작
export const LOCAL =
  ['localhost', '127.0.0.1'].includes(location.hostname) &&
  new URLSearchParams(location.search).has('local');
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
  const { demoItems } = await import('./demo.js');
  const seed = demoItems();
  localStorage.setItem(LOCAL_KEY, JSON.stringify(seed));
  return seed;
}

export async function fetchItems() {
  if (LOCAL) return loadLocal();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=*&order=y.asc,x.asc`, {
    headers: { apikey: SUPABASE_KEY },
  });
  if (!res.ok) throw new Error(`catalog fetch failed: ${res.status}`);
  return res.json();
}
