// 레벨 머리글, 최고 기록 카드, 날짜 상세, 설정, 저장 뒤 축하.
import { h } from './common.js?v=1795446898';
import { addDays } from './log-dates.js?v=1795446898';
import { DEFAULT_METRICS, TIERS, floor1, tierOf, nextTier } from './log-level.js?v=1795446898';
import { levelByDate, records, stickers } from './log-stats.js?v=1795446898';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const won = (n) => '₩' + Math.round(n).toLocaleString('ko-KR');
const lv = (x) => floor1(x).toFixed(1);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const hm = (min) => (min >= 60 ? `${Math.floor(min / 60)}시간${min % 60 ? ` ${min % 60}분` : ''}` : `${min}분`);
const dayLabel = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return `${m}월 ${d}일 (${WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
};

/* ───────── 레벨 머리글 ───────── */

export function levelAt(data, date, metrics) {
  return levelByDate(data, date, date, metrics).get(date);
}

export function drawLevel(root, { data, today, year, metrics, tiers }) {
  const now = levelAt(data, today, metrics);
  const startOfYear = levelAt(data, `${year - 1}-12-31` < today ? `${year - 1}-12-31` : today, metrics);
  const tier = tierOf(now.total, tiers);
  const next = nextTier(now.total, tiers);
  const v = now.values;
  const part = (key, value) =>
    h('li', {},
      h('span', { class: 'k', text: metrics[key].label }),
      h('b', { text: `Lv ${lv(now.parts[key])}` }),
      h('span', { class: 'v', text: value }));
  root.replaceChildren(
    h('div', { class: 'lv-main' },
      h('span', { class: 'lv-k', text: 'BRAND LEVEL' }),
      h('strong', { class: 'lv-num', text: lv(now.total) }),
      h('span', { class: 'lv-delta', text: '' }),
    ),
    h('div', { class: 'lv-side' },
      h('p', { class: 'lv-tier' }, h('b', { text: tier.min === tier.max ? `Lv ${tier.min}` : `Lv ${tier.min}–${tier.max}` }), ' ', tier.name),
      h('p', { class: 'lv-who', text: `누가 아는가 — ${tier.who}` }),
      next ? h('p', { class: 'lv-next', text: `다음 · Lv ${next.min} ${next.name}` }) : null,
      h('ul', { class: 'lv-parts' },
        part('works', `${v.works}점`),
        part('revenue', v.revenue > 0 ? `최근 12개월 최고 ${won(v.revenue)}` : '아직 판매 없음'),
        part('social', '아직 없음'),
      ),
      h('p', { class: 'lv-year', text: `${year}년 +${lv(Math.max(0, now.total - startOfYear.total))}` }),
    ),
  );
}

/* ───────── 최고 기록 ───────── */

export function drawRecords(root, { data, today }) {
  const r = records(data, today);
  const card = (title, rec, fmt) =>
    h('div', { class: 'rec' + (rec.brokeOn === today && rec.value > 0 && rec.value >= rec.best ? ' broke' : '') },
      h('span', { class: 'k', text: title }),
      h('strong', { text: fmt(rec.value) }),
      h('span', { class: 'best', text: rec.brokeOn === today && rec.value > 0 && rec.value >= rec.best ? '★ 경신' : `최고 ${fmt(rec.best)}` }),
    );
  root.replaceChildren(
    card('포트폴리오', r.portfolio, (n) => `${n}점`),
    card('28일 매출', r.revenue28, won),
    card('이번 달 매출', r.revenueMonth, won),
    card('오늘 매출', r.bestDay, won),
    card('이번 주 작업', r.workWeekMinutes, hm),
    card('연속 기록', r.streak, (n) => `${n}일`),
  );
}

/* ───────── 날짜 상세 ───────── */

export async function openDay(dialog, date, { api, data, levels, tiers, onChanged, onWrite }) {
  const entries = await api.entries(date);
  const work = data.work.filter((w) => w.date === date);
  const sales = data.sales.filter((s) => s.date === date);
  const items = new Map(data.items.map((i) => [i.id, i]));
  const recorded = data.days.some((d) => d.date === date);
  const run = async (fn) => {
    try { await fn(); await onChanged(); dialog.close(); } catch (e) { alert('저장하지 못했습니다: ' + (e.message || e)); }
  };

  const workRow = (w) => {
    const min = h('input', { type: 'number', min: 0, max: 1440, step: 10, value: w.minutes ?? '', placeholder: '분', 'aria-label': '분' });
    min.onchange = () => run(() => api.updateWork(w.id, { minutes: min.value === '' ? null : Math.max(0, Math.round(Number(min.value))) }));
    return h('li', {}, h('span', { class: 't', text: w.title }), min, h('span', { class: 'u', text: '분' }),
      h('button', { type: 'button', class: 'x', 'aria-label': '지우기', onclick: () => confirm('이 작업 기록을 지울까요?') && run(() => api.deleteWork(w.id)) }, '×'));
  };
  const saleRow = (s) => {
    const amt = h('input', { type: 'number', min: 0, step: 1000, value: s.amount ?? '', placeholder: '₩', 'aria-label': '금액' });
    amt.onchange = () => run(() => api.updateSale(s.id, { amount: amt.value === '' ? null : Math.max(0, Math.round(Number(amt.value))) }));
    const img = s.item_id && items.get(s.item_id)?.thumb_url;
    return h('li', {}, img ? h('img', { src: img, alt: '' }) : null,
      h('span', { class: 't', text: `${s.title || items.get(s.item_id)?.name || '판매'}${s.channel ? ' · ' + s.channel : ''}${s.qty > 1 ? ` × ${s.qty}` : ''}${s.gift ? ' · 선물' : ''}` }),
      amt,
      h('button', { type: 'button', class: 'x', 'aria-label': '지우기', onclick: () => confirm('이 판매 기록을 지울까요?') && run(() => api.deleteSale(s.id)) }, '×'));
  };
  const stk = stickers(data, levels, date, date, tiers);

  dialog.replaceChildren(...[
    h('div', { class: 'logsheet-head' },
      h('strong', { text: dayLabel(date) }),
      h('button', { type: 'button', class: 'close', onclick: () => dialog.close() }, '닫기 ×')),
    !recorded ? h('p', { class: 'empty', text: '아직 기록이 없는 날이에요.' }) : null,
    stk.length ? h('div', { class: 'day-stickers' }, ...stk.map((s) =>
      s.img ? h('img', { src: s.img, alt: s.label, title: s.label }) : h('span', { class: `chip ${s.kind}`, text: s.label }))) : null,
    entries.length ? h('section', {}, h('h3', { text: '그날 쓴 글' }), ...entries.map((e) => h('p', { class: 'raw', text: e.text }))) : null,
    work.length ? h('section', {}, h('h3', { text: '작업' }), h('ul', { class: 'day-list' }, ...work.map(workRow))) : null,
    sales.length ? h('section', {}, h('h3', { text: '판매' }), h('ul', { class: 'day-list' }, ...sales.map(saleRow))) : null,
    recorded && !work.length && !sales.length ? h('p', { class: 'empty', text: '쉰 날로 기록됐어요.' }) : null,
    h('div', { class: 'logsheet-foot' },
      h('button', { type: 'button', class: 'primary', onclick: () => { dialog.close(); onWrite(date); } }, '이 날에 더 쓰기')),
  ].filter(Boolean));
  dialog.showModal();
}

/* ───────── 설정 ───────── */

export function openSettings(dialog, { api, data, onChanged }) {
  const s = data.settings ?? {};
  const metricRows = Object.entries(DEFAULT_METRICS).map(([key, def]) => {
    const cur = { ...def, ...(s.metrics?.[key] ?? {}) };
    const num = (name, step) => h('input', { type: 'number', name: `${key}.${name}`, value: cur[name], step, min: 0, 'aria-label': `${def.label} ${name}` });
    return h('tr', {},
      h('th', { text: def.label }),
      h('td', {}, num('weight', 1)),
      h('td', {}, num('baseline', 'any')),
      h('td', {}, num('p', 0.1)),
      h('td', {}, h('input', { type: 'text', name: `${key}.source`, value: cur.source, 'aria-label': `${def.label} 출처` })));
  });
  const tierRows = TIERS.map((def, i) => {
    const cur = { ...def, ...(s.tiers?.[i] ?? {}) };
    return h('tr', {},
      h('th', { text: def.min === def.max ? String(def.min) : `${def.min}–${def.max}` }),
      h('td', {}, h('input', { type: 'text', name: `tier.${i}.name`, value: cur.name, 'aria-label': `Lv ${def.min} 설명` })),
      h('td', {}, h('input', { type: 'text', name: `tier.${i}.who`, value: cur.who, 'aria-label': `Lv ${def.min} 누가 아는가` })));
  });
  const channels = h('textarea', { name: 'channels', rows: 4, 'aria-label': '판매처 목록' });
  channels.value = data.channels.join('\n');

  const form = h('form', { method: 'dialog' },
    h('div', { class: 'logsheet-head' }, h('strong', { text: '설정' }), h('button', { type: 'button', class: 'close', onclick: () => dialog.close() }, '닫기 ×')),
    h('section', {}, h('h3', { text: '레벨 계산 (구찌 기준값)' }),
      h('p', { class: 'hint', text: '레벨 = 100 × (내 수치 ÷ 기준값)^(1/p). 가중치는 세 수치의 비중이에요.' }),
      h('table', { class: 'set' }, h('tr', {}, h('th'), h('th', { text: '가중치' }), h('th', { text: '기준값' }), h('th', { text: 'p' }), h('th', { text: '출처' })), ...metricRows)),
    h('section', {}, h('h3', { text: '레벨 가이드 문구' }), h('table', { class: 'set tiers' }, ...tierRows)),
    h('section', {}, h('h3', { text: '판매처 (한 줄에 하나)' }), channels),
    h('div', { class: 'logsheet-foot' },
      h('button', { type: 'button', onclick: async () => {
        if (!confirm('레벨 설정과 문구를 기본값으로 되돌릴까요?')) return;
        await api.saveSettings({});
        await onChanged();
        dialog.close();
      } }, '기본값으로'),
      h('button', { type: 'submit', class: 'primary' }, '저장')),
  );
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const metrics = {};
    for (const [key, def] of Object.entries(DEFAULT_METRICS)) {
      const n = (name) => {
        const v = Number(fd.get(`${key}.${name}`));
        return Number.isFinite(v) && v >= 0 ? v : def[name];
      };
      metrics[key] = { weight: n('weight'), baseline: n('baseline') || def.baseline, p: n('p') || def.p, source: String(fd.get(`${key}.source`) ?? def.source) };
    }
    const tiers = TIERS.map((def, i) => ({ name: String(fd.get(`tier.${i}.name`) || def.name), who: String(fd.get(`tier.${i}.who`) || def.who) }));
    const list = String(fd.get('channels') || '').split('\n').map((x) => x.trim()).filter(Boolean);
    try {
      await api.saveSettings({ metrics, tiers });
      await api.saveChannels(list.length ? [...new Set(list)] : data.channels);
      await onChanged();
      dialog.close();
    } catch (err) {
      alert('저장하지 못했습니다: ' + (err.message || err));
    }
  };
  dialog.replaceChildren(form);
  dialog.showModal();
}

/* ───────── 저장 뒤 축하 ───────── */

// 레벨 숫자가 옛 값에서 새 값까지 0.1씩 오르고, 단계가 바뀌었으면 화면 가운데 큰 별과 새 단계 문구.
export async function celebrate(levelRoot, burst, { from, to, tiers }) {
  const a = floor1(from), b = floor1(to);
  const num = levelRoot.querySelector('.lv-num');
  const delta = levelRoot.querySelector('.lv-delta');
  if (b <= a || !num) return;
  delta.textContent = `▲ ${(b - a).toFixed(1)}`;
  delta.classList.add('show');
  if (!reduced()) {
    const steps = Math.round((b - a) * 10);
    const each = Math.max(40, Math.min(160, 1200 / steps));
    for (let i = 0; i <= steps; i++) {
      num.textContent = (a + i / 10).toFixed(1);
      num.classList.remove('tick');
      void num.offsetWidth;
      num.classList.add('tick');
      await new Promise((r) => setTimeout(r, each));
    }
  }
  num.textContent = b.toFixed(1);
  const t0 = tierOf(from, tiers), t1 = tierOf(to, tiers);
  if (t1.min !== t0.min) {
    burst.replaceChildren(
      h('div', { class: 'burst-star' }),
      h('div', { class: 'burst-text' }, h('b', { text: `Lv ${t1.min}` }), h('span', { text: t1.name })),
    );
    burst.querySelector('.burst-star').innerHTML = (await import('./log-calendar.js?v=1795446898')).starSvg(16);
    burst.hidden = false;
    burst.onclick = () => (burst.hidden = true);
    await new Promise((r) => setTimeout(r, reduced() ? 1500 : 2200));
    burst.hidden = true;
  }
}
