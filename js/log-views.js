// 월간·주간·일간 보기. 연간 달력(log-calendar.js)과 같은 데이터로 그린다.
import { h } from './common.js?v=1795449293';
import { addDays, monthWeeks, weekday } from './log-dates.js?v=1795449293';
import { daySummary, stickers, levelByDate } from './log-stats.js?v=1795449293';
import { floor1 } from './log-level.js?v=1795449293';
import { starSvg } from './log-calendar.js?v=1795449293';

const WEEK = ['월', '화', '수', '목', '금', '토', '일'];
const won = (n) => '₩' + Math.round(n).toLocaleString('ko-KR');
const hm = (min) => (min >= 60 ? `${Math.floor(min / 60)}시간${min % 60 ? ` ${min % 60}분` : ''}` : `${min}분`);
const mdw = (date) => `${Number(date.slice(5, 7))}.${Number(date.slice(8))} ${WEEK[weekday(date)]}`;

function photosByDate(data, levels, from, to, tiers) {
  const map = new Map();
  for (const s of stickers(data, levels, from, to, tiers)) {
    if (!map.has(s.date)) map.set(s.date, { photos: [], star: null });
    const e = map.get(s.date);
    if (s.kind === 'product' || s.kind === 'sale') e.photos.push(s);
    else if (!e.star || s.kind === 'tier') e.star = s;
  }
  return map;
}

function starMark(star) {
  if (!star) return null;
  const el = h('i', { class: `mark ${star.kind}`, title: star.label });
  el.innerHTML = starSvg();
  return el;
}

// 기간 합계: 작업 시간, 매출, 새 상품 수, 기록한 날
export function periodSum(data, from, to) {
  let minutes = 0, revenue = 0, days = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const s = daySummary(data, d);
    minutes += s.minutes;
    revenue += s.revenue;
    if (s.recorded) days += 1;
  }
  const products = stickers(data, new Map(), from, to).filter((s) => s.kind === 'product').length;
  return `기록 ${days}일 · 작업 ${hm(minutes)} · 매출 ${won(revenue)} · 상품 +${products}`;
}

/* ───────── 월간 ───────── */

export function renderMonth(root, year, month, data, levels, { today, onPick, tiers }) {
  root.className = 'view month';
  root.replaceChildren();
  const weeks = monthWeeks(year, month);
  const from = weeks.flat().find(Boolean), to = weeks.flat().filter(Boolean).at(-1);
  const pics = photosByDate(data, levels, from, to, tiers);
  root.append(...WEEK.map((w, i) => h('span', { class: 'wd' + (i >= 5 ? ' we' : ''), text: w })));
  for (const date of weeks.flat()) {
    if (!date) { root.append(h('span', { class: 'blank' })); continue; }
    const s = daySummary(data, date);
    const p = pics.get(date);
    const shown = p?.photos.find((x) => x.img) || p?.photos[0];
    root.append(h('button', {
      type: 'button',
      class: 'mcell' + (date === today ? ' today' : '') + (date > today ? ' future' : ''),
      'data-level': String(s.level),
      'aria-label': `${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일`,
      onclick: () => onPick(date),
    },
      h('span', { class: 'num', text: String(Number(date.slice(8))) }),
      starMark(p?.star),
      shown?.img ? h('img', { src: shown.img, alt: shown.label, loading: 'lazy' }) : null,
      p && p.photos.length > 1 ? h('i', { class: 'more', text: `+${p.photos.length - 1}` }) : null,
      s.work[0] ? h('span', { class: 'line', text: s.work[0].title + (s.minutes ? ` · ${hm(s.minutes)}` : '') }) : (s.recorded && !s.sales.length ? h('span', { class: 'line mute', text: '쉼' }) : null),
      s.revenue ? h('span', { class: 'line won', text: won(s.revenue) }) : null,
    ));
  }
  return periodSum(data, `${year}-${String(month).padStart(2, '0')}-01`, to);
}

/* ───────── 주간 ───────── */

