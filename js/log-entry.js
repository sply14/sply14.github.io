// 오늘의 기록: 평문을 쓰면 AI(연습 모드는 규칙)가 작업·판매로 나눠 확인 카드를 띄우고, 고친 뒤 저장한다.
import { h } from './common.js?v=1795446759';
import { addedOn } from './log-stats.js?v=1795446759';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const MINUTE_CHOICES = [[30, '30분'], [60, '1시간'], [120, '2시간'], [240, '반나절'], [480, '하루 종일']];
const PLACEHOLDER = '오늘 뭐 했어? 그냥 쓰면 돼.\n예: 카드지갑 패턴 2시간 수정하고 지폐홀더 후르츠에서 3만원에 팔림';

const label = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return `${m}.${d} ${WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}`;
};
const intOrNull = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Math.round(Number(v)));
const emptyWork = () => ({ title: '', minutes: null, span_key: null });
const emptySale = () => ({ item_id: null, title: '', channel: null, amount: null, qty: 1, gift: false, mark_sold: false });

export function mountEntry(root, ctx) {
  let date = ctx.today();      // 글을 쓰는 날짜 (날짜 상세에서 "이 날에 더 쓰기"로 바꿀 수 있음)
  let text = '';
  let draft = null;
  let busy = false;
  let note = '';

  function render() {
    root.replaceChildren(draft ? confirmView() : writeView());
  }

  /* ───────── 쓰기 ───────── */

  function writeView() {
    const ta = h('textarea', { rows: 4, placeholder: PLACEHOLDER, 'aria-label': '오늘의 기록' });
    ta.value = text;
    ta.oninput = () => (text = ta.value);
    ta.onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); };
    const btn = h('button', { type: 'button', class: 'primary', onclick: submit, disabled: busy }, busy ? '읽는 중…' : '기록하기');
    const isToday = date === ctx.today();
    return h('div', { class: 'write' },
      h('div', { class: 'entry-head' },
        h('strong', { text: isToday ? `오늘 (${label(date)})` : label(date) }),
        isToday ? null : h('button', { type: 'button', class: 'link', onclick: () => { date = ctx.today(); render(); } }, '오늘로'),
      ),
      ta,
      h('div', { class: 'entry-foot' }, note ? h('span', { class: 'note', text: note }) : h('span'), btn),
    );
  }

  async function submit() {
    if (busy) return;
    if (!text.trim()) { root.querySelector('textarea')?.focus(); return; }
    busy = true;
    note = '';
    render();
    const data = ctx.getData();
    const pctx = { today: date, items: data.items, channels: data.channels, work: data.work };
    try {
      draft = await ctx.api.parse(text, pctx);
    } catch (err) {
      console.warn('parse failed', err);
      note = 'AI가 응답하지 않았어. 직접 채워 줘';
      draft = { date, rest: false, work: [emptyWork()], sales: [] };
    }
    busy = false;
    render();
  }

  /* ───────── 확인 카드 ───────── */

  function confirmView() {
    const data = ctx.getData();
    const added = addedOn(data.events, draft.date).length;
    const rows = [];

    const dateInput = h('input', { type: 'date', value: draft.date, max: ctx.today(), 'aria-label': '날짜' });
    dateInput.onchange = () => { if (dateInput.value) { draft.date = dateInput.value; render(); } };
    rows.push(h('div', { class: 'row date' }, h('span', { class: 'k', text: '날짜' }), dateInput));

    if (added > 0) rows.push(h('div', { class: 'row auto' }, h('span', { class: 'k', text: '상품' }), h('span', { text: `사이트에 ${added}개 추가됨 (자동 확인 ✓)` })));

    draft.work.forEach((w, i) => rows.push(workRow(w, i)));
    draft.sales.forEach((s, i) => rows.push(saleRow(s, i, data)));

    if (!draft.work.length && !draft.sales.length) rows.push(h('div', { class: 'row rest' }, h('span', { class: 'k', text: '쉼' }), h('span', { text: '쉰 날로 기록돼' })));

    return h('div', { class: 'confirm' },
      h('div', { class: 'entry-head' }, h('strong', { text: '이렇게 기록할까?' }), note ? h('span', { class: 'note', text: note }) : null),
      h('div', { class: 'rows' }, ...rows),
      h('div', { class: 'adders' },
        h('button', { type: 'button', class: 'link', onclick: () => { draft.work.push(emptyWork()); render(); } }, '+ 작업'),
        h('button', { type: 'button', class: 'link', onclick: () => { draft.sales.push(emptySale()); render(); } }, '+ 판매'),
      ),
      h('div', { class: 'entry-foot' },
        h('button', { type: 'button', onclick: () => { draft = null; note = ''; render(); } }, '고치기'),
        h('button', { type: 'button', class: 'primary', onclick: save, disabled: busy }, busy ? '저장 중…' : '저장 ✓'),
      ),
    );
  }

  function removeBtn(list, i) {
    return h('button', { type: 'button', class: 'x', 'aria-label': '이 줄 지우기', onclick: () => { list.splice(i, 1); render(); } }, '×');
  }

  function workRow(w, i) {
    const title = h('input', { type: 'text', value: w.title, placeholder: '무슨 작업?', 'aria-label': '작업' });
    title.oninput = () => (w.title = title.value);
    const known = MINUTE_CHOICES.some(([m]) => m === w.minutes);
    const sel = h('select', { 'aria-label': '시간' },
      h('option', { value: '', text: '시간 ?' }),
      ...MINUTE_CHOICES.map(([m, t]) => h('option', { value: String(m), text: t, selected: m === w.minutes })),
      h('option', { value: 'custom', text: '직접', selected: w.minutes != null && !known }),
    );
    const custom = h('input', { type: 'number', min: 0, max: 1440, step: 10, value: w.minutes ?? '', placeholder: '분', 'aria-label': '분', hidden: !(w.minutes != null && !known) });
    sel.onchange = () => {
      if (sel.value === 'custom') { custom.hidden = false; custom.focus(); return; }
      custom.hidden = true;
      w.minutes = sel.value === '' ? null : Number(sel.value);
    };
    custom.oninput = () => (w.minutes = intOrNull(custom.value));
    return h('div', { class: 'row work' }, h('span', { class: 'k', text: '작업' }), title, sel, custom, removeBtn(draft.work, i));
  }

  function saleRow(s, i, data) {
    const item = h('select', { 'aria-label': '상품' },
      h('option', { value: '', text: '목록에 없음' }),
      ...data.items.map((it) => h('option', { value: it.id, text: it.name || '(이름 없음)', selected: it.id === s.item_id })),
    );
    item.onchange = () => {
      s.item_id = item.value || null;
      const it = data.items.find((x) => x.id === s.item_id);
      if (it) s.title = it.name;
      s.mark_sold = !!s.item_id;
      render();
    };
    const title = h('input', { type: 'text', value: s.title, placeholder: '무엇을?', 'aria-label': '판매한 것', hidden: !!s.item_id });
    title.oninput = () => (s.title = title.value);
    const channel = h('select', { 'aria-label': '판매처' },
      h('option', { value: '', text: '판매처 ?' }),
      ...[...new Set([...data.channels, ...(s.channel ? [s.channel] : [])])].map((c) => h('option', { value: c, text: c, selected: c === s.channel })),
    );
    channel.onchange = () => (s.channel = channel.value || null);
    const amount = h('input', { type: 'number', min: 0, step: 1000, value: s.amount ?? '', placeholder: '₩ ?', 'aria-label': '금액' });
    amount.oninput = () => (s.amount = intOrNull(amount.value));
    const qty = h('input', { type: 'number', min: 1, step: 1, value: s.qty, 'aria-label': '수량', class: 'qty' });
    qty.oninput = () => (s.qty = Math.max(1, intOrNull(qty.value) ?? 1));
    const gift = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.gift, onchange: (e) => (s.gift = e.target.checked) }), '선물');
    const sold = s.item_id
      ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.mark_sold, onchange: (e) => (s.mark_sold = e.target.checked) }), '사이트에서 SOLD로 표시')
      : null;
    return h('div', { class: 'row sale' }, h('span', { class: 'k', text: '판매' }), item, title, channel, amount, qty, gift, sold, removeBtn(draft.sales, i));
  }

  async function save() {
    if (busy) return;
    busy = true;
    render();
    const clean = {
      date: draft.date,
      text,
      work: draft.work.filter((w) => w.title.trim()).map((w) => ({ ...w, title: w.title.trim() })),
      sales: draft.sales.filter((s) => s.item_id || s.title.trim() || s.amount != null),
    };
    try {
      await ctx.api.save(clean);
      const saved = { ...draft, ...clean };
      text = '';
      draft = null;
      note = '';
      busy = false;
      date = ctx.today();
      render();
      ctx.onSaved(saved);
    } catch (err) {
      console.error(err);
      busy = false;
      note = '저장하지 못했어: ' + (err.message || err);
      render();
    }
  }

  render();
  return {
    setDate(d) { date = d; draft = null; render(); root.scrollIntoView({ behavior: 'smooth', block: 'start' }); root.querySelector('textarea')?.focus(); },
    refresh: render,
  };
}
