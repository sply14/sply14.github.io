import { look, fitText, fitAll, FONTS, h, SUPABASE_URL, SUPABASE_KEY, TABLE, BUCKET, COLS, LOCAL, LOCAL_KEY, loadLocal } from './common.js?v=1795448926';

const $ = (s) => document.querySelector(s);
const grid = $('#grid');
const panel = $('#panel');
const form = $('#form');
const fileInput = $('#file');
const statusEl = $('#status');

let api;
let items = [];
let rows = 6;
let selected = null;   // 편집 패널에 열려 있는 상품
let fileTarget = null; // 파일 선택 창의 용도: {kind:'new', cell} | {kind:'main'} | {kind:'detail'}
// 빈칸 없이 채우기: 켜면 모든 상품이 1행 1열부터 순서대로 빈틈없이 놓임 (끄면 자유 배치)
const PACK_KEY = 'catalog-auto-pack';
let autoPack = localStorage.getItem(PACK_KEY) !== 'off';
let order = [];        // 채우기 순서 (상품 id)
let hiddenItems = [];  // 숨긴 상품 (사이트에 안 보이고 그리드 칸도 차지하지 않음, 복구 가능)
const picked = new Set(); // 여러 개 선택된 상품 id

/* ───────── 데이터 계층 ───────── */

async function remoteApi() {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  const ok = ({ data, error }) => {
    if (error) throw error;
    return data;
  };
  const pathOf = (url) => {
    const mark = `/object/public/${BUCKET}/`;
    const i = (url || '').indexOf(mark);
    return i < 0 ? null : decodeURIComponent(url.slice(i + mark.length));
  };
  return {
    async user() {
      return (await sb.auth.getSession()).data.session?.user ?? null;
    },
    async signIn(email, password) {
      ok(await sb.auth.signInWithPassword({ email, password }));
    },
    async signOut() {
      await sb.auth.signOut();
    },
    async isAdmin() {
      return !!ok(await sb.from('admins').select('user_id').maybeSingle());
    },
    async list() {
      return ok(await sb.from(TABLE).select('*').order('y').order('x'));
    },
    async insert(row) {
      return ok(await sb.from(TABLE).insert(row).select().single());
    },
    async update(id, patch) {
      ok(await sb.from(TABLE).update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('id').single());
    },
    // 여러 상품의 위치·크기를 한 번에 저장 (전부 성공하거나 전부 실패)
    async setLayout(changes) {
      ok(await sb.rpc('catalog_set_layout', { changes }));
    },
    async remove(id) {
      ok(await sb.from(TABLE).delete().eq('id', id));
    },
    async removeMany(ids) {
      ok(await sb.from(TABLE).delete().in('id', ids));
    },
    async hide(ids) {
      const rows = ok(await sb.from(TABLE).update({ hidden: true, updated_at: new Date().toISOString() }).in('id', ids).select('id'));
      if (rows.length !== ids.length) throw new Error('일부 상품을 숨기지 못했습니다');
    },
    // 숨긴 상품을 새 자리와 함께 다시 보이게
    // 자리를 먼저 한 번에 저장한 뒤(숨긴 상태라 사이트에 영향 없음), 한 번의 요청으로 전부 보이게 → 일부만 복구되는 일이 없음
    async restore(rows) {
      await this.setLayout(rows);
      const ids = rows.map((r) => r.id);
      const done = ok(await sb.from(TABLE).update({ hidden: false, updated_at: new Date().toISOString() }).in('id', ids).select('id'));
      if (done.length !== ids.length) throw new Error('일부 상품을 복구하지 못했습니다');
    },
    async upload(blob) {
      const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      const path = `${crypto.randomUUID()}.${ext}`;
      ok(await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: '31536000' }));
      return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    },
    async removeFiles(urls) {
      const paths = urls.map(pathOf).filter(Boolean);
      if (paths.length) await sb.storage.from(BUCKET).remove(paths);
    },
  };
}

// 로컬 연습 모드 (?local): 브라우저 저장소만 사용
async function localApi() {
  let data = await loadLocal();
  const save = () => localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
  return {
    async user() { return { email: 'local' }; },
    async signIn() {},
    async signOut() {},
    async isAdmin() { return true; },
    async list() { return structuredClone(data); },
    async insert(row) {
      const full = { id: crypto.randomUUID(), kind: 'product', label: '', scale: 1, style: {}, name: '', code: '', price: null, sold: false, size: '', material: '', description: '', buy_url: '', detail_urls: [], ...row };
      data.push(full);
      save();
      return structuredClone(full);
    },
    async update(id, patch) { Object.assign(data.find((d) => d.id === id), patch); save(); },
    async setLayout(changes) {
      for (const { id, ...pos } of changes) Object.assign(data.find((d) => d.id === id), pos);
      save();
    },
    async remove(id) { data = data.filter((d) => d.id !== id); save(); },
    async removeMany(ids) { data = data.filter((d) => !ids.includes(d.id)); save(); },
    async hide(ids) { data.filter((d) => ids.includes(d.id)).forEach((d) => (d.hidden = true)); save(); },
    async restore(rows) {
      for (const { id, ...pos } of rows) Object.assign(data.find((d) => d.id === id), pos, { hidden: false });
      save();
    },
    upload(blob) {
      return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(blob);
      });
    },
    async removeFiles() {},
  };
}

/* ───────── 상태 표시 ───────── */

let statusTimer;
function status(text, err = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('err', err);
  clearTimeout(statusTimer);
  if (text && !err) statusTimer = setTimeout(() => (statusEl.textContent = ''), 1800);
}

async function run(label, fn) {
  status(label);
  try {
    const out = await fn();
    status('저장됨');
    return out;
  } catch (e) {
    console.error(e);
    status(`오류: ${e.message || e}`, true);
    throw e;
  }
}

/* ───────── 그리드 계산 ───────── */

const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const collides = (id, x, y, w, hh) => items.some((o) => o.id !== id && overlap({ x, y, w, h: hh }, o));

function firstFree(w, hh) {
  for (let y = 0; ; y++) for (let x = 0; x <= COLS - w; x++) if (!collides(null, x, y, w, hh)) return { x, y };
}

// 한 상품을 box 자리로 옮기거나 키웠을 때 나머지의 새 자리를 계산:
// 겹치는 상품은 읽는 순서(왼→오, 위→아래)대로 옆으로 밀려나고, 줄 끝에 닿으면 다음 줄 처음으로 넘어감
const pushLayout = (id, box) => pushLayoutMany(new Map([[id, box]]));

// 여러 상품(boxes: id → 새 자리)을 한꺼번에 옮겼을 때
function pushLayoutMany(boxes) {
  const placed = [...boxes.values()];
  const moved = new Map();
  const others = items.filter((o) => !boxes.has(o.id)).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const o of others) {
    const p = { x: o.x, y: o.y, w: o.w, h: o.h };
    while (placed.some((q) => overlap(p, q))) {
      p.x++;
      if (p.x + p.w > COLS) {
        p.x = 0;
        p.y++;
      }
    }
    placed.push(p);
    if (p.x !== o.x || p.y !== o.y) moved.set(o.id, { x: p.x, y: p.y });
  }
  return moved;
}