export function renderWeek(root, start, data, levels, { today, onPick, tiers }) {
  root.className = 'view week';
  root.replaceChildren();
  const end = addDays(start, 6);
  const pics = photosByDate(data, levels, start, end, tiers);
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    const s = daySummary(data, date);
    const p = pics.get(date);
    const lines = [
      ...s.work.map((w) => h('li', { text: w.title + (w.minutes ? ` · ${hm(w.minutes)}` : '') })),
      ...s.sales.map((x) => h('li', { class: 'sale', text: `${x.title || '판매'}${x.channel ? ' · ' + x.channel : ''}${x.amount != null ? ' · ' + won((x.amount ?? 0) * (x.qty ?? 1)) : ''}${x.gift ? ' · 선물' : ''}` })),
    ];
    if (s.recorded && !lines.length) lines.push(h('li', { class: 'mute', text: '쉼' }));
    root.append(h('button', {
      type: 'button',
      class: 'wrow' + (date === today ? ' today' : '') + (date > today ? ' future' : ''),
      'data-level': String(s.level),
      onclick: () => onPick(date),
    },
      h('span', { class: 'day' }, h('b', { text: mdw(date) }), starMark(p?.star)),
      lines.length ? h('ul', {}, ...lines) : h('span', { class: 'mute', text: date > today ? '' : '기록 없음' }),
      h('span', { class: 'pics' }, ...(p?.photos ?? []).filter((x) => x.img).slice(0, 4).map((x) => h('img', { src: x.img, alt: x.label, loading: 'lazy' }))),
    ));
  }
  return periodSum(data, start, end);
}

/* ───────── 일간 ───────── */

export async function renderDay(root, date, data, { api, today, metrics, tiers, onEdit }) {
  root.className = 'view day';
  root.replaceChildren(h('p', { class: 'mute', text: '불러오는 중…' }));
  const s = daySummary(data, date);
  const entries = await api.entries(date);
  const lv = levelByDate(data, addDays(date, -1), date, metrics);
  const level = lv.get(date)?.total ?? 0;
  const rose = floor1(level) > floor1(lv.get(addDays(date, -1))?.total ?? 0);
  const pics = stickers(data, lv, date, date, tiers).filter((x) => x.kind === 'product' || x.kind === 'sale');

  root.replaceChildren(
    h('div', { class: 'day-top' },
      h('span', { class: 'day-lv' }, `그날 레벨 Lv ${floor1(level).toFixed(1)}`, rose ? h('b', { text: ' ▲' }) : null),
      h('span', { class: 'mute', text: s.recorded ? [s.minutes ? `작업 ${hm(s.minutes)}` : '', s.revenue ? `매출 ${won(s.revenue)}` : ''].filter(Boolean).join(' · ') : date > today ? '' : '기록 없음' }),
      s.recorded ? h('button', { type: 'button', class: 'edit', onclick: () => onEdit(date) }, '고치기') : null,
    ),
    pics.length ? h('div', { class: 'day-pics' }, ...pics.map((x) =>
      x.img ? h('figure', {}, h('img', { src: x.img, alt: x.label }), h('figcaption', { text: x.label + (x.kind === 'sale' && x.amount ? ` · ${won(x.amount)}` : '') }))
        : h('figure', { class: 'noimg' }, h('figcaption', { text: x.label + (x.kind === 'sale' && x.amount ? ` · ${won(x.amount)}` : '') })))) : null,
    entries.length ? h('section', {}, h('h3', { text: '그날 쓴 글' }), ...entries.map((e) => h('p', { class: 'raw', text: e.text }))) : null,
    s.work.length ? h('section', {}, h('h3', { text: '작업' }), h('ul', {}, ...s.work.map((w) => h('li', { text: w.title + (w.minutes ? ` · ${hm(w.minutes)}` : '') })))) : null,
    s.sales.length ? h('section', {}, h('h3', { text: '판매' }), h('ul', {}, ...s.sales.map((x) => h('li', { text: `${x.title || '판매'}${x.channel ? ' · ' + x.channel : ''}${x.qty > 1 ? ` × ${x.qty}` : ''}${x.amount != null ? ' · ' + won((x.amount ?? 0) * (x.qty ?? 1)) : ''}${x.gift ? ' · 선물' : ''}` })))) : null,
    s.recorded && !s.work.length && !s.sales.length ? h('p', { class: 'mute', text: '쉰 날로 기록됐어요.' }) : null,
  );
}
