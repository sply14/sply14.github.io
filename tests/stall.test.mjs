import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout, frame, aspectOf, pad3, resolvePiece, groupPieces, nextNo } from '../js/stall.js';

const PC = { W: 1230, H: 660 };
const PHONE = { W: 352, H: 690 };

test('pad3 writes the number as 001', () => {
  assert.equal(pad3(1), '001');
  assert.equal(pad3(48), '048');
  assert.equal(pad3(1234), '1234');
});

test('layout never leaves a hole: label + pieces fill a whole rectangle', () => {
  for (const { W, H } of [PC, PHONE, { W: 2500, H: 1300 }, { W: 720, H: 1000 }]) {
    for (let n = 1; n <= 300; n++) {
      const l = layout(n, W, H);
      assert.equal(l.label + n, l.cols * l.rows, `n=${n} W=${W}`);
      assert.ok(l.label >= 1 && l.label <= l.cols, `label n=${n} W=${W} ${JSON.stringify(l)}`);
    }
  }
});

test('few pieces get big cells that use the screen', () => {
  for (const n of [1, 2, 3, 4, 5, 6]) {
    for (const { W, H } of [PC, PHONE]) {
      const l = layout(n, W, H);
      assert.ok(l.rows * l.rowH >= H * 0.6, `n=${n} W=${W} height ${l.rows * l.rowH} of ${H}`);
      assert.ok(l.rows * l.rowH <= H + 1, `n=${n} W=${W} fits`);
    }
  }
});

test('a normal batch fits one screen without scrolling', () => {
  for (let n = 1; n <= 60; n++) {
    const l = layout(n, PC.W, PC.H);
    assert.ok(l.rows * l.rowH <= PC.H + 1, `n=${n} ${JSON.stringify(l)}`);
  }
});

test('more pieces never mean bigger cells by much, and many are dense', () => {
  assert.ok(layout(100, PC.W, PC.H).cell < 110);
  assert.ok(layout(100, PC.W, PC.H).cell >= 80);
  assert.ok(layout(12, PC.W, PC.H).cell > layout(48, PC.W, PC.H).cell);
});

test('cells stay tappable however many there are', () => {
  assert.ok(layout(300, PC.W, PC.H).cell >= 80);
  assert.ok(layout(300, PHONE.W, PHONE.H).cols <= 6);
});

test('row height stays near the cell width and tappable', () => {
  for (let n = 1; n <= 120; n++) {
    for (const { W, H } of [PC, PHONE]) {
      const l = layout(n, W, H);
      assert.ok(l.rowH >= l.cell * 0.64 - 1 && l.rowH <= l.cell * 1.5 + 1 && l.rowH >= 44, `n=${n}`);
    }
  }
});

test('resolvePiece falls back to the parent for blank fields and keeps its own', () => {
  const parent = { id: 'p', name: 'Wallet', code: 'C14-W', price: 30000, size: 'S', material: 'Leather', description: 'common', buy_url: 'https://a.b', scale: 1.8, style: { ox: 0.1 }, sold: false };
  const r = resolvePiece(parent, { id: 'c', no: 4, price: null, size: '', material: '', description: 'own', buy_url: '', sold: true, image_url: 'i', scale: 1, style: {} });
  assert.deepEqual(
    [r.id, r.name, r.no, r.price, r.size, r.description, r.sold, r.scale, r.style.ox, r.buy_url],
    ['c', 'Wallet', 4, 30000, 'S', 'own', true, 1.8, 0.1, 'https://a.b'],
  );
  assert.equal(resolvePiece(parent, { id: 'c', no: 1, price: 0 }).price, 0);
});

test('a sold-out parent sells out every piece', () => {
  assert.equal(resolvePiece({ id: 'p', sold: true }, { id: 'c', no: 1, sold: false }).sold, true);
});

test('groupPieces attaches pieces in number order and drops orphans', () => {
  const { products, stalls } = groupPieces([
    { id: 'p', kind: 'product' },
    { id: 't', kind: 'text' },
    { id: 'b', kind: 'piece', parent_id: 'p', no: 2 },
    { id: 'a', kind: 'piece', parent_id: 'p', no: 1 },
    { id: 'x', kind: 'piece', parent_id: 'gone', no: 1 },
  ]);
  assert.deepEqual(products.map((i) => i.id), ['p', 't']);
  assert.deepEqual(stalls.get('p').map((i) => i.id), ['a', 'b']);
  assert.equal(stalls.size, 1);
});

test('nextNo continues after the highest number, never reusing a gap', () => {
  assert.equal(nextNo([]), 1);
  assert.equal(nextNo([{ no: 1 }, { no: 5 }, { no: 3 }]), 6);
});

const shown = (f, r, bw, bh) => { const w = Math.min(bw, bh * r) * f.s; return [w, w / r]; };

test('frame leaves an unscaled 1x1 photo filling its box', () => {
  const f = frame({ scale: 1, w: 1, h: 1, style: {} }, 1, 84, 80);
  assert.ok(Math.abs(shown(f, 1, 84, 80)[0] - 80) < 0.01);
  assert.equal(f.ox, 0);
});

test('frame shrinks a wide zoomed tile so the part visible in the tile fits the box', () => {
  // 2x1 칸에 206%로 확대된 카드지갑 (사진 800x597)
  const r = 800 / 597;
  const f = frame({ scale: 2.06, w: 2, h: 1, style: { ox: 0, oy: -0.05 } }, r, 84, 80);
  const [w, h] = shown(f, r, 84, 80);
  const tile = Math.min(1.6, 0.8 * r) * 2.06; // 타일에서의 사진 폭 (칸 단위)
  assert.ok(Math.abs((w / tile) * 2 - 84) < 0.01, 'the 2-cell window spans the box width');
  assert.ok((h / (tile / r)) * 1 <= 80);
  // 세로 위치도 같은 비율로 옮겨짐: -0.05 × 0.8칸
  assert.ok(Math.abs(f.oy * 80 - -0.05 * 0.8 * (w / tile)) < 0.01);
});

test('wide photos get flatter rows, so they end up bigger and tighter', () => {
  for (const n of [12, 30, 48]) {
    const sq = layout(n, 740, 1060), wide = layout(n, 740, 1060, 2);
    assert.ok(wide.rowH / wide.cell < sq.rowH / sq.cell, `n=${n}`);
    assert.ok(wide.cell > sq.cell, `n=${n} ${JSON.stringify(wide)}`);
    assert.equal(wide.label + n, wide.cols * wide.rows);
    assert.ok(wide.rows * wide.rowH <= 1061);
  }
});

test('aspect is the visible window of the tile', () => {
  assert.ok(Math.abs(aspectOf({ scale: 2.06, w: 2, h: 1 }, 800 / 597) - 2) < 0.01);
  assert.ok(Math.abs(aspectOf({ scale: 1, w: 1, h: 1 }, 1) - 1) < 0.01);
  assert.ok(aspectOf({ scale: 1, w: 1, h: 1 }, 10) <= 2.2);
});