/* 빈칸 없이 채우기 */

const readingOrder = () => [...items].sort((a, b) => a.y - b.y || a.x - b.x).map((i) => i.id);
const itemAt = (cell, skipId) =>
  items.find((o) => o.id !== skipId && cell.x >= o.x && cell.x < o.x + o.w && cell.y >= o.y && cell.y < o.y + o.h);

// seq 순서대로 하나씩, 들어갈 수 있는 가장 앞자리에 놓는다. size로 일부의 크기를 바꿔서 계산할 수 있음
function packed(seq = order, size = {}) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const occ = [];
  const out = new Map();
  for (const id of seq) {
    const src = { ...(byId.get(id) || {}), ...(size[id] || {}) };
    const w = Math.min(COLS, src.w || 1);
    const hh = src.h || 1;
    find: for (let y = 0; ; y++) {
      for (let x = 0; x <= COLS - w; x++) {
        let ok = true;
        for (let dy = 0; ok && dy < hh; dy++) for (let dx = 0; dx < w; dx++) if (occ[y + dy]?.[x + dx]) { ok = false; break; }
        if (!ok) continue;
        for (let dy = 0; dy < hh; dy++) for (let dx = 0; dx < w; dx++) (occ[y + dy] ||= [])[x + dx] = true;
        out.set(id, { x, y, w, h: hh });
        break find;
      }
    }
  }
  return out;
}

// 그 칸에 끼워 넣을 때의 순서 위치: 칸에 상품이 있으면 그 앞, 없으면 그 칸 다음에 오는 상품 앞
function indexForCell(cell, seq = order, skipId) {
  if (!cell) return seq.length;
  const t = itemAt(cell, skipId);
  if (t) return seq.indexOf(t.id);
  const byId = new Map(items.map((i) => [i.id, i]));
  const i = seq.findIndex((id) => {
    const o = byId.get(id);
    return o && id !== skipId && (o.y > cell.y || (o.y === cell.y && o.x > cell.x));
  });
  return i < 0 ? seq.length : i;
}

// 끌어서 옮기거나 크기를 바꿨을 때 전체가 어떻게 놓일지 계산
function plan(it, box, mode, cell) {
  if (!autoPack) {
    const map = pushLayout(it.id, box);
    map.set(it.id, box);
    return { map, order: null };
  }
  let seq = order;
  const onSelf = cell && cell.x >= it.x && cell.x < it.x + it.w && cell.y >= it.y && cell.y < it.y + it.h;
  if (mode === 'move' && cell && !onSelf) {
    seq = order.slice();
    const from = seq.indexOf(it.id);
    const t = itemAt(cell, it.id);
    if (t) {
      // 다른 상품 위에 놓으면 둘이 자리를 맞바꿈
      const to = seq.indexOf(t.id);
      [seq[from], seq[to]] = [seq[to], seq[from]];
    } else {
      seq.splice(from, 1);
      seq.splice(indexForCell(cell, seq, it.id), 0, it.id);
    }
  }
  return { map: packed(seq, { [it.id]: { w: box.w, h: box.h } }), order: seq };
}

// 선택한 여러 상품을 한 묶음으로 끌었을 때 (fdx, fdy = 끈 거리, 칸 단위)
function planGroup(group, fdx, fdy, cell) {
  const ids = new Set(group.map((g) => g.id));
  if (autoPack) {
    // 채우기 모드: 묶음을 순서 그대로 놓은 칸의 상품 앞(뒤로 옮길 땐 뒤)에 끼워 넣음
    const t = itemAt(cell);
    if (t && ids.has(t.id)) return { map: packed(), order: null };
    const rest = order.filter((id) => !ids.has(id));
    const g = order.filter((id) => ids.has(id));
    let at;
    if (t) at = rest.indexOf(t.id) + (order.indexOf(t.id) > order.indexOf(g[0]) ? 1 : 0);
    else at = indexForCell(cell, rest);
    const seq = [...rest.slice(0, at), ...g, ...rest.slice(at)];
    return { map: packed(seq), order: seq };
  }
  // 자유 배치: 묶음 모양 그대로 평행 이동, 겹치는 상품은 밀려남
  const minX = Math.min(...group.map((o) => o.x));
  const maxX = Math.max(...group.map((o) => o.x + o.w));
  const minY = Math.min(...group.map((o) => o.y));
  const ddx = Math.max(-minX, Math.min(COLS - maxX, Math.round(fdx)));
  const ddy = Math.max(-minY, Math.round(fdy));
  const boxes = new Map(group.map((o) => [o.id, { x: o.x + ddx, y: o.y + ddy, w: o.w, h: o.h }]));
  const map = pushLayoutMany(boxes);
  boxes.forEach((b, id) => map.set(id, b));
  return { map, order: null };
}

// 배치 저장은 한 줄로 세워 차례로 보낸다 (앞 저장이 끝나기 전에 다음 저장이 끼어들어 순서가 뒤바뀌지 않게)
let layoutQueue = Promise.resolve();
let resyncPending = false;

// 계산된 배치를 확정하고 저장. 실패하면 DB에 실제로 저장된 상태를 다시 읽어와 화면을 맞춤
function commitChanges(map, newOrder) {
  const changes = [...map]
    .map(([id, pos]) => [items.find((i) => i.id === id), pos])
    .filter(([o, pos]) => o && (pos.x !== o.x || pos.y !== o.y || (pos.w ?? o.w) !== o.w || (pos.h ?? o.h) !== o.h));
  const prevOrder = order;
  if (newOrder) order = newOrder;
  if (!changes.length) {
    render();
    return Promise.resolve();
  }
  changes.forEach(([o, pos]) => Object.assign(o, pos));
  render();
  if (selected) fillPanel();
  // 바뀐 것만이 아니라 지금 화면의 전체 배치를 보냄 → 어느 저장이 실패해도, 마지막으로 성공한 저장이 겹침 없는 배치가 됨
  const payload = items.map((o) => ({ id: o.id, x: o.x, y: o.y, w: o.w, h: o.h }));
  const job = layoutQueue.then(() => run('저장 중…', () => api.setLayout(payload)));
  layoutQueue = job.catch(() => {
    order = prevOrder;
    scheduleResync();
  });
  return layoutQueue;
}

// 저장이 실패하면, 줄에 남은 저장이 모두 끝난 뒤 DB 상태를 한 번 다시 읽어옴
function scheduleResync() {
  if (resyncPending) return;
  resyncPending = true;
  layoutQueue = layoutQueue.then(async () => {
    resyncPending = false;
    try {
      await reload();
      status('저장에 실패해서 저장된 배치를 다시 불러왔습니다', true);
    } catch (err) {
      console.error(err);
      status('저장에 실패했습니다. 새로고침해서 확인해주세요', true);
    }
  });
}

// DB에서 전체를 다시 읽어 화면을 그림
async function reload() {
  const all = await api.list();
  items = all.filter((i) => !i.hidden);
  hiddenItems = all.filter((i) => i.hidden);
  order = readingOrder();
  selected = selected && items.find((i) => i.id === selected.id);
  for (const id of [...picked]) if (!items.some((i) => i.id === id)) picked.delete(id);
  render();
  renderHidden();
  fitAll(grid, '.txt');
  if (selected) fillPanel();
}

