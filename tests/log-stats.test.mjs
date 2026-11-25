import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_METRICS } from '../js/log-level.js';
import { portfolioByDate, addedOn, levelByDate, records, cellLevel, makings, makingsOn, stickers, daySummary } from '../js/log-stats.js';

const kst = (date, hh = '12:00') => new Date(`${date}T${hh}:00+09:00`).toISOString();
const empty = () => ({ days: [], work: [], sales: [], events: [], items: [] });

test('portfolioByDate adds and removes per KST day', () => {
  const events = [
    { item_id: 'a', event: 'added', at: kst('2026-11-01') },
    { item_id: 'b', event: 'added', at: kst('2026-11-02') },
    { item_id: 'a', event: 'hidden', at: kst('2026-11-03') },
  ];
  const m = portfolioByDate(events, '2026-11-01', '2026-11-04');
  assert.deepEqual(m.get('2026-11-01'), { kinds: 1, made: 1 });
  assert.deepEqual(m.get('2026-11-02'), { kinds: 2, made: 2 });
  assert.deepEqual(m.get('2026-11-03'), { kinds: 1, made: 1 });
  assert.deepEqual(m.get('2026-11-04'), { kinds: 1, made: 1 });
});

test('addedOn uses the Korean date of the event', () => {
  const events = [{ item_id: 'a', event: 'added', at: '2026-11-23T15:30:00Z' }];
  assert.deepEqual(addedOn(events, '2026-11-24'), ['a']);
  assert.deepEqual(addedOn(events, '2026-11-23'), []);
});

test('revenue level uses the best 365-day window and never goes down', () => {
  const data = empty();
  data.days = [{ date: '2025-12-01' }, { date: '2026-11-20' }];
  data.sales = [
    { date: '2025-12-01', item_id: null, title: 'x', amount: 1000000, qty: 1, gift: false },
    { date: '2026-11-20', item_id: null, title: 'y', amount: 30000, qty: 1, gift: false },
  ];
  const lv = levelByDate(data, '2025-12-01', '2026-12-31');
  const nov24 = lv.get('2026-11-24').parts.revenue;
  const dec31 = lv.get('2026-12-31').parts.revenue;
  assert.ok(nov24 > lv.get('2026-11-19').parts.revenue);
  assert.ok(dec31 >= nov24);
  assert.equal(lv.get('2026-11-24').values.revenue, 1030000);
  assert.equal(lv.get('2026-12-31').values.revenue, 1030000);
});

test('gift sales do not count as revenue', () => {
  const data = empty();
  data.days = [{ date: '2026-11-20' }];
  data.sales = [{ date: '2026-11-20', item_id: null, title: 'g', amount: 50000, qty: 1, gift: true }];
  assert.equal(levelByDate(data, '2026-11-20', '2026-11-20').get('2026-11-20').parts.revenue, 0);
  assert.equal(records(data, '2026-11-20').revenue28.value, 0);
});

test('cellLevel separates no record, rest, and work intensity', () => {
  const data = empty();
  data.days = [{ date: '2026-11-01' }, { date: '2026-11-02' }];
  data.work = [{ date: '2026-11-02', title: 't', minutes: 90, span_key: null }];
  assert.equal(cellLevel('2026-10-31', data), 'none');
  assert.equal(cellLevel('2026-11-01', data), 'rest');
  assert.equal(cellLevel('2026-11-02', data), 2);
});

test('a day with work of unknown length or only a sale is filled, not a rest day', () => {
  const data = empty();
  data.days = [{ date: '2026-11-03' }, { date: '2026-11-04' }];
  data.work = [{ date: '2026-11-03', title: '패턴 수정', minutes: null, span_key: null }];
  data.sales = [{ date: '2026-11-04', item_id: null, title: 'x', amount: 30000, qty: 1, gift: false }];
  assert.equal(cellLevel('2026-11-03', data), 1);
  assert.equal(cellLevel('2026-11-04', data), 1);
});

