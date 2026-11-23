// 기록(LogData)에서 달력과 레벨 화면에 필요한 숫자를 계산합니다. DOM을 모르는 순수 함수만 있습니다.
// LogData = { days: [{date}], work: [{date, title, minutes, span_key}], sales: [{date, item_id, title, channel, amount, qty, gift}],
//             events: [{item_id, event, at}], items: [{id, name, thumb_url, image_url, kind}] }
import { kstDateOf, addDays, diffDays } from './log-dates.js?v=1795452031';
import { DEFAULT_METRICS, brandLevel, floor1, tierOf, TIERS } from './log-level.js?v=1795452031';

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

export function portfolioByDate(events, from, to) {
  const delta = new Map();
  for (const e of events) {
    const d = kstDateOf(e.at);
    const v = e.event === 'added' || e.event === 'shown' ? 1 : -1;
    delta.set(d, (delta.get(d) ?? 0) + v);
  }
  let count = 0;
  for (const [d, v] of [...delta].sort(([a], [b]) => (a < b ? -1 : 1))) if (d < from) count = Math.max(0, count + v);
  const out = new Map();
  for (const d of dateRange(from, to)) {
    count = Math.max(0, count + (delta.get(d) ?? 0));
    out.set(d, count);
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
  return {
    start,
    portfolio: portfolioByDate(data.events, start, to),
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
    bestWorks = Math.max(bestWorks, s.portfolio.get(d) ?? 0);
    bestRevenue = Math.max(bestRevenue, s.revenue365.get(d) ?? 0);
    if (d >= from) {
      const values = { works: bestWorks, revenue: bestRevenue, social: 0 };
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
    portfolio: summarize(s.portfolio, today),
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
  for (const key of ['portfolio', 'revenue28', 'bestDay', 'workWeekMinutes', 'streak']) {
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

export function spans(work) {
  const byKey = new Map();
  for (const w of work) {
    if (!w.span_key) continue;
    if (!byKey.has(w.span_key)) byKey.set(w.span_key, { title: w.title, dates: new Set() });
    byKey.get(w.span_key).dates.add(w.date);
  }
  const out = [];
  for (const [span_key, { title, dates }] of byKey) {
    const sorted = [...dates].sort();
    let from = sorted[0], prev = sorted[0];
    for (const d of [...sorted.slice(1), null]) {
      if (d && diffDays(prev, d) === 1) { prev = d; continue; }
      if (prev !== from) out.push({ span_key, title, from, to: prev });
      from = prev = d;
    }
  }
  return out.sort((a, b) => (a.from < b.from ? -1 : 1));
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function stickers(data, levels, from, to, tiers = TIERS) {
  const ix = index(data);
  const breaks = recordBreakDates(data, to);
  const out = [];
  for (const d of dateRange(from, to)) {
    for (const id of addedOn(data.events, d)) {
      const item = ix.items.get(id);
      if (item?.hidden) continue; // 지금 숨긴 상품은 달력에서도 뺀다
      out.push({ date: d, kind: 'product', item_id: id, img: item ? item.thumb_url || item.image_url || undefined : undefined, label: item ? item.name : '상품', seed: hash(d + id) });
    }
    for (const [i, s] of (ix.salesOn.get(d) ?? []).entries()) {
      const item = s.item_id ? ix.items.get(s.item_id) : null;
      out.push({ date: d, kind: 'sale', item_id: s.item_id, img: item ? item.thumb_url || item.image_url || undefined : undefined, label: s.title || item?.name || '판매', amount: saleValue(s), seed: hash(d + 'sale' + i) });
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