const repack = () => (autoPack ? commitChanges(packed()) : Promise.resolve());

// 밀려날 상품들을 예상 자리로 미끄러지듯 옮겨 보여줌 (저장 전 미리보기)
function previewPush(moved, skip) {
  const others = items.map((o) => [o, tiles.get(o.id)]).filter(([, t]) => t && !skip.has(t));
  const from = new Map(others.map(([, t]) => [t, t.getBoundingClientRect()]));
  let bottom = 0;
  for (const [o, t] of others) {
    t.getAnimations().forEach((a) => a.cancel());
    const pos = { ...o, ...(moved.get(o.id) || {}) };
    bottom = Math.max(bottom, pos.y + pos.h);
    place(t, pos);
  }
  if (bottom + 2 > rows) setRows(bottom + 3);
  for (const [, t] of others) {
    const a = from.get(t);
    const b = t.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (Math.abs(dx) + Math.abs(dy) < 1) continue;
    t.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
      duration: 320,
      easing: 'cubic-bezier(.2, .7, .1, 1)',
    });
  }
}

// 원하는 칸이 차 있으면 가장 가까운 빈 자리를 찾음
function nearestFree(cell, w, hh) {
  if (!cell) return firstFree(w, hh);
  let best = null;
  const maxY = Math.max(rows, cell.y) + 4;
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= COLS - w; x++) {
      if (collides(null, x, y, w, hh)) continue;
      const d = (x - cell.x) ** 2 + (y - cell.y) ** 2;
      if (!best || d < best.d) best = { x, y, d };
    }
  }
  return best ? { x: best.x, y: best.y } : firstFree(w, hh);
}

const cellSize = () => grid.clientWidth / COLS;

function cellAt(clientX, clientY) {
  const r = grid.getBoundingClientRect();
  const c = cellSize();
  return {
    x: Math.min(COLS - 1, Math.max(0, Math.floor((clientX - r.left) / c))),
    y: Math.max(0, Math.floor((clientY - r.top) / c)),
  };
}

function setRows(min = 0) {
  const bottom = items.reduce((m, it) => Math.max(m, it.y + it.h), 0);
  rows = Math.max(bottom + 3, min, 6);
  grid.style.setProperty('--rows', rows);
}

const place = (el, { x, y, w, h: hh }) => {
  el.style.setProperty('--x', x + 1);
  el.style.setProperty('--y', y + 1);
  el.style.setProperty('--w', w);
  el.style.setProperty('--h', hh);
};

// 타일은 상품 id별로 한 번만 만들고, 이후에는 바뀐 값만 갱신 (전체를 다시 그리면 사진이 깜빡임)
const tiles = new Map();
const tileOf = (it) => (it ? tiles.get(it.id) : null);

function makeTile(it) {
  return h(
    'div',
    { class: 'tile', 'data-id': it.id, tabindex: '0' },
    it.kind === 'text' ? h('span', { class: 'txt' }, h('span', { class: 't' })) : h('img', { alt: '', draggable: 'false' }),
    h('span', { class: 'badge' }),
    ['nw', 'ne', 'sw', 'se'].map((d) => h('span', { class: `handle ${d}`, 'data-dir': d })),
  );
}

function render() {
  setRows();
  const alive = new Set();
  for (const it of items) {
    alive.add(it.id);
    let el = tiles.get(it.id);
    if (!el) {
      el = makeTile(it);
      tiles.set(it.id, el);
      grid.append(el);
    }
    el.classList.toggle('selected', selected?.id === it.id);
    el.querySelector('.badge').textContent = `${it.w}×${it.h}`;
    if (it.kind === 'text') {
      el.querySelector('.t').textContent = (it.label || '').trimEnd();
    } else {
      const img = el.querySelector('img');
      const src = it.thumb_url || it.image_url;
      if (img.getAttribute('src') !== src) img.src = src;
      img.alt = it.name || '';
    }
    place(el, it);
    look(el, it);
    if (it.kind === 'text') fitText(el.querySelector('.txt'));
  }
  for (const [id, el] of tiles) {
    if (alive.has(id)) continue;
    el.remove();
    tiles.delete(id);
  }
  syncPicks();
}

/* ───────── 여러 개 선택 ───────── */

const multiBar = $('#multi');
function syncPicks() {
  for (const id of picked) if (!tiles.has(id)) picked.delete(id);
  for (const [id, el] of tiles) el.classList.toggle('picked', picked.has(id));
  multiBar.hidden = !picked.size;
  $('#m-count').textContent = `${picked.size}개 선택`;
}
const pickedItems = () => items.filter((i) => picked.has(i.id));
function clearPicks() {
  picked.clear();
  syncPicks();
}
// Shift·⌘·Ctrl + 클릭: 하나씩 선택에 넣거나 빼기
function togglePick(it) {
  if (selected && selected.id !== it.id) picked.add(selected.id);
  select(null);
  if (picked.has(it.id)) picked.delete(it.id);
  else picked.add(it.id);
  syncPicks();
}

// 빈 곳에서 끌면 사각형 안에 걸친 상품을 모두 선택
let marquee = null;
function startMarquee(e) {
  e.preventDefault();
  commitPendingEdit();
  const r = grid.getBoundingClientRect();
  marquee = {
    x0: e.clientX - r.left,
    y0: e.clientY - r.top,
    base: e.shiftKey || e.metaKey || e.ctrlKey ? new Set(picked) : new Set(),
    el: null,
  };
  grid.setPointerCapture(e.pointerId);
}
function moveMarquee(e) {
  const r = grid.getBoundingClientRect();
  const x1 = e.clientX - r.left;
  const y1 = e.clientY - r.top;
  if (!marquee.el) {
    if (Math.hypot(x1 - marquee.x0, y1 - marquee.y0) < 5) return;
    marquee.el = h('div', { class: 'marquee' });
    grid.append(marquee.el);
    select(null);
  }
  const L = Math.max(0, Math.min(marquee.x0, x1));
  const T = Math.max(0, Math.min(marquee.y0, y1));
  const R = Math.min(grid.clientWidth, Math.max(marquee.x0, x1));
  const B = Math.min(grid.clientHeight, Math.max(marquee.y0, y1));
  Object.assign(marquee.el.style, { left: `${L}px`, top: `${T}px`, width: `${R - L}px`, height: `${B - T}px` });
  picked.clear();
  marquee.base.forEach((id) => picked.add(id));
  for (const [id, t] of tiles) {
    const b = t.getBoundingClientRect();
    if (b.left < r.left + R && b.right > r.left + L && b.top < r.top + B && b.bottom > r.top + T) picked.add(id);
  }
  syncPicks();
  if (e.clientY > innerHeight - 50) scrollBy(0, 14);
  else if (e.clientY < 90) scrollBy(0, -14);
}
function endMarquee() {
  if (!marquee) return false;
  if (marquee.el) marquee.el.remove();
  else {
    // 빈 곳을 그냥 클릭: 선택 해제
    clearPicks();
    select(null);
  }
  marquee = null;
  return true;
}

