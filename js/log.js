// 브랜드 로그 페이지 (관리자 전용). 평문 기록 → 연간 달력 → 브랜드 레벨.
import { LOCAL } from './common.js?v=1795447988';
import { kstToday, addDays } from './log-dates.js?v=1795447988';
import { DEFAULT_METRICS, TIERS, floor1 } from './log-level.js?v=1795447988';
import { levelByDate } from './log-stats.js?v=1795447988';
import { createLogApi } from './log-api.js?v=1795447988';
import { renderYear, highlightDay, popStickers } from './log-calendar.js?v=1795447988';
import { drawLevel, drawRecords, openDay, openSettings, celebrate, levelAt } from './log-panels.js?v=1795447988';

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
    onPick: (date) =>
      openDay($('#day'), date, {
        api: state.api,
        data: state.data,
        levels,
        tiers: tiersOf(state.data.settings),
        onChanged: reload,
      }).catch((e) => status('불러오지 못했습니다: ' + (e.message || e))),
  });
  const y = String(state.year);
  const recorded = state.data.days.filter((d) => d.date.startsWith(y)).length;
  const stickerCount = yearEl.querySelectorAll('.sticker').length;
  $('#year-sum').textContent = `기록 ${recorded}일 · 스티커 ${stickerCount}개`;
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
  $('#prev-year').onclick = () => { state.year -= 1; drawYear(); };
  $('#next-year').onclick = () => { state.year += 1; drawYear(); };
  narrow.addEventListener('change', drawYear);
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
