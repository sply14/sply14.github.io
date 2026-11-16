import { h, fetchItems, formatPrice, safeUrl, look, MOBILE_COLS } from './common.js?v=1794846011';

const grid = document.getElementById('grid');
const detail = document.getElementById('detail');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

let all = [];   // 그리드에 놓인 전체 (상품 + 텍스트)
let items = []; // 상품만 (상세 팝업 대상)
let current = -1;
let lastFocus = null;

const pad2 = (n) => String(n).padStart(2, '0');
const cellOf = (i) => grid.querySelector(`.item[data-i="${i}"]`);
const thumbOf = (i) => cellOf(i)?.querySelector('img');

/* ───────── 그리드 ───────── */

function renderGrid() {
  grid.replaceChildren(
    ...all.map((it) => {
      const mw = Math.min(it.w, MOBILE_COLS);
      const mh = Math.max(1, Math.round((it.h * mw) / it.w));
      const pos = `--x:${it.x + 1};--y:${it.y + 1};--w:${it.w};--h:${it.h};--mw:${mw};--mh:${mh};--d:${Math.min(it.x + it.y, 24)};--fit:${Number(it.scale) || 1}`;
      if (it.kind === 'text') {
        // 모바일에서는 CSS가 텍스트를 한 줄 전체 폭으로 놓음
        const label = h('div', { class: 'label', style: pos }, h('span', { class: 't', text: it.label || '' }));
        look(label, it);
        return label;
      }
      const i = items.indexOf(it);
      const price = formatPrice(it);
      const el = h(
        'button',
        {
          class: 'item',
          type: 'button',
          'data-i': i,
          style: pos,
          'aria-label': [it.name, price].filter(Boolean).join(', ') || 'Product',
          onclick: () => open(i),
        },
        h('img', { src: it.thumb_url || it.image_url, alt: '', loading: i < 40 ? 'eager' : 'lazy', decoding: 'async' }),
        price && h('span', { class: 'price', text: price }),
      );
      look(el, it);
      return el;
    }),
  );
}

/* 커서를 따라다니는 가격 태그 + 사진이 커서 쪽으로 살짝 끌려오는 효과 (마우스 전용) */
function setupPointer() {
  if (!finePointer) return;
  const tag = h('div', { class: 'tag', 'aria-hidden': 'true' });
  document.body.append(tag);
  let tx = 0, ty = 0, x = 0, y = 0, raf = 0, hovered = null;

  const tick = () => {
    x += (tx - x) * (reduced ? 1 : 0.22);
    y += (ty - y) * (reduced ? 1 : 0.22);
    tag.style.transform = `translate(${x + 16}px, ${y + 18}px)`;
    raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.3 ? requestAnimationFrame(tick) : 0;
  };

  const leave = () => {
    if (!hovered) return;
    hovered.style.removeProperty('--px');
    hovered.style.removeProperty('--py');
    hovered.classList.remove('hot');
    hovered = null;
    grid.classList.remove('focus');
    tag.classList.remove('on');
  };

  // 칸 가장자리(한 칸 크기의 EDGE 비율)에 있을 때는 아무것도 고르지 않은 상태로 둔다 → 상품 사이에서 전체가 보임
  // 이미 고른 상품은 조금 더 바깥에서 놓아줘서 경계에서 깜빡이지 않게 한다
  const EDGE = 0.14, KEEP = 0.08;
  const inside = (el, e, ratio) => {
    const r = el.getBoundingClientRect();
    const m = (grid.clientWidth / (Number(getComputedStyle(grid).getPropertyValue('--cols')) || 10)) * ratio;
    return e.clientX > r.left + m && e.clientX < r.right - m && e.clientY > r.top + m && e.clientY < r.bottom - m;
  };

  grid.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    tx = e.clientX;
    ty = e.clientY;
    let el = null;
    if (hovered && inside(hovered, e, KEEP)) el = hovered;
    else {
      el = document.elementsFromPoint(e.clientX, e.clientY)
        .find((n) => n.classList.contains('item') && grid.contains(n) && inside(n, e, EDGE)) || null;
    }
    if (el !== hovered) {
      leave();
      hovered = el;
      if (el) {
        el.classList.add('hot');
        grid.classList.add('focus');
        const it = items[el.dataset.i];
        const price = formatPrice(it);
        if (!tag.classList.contains('on')) { x = tx; y = ty; }
        tag.textContent = price;
        tag.classList.toggle('sold', !!it.sold);
        tag.classList.toggle('on', !!price);
      }
    }
    if (el) {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--px', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
      el.style.setProperty('--py', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
    }
    if (!raf) raf = requestAnimationFrame(tick);
  });
  grid.addEventListener('pointerleave', leave);
  addEventListener('scroll', leave, { passive: true });
  return leave;
}