/* ───────── 드래그: 이동 / 크기 조절 ───────── */

let drag = null;

grid.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || drag || marquee) return;
  const el = e.target.closest('.tile');
  if (!el) {
    if (e.pointerType !== 'touch') startMarquee(e);
    return;
  }
  const it = items.find((i) => String(i.id) === el.dataset.id);
  if (!it) return;
  commitPendingEdit();
  e.preventDefault();
  if (e.shiftKey || e.metaKey || e.ctrlKey) {
    togglePick(it);
    return;
  }
  const handle = e.target.closest('.handle');
  // 선택된 묶음 중 하나를 잡으면 묶음 전체를 옮김
  const group = !handle && picked.has(it.id) && picked.size > 1 ? pickedItems() : null;
  el.setPointerCapture(e.pointerId);
  drag = {
    el, it, group,
    mode: group ? 'group' : handle ? 'resize' : 'move',
    dir: handle?.dataset.dir || '',
    sx: e.clientX, sy: e.clientY, scrollY,
    next: { x: it.x, y: it.y, w: it.w, h: it.h },
    moved: false, ghost: null, key: '', plan: null,
  };
});

grid.addEventListener('pointermove', (e) => {
  if (marquee) return moveMarquee(e);
  if (!drag) return;
  const { el, it, mode } = drag;
  const dx = e.clientX - drag.sx;
  const dy = e.clientY - drag.sy + (scrollY - drag.scrollY);
  if (!drag.moved) {
    if (Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    if (!drag.group && !picked.has(it.id)) clearPicks();
    // 끄는 동안 타일이 쪼그라들지 않도록 현재 크기를 고정
    drag.list = drag.group || [it];
    drag.tiles = drag.list.map(tileOf);
    drag.ghosts = drag.list.map(() => grid.appendChild(h('div', { class: 'ghost' })));
    drag.list.forEach((o, i) => {
      const t = drag.tiles[i];
      t.style.width = `${o.w * cellSize()}px`;
      t.style.height = `${o.h * cellSize()}px`;
      t.classList.add('active');
    });
    drag.ghost = drag.ghosts[0];
  }
  const c = cellSize();
  const n = drag.next;
  if (mode === 'group') {
    drag.tiles.forEach((t) => (t.style.transform = `translate(${dx}px, ${dy}px)`));
    const cell = cellAt(e.clientX, e.clientY);
    const key = autoPack ? `c${cell.x},${cell.y}` : `${Math.round(dx / c)},${Math.round(dy / c)}`;
    if (key !== drag.key) {
      drag.key = key;
      drag.plan = planGroup(drag.group, dx / c, dy / c, cell);
      let bottom = 0;
      drag.group.forEach((o, i) => {
        const p = { ...o, ...drag.plan.map.get(o.id) };
        bottom = Math.max(bottom, p.y + p.h);
        place(drag.ghosts[i], p);
      });
      if (bottom + 1 > rows) setRows(bottom + 2);
      previewPush(drag.plan.map, new Set(drag.tiles));
    }
    if (e.clientY > innerHeight - 50) scrollBy(0, 14);
    else if (e.clientY < 90) scrollBy(0, -14);
    return;
  }
  if (mode === 'move') {
    n.x = Math.min(COLS - it.w, Math.max(0, Math.round(it.x + dx / c)));
    n.y = Math.max(0, Math.round(it.y + dy / c));
    el.style.transform = `translate(${dx}px, ${dy}px)`;
  } else {
    // 잡은 모서리 쪽으로만 늘어나고 반대쪽 모서리는 고정
    const d = drag.dir;
    let fx = 0, fy = 0, fw = it.w * c, fh = it.h * c;
    if (d.includes('e')) {
      n.w = Math.min(COLS - it.x, Math.max(1, Math.round(it.w + dx / c)));
      fw = Math.min((COLS - it.x) * c, Math.max(c * 0.5, it.w * c + dx));
    }
    if (d.includes('w')) {
      const right = it.x + it.w;
      n.x = Math.min(right - 1, Math.max(0, Math.round(it.x + dx / c)));
      n.w = right - n.x;
      fx = Math.max(-it.x * c, Math.min(dx, (it.w - 0.5) * c));
      fw = it.w * c - fx;
    }
    if (d.includes('s')) {
      n.h = Math.max(1, Math.round(it.h + dy / c));
      fh = Math.max(c * 0.5, it.h * c + dy);
    }
    if (d.includes('n')) {
      const bottom = it.y + it.h;
      n.y = Math.min(bottom - 1, Math.max(0, Math.round(it.y + dy / c)));
      n.h = bottom - n.y;
      fy = Math.max(-it.y * c, Math.min(dy, (it.h - 0.5) * c));
      fh = it.h * c - fy;
    }
    el.style.transform = `translate(${fx}px, ${fy}px)`;
    el.style.width = `${fw}px`;
    el.style.height = `${fh}px`;
    el.querySelector('.badge').textContent = `${n.w}×${n.h}`;
  }
  if (n.y + n.h + 1 > rows) setRows(n.y + n.h + 2);
  // 놓일 자리가 바뀔 때마다 나머지 상품들이 어떻게 움직일지 미리 보여줌
  const cell = cellAt(e.clientX, e.clientY);
  const key = autoPack && mode === 'move' ? `c${cell.x},${cell.y}` : `${n.x},${n.y},${n.w},${n.h}`;
  if (key !== drag.key) {
    drag.key = key;
    drag.plan = plan(it, n, mode, cell);
    const self = { ...n, ...drag.plan.map.get(it.id) };
    if (self.y + self.h + 1 > rows) setRows(self.y + self.h + 2);
    place(drag.ghost, self);
    previewPush(drag.plan.map, new Set([el]));
  }

  // 화면 가장자리에서 자동 스크롤
  if (e.clientY > innerHeight - 50) scrollBy(0, 14);
  else if (e.clientY < 90) scrollBy(0, -14);
});

function endDrag(e, cancel = false) {
  if (endMarquee()) return;
  if (!drag) return;
  const { el, it, moved, plan: planned } = drag;
  drag.ghosts?.forEach((g) => g.remove());
  for (const t of drag.tiles || [el]) {
    t.classList.remove('active');
    t.style.transform = t.style.width = t.style.height = '';
  }
  drag = null;
  if (!moved) {
    if (!cancel) select(it);
    return;
  }
  if (cancel || !planned) {
    render();
    return;
  }
  commitChanges(planned.map, planned.order);
}
grid.addEventListener('pointerup', (e) => endDrag(e));
grid.addEventListener('pointercancel', (e) => endDrag(e, true));

/* ───────── 이미지 추가 ───────── */

// 올리기 전에 브라우저에서 크기를 줄여 원본(최대 2000px)과 그리드용(최대 800px) 두 장을 만듦
async function prepare(file) {
  const bmp = await createImageBitmap(file);
  try {
    return { full: await make(bmp, 2000), thumb: await make(bmp, 800) };
  } finally {
    bmp.close(); // 큰 사진 여러 장을 올릴 때 메모리가 쌓이지 않게 바로 해제
  }
}

// 사진을 최대 max 픽셀 크기의 WebP로 변환
function make(bmp, max) {
  const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * sc));
  c.height = Math.max(1, Math.round(bmp.height * sc));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('사진 변환 실패'))), 'image/webp', 0.9));
}