test('streak counts back from today, or from yesterday if today is empty', () => {
  const data = empty();
  data.days = ['2026-11-20', '2026-11-22', '2026-11-23', '2026-11-24'].map((date) => ({ date }));
  assert.equal(records(data, '2026-11-24').streak.value, 3);
  assert.equal(records(data, '2026-11-25').streak.value, 3);
  assert.equal(records(data, '2026-11-27').streak.value, 0);
});

test('records sum revenue over 28 days and mark the day a best was broken', () => {
  const data = empty();
  data.days = [{ date: '2026-11-10' }, { date: '2026-11-24' }];
  data.sales = [
    { date: '2026-11-10', item_id: null, title: 'a', amount: 30000, qty: 1, gift: false },
    { date: '2026-11-24', item_id: null, title: 'b', amount: 20000, qty: 2, gift: false },
  ];
  const r = records(data, '2026-11-24');
  assert.equal(r.revenue28.value, 70000);
  assert.equal(r.revenue28.brokeOn, '2026-11-24');
  assert.equal(r.bestDay.best, 40000);
});

test('stickers fall back to a text tag when the sold item was deleted', () => {
  const data = empty();
  data.days = [{ date: '2026-11-24' }];
  data.sales = [{ date: '2026-11-24', item_id: 'gone', title: '심볼 지폐홀더', amount: 30000, qty: 1, gift: false }];
  const levels = levelByDate(data, '2026-11-23', '2026-11-24');
  const sale = stickers(data, levels, '2026-11-24', '2026-11-24').find((s) => s.kind === 'sale');
  assert.equal(sale.img, undefined);
  assert.equal(sale.label, '심볼 지폐홀더');
});

test('stickers show product photos on the day they were added and a star when the level rises', () => {
  const data = empty();
  data.items = [{ id: 'a', name: '월렛', thumb_url: 't.png', image_url: 'i.png', kind: 'product' }];
  data.events = [{ item_id: 'a', event: 'added', at: kst('2026-11-24') }];
  const levels = levelByDate(data, '2026-11-23', '2026-11-24');
  const list = stickers(data, levels, '2026-11-24', '2026-11-24');
  assert.equal(list.find((s) => s.kind === 'product').img, 't.png');
  const star = list.find((s) => s.kind === 'star' || s.kind === 'tier');
  assert.ok(star, 'a level rise from 0 should add a star or tier sticker');
});

test('products that are hidden now get no photo sticker', () => {
  const data = empty();
  data.items = [
    { id: 'a', name: '보임', thumb_url: 'a.png', image_url: '', kind: 'product', hidden: false },
    { id: 'b', name: '숨김', thumb_url: 'b.png', image_url: '', kind: 'product', hidden: true },
  ];
  data.events = [
    { item_id: 'a', event: 'added', at: kst('2026-11-24') },
    { item_id: 'b', event: 'added', at: kst('2026-11-24') },
  ];
  const levels = levelByDate(data, '2026-11-23', '2026-11-24');
  const photos = stickers(data, levels, '2026-11-24', '2026-11-24').filter((s) => s.kind === 'product');
  assert.deepEqual(photos.map((s) => s.item_id), ['a']);
});

test('daySummary totals one day of work and sales', () => {
  const data = empty();
  data.days = [{ date: '2026-11-24' }];
  data.work = [
    { date: '2026-11-24', title: '패턴', minutes: 120, span_key: null },
    { date: '2026-11-24', title: '촬영', minutes: null, span_key: null },
  ];
  data.sales = [
    { date: '2026-11-24', item_id: null, title: 'a', amount: 30000, qty: 2, gift: false },
    { date: '2026-11-24', item_id: null, title: 'g', amount: 50000, qty: 1, gift: true },
  ];
  const s = daySummary(data, '2026-11-24');
  assert.equal(s.recorded, true);
  assert.equal(s.minutes, 120);
  assert.equal(s.revenue, 60000);
  assert.deepEqual(s.work.map((w) => w.title), ['패턴', '촬영']);
  assert.equal(s.sales.length, 2);
  assert.equal(daySummary(data, '2026-11-25').recorded, false);
});

