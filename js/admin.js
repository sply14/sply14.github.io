import { h, SUPABASE_URL, SUPABASE_KEY, TABLE, BUCKET, COLS, LOCAL, LOCAL_KEY, loadLocal } from './common.js';

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
    async remove(id) {
      ok(await sb.from(TABLE).delete().eq('id', id));
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
      const full = { id: crypto.randomUUID(), kind: 'product', label: '', scale: 1, name: '', code: '', price: null, sold: false, size: '', material: '', description: '', buy_url: '', detail_urls: [], ...row };
      data.push(full);
      save();
      return structuredClone(full);
    },
    async update(id, patch) { Object.assign(data.find((d) => d.id === id), patch); save(); },
    async remove(id) { data = data.filter((d) => d.id !== id); save(); },
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

const collides = (id, x, y, w, hh) =>
  items.some((o) => o.id !== id && x < o.x + o.w && x + w > o.x && y < o.y + o.h && y + hh > o.y);

function firstFree(w, hh) {
  for (let y = 0; ; y++) for (let x = 0; x <= COLS - w; x++) if (!collides(null, x, y, w, hh)) return { x, y };
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

function render() {
  setRows();
  grid.replaceChildren(
    ...items.map((it) => {
      const el = h(
        'div',
        { class: 'tile' + (selected?.id === it.id ? ' selected' : ''), 'data-id': it.id, tabindex: '0' },
        it.kind === 'text'
          ? h('span', { class: 'txt', text: it.label || '' })
          : h('img', { src: it.thumb_url || it.image_url, alt: it.name || '', draggable: 'false' }),
        h('span', { class: 'badge', text: `${it.w}×${it.h}` }),
        ['nw', 'ne', 'sw', 'se'].map((d) => h('span', { class: `handle ${d}`, 'data-dir': d })),
      );
      place(el, it);
      el.style.setProperty('--fit', Number(it.scale) || 1);
      return el;
    }),
  );
}

/* ───────── 드래그: 이동 / 크기 조절 ───────── */

let drag = null;

grid.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const el = e.target.closest('.tile');
  if (!el) return;
  const it = items.find((i) => String(i.id) === el.dataset.id);
  if (!it) return;
  e.preventDefault();
  el.setPointerCapture(e.pointerId);
  drag = {
    el, it,
    mode: e.target.closest('.handle') ? 'resize' : 'move',
    dir: e.target.closest('.handle')?.dataset.dir || '',
    sx: e.clientX, sy: e.clientY, scrollY,
    next: { x: it.x, y: it.y, w: it.w, h: it.h },
    moved: false, ghost: null, ok: true,
  };
});

grid.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const { el, it, mode } = drag;
  const dx = e.clientX - drag.sx;
  const dy = e.clientY - drag.sy + (scrollY - drag.scrollY);
  if (!drag.moved) {
    if (Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    el.classList.add('active');
    drag.ghost = h('div', { class: 'ghost' });
    grid.append(drag.ghost);
  }
  const c = cellSize();
  const n = drag.next;
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
  drag.ok = !collides(it.id, n.x, n.y, n.w, n.h);
  place(drag.ghost, n);
  drag.ghost.classList.toggle('bad', !drag.ok);

  // 화면 가장자리에서 자동 스크롤
  if (e.clientY > innerHeight - 50) scrollBy(0, 14);
  else if (e.clientY < 90) scrollBy(0, -14);
});

function endDrag(e, cancel = false) {
  if (!drag) return;
  const { el, it, next, moved, ok, ghost } = drag;
  drag = null;
  ghost?.remove();
  el.classList.remove('active');
  el.style.transform = el.style.width = el.style.height = '';
  if (!moved) {
    if (!cancel) select(it);
    return;
  }
  const changed = next.x !== it.x || next.y !== it.y || next.w !== it.w || next.h !== it.h;
  if (cancel || !ok || !changed) {
    render();
    return;
  }
  const prev = { x: it.x, y: it.y, w: it.w, h: it.h };
  Object.assign(it, next);
  render();
  if (selected?.id === it.id) fillPanel();
  run('저장 중…', () => api.update(it.id, next)).catch(() => {
    Object.assign(it, prev);
    render();
  });
}
grid.addEventListener('pointerup', (e) => endDrag(e));
grid.addEventListener('pointercancel', (e) => endDrag(e, true));

/* ───────── 이미지 추가 ───────── */

