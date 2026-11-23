import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_METRICS, metricLevel, brandLevel, floor1, TIERS, tierOf, nextTier } from '../js/log-level.js';

const near = (actual, expected, tol) => assert.ok(Math.abs(actual - expected) <= tol, `${actual} is not within ${tol} of ${expected}`);

test('revenue level follows the spec table (p = 7, baseline 11 trillion won)', () => {
  const r = DEFAULT_METRICS.revenue;
  near(metricLevel(30000, r), 6.0, 0.1);
  near(metricLevel(1e8, r), 19.0, 0.1);
  near(metricLevel(1e10, r), 36.8, 0.2);
  near(metricLevel(1e12, r), 71.0, 0.2);
  assert.equal(metricLevel(11e12, r), 100);
  assert.equal(metricLevel(1e15, r), 100);
  assert.equal(metricLevel(0, r), 0);
});

test('42 portfolio pieces land near works level 12', () => {
  near(metricLevel(42, DEFAULT_METRICS.works), 12.1, 0.3);
});

test('brandLevel is the weighted average of the three parts', () => {
  const { total, parts } = brandLevel({ works: 42, revenue: 30000, social: 0 });
  near(total, (parts.works * 30 + parts.revenue * 40 + 0) / 100, 1e-9);
  assert.equal(parts.social, 0);
});

test('brandLevel uses overridden weights', () => {
  const m = { ...DEFAULT_METRICS, revenue: { ...DEFAULT_METRICS.revenue, weight: 0 } };
  const { total, parts } = brandLevel({ works: 42, revenue: 30000, social: 0 }, m);
  near(total, (parts.works * 30) / 60, 1e-9);
});

test('floor1 cuts to one decimal instead of rounding up', () => {
  assert.equal(floor1(7.39), 7.3);
  assert.equal(floor1(7.95), 7.9);
  assert.equal(floor1(10), 10);
});

test('tiers cover 0 to 100 in twelve steps', () => {
  assert.equal(TIERS.length, 12);
  assert.equal(tierOf(0).min, 0);
  assert.equal(tierOf(0.05).min, 0);
  assert.equal(tierOf(0.5).min, 1);
  assert.equal(tierOf(9.9).min, 1);
  assert.equal(tierOf(10).min, 10);
  assert.equal(tierOf(100).min, 100);
  assert.equal(nextTier(9.9).min, 10);
  assert.equal(nextTier(100), null);
  assert.equal(TIERS[11].name, '구찌급. 사실상 도달 불가능한 끝');
});