/* ───────── 종류와 만든 개수 (좌판) ───────── */

const added = (id, date, parent_id = null, hh) => ({ item_id: id, event: 'added', at: kst(date, hh), parent_id });

test('pieces count toward made, and their parent is not counted twice', () => {
  const events = [
    added('a', '2026-11-01'), added('w', '2026-11-01'),
    added('w1', '2026-11-02', 'w'), added('w2', '2026-11-02', 'w'), added('w3', '2026-11-03', 'w'),
    { item_id: 'w3', event: 'deleted', at: kst('2026-11-04'), parent_id: 'w' },
    { item_id: 'w', event: 'hidden', at: kst('2026-11-05') },
    { item_id: 'w', event: 'shown', at: kst('2026-11-06') },
  ];
  const m = portfolioByDate(events, '2026-11-01', '2026-11-06');
  assert.deepEqual([...m.values()].map((v) => [v.kinds, v.made]), [[2, 2], [2, 3], [2, 4], [2, 3], [1, 1], [2, 3]]);
});

test('a product hidden in the same moment it was added, and changes before the range, are handled', () => {
  const events = [
    added('a', '2026-11-01'),
    added('h', '2026-11-01'), { item_id: 'h', event: 'hidden', at: kst('2026-11-01') },
    added('h1', '2026-11-01', 'h'),
  ];
  assert.deepEqual(portfolioByDate(events, '2026-11-10', '2026-11-10').get('2026-11-10'), { kinds: 1, made: 1 });
});

test('ten more of one kind are worth one new kind, and thirty kinds beat thirty of one kind', () => {
  const build = (kinds, pieces) => {
    const data = empty();
    for (let i = 0; i < kinds; i++) data.events.push(added(`k${i}`, '2026-11-01'));
    for (let i = 0; i < pieces; i++) data.events.push(added(`p${i}`, '2026-11-02', 'k0'));
    return levelByDate(data, '2026-11-02', '2026-11-02').get('2026-11-02');
  };
  assert.ok(Math.abs(build(3, 11).values.works - 4) < 1e-9);
  assert.ok(Math.abs(build(4, 0).values.works - 4) < 1e-9);
  assert.ok(build(1, 11).total > build(1, 2).total);
  assert.ok(build(30, 0).total > build(1, 30).total * 2);
  const now = build(3, 30).values;
  assert.deepEqual([now.kinds, now.made], [3, 32]);
});

test('the ratio comes from the settings', () => {
  const data = empty();
  data.events = [added('a', '2026-11-01'), ...[1, 2, 3, 4, 5, 6].map((i) => added(`p${i}`, '2026-11-01', 'a'))];
  const metrics = { ...DEFAULT_METRICS, works: { ...DEFAULT_METRICS.works, repeat: 5 } };
  assert.equal(levelByDate(data, '2026-11-01', '2026-11-01', metrics).get('2026-11-01').values.works, 2);
});

test('the works level never goes down when pieces are deleted', () => {
  const data = empty();
  data.events = [added('a', '2026-11-01'), added('p1', '2026-11-01', 'a'), added('p2', '2026-11-01', 'a'),
    { item_id: 'p2', event: 'deleted', at: kst('2026-11-02'), parent_id: 'a' }];
  const lv = levelByDate(data, '2026-11-01', '2026-11-02');
  assert.equal(lv.get('2026-11-02').total, lv.get('2026-11-01').total);
});

test('portfolio record uses the made count and knows the kinds', () => {
  const data = empty();
  data.events = [added('a', '2026-11-01'), added('b', '2026-11-01'), added('p1', '2026-11-02', 'a'), added('p2', '2026-11-02', 'a')];
  const r = records(data, '2026-11-02').portfolio;
  assert.deepEqual([r.value, r.best, r.kinds, r.brokeOn], [3, 3, 2, '2026-11-02']);
});

