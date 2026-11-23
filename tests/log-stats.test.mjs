import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portfolioByDate, addedOn, levelByDate, records, cellLevel, spans, stickers, daySummary } from '../js/log-stats.js';

const kst = (date, hh = '12:00') => new Date(`${date}T${hh}:00+09:00`).toISOString();
const empty = () => ({ days: [], work: [], sales: [], events: [], items: [] });

test('portfolioByDate adds and removes per KST day', () => {
  const events = [
    { item_id: 'a', event: 'added', at: kst('2026-11-01') },
    { item_id: 'b', event: 'added', at: kst('2026-11-02') },
    { item_id: 'a', event: 'hidden', at: kst('2026-11-03') },
  ];
  const m = portfolioByDate(events, '2026-11-01', '2026-11-04');
  assert.equal(m.get('2026-11-01'), 1);
  assert.equal(m.get('2026-11-02'), 2);
  assert.equal(m.get('2026-11-03'), 1);
  assert.equal(m.get('2026-11-04'), 1);
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

test('spans join consecutive days with the same span key, ignoring one-day work', () => {
  const work = [
    { date: '2026-11-01', title: '카드지갑 패턴', minutes: 60, span_key: 'wallet' },
    { date: '2026-11-02', title: '카드지갑 패턴', minutes: 60, span_key: 'wallet' },
    { date: '2026-11-03', title: '카드지갑 패턴', minutes: 60, span_key: 'wallet' },
    { date: '2026-11-05', title: '촬영', minutes: 60, span_key: 'shoot' },
  ];
  assert.deepEqual(spans(work), [{ span_key: 'wallet', title: '카드지갑 패턴', from: '2026-11-01', to: '2026-11-03' }]);
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