// 사진 둘레의 빈 여백(투명 또는 단색 배경)을 찾아 상품만 남는 영역을 계산
function contentBox(ctx, w, hh) {
  const { data } = ctx.getImageData(0, 0, w, hh);
  const px = (x, y) => (y * w + x) * 4;
  const corners = [px(0, 0), px(w - 1, 0), px(0, hh - 1), px(w - 1, hh - 1)];
  const transparent = corners.every((i) => data[i + 3] < 16);
  const bg = corners[0];
  if (!transparent) {
    // 불투명 사진: 네 모서리 색이 거의 같을 때만 그 색을 배경으로 봄
    const same = corners.every((i) => data[i + 3] > 240 && [0, 1, 2].every((c) => Math.abs(data[i + c] - data[bg + c]) < 14));
    if (!same) return null;
  }
  const isContent = (i) =>
    transparent
      ? data[i + 3] > 12
      : Math.abs(data[i] - data[bg]) + Math.abs(data[i + 1] - data[bg + 1]) + Math.abs(data[i + 2] - data[bg + 2]) > 36;
  let x0 = w, y0 = hh, x1 = -1, y1 = -1;
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      if (!isContent(px(x, y))) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const m = Math.round(Math.max(x1 - x0, y1 - y0) * 0.01);
  x0 = Math.max(0, x0 - m);
  y0 = Math.max(0, y0 - m);
  x1 = Math.min(w - 1, x1 + m);
  y1 = Math.min(hh - 1, y1 + m);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

async function prepare(file, trim = true) {
  const bmp = await createImageBitmap(file);
  let box = { x: 0, y: 0, w: bmp.width, h: bmp.height };
  let trimmed = false;
  if (trim) {
    // 분석은 최대 1200px로 줄여서 하고, 결과 영역을 원본 좌표로 환산
    const k = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const b = contentBox(ctx, c.width, c.height);
    if (b && (b.w < c.width * 0.97 || b.h < c.height * 0.97)) {
      box = {
        x: Math.floor(b.x / k),
        y: Math.floor(b.y / k),
        w: Math.min(bmp.width - Math.floor(b.x / k), Math.ceil(b.w / k)),
        h: Math.min(bmp.height - Math.floor(b.y / k), Math.ceil(b.h / k)),
      };
      trimmed = true;
    }
  }
  const make = (max) => {
    const sc = Math.min(1, max / Math.max(box.w, box.h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(box.w * sc));
    c.height = Math.max(1, Math.round(box.h * sc));
    c.getContext('2d').drawImage(bmp, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height);
    return new Promise((res) => c.toBlob(res, 'image/webp', 0.9));
  };
  return { full: await make(2000), thumb: await make(800), aspect: box.w / box.h, trimmed };
}

// 이미 올린 대표 사진의 여백을 잘라 다시 저장
async function trimSelected() {
  const it = selected;
  if (!it || it.kind === 'text') return;
  let changed = false;
  await run('여백 분석 중…', async () => {
    const blob = await (await fetch(it.image_url)).blob();
    const { full, thumb, trimmed } = await prepare(blob, true);
    if (!trimmed) return;
    const old = [it.image_url, it.thumb_url];
    const [image_url, thumb_url] = await Promise.all([api.upload(full), api.upload(thumb)]);
    await api.update(it.id, { image_url, thumb_url });
    Object.assign(it, { image_url, thumb_url });
    api.removeFiles(old);
    changed = true;
  });
  if (changed) {
    render();
    fillPanel();
  } else {
    status('잘라낼 여백이 없습니다 — 아래 사진 크기 슬라이더로 키워 보세요');
  }
}

async function addFiles(files, cell) {
  const list = [...files].filter((f) => f.type.startsWith('image/'));
  let last = null;
  for (const [n, file] of list.entries()) {
    try {
      last = await run(`업로드 중… ${n + 1}/${list.length}`, async () => {
        const { full, thumb, aspect } = await prepare(file);
        // 사진 비율로 기본 칸 수 추천: 가로로 긴 제품은 2×1, 세로로 긴 제품은 1×2
        const w = aspect > 1.6 ? 2 : 1;
        const hh = aspect < 0.62 ? 2 : 1;
        const pos = nearestFree(cell && { x: Math.min(cell.x, COLS - w), y: cell.y }, w, hh);
        cell = null;
        const [image_url, thumb_url] = await Promise.all([api.upload(full), api.upload(thumb)]);
        const row = await api.insert({ image_url, thumb_url, ...pos, w, h: hh });
        items.push(row);
        render();
        return row;
      });
    } catch {
      break;
    }
  }
  if (last) {
    select(last);
    grid.querySelector(`[data-id="${last.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

async function replaceMain(file) {
  const it = selected;
  await run('업로드 중…', async () => {
    const { full, thumb } = await prepare(file);
    const old = [it.image_url, it.thumb_url];
    const [image_url, thumb_url] = await Promise.all([api.upload(full), api.upload(thumb)]);
    await api.update(it.id, { image_url, thumb_url });
    Object.assign(it, { image_url, thumb_url });
    api.removeFiles(old);
  });
  render();
  fillPanel();
}

async function addDetails(files) {
  const it = selected;
  await run('업로드 중…', async () => {
    const urls = [];
    for (const f of files) urls.push(await api.upload((await prepare(f)).full));
    const detail_urls = [...(it.detail_urls || []), ...urls];
    await api.update(it.id, { detail_urls });
    it.detail_urls = detail_urls;
  });
  fillPanel();
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
  const row = await run('저장 중…', () => api.insert({ kind: 'text', label: '텍스트', ...firstFree(w, 1), w, h: 1 }));
  items.push(row);
  render();
  select(row);
  grid.querySelector(`[data-id="${row.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
  const cell = nearestFree(at, 1, 1);
  if (!dropGhost) {
    dropGhost = h('div', { class: 'ghost drop' });
    grid.append(dropGhost);
  }
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
  if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files, cell);
});
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => e.preventDefault());

/* ───────── 편집 패널 ───────── */

function select(it) {
  selected = it;
  grid.querySelectorAll('.tile').forEach((t) => t.classList.toggle('selected', !!it && t.dataset.id === String(it.id)));
  panel.hidden = !it;
  if (it) fillPanel();
}

function fillPanel() {
  const it = selected;
  const isText = it.kind === 'text';
  $('#p-size').textContent = `${isText ? '텍스트 · ' : ''}${it.w} × ${it.h} 칸`;
  $('#f-text').hidden = !isText;
  $('#f-product').hidden = isText;
  $('#scale-label').textContent = isText ? '글자 크기' : '칸 안에서 사진 크기';
  $('#p-delete').textContent = isText ? '텍스트 삭제' : '상품 삭제';
  form.elements.scale.value = Number(it.scale) || 1;
  $('#scale-out').textContent = `${Math.round((Number(it.scale) || 1) * 100)}%`;
  $('#p-img').src = it.thumb_url || it.image_url || '';
  for (const k of ['label', 'name', 'code', 'size', 'material', 'description', 'buy_url', 'w', 'h']) form.elements[k].value = it[k] ?? '';
  form.elements.price.value = it.price ?? '';
  form.elements.sold.checked = !!it.sold;
  form.elements.w.max = COLS - it.x;

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
          onclick: async () => {
            const detail_urls = it.detail_urls.filter((u) => u !== url);
            await run('저장 중…', () => api.update(it.id, { detail_urls }));
            it.detail_urls = detail_urls;
            api.removeFiles([url]);
            fillPanel();
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
    const w = Math.min(COLS - it.x, Math.max(1, parseInt(form.elements.w.value, 10) || 1));
    const hh = Math.max(1, parseInt(form.elements.h.value, 10) || 1);
    if (collides(it.id, it.x, it.y, w, hh)) {
      status('그 크기로는 옆 상품과 겹칩니다', true);
      fillPanel();
      return;
    }
    await run('저장 중…', () => api.update(it.id, { w, h: hh }));
    Object.assign(it, { w, h: hh });
    render();
    fillPanel();
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

// 글자·크기는 입력하는 동안 그리드에 바로 미리보기
form.addEventListener('input', (e) => {
  const it = selected;
  const tile = it && grid.querySelector(`[data-id="${it.id}"]`);
  if (!tile) return;
  if (e.target.name === 'scale') {
    tile.style.setProperty('--fit', e.target.value);
    $('#scale-out').textContent = `${Math.round(e.target.value * 100)}%`;
  } else if (e.target.name === 'label') {
    tile.querySelector('.txt').textContent = e.target.value;
  }
});
$('#p-trim').addEventListener('click', () => trimSelected().catch(() => {}));

$('#p-replace').addEventListener('click', () => pick({ kind: 'main' }, false));
$('#p-close').addEventListener('click', () => select(null));

async function removeSelected() {
  const it = selected;
  if (!it || !confirm(`"${it.label || it.name || it.code || '이 상품'}"을(를) 삭제할까요? 되돌릴 수 없습니다.`)) return;
  await run('삭제 중…', () => api.remove(it.id));
  api.removeFiles([it.image_url, it.thumb_url, ...(it.detail_urls || [])]);
  items = items.filter((i) => i.id !== it.id);
  select(null);
  render();
}
$('#p-delete').addEventListener('click', removeSelected);

addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);
  if (e.key === 'Escape') {
    if (drag) endDrag(e, true);
    else if (!typing) select(null);
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected && !typing) removeSelected();
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
    $('#logout').hidden = true;
    status('로컬 연습 모드 — 실제 사이트에는 반영되지 않습니다');
    clearTimeout(statusTimer);
  }
  items = await api.list();
  render();
}

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
