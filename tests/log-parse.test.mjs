import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeParse, parseKoreanAmount, fakeParse } from '../js/log-parse-local.js';

const ctx = {
  today: '2026-11-24',
  items: [{ id: 'a', name: '심볼 지폐홀더' }, { id: 'b', name: '6뾰족 월렛' }],
  channels: ['DM', '스마트스토어', '후르츠패밀리'],
};

test('parseKoreanAmount reads common Korean money phrases as won', () => {
  assert.equal(parseKoreanAmount('3만원'), 30000);
  assert.equal(parseKoreanAmount('30,000원'), 30000);
  assert.equal(parseKoreanAmount('만오천원'), 15000);
  assert.equal(parseKoreanAmount('1.5만'), 15000);
  assert.equal(parseKoreanAmount('삼만원'), 30000);
  assert.equal(parseKoreanAmount('팔림'), null);
});

test('fakeParse splits work and a sale with item, channel and amount', () => {
  const d = fakeParse('카드지갑 패턴 2시간 수정. 지폐홀더 후르츠에서 3만원에 팔림', ctx);
  assert.equal(d.date, '2026-11-24');
  assert.equal(d.rest, false);
  assert.equal(d.work.length, 1);
  assert.equal(d.work[0].title, '카드지갑 패턴 2시간 수정');
  assert.equal(d.work[0].minutes, 120);
  assert.equal(d.sales.length, 1);
  assert.equal(d.sales[0].item_id, 'a');
  assert.equal(d.sales[0].channel, '후르츠패밀리');
  assert.equal(d.sales[0].amount, 30000);
  assert.equal(d.sales[0].mark_sold, true);
});

test('fakeParse reads "어제 쉼" as a rest day yesterday', () => {
  const d = fakeParse('어제 쉼', ctx);
  assert.equal(d.date, '2026-11-23');
  assert.equal(d.rest, true);
  assert.deepEqual(d.work, []);
  assert.deepEqual(d.sales, []);
});

test('normalizeParse drops bad values instead of guessing', () => {
  const d = normalizeParse(
    { date: '2099-01-01', work: [{ title: 'x', minutes: -5 }], sales: [{ item_id: 'zzz', title: 'y', amount: '3만' }] },
    ctx,
  );
  assert.equal(d.date, '2026-11-24');
  assert.equal(d.work[0].minutes, null);
  assert.equal(d.sales[0].item_id, null);
  assert.equal(d.sales[0].amount, null);
  assert.equal(d.sales[0].mark_sold, false);
  assert.equal(d.sales[0].qty, 1);
});

test('normalizeParse turns garbage into an empty draft for today', () => {
  assert.deepEqual(normalizeParse(null, ctx), { date: '2026-11-24', rest: false, work: [], sales: [] });
});

test('normalizeParse keeps a valid past date and trims channel', () => {
  const d = normalizeParse({ date: '2026-11-20', sales: [{ title: 'z', channel: ' DM ', amount: 5000, item_id: 'b' }] }, ctx);
  assert.equal(d.date, '2026-11-20');
  assert.equal(d.sales[0].channel, 'DM');
  assert.equal(d.sales[0].mark_sold, true);
});
