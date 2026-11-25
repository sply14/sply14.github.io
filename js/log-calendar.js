// 연간 달력: 가로 1~31일 × 세로 1~12월 (폰 세로 화면에서는 가로 1~12월 × 세로 1~31일).
// 칸 채우기(회색 단계), 스티커(상품 누끼 사진만 컬러, 나머지 흑백), 호버하면 만든 기간 채우기를 그립니다.
import { h } from './common.js?v=1795605176';
import { daysInMonth, addDays, diffDays } from './log-dates.js?v=1795605176';
import { cellLevel, makings, makingsOn, stickers } from './log-stats.js?v=1795605176';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const pad = (n) => String(n).padStart(2, '0');

// 뾰족한 별 (레퍼런스: 별 모양 날짜 포스터)
export function starSvg(points = 12) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? 26 : 50;
    const a = (Math.PI * i) / points - Math.PI / 2;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`);
  }
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><polygon points="${pts.join(' ')}"/></svg>`;
}

// 칸 위치: 가로면 (행 = 월, 열 = 일), 세로면 (행 = 일, 열 = 월). 머리 행·열이 1번이라 +1.
const place = (vertical, m, d) => (vertical ? { row: d + 1, col: m + 1 } : { row: m + 1, col: d + 1 });

export function renderYear(root, year, data, levels, opts) {
  const { vertical, today, onPick, firstTitle = () => '' } = opts;
  root.replaceChildren();
  root.classList.toggle('vertical', vertical);

  // 머리: 월 이름과 일 번호
  for (let m = 1; m <= 12; m++) {
    const p = vertical ? { row: 1, col: m + 1 } : { row: m + 1, col: 1 };
    root.append(h('span', { class: 'head month', style: `grid-row:${p.row};grid-column:${p.col}`, text: MONTHS[m - 1] }));
  }
  for (let d = 1; d <= 31; d++) {
    const p = vertical ? { row: d + 1, col: 1 } : { row: 1, col: d + 1 };
    root.append(h('span', { class: 'head day', style: `grid-row:${p.row};grid-column:${p.col}`, text: String(d) }));
  }

  // 칸 (없는 날은 만들지 않음)
  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= daysInMonth(year, m); d++) {
      const date = `${year}-${pad(m)}-${pad(d)}`;
      const p = place(vertical, m, d);
      const wd = new Date(Date.UTC(year, m - 1, d)).getUTCDay();
      const title = firstTitle(date);
      const cell = h('button', {
        type: 'button',
        class: 'cell' + (date === today ? ' today' : '') + (date > today ? ' future' : '') + (wd === 0 || wd === 6 ? ' weekend' : ''),
        style: `grid-row:${p.row};grid-column:${p.col}`,
        'data-date': date,
        'data-level': String(cellLevel(date, data)),
        'aria-label': `${m}월 ${d}일`,
        onclick: () => onPick(date),
      }, title ? h('span', { class: 'memo', text: title }) : null);
      root.append(cell);
    }
  }

  // 스티커: 한 칸에 하나. 사진은 칸 안에 맞춰 한 장만 보여 주고, 나머지는 "+N"으로. 칸을 누르면 상세 창에서 전부 보인다.
  const byDate = new Map();
  for (const s of stickers(data, levels, `${year}-01-01`, `${year}-12-31`, opts.tiers)) {
    if (s.date > today) continue;
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push(s);
  }
  for (const [date, list] of byDate) {
    const m = Number(date.slice(5, 7)), d = Number(date.slice(8));
    const p = place(vertical, m, d);
    const things = list.filter((s) => s.kind === 'product' || s.kind === 'sale');
    const star = list.find((s) => s.kind === 'tier') || list.find((s) => s.kind === 'star');
    const shown = things.find((s) => s.img) || things[0];
    const el = h('span', {
      class: 'sticker' + (star ? ` has-${star.kind}` : ''),
      style: `grid-row:${p.row};grid-column:${p.col}`,
      'data-date': date,
      title: things.map((s) => s.label).join(', '),
    });
    if (shown?.img) el.append(h('img', { src: shown.img, alt: shown.label, loading: 'lazy', decoding: 'async' }));
    else if (shown) el.append(h('i', { class: 'name', text: shown.label }));
    if (things.length > 1) el.append(h('i', { class: 'more', text: `+${things.length - 1}` }));
    if (star) {
      const mark = h('i', { class: `mark ${star.kind}` });
      mark.innerHTML = starSvg();
      el.append(mark);
    }
    root.append(el);
  }
  fitGrid(root, { cols: vertical ? 12 : 31, head: vertical ? 26 : 38 });
}

