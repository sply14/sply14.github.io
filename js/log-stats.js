// 기록(LogData)에서 달력과 레벨 화면에 필요한 숫자를 계산합니다. DOM을 모르는 순수 함수만 있습니다.
// LogData = { days: [{date}], work: [{date, title, minutes, span_key, item_id}], sales: [{date, item_id, title, channel, amount, qty, gift}],
//             events: [{item_id, event, at, parent_id}], items: [{id, name, thumb_url, image_url, kind, parent_id, no}] }
import { kstDateOf, addDays } from './log-dates.js?v=1795605176';
import { DEFAULT_METRICS, brandLevel, worksPoints, floor1, tierOf, TIERS } from './log-level.js?v=1795605176';

const saleValue = (s) => (s.gift ? 0 : (s.amount ?? 0) * (s.qty ?? 1));

function dateRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// 같은 data 객체로 여러 번 부를 때 다시 세지 않도록 색인을 기억해 둔다.
const cache = new WeakMap();
function index(data) {
  let ix = cache.get(data);
  if (ix) return ix;
  const days = new Set(data.days.map((d) => d.date));
  const minutes = new Map(), revenue = new Map(), salesOn = new Map(), workOn = new Map();
  for (const w of data.work) {
    minutes.set(w.date, (minutes.get(w.date) ?? 0) + (w.minutes ?? 0));
    if (!workOn.has(w.date)) workOn.set(w.date, []);
    workOn.get(w.date).push(w);
  }
  for (const s of data.sales) {
    revenue.set(s.date, (revenue.get(s.date) ?? 0) + saleValue(s));
    if (!salesOn.has(s.date)) salesOn.set(s.date, []);
    salesOn.get(s.date).push(s);
  }
  const eventDates = data.events.map((e) => kstDateOf(e.at));
  const first = [...days, ...data.sales.map((s) => s.date), ...eventDates].sort()[0] ?? null;
  ix = { days, minutes, revenue, salesOn, workOn, first, items: new Map(data.items.map((i) => [i.id, i])) };
  cache.set(data, ix);
  return ix;
}

/* ───────── 포트폴리오 ───────── */

// 날짜별 { kinds: 보이는 상품 종류 수, made: 만든 개수 }.
// 낱개(parent_id가 있는 이벤트)가 있는 상품은 낱개 수를, 없으면 1개를 센다. 대표가 숨겨지면 낱개도 빠진다.
export function portfolioByDate(events, from, to) {
  const sorted = events.map((e) => ({ e, d: kstDateOf(e.at), t: Date.parse(e.at) })).sort((a, b) => a.t - b.t);
  const kinds = new Set(), pieces = new Map();
  const apply = ({ item_id, event, parent_id }) => {
    const on = event === 'added' || event === 'shown';
    if (parent_id && !pieces.has(parent_id)) pieces.set(parent_id, new Set());
    const set = parent_id ? pieces.get(parent_id) : kinds;
    if (on) set.add(item_id);
    else set.delete(item_id);
  };
  const count = () => {
    let made = 0;
    for (const id of kinds) made += Math.max(1, pieces.get(id)?.size ?? 0);
    return { kinds: kinds.size, made };
  };
  let i = 0;
  while (i < sorted.length && sorted[i].d < from) apply(sorted[i++].e);
  const out = new Map();
  let cur = count();
  for (const d of dateRange(from, to)) {
    const start = i;
    while (i < sorted.length && sorted[i].d <= d) apply(sorted[i++].e);
    if (i > start) cur = count();
    out.set(d, cur);
  }
  return out;
}

export function addedOn(events, date) {
  return events.filter((e) => e.event === 'added' && kstDateOf(e.at) === date).map((e) => e.item_id);
}

/* ───────── 날짜별 수치 시리즈 ───────── */

// 시작일부터 to까지 날마다의 값. 창(window) 합계는 누적합 차이로 계산한다.
function windowSeries(byDate, start, to, size) {
  const out = new Map();
  const dates = dateRange(start, to);
  let sum = 0;
  dates.forEach((d, i) => {
    sum += byDate.get(d) ?? 0;
    if (i >= size) sum -= byDate.get(dates[i - size]) ?? 0;
    out.set(d, sum);
  });
  return out;
}