async function addFiles(files, cell) {
  const list = [...files].filter(isImage);
  let last = null;
  const failed = [];
  let at = autoPack ? indexForCell(cell) : 0;
  for (const [n, file] of list.entries()) {
    try {
      last = await run(`업로드 중… ${n + 1}/${list.length}`, async () => {
        const { full, thumb } = await prepare(file);
        // 항상 표시된 한 칸에 들어감 (크기는 올린 뒤 모서리를 끌어 조절)
        const w = 1;
        const hh = 1;
        const seq = order.slice();
        seq.splice(at, 0, '__new');
        const { x, y } = autoPack ? packed(seq, { __new: { w, h: hh } }).get('__new') : nearestFree(cell, w, hh);
        const pos = { x, y };
        cell = null;
        const [image_url, thumb_url] = await Promise.all([api.upload(full), api.upload(thumb)]);
        const row = await api.insert({ image_url, thumb_url, ...pos, w, h: hh }).catch((err) => {
          api.removeFiles([image_url, thumb_url]); // 등록에 실패하면 방금 올린 사진도 정리
          throw err;
        });
        items.push(row);
        order.splice(autoPack ? at++ : order.length, 0, row.id);
        render();
        await repack();
        return row;
      });
    } catch {
      failed.push(file.name); // 한 장이 안 돼도 나머지는 계속 올림
    }
  }
  if (failed.length) status(failMessage(list.length - failed.length, failed), true);
  if (last) {
    select(last);
    tileOf(last)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

async function replaceMain(file) {
  const it = selected;
  await run('업로드 중…', async () => {
    const { full, thumb } = await prepare(file);
    const old = [it.image_url, it.thumb_url];
    const [image_url, thumb_url] = await Promise.all([api.upload(full), api.upload(thumb)]);
    await api.update(it.id, { image_url, thumb_url }).catch((err) => {
      api.removeFiles([image_url, thumb_url]);
      throw err;
    });
    Object.assign(it, { image_url, thumb_url });
    api.removeFiles(old);
  });
  render();
  fillPanel();
}

// 실패한 파일 이름을 알려주는 안내 문구 (HEIC는 브라우저가 못 읽으니 JPG로 바꾸라고 덧붙임)
const failMessage = (okCount, failed) =>
  `${okCount}장 추가 · ${failed.length}장 실패: ${failed.join(', ')}${failed.some((n) => /\.hei[cf]$/i.test(n)) ? ' (HEIC는 JPG로 바꿔서 올려주세요)' : ''}`;

// 상세 사진은 한 묶음씩 차례로 올림 (올리는 도중에 또 끌어다 놓아도 앞의 사진이 덮어써지지 않게)
let detailQueue = Promise.resolve();
function addDetails(files) {
  const it = selected;
  const job = detailQueue.then(() => addDetailsNow(it, files));
  detailQueue = job.catch(() => {});
  return job;
}

async function addDetailsNow(it, files) {
  // 폴더에서 여러 장을 끌어와도 파일 이름 순서(1, 2, … 10)대로 등록
  files = [...files]
    .filter(isImage)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!it) return;
  if (!files.length) return status('올릴 수 있는 사진 파일이 없습니다 (PNG · JPG · WebP · AVIF)', true);
  // 한 장이 실패해도 나머지는 등록. 실패한 파일은 이름을 알려줌
  const urls = [];
  const failed = [];
  for (const [i, f] of files.entries()) {
    status(`상세 사진 업로드 중… ${i + 1}/${files.length}`);
    try {
      urls.push(await api.upload((await prepare(f)).full));
    } catch (err) {
      console.error(err);
      failed.push(f.name);
    }
  }
  if (urls.length) {
    try {
      const detail_urls = [...(it.detail_urls || []), ...urls];
      await api.update(it.id, { detail_urls });
      it.detail_urls = detail_urls;
    } catch (err) {
      console.error(err);
      api.removeFiles(urls); // 등록에 실패하면 방금 올린 사진도 정리
      status(`오류: ${err.message || err} — 사진이 등록되지 않았습니다${failed.length ? ` (변환 실패: ${failed.join(', ')})` : ''}`, true);
      return;
    }
  }
  if (failed.length) status(failMessage(urls.length, failed), true);
  else status(`상세 사진 ${urls.length}장 추가됨`);
  if (selected === it) fillPanel();
}

const isImage = (f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|avif|hei[cf])$/i.test(f.name);

// 끌어다 놓은 것에서 사진 파일을 모두 꺼냄 (폴더를 통째로 놓으면 그 안의 사진까지)
function droppedFiles(dt) {
  const entries = [...(dt.items || [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.some((en) => en.isDirectory)) return Promise.resolve([...dt.files]);
  const walk = (en) =>
    en.isFile
      ? new Promise((res) => en.file((f) => res([f]), () => res([])))
      : new Promise((res) => {
          const reader = en.createReader();
          const all = [];
          const next = () =>
            reader.readEntries(async (batch) => {
              if (!batch.length) return res((await Promise.all(all.map(walk))).flat());
              all.push(...batch);
              next();
            }, () => res([]));
          next();
        });
  return Promise.all(entries.map(walk)).then((x) => x.flat().filter((f) => !f.name.startsWith('.')));
}

fileInput.addEventListener('change', async () => {
  const files = [...fileInput.files];
  const target = fileTarget;
  fileInput.value = '';
  fileTarget = null;
  if (!files.length || !target) return;
  if (target.kind === 'new') await addFiles(files, target.cell);
  else if (target.kind === 'main') await replaceMain(files[0]);
  else await addDetails(files);
});

function pick(target, multiple = true) {
  fileTarget = target;
  fileInput.multiple = multiple;
  fileInput.click();
}

$('#add').addEventListener('click', () => pick({ kind: 'new', cell: null }));
$('#add-text').addEventListener('click', async () => {
  const w = 3;
  const { x, y } = autoPack ? packed([...order, '__new'], { __new: { w, h: 1 } }).get('__new') : firstFree(w, 1);
  const row = await run('저장 중…', () => api.insert({ kind: 'text', label: '텍스트', x, y, w, h: 1 }));
  items.push(row);
  order.push(row.id);
  render();
  select(row);
  tileOf(row)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  form.elements.label.focus();
  form.elements.label.select();
});
grid.addEventListener('dblclick', (e) => {
  if (e.target.closest('.tile')) return;
  pick({ kind: 'new', cell: cellAt(e.clientX, e.clientY) });
});

// 파일을 그리드에 끌어다 놓기: 사진이 들어갈 칸 하나만 표시
let dropGhost = null;
let dropCell = null;
const clearDrop = () => {
  dropGhost?.remove();
  dropGhost = dropCell = null;
};
grid.addEventListener('dragover', (e) => {
  if (![...e.dataTransfer.types].includes('Files')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  const at = cellAt(e.clientX, e.clientY);
  if (at.y + 2 > rows) setRows(at.y + 3);
  if (!dropGhost) {
    dropGhost = h('div', { class: 'ghost drop' });
    grid.append(dropGhost);
  }
  if (autoPack) {
    // 채우기 모드: 그 칸 순서에 끼워 넣었을 때 실제로 놓일 자리를 표시
    if (dropCell?.x === at.x && dropCell?.y === at.y) return;
    dropCell = at;
    const seq = order.slice();
    seq.splice(indexForCell(at), 0, '__new');
    place(dropGhost, packed(seq, { __new: { w: 1, h: 1 } }).get('__new'));
    return;
  }
  const cell = nearestFree(at, 1, 1);
  if (!dropCell || dropCell.x !== cell.x || dropCell.y !== cell.y) {
    dropCell = cell;
    place(dropGhost, { ...cell, w: 1, h: 1 });
  }
});
grid.addEventListener('dragleave', (e) => {
  if (!grid.contains(e.relatedTarget)) clearDrop();
});
grid.addEventListener('drop', (e) => {
  e.preventDefault();
  const cell = dropCell || cellAt(e.clientX, e.clientY);
  clearDrop();
  droppedFiles(e.dataTransfer).then((files) => files.length && addFiles(files, cell));
});
// 편집 패널에 사진 파일을 끌어다 놓으면 상세 사진으로 한꺼번에 추가
panel.addEventListener('dragover', (e) => {
  if (![...e.dataTransfer.types].includes('Files') || !selected || selected.kind === 'text') return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  panel.classList.add('dropping');
});
panel.addEventListener('dragleave', (e) => {
  if (!panel.contains(e.relatedTarget)) panel.classList.remove('dropping');
});
panel.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  panel.classList.remove('dropping');
  if (selected && selected.kind !== 'text') droppedFiles(e.dataTransfer).then(addDetails);
});
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => e.preventDefault());

/* ───────── 편집 패널 ───────── */

// 입력란에 쓰던 내용이 있으면 다른 상품으로 넘어가기 전에 먼저 저장되게 함
function commitPendingEdit() {
  const el = document.activeElement;
  if (el && form.contains(el)) el.blur();
}

function select(it) {
  commitPendingEdit();
  if (it && picked.size) clearPicks();
  selected = it;
  for (const [id, el] of tiles) el.classList.toggle('selected', !!it && id === it.id);
  panel.hidden = !it;
  if (it) fillPanel();
}

function fillPanel() {
  const it = selected;
  const isText = it.kind === 'text';
  $('#p-size').textContent = `${isText ? '텍스트 · ' : ''}${it.w} × ${it.h} 칸`;
  $('#f-text').hidden = !isText;
  $('#f-product').hidden = isText;
  $('#scale-label').textContent = isText ? '글자 크기' : '사진 확대';
  const st = it.style || {};
  form.elements.st_font.value = FONTS[st.font] ? st.font : 'grotesk';
  form.elements.st_bold.checked = st.bold !== false;
  form.elements.st_italic.checked = !!st.italic;
  form.elements.st_align.value = ['left', 'right'].includes(st.align) ? st.align : 'center';
  form.elements.st_color.value = /^#[0-9a-f]{6}$/i.test(st.color || '') ? st.color : '#0a0a0a';
  form.elements.st_outline.checked = !!st.outline;
  form.elements.st_sx.value = Number(st.sx) || 1;
  form.elements.st_sy.value = Number(st.sy) || 1;
  form.elements.st_skew.value = Number(st.skew) || 0;
  syncOutputs();
  const crop = $('#p-crop');
  crop.style.aspectRatio = `${it.w} / ${it.h}`;
  crop.style.width = it.h > it.w ? `${Math.round((100 * it.w) / it.h)}%` : '100%';
  look(crop, it);
  $('#p-delete').textContent = isText ? '텍스트 삭제' : '상품 삭제';
  form.elements.scale.value = Number(it.scale) || 1;
  $('#scale-out').textContent = `${Math.round((Number(it.scale) || 1) * 100)}%`;
  $('#p-img').src = it.thumb_url || it.image_url || '';
  for (const k of ['label', 'name', 'code', 'size', 'material', 'description', 'buy_url', 'w', 'h']) form.elements[k].value = it[k] ?? '';
  form.elements.price.value = it.price ?? '';
  form.elements.sold.checked = !!it.sold;
  form.elements.w.max = autoPack ? COLS : COLS - it.x;

  $('#p-details').replaceChildren(
    ...(it.detail_urls || []).map((url) =>
      h(
        'div',
        { class: 'd' },
        h('img', { src: url, alt: '' }),
        h('button', {
          type: 'button',
          'aria-label': '상세 사진 삭제',
          text: '×',
          onclick: (e) => {
            // 업로드와 같은 줄에 세움. 목록은 실행하는 순간의 값으로 계산 (연달아 눌러도 앞의 삭제가 되살아나지 않게)
            e.currentTarget.disabled = true;
            const job = detailQueue.then(async () => {
              const detail_urls = (it.detail_urls || []).filter((u) => u !== url);
              await run('저장 중…', () => api.update(it.id, { detail_urls }));
              it.detail_urls = detail_urls;
              api.removeFiles([url]); // DB에서 빠진 뒤에만 파일을 지움
            });
            detailQueue = job.catch(() => {});
            job.catch(() => {}).finally(() => { if (selected === it) fillPanel(); });
          },
        }),
      ),
    ),
    h('button', { type: 'button', class: 'plus', 'aria-label': '상세 사진 추가', text: '+', onclick: () => pick({ kind: 'detail' }) }),
  );
}

form.addEventListener('submit', (e) => e.preventDefault());
form.addEventListener('change', async (e) => {
  const it = selected;
  const el = e.target;
  if (!it || !el.name) return;

  if (el.name === 'w' || el.name === 'h') {
    const w = Math.min(autoPack ? COLS : COLS - it.x, Math.max(1, parseInt(form.elements.w.value, 10) || 1));
    const hh = Math.max(1, parseInt(form.elements.h.value, 10) || 1);
    const p = plan(it, { x: it.x, y: it.y, w, h: hh }, 'resize');
    await commitChanges(p.map, p.order);
    return;
  }

  if (el.name.startsWith('st_')) {
    const style = { ...(it.style || {}), ...readTextStyle() };
    await run('저장 중…', () => api.update(it.id, { style }));
    it.style = style;
    return;
  }

  let value;
  if (el.name === 'scale') value = Number(el.value) || 1;
  else if (el.name === 'label') value = el.value;
  else if (el.name === 'sold') value = el.checked;
  else if (el.name === 'price') value = el.value === '' ? null : Math.max(0, Math.round(Number(el.value)));
  else value = el.value.trim();
  await run('저장 중…', () => api.update(it.id, { [el.name]: value }));
  it[el.name] = value;
});

form.elements.st_font.append(...Object.entries(FONTS).map(([value, text]) => h('option', { value, text })));

const readTextStyle = () => ({
  font: form.elements.st_font.value,
  bold: form.elements.st_bold.checked,
  italic: form.elements.st_italic.checked,
  align: form.elements.st_align.value || 'center',
  color: form.elements.st_color.value,
  outline: form.elements.st_outline.checked,
  sx: Number(form.elements.st_sx.value) || 1,
  sy: Number(form.elements.st_sy.value) || 1,
  skew: Number(form.elements.st_skew.value) || 0,
});

function syncOutputs() {
  $('#scale-out').textContent = `${Math.round(form.elements.scale.value * 100)}%`;
  form.querySelector('[data-for="st_sx"]').textContent = `${Math.round(form.elements.st_sx.value * 100)}%`;
  form.querySelector('[data-for="st_sy"]').textContent = `${Math.round(form.elements.st_sy.value * 100)}%`;
  form.querySelector('[data-for="st_skew"]').textContent = `${form.elements.st_skew.value}°`;
}

// 입력하는 동안 그리드에 바로 미리보기
form.addEventListener('input', (e) => {
  const it = selected;
  const tile = tileOf(it);
  if (!tile) return;
  const name = e.target.name;
  if (name === 'scale') {
    tile.style.setProperty('--fit', e.target.value);
    if (it.kind === 'text') fitText(tile.querySelector('.txt'));
    $('#p-crop').style.setProperty('--fit', e.target.value);
  } else if (name === 'label') {
    tile.querySelector('.t').textContent = e.target.value.trimEnd();
    fitText(tile.querySelector('.txt'));
  } else if (name.startsWith('st_')) {
    look(tile, { ...it, scale: form.elements.scale.value, style: { ...(it.style || {}), ...readTextStyle() } });
    if (it.kind === 'text') fitText(tile.querySelector('.txt'));
  }
  syncOutputs();
});

/* 사진 위치·확대 편집: 틀 안에서 끌면 이동, 휠이나 슬라이더로 확대 (인스타그램 사진 맞추기처럼) */
{
  const crop = $('#p-crop');
  let pan = null;
  let wheelTimer;

  const show = (it, scale, ox, oy) => {
    const tmp = { kind: 'product', scale, style: { ox, oy } };
    look(crop, tmp);
    const tile = tileOf(it);
    if (tile) look(tile, tmp);
    form.elements.scale.value = scale;
    syncOutputs();
  };
  let cropQueue = Promise.resolve();
  const save = (it, scale, ox, oy) => {
    const prev = { scale: it.scale, style: it.style };
    const style = { ...(it.style || {}), ox, oy };
    it.scale = scale;
    it.style = style;
    const job = cropQueue.then(() => run('저장 중…', () => api.update(it.id, { scale, style })));
    cropQueue = job.catch(() => {
      // 실패하면 이전 값으로 되돌림 (그 사이에 더 새로 맞춘 값이 있으면 그쪽을 그대로 둠)
      if (it.scale !== scale || it.style !== style) return;
      it.scale = prev.scale;
      it.style = prev.style;
      const tile = tileOf(it);
      if (tile) look(tile, it);
      if (selected === it) fillPanel();
    });
    return cropQueue;
  };
  const current = (it) => ({
    scale: Number(form.elements.scale.value) || 1,
    ox: Number(it.style?.ox) || 0,
    oy: Number(it.style?.oy) || 0,
  });

  crop.addEventListener('pointerdown', (e) => {
    const it = selected;
    if (!it || it.kind === 'text') return;
    e.preventDefault();
    crop.setPointerCapture(e.pointerId);
    pan = { it, sx: e.clientX, sy: e.clientY, ...current(it) };
    pan.nx = pan.ox;
    pan.ny = pan.oy;
  });
  crop.addEventListener('pointermove', (e) => {
    if (!pan) return;
    // 이동량은 사진 상자(틀의 80%) 대비 비율로 저장 → 어떤 화면 크기에서도 같은 위치
    const clamp = (v) => Math.max(-3, Math.min(3, v));
    pan.nx = clamp(pan.ox + (e.clientX - pan.sx) / (crop.clientWidth * 0.8));
    pan.ny = clamp(pan.oy + (e.clientY - pan.sy) / (crop.clientHeight * 0.8));
    show(pan.it, pan.scale, pan.nx, pan.ny);
  });
  const end = () => {
    if (!pan) return;
    const { it, scale, nx, ny, ox, oy } = pan;
    pan = null;
    if (nx !== ox || ny !== oy) save(it, scale, nx, ny);
  };
  crop.addEventListener('pointerup', end);
  crop.addEventListener('pointercancel', end);

  crop.addEventListener('wheel', (e) => {
    const it = selected;
    if (!it || it.kind === 'text') return;
    e.preventDefault();
    const c = current(it);
    const scale = Math.max(0.5, Math.min(4, c.scale * Math.exp(-e.deltaY * 0.0015)));
    show(it, scale, c.ox, c.oy);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => save(it, scale, c.ox, c.oy), 350);
  }, { passive: false });

  $('#p-reset').addEventListener('click', () => {
    const it = selected;
    if (!it) return;
    show(it, 1, 0, 0);
    save(it, 1, 0, 0);
  });
}