test('piece stickers are named after the parent, follow its hidden state, and replace it on the same day', () => {
  const data = empty();
  data.items = [
    { id: 'w', name: 'Wallet', thumb_url: 'w.png', kind: 'product', hidden: false },
    { id: 'w1', name: '', thumb_url: 'w1.png', kind: 'piece', hidden: false, parent_id: 'w', no: 1 },
    { id: 'h', name: '숨김', thumb_url: 'h.png', kind: 'product', hidden: true },
    { id: 'h1', name: '', thumb_url: 'h1.png', kind: 'piece', hidden: false, parent_id: 'h', no: 1 },
  ];
  data.events = [added('w', '2026-11-24'), added('w1', '2026-11-24', 'w'), added('h1', '2026-11-24', 'h')];
  const levels = levelByDate(data, '2026-11-23', '2026-11-24');
  const photos = stickers(data, levels, '2026-11-24', '2026-11-24').filter((s) => s.kind === 'product');
  assert.deepEqual(photos.map((s) => [s.item_id, s.img, s.label]), [['w1', 'w1.png', 'Wallet 001']]);
});

/* ───────── 만든 기간 ───────── */

const w = (date, title, minutes, span_key = null, item_id = null) => ({ date, title, minutes, span_key, item_id });
const makingData = () => ({
  ...empty(),
  items: [
    { id: 'w', name: 'Wallet', kind: 'product', hidden: false },
    { id: 'w1', name: '', kind: 'piece', parent_id: 'w', no: 1, hidden: false },
    { id: 'x', name: '기록 없는 것', kind: 'product', hidden: false },
  ],
  work: [
    w('2026-11-03', '지갑 패턴', 60, 'wallet'), w('2026-11-05', '지갑 재단', null, 'wallet', 'w'),
    w('2026-11-05', '지갑 바느질', 30, 'wallet'), w('2026-11-08', '마감', 90, null, 'w'),
    w('2026-11-06', '가방 패턴', 120, 'bag'), w('2026-11-07', '촬영', 60),
  ],
  events: [added('w1', '2026-11-10', 'w'), added('x', '2026-11-10')],
});

test('a making period runs from the first to the last work day, joined through the span key', () => {
  const m = makings(makingData()).get('item:w');
  assert.deepEqual([m.label, m.from, m.to, m.minutes], ['Wallet', '2026-11-03', '2026-11-08', 180]);
  assert.deepEqual([...m.dates].sort(), ['2026-11-03', '2026-11-05', '2026-11-08']);
});

test('work for something not on the site yet is grouped by its span key', () => {
  const m = makings(makingData()).get('span:bag');
  assert.deepEqual([m.label, m.from, m.to], ['가방 패턴', '2026-11-06', '2026-11-06']);
});

test('makingsOn finds the period from a work day, a piece photo, or a sale, and nothing when there is no work', () => {
  const data = makingData();
  const labels = (d) => makingsOn(data, d).map((m) => m.label);
  assert.deepEqual(labels('2026-11-05'), ['Wallet']);
  assert.deepEqual(labels('2026-11-06'), ['가방 패턴']);
  assert.deepEqual(labels('2026-11-10'), ['Wallet']);
  assert.deepEqual(labels('2026-11-07'), []);
  data.sales = [{ date: '2026-11-20', item_id: 'w1', title: '', amount: 1, qty: 1, gift: false }];
  assert.deepEqual(makingsOn({ ...data }, '2026-11-20').map((m) => m.label), ['Wallet']);
});

test('a piece with its own work keeps its own period', () => {
  const data = makingData();
  data.work.push(w('2026-11-09', '1번 염색', 20, null, 'w1'));
  assert.deepEqual(makingsOn(data, '2026-11-10').map((m) => [m.label, m.from]), [['Wallet 001', '2026-11-09']]);
});
