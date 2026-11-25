// 브랜드 로그 페이지 (관리자 전용). 평문 기록 → 연간 달력 → 브랜드 레벨.
import { LOCAL } from './common.js?v=1795605176';
import { kstToday, addDays, daysInMonth, weekStart, weekday } from './log-dates.js?v=1795605176';
import { DEFAULT_METRICS, TIERS, floor1 } from './log-level.js?v=1795605176';
import { levelByDate } from './log-stats.js?v=1795605176';
import { createLogApi } from './log-api.js?v=1795605176';
import { renderYear, highlightDay, popStickers, bindMakingHover } from './log-calendar.js?v=1795605176';
import { drawLevel, drawRecords, openDay, openSettings, celebrate, levelAt } from './log-panels.js?v=1795605176';
import { renderMonth, renderWeek, renderDay } from './log-views.js?v=1795605176';

const $ = (s) => document.querySelector(s);
const yearEl = $('#year');
const narrow = matchMedia('(max-width: 640px) and (orientation: portrait)');

const state = {
  api: null,
  data: null,
  today: kstToday(),
  year: Number(kstToday().slice(0, 4)),
  view: 'year',          // year | month | week | day
  anchor: kstToday(),    // 지금 보고 있는 날짜 (보기마다 그 날짜가 속한 해·달·주·날을 보여 준다)
};
const VIEW_KEY = 'brand-log-view';
const WEEK = ['월', '화', '수', '목', '금', '토', '일'];

/* ───────── 설정 (가중치·기준값·단계 문구) ───────── */

export function metricsOf(settings) {
  const over = settings?.metrics ?? {};
  return Object.fromEntries(Object.entries(DEFAULT_METRICS).map(([k, m]) => [k, { ...m, ...(over[k] ?? {}) }]));
}

export function tiersOf(settings) {
  const over = settings?.tiers ?? [];
  return TIERS.map((t, i) => ({ ...t, ...(over[i] ?? {}) }));
}

let statusTimer;
export function status(msg, ms = 4000) {
  $('#status').textContent = msg;
  clearTimeout(statusTimer);
  if (ms) statusTimer = setTimeout(() => ($('#status').textContent = ''), ms);
}

/* ───────── 그리기 ───────── */

function levelsFor(year) {
  const to = `${year}-12-31` < state.today ? `${year}-12-31` : state.today;
  const from = `${year - 1}-12-31`;
  return levelByDate(state.data, from < to ? from : to, to, metricsOf(state.data.settings));
}

function firstTitleIndex() {
  const m = new Map();
  for (const w of state.data.work) if (!m.has(w.date)) m.set(w.date, w.title);
  return (date) => m.get(date) ?? '';
}

function pickDay(levels) {
  return (date) =>
    openDay($('#day'), date, {
      api: state.api,
      data: state.data,
      levels,
      tiers: tiersOf(state.data.settings),
      onChanged: reload,
    }).catch((e) => status('불러오지 못했습니다: ' + (e.message || e)));
}

const minDate = (a, b) => (a < b ? a : b);
const pad = (n) => String(n).padStart(2, '0');

const making = bindMakingHover(yearEl, () => state.data, $('#year-sum'));

export function drawYear() {
  making.reset(); // 칸을 새로 그리므로 채워 둔 기간도 잊는다
  for (const b of document.querySelectorAll('.views button')) b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
  const metrics = metricsOf(state.data.settings);
  const tiers = tiersOf(state.data.settings);
  const today = state.today;
  const a = state.anchor;
  const y = Number(a.slice(0, 4)), m = Number(a.slice(5, 7));
  let label = '', sum = '', isLast = false;

  if (state.view === 'year') {
    state.year = y;
    yearEl.className = 'year';
    const levels = levelsFor(y);
    renderYear(yearEl, y, state.data, levels, { vertical: narrow.matches, today, tiers, firstTitle: firstTitleIndex(), onPick: pickDay(levels) });
    label = String(y);
    isLast = y >= Number(today.slice(0, 4));
    const recorded = state.data.days.filter((d) => d.date.startsWith(String(y))).length;
    sum = `기록 ${recorded}일 · 스티커 ${yearEl.querySelectorAll('.sticker').length}개`;
  } else if (state.view === 'month') {
    const first = `${y}-${pad(m)}-01`;
    const levels = levelByDate(state.data, addDays(first, -1), minDate(`${y}-${pad(m)}-${pad(daysInMonth(y, m))}`, today), metrics);
    sum = renderMonth(yearEl, y, m, state.data, levels, { today, tiers, onPick: pickDay(levels) });
    label = `${y}년 ${m}월`;
    isLast = `${y}-${pad(m)}` >= today.slice(0, 7);
  } else if (state.view === 'week') {
    const start = weekStart(a), end = addDays(start, 6);
    const levels = levelByDate(state.data, addDays(start, -1), minDate(end, today), metrics);
    sum = renderWeek(yearEl, start, state.data, levels, { today, tiers, onPick: pickDay(levels) });
    label = `${Number(start.slice(5, 7))}.${Number(start.slice(8))} – ${Number(end.slice(5, 7))}.${Number(end.slice(8))}`;
    isLast = end >= today;
  } else {
    renderDay(yearEl, a, state.data, { api: state.api, today, metrics, tiers, onEdit: pickDay(levelByDate(state.data, addDays(a, -1), a, metrics)) })
      .catch((e) => status('불러오지 못했습니다: ' + (e.message || e)));
    label = `${m}월 ${Number(a.slice(8))}일 (${WEEK[weekday(a)]})`;
    isLast = a >= today;
  }
  $('#year-label').textContent = label;
  $('#next-year').disabled = isLast;
  $('#year-sum').textContent = sum;
}