$('#p-replace').addEventListener('click', () => pick({ kind: 'main' }, false));
$('#p-close').addEventListener('click', () => select(null));

/* ───────── 삭제 · 숨기기 · 복구 ───────── */

// 삭제·숨기기·복구는 한 번에 하나씩만 (버튼을 연달아 눌러도 같은 상품이 두 번 처리되지 않게)
let working = false;
async function exclusive(fn) {
  if (working) return status('앞의 작업이 끝난 뒤에 다시 눌러주세요', true);
  working = true;
  try {
    await fn();
  } finally {
    working = false;
  }
}

const nameOf = (it) => (it.kind === 'text' ? it.label?.trim() : it.name || it.code) || (it.kind === 'text' ? '텍스트' : '이름 없는 상품');

const deleteItems = (list) => exclusive(() => deleteItemsNow(list));
async function deleteItemsNow(list) {
  if (!list.length) return;
  const what = list.length === 1 ? `"${nameOf(list[0])}"을(를)` : `${list.length}개를`;
  if (!confirm(`${what} 삭제할까요? 되돌릴 수 없습니다.\n(나중에 다시 쓸 거라면 '숨기기'를 쓰세요)`)) return;
  const ids = new Set(list.map((i) => i.id));
  try {
    await run('삭제 중…', () => api.removeMany([...ids]));
  } catch {
    return;
  }
  api.removeFiles(list.flatMap((it) => [it.image_url, it.thumb_url, ...(it.detail_urls || [])]));
  items = items.filter((i) => !ids.has(i.id));
  hiddenItems = hiddenItems.filter((i) => !ids.has(i.id));
  order = order.filter((id) => !ids.has(id));
  clearPicks();
  select(null);
  render();
  renderHidden();
  repack();
}

