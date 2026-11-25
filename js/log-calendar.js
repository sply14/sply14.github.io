// 연간 달력: 가로 1~31일 × 세로 1~12월 (폰 세로 화면에서는 가로 1~12월 × 세로 1~31일).
// 칸 채우기(회색 단계), 며칠 이어진 작업 막대, 스티커(상품 누끼 사진만 컬러, 나머지 흑백)를 그립니다.
import { h } from './common.js?v=1795581990';
import { daysInMonth } from './log-dates.js?v=1795581990';
import { cellLevel, spans, stickers } from './log-stats.js?v=1795581990';

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

  // 며칠 이어진 작업은 막대 (달이 바뀌면 달마다 나눠서)
  for (const s of spans(data.work)) {
    if (s.to < `${year}-01-01` || s.from > `${year}-12-31`) continue;
    const from = s.from < `${year}-01-01` ? `${year}-01-01` : s.from;
    const to = s.to > `${year}-12-31` ? `${year}-12-31` : s.to;
    for (let m = Number(from.slice(5, 7)); m <= Number(to.slice(5, 7)); m++) {
      const d0 = m === Number(from.slice(5, 7)) ? Number(from.slice(8)) : 1;
      const d1 = m === Number(to.slice(5, 7)) ? Number(to.slice(8)) : daysInMonth(year, m);
      const a = place(vertical, m, d0), b = place(vertical, m, d1);
      const style = vertical
        ? `grid-column:${a.col};grid-row:${a.row} / ${b.row + 1}`
        : `grid-row:${a.row};grid-column:${a.col} / ${b.col + 1}`;
      root.append(h('span', { class: 'bar-span', style, title: s.title }));
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
export function fitGrid(root, { cols, head = 0, max = 1200 }) {
  const box = root.parentElement;
  const cs = getComputedStyle(box);
  const avail = Math.min(max, box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
  const gap = parseFloat(getComputedStyle(root).columnGap) || 0;
  const gaps = head ? cols : cols - 1;
  const c = Math.max(8, Math.floor((avail - head - gap * gaps) / cols));
  root.style.setProperty('--c', `${c}px`);
  if (head) root.style.setProperty('--head', `${head}px`);
}