// 보기에 맞게 한 칸(해·달·주·날) 앞뒤로
function shift(n) {
  const a = state.anchor;
  const y = Number(a.slice(0, 4)), m = Number(a.slice(5, 7)), d = Number(a.slice(8));
  let next;
  if (state.view === 'year') next = `${y + n}-${pad(m)}-${pad(Math.min(d, daysInMonth(y + n, m)))}`;
  else if (state.view === 'month') {
    const t = y * 12 + (m - 1) + n, ny = Math.floor(t / 12), nm = (t % 12) + 1;
    next = `${ny}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`;
  } else next = addDays(a, state.view === 'week' ? 7 * n : n);
  state.anchor = minDate(next, state.today);
  drawYear();
}

function setView(v) {
  state.view = v;
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* 기억 못 해도 괜찮음 */ }
  drawYear();
}

export function drawAll() {
  drawYear();
  const metrics = metricsOf(state.data.settings);
  const tiers = tiersOf(state.data.settings);
  drawLevel($('#level'), { data: state.data, today: state.today, year: Number(state.today.slice(0, 4)), metrics, tiers });
  drawRecords($('#records'), { data: state.data, today: state.today });
}

export async function reload() {
  state.today = kstToday();
  state.data = await state.api.load();
  drawAll();
}

/* ───────── 시작 ───────── */

async function start() {
  state.api = await createLogApi();
  if (!LOCAL) {
    const user = await state.api.user();
    if (!user || !(await state.api.isAdmin())) {
      $('#gate').hidden = false;
      return;
    }
  } else {
    $('#to-admin').href = './admin.html?local';
    status('로컬 연습 모드 — 이 브라우저에만 저장됩니다', 0);
  }
  $('#app').hidden = false;
  $('#prev-year').onclick = () => shift(-1);
  $('#next-year').onclick = () => shift(1);
  $('#go-today').onclick = () => { state.anchor = state.today; drawYear(); };
  for (const b of document.querySelectorAll('.views button')) b.onclick = () => setView(b.dataset.view);
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    if (['year', 'month', 'week', 'day'].includes(saved)) state.view = saved;
  } catch { /* 기본은 연간 */ }
  narrow.addEventListener('change', drawYear);
  // 창 크기가 바뀌면 칸 크기(정수 픽셀)를 다시 계산
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.view === 'year' || state.view === 'month') drawYear(); }, 150);
  });
  $('#open-settings').onclick = () => openSettings($('#settings'), { api: state.api, data: state.data, onChanged: reload });
  await reload();
  await celebrateSinceLastVisit();
  // 페이지를 켜 둔 채 자정이 지나면, 다시 볼 때 오늘을 새로 잡는다
  const ensureToday = () => {
    if (document.visibilityState === 'visible' && kstToday() !== state.today) reload();
  };
  document.addEventListener('visibilitychange', ensureToday);
  window.addEventListener('focus', ensureToday);
}

/* ───────── 지난번보다 레벨이 올랐으면 축하 ───────── */

// 기록은 Claude Code 세션에서 하므로, 웹을 열었을 때 이 브라우저에서 지난번 본 레벨보다 올랐으면 그 순간을 보여 준다.
const SEEN_KEY = 'brand-log-seen-v1';

async function celebrateSinceLastVisit() {
  const metrics = metricsOf(state.data.settings);
  const now = levelAt(state.data, state.today, metrics).total;
  let seen = null;
  try { seen = JSON.parse(localStorage.getItem(SEEN_KEY)); } catch { seen = null; }
  try { localStorage.setItem(SEEN_KEY, JSON.stringify({ level: now, date: state.today })); } catch { /* 저장소를 못 쓰면 축하만 건너뜀 */ }
  if (!seen || typeof seen.level !== 'number' || floor1(now) <= floor1(seen.level)) return;

  const num = $('#level .lv-num');
  if (num) num.textContent = floor1(seen.level).toFixed(1);
  if (state.data.days.some((d) => d.date === state.today)) {
    await highlightDay(yearEl, state.today);
    await popStickers(yearEl, state.today);
  }
  await celebrate($('#level'), $('#burst'), { from: seen.level, to: now, tiers: tiersOf(state.data.settings) });
}

export { state };

start().catch((err) => {
  console.error(err);
  $('#gate').hidden = false;
  $('#gate').querySelector('p').textContent = '불러오지 못했습니다: ' + (err.message || err);
});