// 숨기기: 사이트에서 안 보이고 칸도 비워짐. 아래 '숨긴 항목'에서 언제든 복구
const hideItems = (list) => exclusive(() => hideItemsNow(list));
async function hideItemsNow(list) {
  if (!list.length) return;
  const ids = new Set(list.map((i) => i.id));
  try {
    await run('숨기는 중…', () => api.hide([...ids]));
  } catch {
    return;
  }
  list.forEach((it) => (it.hidden = true));
  items = items.filter((i) => !ids.has(i.id));
  order = order.filter((id) => !ids.has(id));
  hiddenItems = [...list, ...hiddenItems];
  clearPicks();
  select(null);
  render();
  renderHidden();
  repack();
}

// 복구: 채우기를 켰으면 맨 뒤에, 껐으면 가장 앞의 빈자리에 다시 놓음
const restoreItems = (list) => exclusive(() => restoreItemsNow(list));
async function restoreItemsNow(list) {
  if (!list.length) return;
  const ids = new Set(list.map((i) => i.id));
  const prevItems = items;
  const prevOrder = order;
  for (const it of list) it.w = Math.min(COLS, it.w || 1);
  if (autoPack) {
    items = [...items, ...list];
    order = [...order, ...list.map((i) => i.id)];
    const m = packed();
    for (const it of list) Object.assign(it, m.get(it.id));
  } else {
    for (const it of list) {
      Object.assign(it, firstFree(it.w, it.h));
      items = [...items, it];
      order = [...order, it.id];
    }
  }
  try {
    await run('복구 중…', () => api.restore(list.map(({ id, x, y, w, h: hh }) => ({ id, x, y, w, h: hh }))));
  } catch {
    items = prevItems;
    order = prevOrder;
    return;
  }
  list.forEach((it) => (it.hidden = false));
  hiddenItems = hiddenItems.filter((i) => !ids.has(i.id));
  select(null);
  render();
  renderHidden();
  // 복구한 상품을 선택 상태로 보여줌
  picked.clear();
  ids.forEach((id) => picked.add(id));
  syncPicks();
  tileOf(list[0])?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  repack();
}

