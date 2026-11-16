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
      const full = { id: crypto.randomUUID(), name: '', code: '', price: null, sold: false, size: '', material: '', description: '', buy_url: '', detail_urls: [], ...row };
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
        h('img', { src: it.thumb_url || it.image_url, alt: it.name || '', draggable: 'false' }),
        h('span', { class: 'badge', text: `${it.w}×${it.h}` }),
        h('span', { class: 'handle', title: '크기 조절' }),
      );
      place(el, it);
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
    n.w = Math.min(COLS - it.x, Math.max(1, Math.round(it.w + dx / c)));
    n.h = Math.max(1, Math.round(it.h + dy / c));
    el.style.width = `${Math.max(c * 0.5, it.w * c + dx)}px`;
    el.style.height = `${Math.max(c * 0.5, it.h * c + dy)}px`;
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

async function prepare(file) {
  const bmp = await createImageBitmap(file);
  const make = (max) => {
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * s));
    c.height = Math.max(1, Math.round(bmp.height * s));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise((res) => c.toBlob(res, 'image/webp', 0.9));
  };
  return { full: await make(2000), thumb: await make(800), aspect: bmp.width / bmp.height };
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
        const fits = cell && cell.x + w <= COLS && !collides(null, cell.x, cell.y, w, hh);
        const pos = fits ? cell : firstFree(w, hh);
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
grid.addEventListener('dblclick', (e) => {
  if (e.target.closest('.tile')) return;
  pick({ kind: 'new', cell: cellAt(e.clientX, e.clientY) });
});

// 파일을 그리드에 끌어다 놓기
grid.addEventListener('dragover', (e) => {
  e.preventDefault();
  grid.classList.add('dropping');
});
grid.addEventListener('dragleave', () => grid.classList.remove('dropping'));
grid.addEventListener('drop', (e) => {
  e.preventDefault();
  grid.classList.remove('dropping');
  if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files, cellAt(e.clientX, e.clientY));
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
  $('#p-size').textContent = `${it.w} × ${it.h} 칸`;
  $('#p-img').src = it.thumb_url || it.image_url;
  for (const k of ['name', 'code', 'size', 'material', 'description', 'buy_url', 'w', 'h']) form.elements[k].value = it[k] ?? '';
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
  if (el.name === 'sold') value = el.checked;
  else if (el.name === 'price') value = el.value === '' ? null : Math.max(0, Math.round(Number(el.value)));
  else value = el.value.trim();
  await run('저장 중…', () => api.update(it.id, { [el.name]: value }));
  it[el.name] = value;
});

$('#p-replace').addEventListener('click', () => pick({ kind: 'main' }, false));
$('#p-close').addEventListener('click', () => select(null));

async function removeSelected() {
  const it = selected;
  if (!it || !confirm(`"${it.name || it.code || '이 상품'}"을(를) 삭제할까요? 되돌릴 수 없습니다.`)) return;
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
