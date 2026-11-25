import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout, pad3, resolvePiece, groupPieces, nextNo } from '../js/stall.js';

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