const tray = $('#hidden-tray');
const hiddenBtn = $('#hidden-btn');
function renderHidden() {
  const n = hiddenItems.length;
  tray.hidden = !n;
  hiddenBtn.hidden = !n;
  hiddenBtn.textContent = `숨긴 항목 ${n}`;
  $('#h-count').textContent = n;
  $('#h-list').replaceChildren(
    ...hiddenItems.map((it) =>
      h(
        'div',
        { class: 'hcard' },
        h(
          'div',
          { class: 'hthumb' },
          it.kind === 'text' ? h('span', { text: it.label?.trim() || '텍스트' }) : h('img', { src: it.thumb_url || it.image_url, alt: '' }),
        ),
        h('span', { class: 'hname', text: nameOf(it) }),
        h(
          'div',
          { class: 'hact' },
          h('button', { type: 'button', text: '복구', onclick: () => restoreItems([it]) }),
          h('button', { type: 'button', class: 'del', text: '삭제', onclick: () => deleteItems([it]) }),
        ),
      ),
    ),
  );
}
$('#h-all').addEventListener('click', () => restoreItems([...hiddenItems].reverse()));
hiddenBtn.addEventListener('click', () => tray.scrollIntoView({ behavior: 'smooth', block: 'start' }));

$('#p-delete').addEventListener('click', () => selected && deleteItems([selected]));
$('#p-hide').addEventListener('click', () => selected && hideItems([selected]));
$('#m-hide').addEventListener('click', () => hideItems(pickedItems()));
$('#m-delete').addEventListener('click', () => deleteItems(pickedItems()));
$('#m-clear').addEventListener('click', clearPicks);

addEventListener('keydown', (e) => {
  if (editor.hidden) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (e.key === 'Escape') {
    if (drag || marquee) endDrag(e, true);
    else if (!typing) {
      if (picked.size) clearPicks();
      else select(null);
    }
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && !drag) {
    if (picked.size) deleteItems(pickedItems());
    else if (selected) deleteItems([selected]);
  }
  // ⌘A / Ctrl+A: 전부 선택
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && !typing) {
    e.preventDefault();
    select(null);
    items.forEach((i) => picked.add(i.id));
    syncPicks();
  }
});

/* ───────── 로그인 / 시작 ───────── */

const login = $('#login');
const editor = $('#editor');

async function enter() {
  if (!(await api.isAdmin())) {
    await api.signOut();
    login.hidden = false;
    $('#login-msg').textContent = '이 계정에는 관리자 권한이 없습니다.';
    return;
  }
  login.hidden = true;
  editor.hidden = false;
  if (LOCAL) {
    $('#view').href = './?local';
    $('#log-link').href = './log.html?local';
    $('#logout').hidden = true;
    status('로컬 연습 모드 — 실제 사이트에는 반영되지 않습니다');
    clearTimeout(statusTimer);
  }
  await reload();
  // 화면을 열 때는 저장하지 않는다. 저장된 배치에 빈칸이 있으면 (다른 기기에서 일부러 만든 자유 배치일 수 있으므로)
  // 이 기기의 '채우기' 설정과 상관없이 끈 상태로 시작한다. 채우기는 사용자가 버튼을 눌렀을 때만 적용된다.
  if (autoPack && !isPacked()) {
    autoPack = false;
    if (!LOCAL) status('저장된 배치에 빈칸이 있어 \'빈칸 없이 채우기\'를 끈 상태로 열었습니다');
  }
  syncPack();
}

// 지금 배치가 '빈칸 없이 채우기' 결과와 똑같은지
function isPacked() {
  const byId = new Map(items.map((i) => [i.id, i]));
  return [...packed()].every(([id, p]) => {
    const o = byId.get(id);
    return o && o.x === p.x && o.y === p.y && o.w === p.w && o.h === p.h;
  });
}

const packBtn = $('#pack');
function syncPack() {
  packBtn.textContent = `빈칸 없이 채우기: ${autoPack ? '켬' : '끔'}`;
  packBtn.setAttribute('aria-pressed', String(autoPack));
  grid.classList.toggle('packed', autoPack);
}
packBtn.addEventListener('click', () => {
  if (drag) return;
  autoPack = !autoPack;
  localStorage.setItem(PACK_KEY, autoPack ? 'on' : 'off');
  syncPack();
  if (selected) fillPanel();
  if (autoPack) {
    order = readingOrder(); // 지금 놓인 순서 그대로 앞에서부터 채움
    repack();
  }
});

login.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#login-msg');
  msg.textContent = '';
  const btn = login.querySelector('button');
  btn.disabled = true;
  try {
    await api.signIn(login.elements.email.value.trim(), login.elements.password.value);
    login.elements.password.value = '';
    await enter();
  } catch (err) {
    msg.textContent = err.message?.includes('Invalid login') ? '이메일 또는 비밀번호가 맞지 않습니다.' : `로그인 실패: ${err.message || err}`;
  } finally {
    btn.disabled = false;
  }
});

$('#logout').addEventListener('click', async () => {
  await api.signOut();
  location.reload();
});

try {
  api = LOCAL ? await localApi() : await remoteApi();
  if (await api.user()) await enter();
  else login.hidden = false;
} catch (err) {
  console.error(err);
  login.hidden = false;
  $('#login-msg').textContent = `연결 오류: ${err.message || err}`;
}
