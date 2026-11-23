import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kstToday, daysInMonth, addDays, diffDays, yearDates } from '../js/log-dates.js';

test('kstToday rolls over at Korean midnight, not UTC midnight', () => {
  assert.equal(kstToday(new Date('2026-11-23T15:30:00Z')), '2026-11-24');
  assert.equal(kstToday(new Date('2026-11-23T14:59:00Z')), '2026-11-23');
});

test('daysInMonth handles short months and leap years', () => {
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 12), 31);
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('diffDays counts days from a to b', () => {
  assert.equal(diffDays('2026-11-01', '2026-11-24'), 23);
  assert.equal(diffDays('2026-11-24', '2026-11-01'), -23);
});

test('yearDates lists every day of the year in order', () => {
  const d = yearDates(2026);
  assert.equal(d.length, 365);
  assert.equal(d[0], '2026-01-01');
  assert.equal(d[364], '2026-12-31');
  assert.equal(yearDates(2028).length, 366);
});
