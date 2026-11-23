// 브랜드 로그 페이지 (관리자 전용). 평문 기록 → 연간 달력 → 브랜드 레벨.
import { LOCAL } from './common.js?v=1795446485';
import { kstToday, addDays } from './log-dates.js?v=1795446485';
import { DEFAULT_METRICS, TIERS } from './log-level.js?v=1795446485';
import { levelByDate } from './log-stats.js?v=1795446485';
import { createLogApi } from './log-api.js?v=1795446485';
import { renderYear, highlightDay, popStickers } from './log-calendar.js?v=1795446485';
import { mountEntry } from './log-entry.js?v=1795446485';

const $ = (s) => document.querySelector(s);
const yearEl = $('#year');
const narrow = matchMedia('(max-width: 640px) and (orientation: portrait)');

const state = {
  api: null,
  data: null,
  today: kstToday(),
  year: Number(kstToday().slice(0, 4)),
};

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

export function drawYear() {
  const levels = levelsFor(state.year);
  $('#year-label').textContent = String(state.year);
  $('#next-year').disabled = state.year >= Number(state.today.slice(0, 4));
  renderYear(yearEl, state.year, state.data, levels, {
    vertical: narrow.matches,
    today: state.today,
    tiers: tiersOf(state.data.settings),
    firstTitle: firstTitleIndex(),
    onPick: (date) => document.dispatchEvent(new CustomEvent('log:pick', { detail: date })),
  });
  const y = String(state.year);
  const recorded = state.data.days.filter((d) => d.date.startsWith(y)).length;
  const stickerCount = yearEl.querySelectorAll('.sticker').length;
  $('#year-sum').textContent = `기록 ${recorded}일 · 스티커 ${stickerCount}개`;
}

export function drawAll() {
  drawYear();
  document.dispatchEvent(new CustomEvent('log:draw'));
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
  $('#prev-year').onclick = () => { state.year -= 1; drawYear(); };
  $('#next-year').onclick = () => { state.year += 1; drawYear(); };
  narrow.addEventListener('change', drawYear);
  await reload();
  state.entry = mountEntry($('#entry'), {
    api: state.api,
    getData: () => state.data,
    today: () => state.today,
    onSaved,
  });
}

/* ───────── 저장 뒤 ───────── */

async function onSaved(draft) {
  const before = state.data;
  await reload();
  const y = Number(draft.date.slice(0, 4));
  if (y !== state.year) { state.year = y; drawYear(); }
  await highlightDay(yearEl, draft.date);
  await popStickers(yearEl, draft.date);
  document.dispatchEvent(new CustomEvent('log:saved', { detail: { draft, before } }));
}

export { state };

start().catch((err) => {
  console.error(err);
  $('#gate').hidden = false;
  $('#gate').querySelector('p').textContent = '불러오지 못했습니다: ' + (err.message || err);
});