/* 커스텀 포인터: 맞춤표(+)가 누를 수 있는 곳에서 원으로 펼쳐지고, 확대 가능한 사진 위에서는 +/− */
function setupCursor() {
  if (!finePointer) return;
  const cur = h('div', { class: 'cur', 'aria-hidden': 'true' }, h('i'));
  document.body.append(cur);
  const root = document.documentElement;

  const state = (target) => {
    const slide = target?.closest?.('.slide');
    cur.classList.toggle('zoom', !!slide);
    cur.classList.toggle('out', !!slide?.classList.contains('zoom'));
    cur.classList.toggle('hot', !slide && !!target?.closest?.('a, button:not(.item), .item.hot'));
  };

  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    root.classList.add('has-cur');
    cur.classList.add('on');
    cur.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    state(e.target);
  });
  addEventListener('pointerdown', () => cur.classList.add('down'));
  addEventListener('pointerup', (e) => {
    cur.classList.remove('down');
    requestAnimationFrame(() => state(document.elementFromPoint(e.clientX, e.clientY)));
  });
  root.addEventListener('mouseleave', () => cur.classList.remove('on'));
  // 터치로 전환하면 기본 동작으로 복귀
  addEventListener('touchstart', () => {
    cur.classList.remove('on');
    root.classList.remove('has-cur');
  }, { passive: true });
}

/* ───────── 상세 ───────── */

function row(label, value, i, cls = '') {
  if (!value) return null;
  return h('div', { class: `row rise ${cls}`, style: `--i:${i}` }, h('dt', { text: label }), h('dd', { text: value }));
}

function renderDetail(dir = 0) {
  const it = items[current];
  const images = [it.image_url, ...(Array.isArray(it.detail_urls) ? it.detail_urls : [])].filter(Boolean);
  if (!images.length && it.thumb_url) images.push(it.thumb_url);
  const buy = safeUrl(it.buy_url);

  const slides = images.map((src, i) =>
    h('div', { class: 'slide' }, h('img', { src, alt: i === 0 ? it.name || '' : '', draggable: 'false' })),
  );
  const gallery = h('div', { class: 'gallery' }, slides);
  const dots = images.length > 1
    ? images.map((src, i) =>
        h(
          'button',
          {
            type: 'button',
            'aria-label': `Image ${i + 1}`,
            'aria-current': String(i === 0),
            onclick: () => gallery.scrollTo({ left: i * gallery.clientWidth, behavior: reduced ? 'auto' : 'smooth' }),
          },
          h('img', { src, alt: '' }),
        ),
      )
    : [];
  const thumbs = h('div', { class: 'thumbs' }, dots);

  gallery.addEventListener('scroll', () => {
    const idx = Math.round(gallery.scrollLeft / gallery.clientWidth);
    dots.forEach((d, i) => d.setAttribute('aria-current', String(i === idx)));
  }, { passive: true });

  // PC: 클릭하면 확대, 커서 위치를 따라 살펴보기
  slides.forEach((slide) => {
    const img = slide.firstChild;
    const origin = (e) => {
      const r = slide.getBoundingClientRect();
      img.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
    };
    slide.addEventListener('click', (e) => {
      if (!finePointer) return;
      origin(e);
      slide.classList.toggle('zoom');
    });
    slide.addEventListener('pointermove', (e) => slide.classList.contains('zoom') && origin(e));
    slide.addEventListener('pointerleave', () => slide.classList.remove('zoom'));
  });

  const closeBtn = h('button', { type: 'button', text: 'Close ×', onclick: close });
  let n = 0;

  const sheet = h(
    'div',
    { class: 'sheet', 'data-dir': dir || null },
    h(
      'section',
      { class: 'page plate' },
      h('div', { class: 'run' }, h('span', { text: it.code || '' }), h('span', { class: 'sold-mark', text: it.sold ? 'Sold' : '' })),
      gallery,
      thumbs,
      h('div', { class: 'run' }, h('span', { text: pad2(current + 1) })),
    ),
    h(
      'section',
      { class: 'page spec' },
      h('div', { class: 'run' }, h('span', {}), closeBtn),
      h('h1', { class: 'rise', style: `--i:${n++}`, text: it.name || it.code || '' }),
      h(
        'dl',
        {},
        row('Price', formatPrice(it), n++, 'price'),
        row('Size', it.size, n++),
        row('Material', it.material, n++),
        row('Note', it.description, n++),
      ),
      buy && !it.sold &&
        h('a', { class: 'buy rise', style: `--i:${n++}`, href: buy, target: '_blank', rel: 'noopener' }, h('span', { text: 'Order' }), h('span', { text: '→' })),
      h('div', { class: 'grow' }),
      h(
        'div',
        { class: 'run' },
        h(
          'span',
          { class: 'nav' },
          h('button', { type: 'button', 'aria-label': 'Previous', text: '←', onclick: () => step(-1) }),
          h('button', { type: 'button', 'aria-label': 'Next', text: '→', onclick: () => step(1) }),
        ),
        h('span', { text: `${pad2(current + 1)} / ${pad2(items.length)}` }),
      ),
    ),
  );

  detail.replaceChildren(sheet);
  setupSwipe(sheet, gallery, images.length);
  closeBtn.focus({ preventScroll: true });
  return slides[0]?.firstChild;
}