// 저장 직후: 그날 칸이 아래에서부터 채워지는 애니메이션. 끝나면 resolve.
export function highlightDay(root, date) {
  const cell = root.querySelector(`.cell[data-date="${date}"]`);
  if (!cell || matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  cell.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  cell.classList.remove('fill-in');
  void cell.offsetWidth;
  cell.classList.add('fill-in');
  return new Promise((res) => {
    const done = () => { cell.classList.remove('fill-in'); res(); };
    cell.addEventListener('animationend', done, { once: true });
    setTimeout(done, 700);
  });
}

// 새로 붙은 스티커가 톡톡 붙는 애니메이션
export function popStickers(root, date) {
  const list = [...root.querySelectorAll(`.sticker[data-date="${date}"]`)];
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  list.forEach((el, i) => {
    el.style.animationDelay = `${i * 250}ms`;
    el.classList.add('pop');
  });
  return new Promise((res) => setTimeout(res, list.length * 250 + 350));
}

// 칸 크기를 정수 픽셀로 맞춘다. 소수점 크기면 화면이 1px 단위로 반올림해서 칸마다 크기·테두리가 조금씩 달라 보인다.
// 좌우를 꽉 채우고, 칸에 나눠 줄 수 없는 남는 픽셀은 머리 칸(달 이름)이 가져간다.
export function fitGrid(root, { cols, head = 0 }) {
  const box = root.parentElement;
  const cs = getComputedStyle(box);
  const avail = Math.floor(box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
  const gap = parseFloat(getComputedStyle(root).columnGap) || 0;
  const gaps = head ? cols : cols - 1;
  const c = Math.max(8, Math.floor((avail - head - gap * gaps) / cols));
  root.style.setProperty('--c', `${c}px`);
  if (head) root.style.setProperty('--head', `${Math.max(head, avail - c * cols - gap * gaps)}px`);
}

/* ───────── 만든 기간 ───────── */

const md = (date) => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일`;
const hm = (min) => (min >= 60 ? `${Math.floor(min / 60)}시간${min % 60 ? ` ${min % 60}분` : ''}` : `${min}분`);

// "Wallet · 11월 3일 ~ 25일 · 23일 중 9일 작업 · 14시간"
export function makingText(m) {
  const days = diffDays(m.from, m.to) + 1;
  const year = m.from.slice(0, 4) !== m.to.slice(0, 4);
  const full = (d) => (year ? `${d.slice(0, 4)}년 ` : '') + md(d);
  const end = m.from.slice(0, 7) === m.to.slice(0, 7) ? `${Number(m.to.slice(8))}일` : full(m.to);
  return [
    m.label,
    days === 1 ? md(m.from) : `${full(m.from)} ~ ${end}`,
    days === 1 ? '하루 작업' : `${days}일 중 ${m.dates.size}일 작업`,
    m.minutes ? hm(m.minutes) : '',
  ].filter(Boolean).join(' · ');
}

// 칸에 마우스를 올리거나 키보드로 옮겨 가면 그 작품을 만든 기간을 첫날부터 차례로 채운다.
// getData: 지금 데이터, label: 글을 보여 줄 요소 (벗어나면 원래 글로 되돌린다)
export function bindMakingHover(root, getData, label) {
  let shown = null, restore = '', all = null, from = null;
  const clear = () => {
    if (!shown) return;
    for (const el of root.querySelectorAll('.making, .making-src')) {
      el.classList.remove('making', 'worked', 'making-src');
      el.style.removeProperty('--wait');
    }
    root.classList.remove('has-making');
    label.textContent = restore;
    shown = null;
  };
  const show = (date) => {
    if (shown === date) return;
    clear();
    const data = getData();
    if (!data) return;
    if (from !== data) { all = makings(data); from = data; }
    const list = makingsOn(data, date, all);
    if (!list.length) return;
    shown = date;
    restore = label.textContent;
    root.classList.add('has-making');
    for (const el of root.querySelectorAll(`[data-date="${date}"]`)) el.classList.add('making-src'); // 올려 둔 사진은 그대로 보이게
    const first = list.map((m) => m.from).sort()[0];
    const last = list.map((m) => m.to).sort().at(-1);
    const step = Math.min(45, 900 / (diffDays(first, last) + 1));
    for (const m of list) {
      for (let d = m.from; d <= m.to; d = addDays(d, 1)) {
        const el = root.querySelector(`button[data-date="${d}"]`);
        if (!el) continue;
        el.classList.add('making');
        if (m.dates.has(d)) el.classList.add('worked');
        el.style.setProperty('--wait', `${Math.round(diffDays(first, d) * step)}ms`);
      }
    }
    label.textContent = list.length > 1 ? `${makingText(list[0])} 외 ${list.length - 1}개` : makingText(list[0]);
  };
  const dateOf = (e) => e.target.closest?.('button[data-date]')?.dataset.date;
  const enter = (e) => { const d = dateOf(e); if (d) show(d); else clear(); };
  root.addEventListener('pointerover', (e) => { if (e.pointerType !== 'touch') enter(e); });
  root.addEventListener('pointerleave', clear);
  root.addEventListener('focusin', (e) => { if (e.target.matches(':focus-visible')) enter(e); });
  root.addEventListener('focusout', clear);
  return { reset() { shown = null; root.classList.remove('has-making'); } };
}