function streakSeries(days, start, to) {
  const out = new Map();
  let run = 0;
  for (const d of dateRange(start, to)) {
    run = days.has(d) ? run + 1 : 0;
    out.set(d, run);
  }
  return out;
}

// 값, 역대 최고, 그리고 최고를 마지막으로 경신한 날
function summarize(series, today, value = series.get(today) ?? 0) {
  let best = 0, brokeOn = null;
  for (const [d, v] of series) {
    if (d > today) break;
    if (v > best) { best = v; brokeOn = d; }
  }
  return { value, best, brokeOn };
}

function seriesSet(data, to) {
  const ix = index(data);
  const start = ix.first && ix.first < to ? ix.first : to;
  const portfolio = portfolioByDate(data.events, start, to);
  return {
    start,
    portfolio,
    made: new Map([...portfolio].map(([d, v]) => [d, v.made])),
    revenue28: windowSeries(ix.revenue, start, to, 28),
    revenue365: windowSeries(ix.revenue, start, to, 365),
    bestDay: windowSeries(ix.revenue, start, to, 1),
    workWeekMinutes: windowSeries(ix.minutes, start, to, 7),
    streak: streakSeries(ix.days, start, to),
  };
}

/* ───────── 레벨 ───────── */

export function levelByDate(data, from, to, metrics = DEFAULT_METRICS) {
  const s = seriesSet(data, to);
  const start = s.start < from ? s.start : from;
  const out = new Map();
  let bestWorks = 0, bestRevenue = 0;
  for (const d of dateRange(start, to)) {
    const shown = s.portfolio.get(d) ?? { kinds: 0, made: 0 };
    bestWorks = Math.max(bestWorks, worksPoints(shown, metrics.works));
    bestRevenue = Math.max(bestRevenue, s.revenue365.get(d) ?? 0);
    if (d >= from) {
      const values = { works: bestWorks, kinds: shown.kinds, made: shown.made, revenue: bestRevenue, social: 0 };
      out.set(d, { ...brandLevel(values, metrics), values });
    }
  }
  return out;
}

/* ───────── 최고 기록 ───────── */

export function records(data, today) {
  const s = seriesSet(data, today);
  const ix = index(data);
  const monthSeries = new Map();
  let month = '', mtd = 0;
  for (const d of dateRange(s.start, today)) {
    if (d.slice(0, 7) !== month) { month = d.slice(0, 7); mtd = 0; }
    mtd += ix.revenue.get(d) ?? 0;
    monthSeries.set(d, mtd);
  }
  const yesterday = addDays(today, -1);
  const streakNow = ix.days.has(today) ? s.streak.get(today) ?? 0 : s.streak.get(yesterday) ?? 0;
  return {
    portfolio: { ...summarize(s.made, today), kinds: s.portfolio.get(today)?.kinds ?? 0 },
    revenue28: summarize(s.revenue28, today),
    revenueMonth: summarize(monthSeries, today),
    bestDay: summarize(s.bestDay, today),
    workWeekMinutes: summarize(s.workWeekMinutes, today),
    streak: summarize(s.streak, today, streakNow),
  };
}

// 어떤 최고 기록이든 새로 경신한 날들
function recordBreakDates(data, to) {
  const s = seriesSet(data, to);
  const out = new Set();
  for (const key of ['made', 'revenue28', 'bestDay', 'workWeekMinutes', 'streak']) {
    let best = 0;
    for (const [d, v] of s[key]) if (v > best) { best = v; out.add(d); }
  }
  return out;
}

/* ───────── 달력 ───────── */

export function cellLevel(date, data) {
  const ix = index(data);
  if (!ix.days.has(date)) return 'none';
  const m = ix.minutes.get(date) ?? 0;
  if (m <= 0) return ix.workOn.has(date) || ix.salesOn.has(date) ? 1 : 'rest';
  return m < 60 ? 1 : m < 180 ? 2 : 3;
}

/* ───────── 만든 기간 ───────── */

