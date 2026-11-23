// 평문 기록을 작업·판매로 나눈 결과(Draft)를 정리하고, 연습 모드(?local)에서는 AI 대신 간단한 규칙으로 나눕니다.
// Draft = { date, rest, work: [{title, minutes, span_key}], sales: [{item_id, title, channel, amount, qty, gift, mark_sold}] }
import { addDays } from './log-dates.js?v=1795446372';

const isDateKey = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const isCount = (n, max = Infinity) => Number.isInteger(n) && n >= 0 && n <= max;
const str = (s) => (typeof s === 'string' ? s.trim() : '');

// AI나 가짜 파서가 돌려준 값을 믿지 않고 모양을 맞춘다. 틀린 값은 추측하지 않고 비운다(null).
export function normalizeParse(raw, ctx) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const ids = new Map(ctx.items.map((i) => [i.id, i]));
  const date = isDateKey(o.date) && o.date <= ctx.today ? o.date : ctx.today;

  const work = (Array.isArray(o.work) ? o.work : [])
    .filter((w) => w && str(w.title))
    .map((w) => ({
      title: str(w.title),
      minutes: isCount(w.minutes, 1440) ? w.minutes : null,
      span_key: str(w.span_key) || null,
    }));

  const sales = (Array.isArray(o.sales) ? o.sales : [])
    .filter((s) => s && typeof s === 'object')
    .map((s) => {
      const item = ids.get(s.item_id) || null;
      const item_id = item ? item.id : null;
      return {
        item_id,
        title: str(s.title) || (item ? item.name : ''),
        channel: str(s.channel) || null,
        amount: isCount(s.amount) ? s.amount : null,
        qty: Number.isInteger(s.qty) && s.qty >= 1 ? s.qty : 1,
        gift: s.gift === true,
        mark_sold: item_id !== null && s.mark_sold !== false,
      };
    });

  return { date, rest: o.rest === true, work, sales };
}

/* ───────── 금액 ───────── */

const DIGIT = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
const SMALL = { 십: 10, 백: 100, 천: 1000 };

// '삼만오천' → 35000
function hangulNumber(s) {
  let total = 0, group = 0, digit = 0;
  for (const ch of s) {
    if (ch in DIGIT) digit = DIGIT[ch];
    else if (ch in SMALL) { group += (digit || 1) * SMALL[ch]; digit = 0; }
    else if (ch === '만') { total += (group + digit || 1) * 10000; group = 0; digit = 0; }
  }
  return total + group + digit;
}

// '3만원', '30,000원', '만오천원', '1.5만', '삼만원' → 원 단위 정수. 금액이 없으면 null.
export function parseKoreanAmount(s) {
  const text = String(s);
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(만|천)?\s*(?:(\d+)\s*천)?\s*(원)?/g)) {
    const n = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    const unit = m[2] === '만' ? 10000 : m[2] === '천' ? 1000 : 1;
    const extra = m[3] ? Number(m[3]) * 1000 : 0;
    if (m[2] || m[4] || n >= 1000) return Math.round(n * unit + extra);
  }
  const h = text.match(/[일이삼사오육칠팔구십백천]*만[일이삼사오육칠팔구십백천]*|[일이삼사오육칠팔구십백천만]+(?=\s*원)/);
  return h ? hangulNumber(h[0]) : null;
}

/* ───────── 연습 모드용 가짜 파서 ───────── */

const CHANNEL_ALIASES = [
  ['스마트스토어', '스마트스토어'], ['후르츠', '후르츠패밀리'], ['스스', '스마트스토어'], ['디엠', 'DM'], ['dm', 'DM'],
];

function minutesOf(s) {
  if (/하루\s*종일/.test(s)) return 480;
  if (/반나절/.test(s)) return 240;
  const h = s.match(/(\d+(?:\.\d+)?)\s*시간/);
  const m = s.match(/(\d+)\s*분/);
  if (!h && !m) return null;
  return Math.round((h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0));
}

function itemOf(s, items) {
  return items.find((i) => i.name.split(/\s+/).some((w) => w.length >= 2 && s.includes(w))) || null;
}

function channelOf(s, channels) {
  const low = s.toLowerCase();
  const hit = CHANNEL_ALIASES.find(([k]) => low.includes(k));
  if (hit) return hit[1];
  return channels.find((c) => low.includes(c.toLowerCase())) || null;
}

export function fakeParse(text, ctx) {
  const date = /그저께|그제/.test(text) ? addDays(ctx.today, -2) : /어제/.test(text) ? addDays(ctx.today, -1) : ctx.today;
  const sentences = text
    .split(/[.\n!?]+/)
    .map((s) => s.replace(/^\s*(어제|오늘|그저께|그제)\s*/, '').trim())
    .filter(Boolean);

  const work = [], sales = [];
  let restOnly = sentences.length > 0;
  for (const s of sentences) {
    if (/쉼|쉬었/.test(s) && s.length <= 12) continue;
    restOnly = false;
    if (/팔|판매/.test(s)) {
      const item = itemOf(s, ctx.items);
      sales.push({ item_id: item?.id ?? null, title: item?.name ?? s, channel: channelOf(s, ctx.channels), amount: parseKoreanAmount(s), qty: 1, gift: false });
    } else {
      work.push({ title: s, minutes: minutesOf(s), span_key: null });
    }
  }
  return normalizeParse({ date, rest: restOnly, work, sales }, ctx);
}