/* 모바일 제스처: 아래로 끌어 닫기, 사진이 한 장이면 좌우로 밀어 이전/다음 상품 */
function setupSwipe(sheet, gallery, imageCount) {
  let sx = 0, sy = 0, mode = null, dy = 0;

  sheet.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return (mode = null);
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    dy = 0;
    mode = 'pending';
  }, { passive: true });

  sheet.addEventListener('touchmove', (e) => {
    if (!mode) return;
    const dx = e.touches[0].clientX - sx;
    dy = e.touches[0].clientY - sy;
    if (mode === 'pending') {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (dy > Math.abs(dx) && sheet.scrollTop <= 0) mode = 'pull';
      else if (Math.abs(dx) > Math.abs(dy) && (imageCount < 2 || !gallery.contains(e.target))) mode = 'side';
      else mode = null;
    }
    if (mode === 'pull') {
      e.preventDefault();
      const d = Math.max(0, dy);
      sheet.style.transition = 'none';
      sheet.style.transform = `translateY(${d}px) scale(${1 - Math.min(d, 400) / 4000})`;
      detail.style.background = `rgba(10,10,10,${Math.max(0.25, 1 - d / 500)})`;
    }
  }, { passive: false });

  sheet.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - sx;
    if (mode === 'pull') {
      if (dy > 110) {
        close();
      } else {
        sheet.style.transition = 'transform .35s cubic-bezier(.2,.7,.1,1)';
        sheet.style.transform = '';
      }
      detail.style.background = '';
    } else if (mode === 'side' && Math.abs(dx) > 60) {
      step(dx < 0 ? 1 : -1);
    }
    mode = null;
  });
}

function withTransition(update) {
  if (reduced || !document.startViewTransition) {
    update();
    return Promise.resolve();
  }
  return document.startViewTransition(update).finished.catch(() => {});
}

function open(i, { instant = false } = {}) {
  if (current >= 0) return;
  lastFocus = document.activeElement;
  hideTag?.();
  const thumb = thumbOf(i);
  const show = () => {
    if (thumb) thumb.style.viewTransitionName = '';
    current = i;
    detail.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    const hero = renderDetail();
    if (hero) hero.style.viewTransitionName = 'hero';
    history.replaceState(null, '', `#${items[i].id}`);
    return hero;
  };
  if (instant || reduced || !document.startViewTransition) {
    detail.classList.add('fade');
    show();
    return;
  }
  detail.classList.remove('fade');
  if (thumb) thumb.style.viewTransitionName = 'hero';
  withTransition(show).then(() => {
    const hero = detail.querySelector('.slide img');
    if (hero) hero.style.viewTransitionName = '';
  });
}

function close() {
  if (current < 0) return;
  const thumb = thumbOf(current);
  const hero = detail.querySelector('.slide img');
  const atFirst = (detail.querySelector('.gallery')?.scrollLeft ?? 0) < 10;
  const thumbVisible = thumb && (() => {
    const r = thumb.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight;
  })();
  const morph = hero && thumbVisible && atFirst;
  if (morph) hero.style.viewTransitionName = 'hero';

  withTransition(() => {
    current = -1;
    detail.hidden = true;
    detail.replaceChildren();
    detail.style.background = '';
    document.documentElement.style.overflow = '';
    if (morph) thumb.style.viewTransitionName = 'hero';
    history.replaceState(null, '', location.pathname + location.search);
  }).then(() => {
    if (thumb) thumb.style.viewTransitionName = '';
  });
  lastFocus?.focus?.({ preventScroll: true });
}

function step(d) {
  if (current < 0 || items.length < 2) return;
  current = (current + d + items.length) % items.length;
  renderDetail(d);
  history.replaceState(null, '', `#${items[current].id}`);
  // 닫을 때 돌아갈 자리가 보이도록 그리드도 따라 스크롤
  cellOf(current)?.scrollIntoView({ block: 'nearest' });
}

detail.addEventListener('click', (e) => {
  if (e.target === detail) close();
});

addEventListener('keydown', (e) => {
  if (current < 0) return;
  if (e.key === 'Escape') close();
  else if (e.key === 'ArrowRight') step(1);
  else if (e.key === 'ArrowLeft') step(-1);
});

let hideTag;
try {
  all = await fetchItems();
  all.sort((a, b) => a.y - b.y || a.x - b.x);
  items = all.filter((it) => it.kind !== 'text');
  renderGrid();
  hideTag = setupPointer();
  setupCursor();
  const id = decodeURIComponent(location.hash.slice(1));
  const i = id ? items.findIndex((it) => String(it.id) === id) : -1;
  if (i >= 0) open(i, { instant: true });
} catch (err) {
  console.error(err);
}