// 작업을 작품(item_id) 또는 묶음(span_key)으로 모은다. span_key의 작업 하나라도 작품에 연결됐으면 그 묶음은 그 작품의 것.
// 돌려주는 것: Map('item:<id>' | 'span:<key>' → { label, from, to, dates, minutes })
export function makings(data) {
  const ix = index(data);
  const owner = new Map();
  for (const w of data.work) if (w.span_key && w.item_id) owner.set(w.span_key, w.item_id);
  const out = new Map();
  for (const w of data.work) {
    const item_id = w.item_id || owner.get(w.span_key);
    const key = item_id ? `item:${item_id}` : w.span_key ? `span:${w.span_key}` : null;
    if (!key) continue;
    if (!out.has(key)) {
      const item = item_id ? ix.items.get(item_id) : null;
      out.set(key, { label: itemName(item, ix.items.get(item?.parent_id)) || w.title, from: w.date, to: w.date, dates: new Set(), minutes: 0 });
    }
    const m = out.get(key);
    if (w.date < m.from) m.from = w.date;
    if (w.date > m.to) m.to = w.date;
    m.dates.add(w.date);
    m.minutes += w.minutes ?? 0;
  }
  return out;
}

// 그날 칸에서 볼 만든 기간: 그날 작업한 것, 올린 작품, 팔린 작품 (낱개의 작업이 없으면 대표 작품의 것)
export function makingsOn(data, date, all = makings(data)) {
  const ix = index(data);
  const found = new Set();
  for (const m of all.values()) if (m.dates.has(date)) found.add(m);
  const ids = [...addedOn(data.events, date), ...(ix.salesOn.get(date) ?? []).map((s) => s.item_id)].filter(Boolean);
  for (const id of ids) {
    const item = ix.items.get(id);
    if (!item || item.hidden || ix.items.get(item.parent_id)?.hidden) continue;
    const m = all.get(`item:${id}`) ?? all.get(`item:${item.parent_id}`);
    if (m) found.add(m);
  }
  return [...found];
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// 낱개는 대표 상품 이름 + 번호 (Wallet 001)
export function itemName(item, parent) {
  if (!item) return '';
  if (item.kind !== 'piece') return item.name ?? '';
  return `${item.name || parent?.name || ''} ${String(item.no).padStart(3, '0')}`.trim();
}

export function stickers(data, levels, from, to, tiers = TIERS) {
  const ix = index(data);
  const breaks = recordBreakDates(data, to);
  const out = [];
  for (const d of dateRange(from, to)) {
    const ids = addedOn(data.events, d);
    const withPieces = new Set(ids.map((id) => ix.items.get(id)?.parent_id).filter(Boolean));
    for (const id of ids) {
      const item = ix.items.get(id);
      const parent = item?.parent_id ? ix.items.get(item.parent_id) : null;
      if (item?.hidden || parent?.hidden) continue; // 지금 숨긴 상품은 달력에서도 뺀다
      if (withPieces.has(id)) continue; // 같은 날 낱개도 올렸으면 낱개 사진만
      out.push({ date: d, kind: 'product', item_id: id, img: item ? item.thumb_url || item.image_url || undefined : undefined, label: itemName(item, parent) || '상품', seed: hash(d + id) });
    }
    for (const [i, s] of (ix.salesOn.get(d) ?? []).entries()) {
      const item = s.item_id ? ix.items.get(s.item_id) : null;
      out.push({ date: d, kind: 'sale', item_id: s.item_id, img: item ? item.thumb_url || item.image_url || undefined : undefined, label: s.title || itemName(item, ix.items.get(item?.parent_id)) || '판매', amount: saleValue(s), seed: hash(d + 'sale' + i) });
    }
    const cur = levels.get(d), prev = levels.get(addDays(d, -1));
    if (cur && prev && floor1(cur.total) > floor1(prev.total)) {
      const tierUp = tierOf(cur.total, tiers).min !== tierOf(prev.total, tiers).min;
      out.push({ date: d, kind: tierUp ? 'tier' : 'star', label: `Lv ${floor1(cur.total).toFixed(1)}`, seed: hash(d + 'lv') });
    } else if (breaks.has(d)) {
      out.push({ date: d, kind: 'star', label: '★', seed: hash(d + 'rec') });
    }
  }
  return out;
}

// 하루 요약 (월간·주간·일간 보기용)
export function daySummary(data, date) {
  const ix = index(data);
  const work = ix.workOn.get(date) ?? [];
  const sales = ix.salesOn.get(date) ?? [];
  return {
    date,
    recorded: ix.days.has(date),
    minutes: ix.minutes.get(date) ?? 0,
    revenue: ix.revenue.get(date) ?? 0,
    work,
    sales,
    level: cellLevel(date, data),
  };
}
