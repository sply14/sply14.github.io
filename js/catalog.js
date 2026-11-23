import { h, fetchItems, formatPrice, safeUrl, look, fitAll, MOBILE_COLS } from './common.js?v=1795448926';

const grid = document.getElementById('grid');
const detail = document.getElementById('detail');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

let all = [];   // 그리드에 놓인 전체 (상품 + 텍스트)
let items = []; // 상품만 (상세 팝업 대상)
let current = -1;
let photos = null; // 열려 있는 상세의 사진 넘기기 도구 {index, go, zone, count}
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
      const pos = `--x:${it.x + 1};--y:${it.y + 1};--w:${it.w};--h:${it.h};--mw:${mw};--mh:${mh};--mk:${mw / it.w};--d:${Math.min(it.x + it.y, 24)};--fit:${Number(it.scale) || 1}`;
      if (it.kind === 'text') {
        // 모바일에서는 CSS가 텍스트를 한 줄 전체 폭으로 놓음
        const label = h('div', { class: 'label', style: pos }, h('span', { class: 't', text: (it.label || '').trimEnd() }));
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
  let hovered = null;

  // 가격표는 포인터에 딱 붙어 다님. 화면 오른쪽 끝에서는 포인터 왼쪽으로 넘김
  const follow = (e) => {
    const flip = e.clientX + 18 + tag.offsetWidth > innerWidth - 4;
    tag.classList.toggle('flip', flip);
    tag.style.translate = `${flip ? e.clientX - 14 - tag.offsetWidth : e.clientX + 14}px ${e.clientY + 16}px`;
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
    if (el) follow(e); // 사라지는 중에는 제자리에서 사라짐
  });
  grid.addEventListener('pointerleave', leave);
  addEventListener('scroll', leave, { passive: true });
  return leave;
}

/* 커스텀 포인터: 맞춤표(+)가 누를 수 있는 곳에서 원으로 펼쳐지고, 확대 가능한 사진 위에서는 +/− */
function setupCursor() {
  if (!finePointer) return;
  const cur = h('div', { class: 'cur', 'aria-hidden': 'true' }, h('i'), h('b'));
  document.body.append(cur);
  const root = document.documentElement;

  const state = (target, x) => {
    const slide = target?.closest?.('.slide');
    const z = slide && x != null ? photos?.zone(x) : 0;
    cur.classList.toggle('prev', z < 0);
    cur.classList.toggle('next', z > 0);
    cur.classList.toggle('zoom', !!slide && !z);
    cur.classList.toggle('out', !!slide?.classList.contains('zoom'));
    cur.classList.toggle('hot', !slide && !!target?.closest?.('a, button:not(.item), .item.hot'));
  };

  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    root.classList.add('has-cur');
    cur.classList.add('on');
    cur.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    state(e.target, e.clientX);
  });
  addEventListener('pointerdown', () => cur.classList.add('down'));
  addEventListener('pointerup', (e) => {
    cur.classList.remove('down');
    requestAnimationFrame(() => state(document.elementFromPoint(e.clientX, e.clientY), e.clientX));
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
  // 상세 사진이 있으면 상세 사진만 (첫 장부터), 없을 때만 그리드의 대표 사진
  const details = (Array.isArray(it.detail_urls) ? it.detail_urls : []).filter(Boolean);
  const images = details.length ? details : [it.image_url || it.thumb_url].filter(Boolean);
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
            onclick: () => go(i),
          },
          h('img', { src, alt: '' }),
        ),
      )
    : [];
  const thumbs = h('div', { class: 'thumbs' }, dots);

  const count = h('span', { class: 'count', text: images.length > 1 ? `1 / ${images.length}` : '' });

  // 지금 가운데에 가장 가까운 사진
  const index = () => {
    const mid = gallery.scrollLeft + gallery.clientWidth / 2;
    let best = 0, bd = Infinity;
    slides.forEach((s, i) => {
      const d = Math.abs(s.offsetLeft + s.offsetWidth / 2 - mid);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };
  const go = (i) => {
    const s = slides[i];
    if (!s) return false;
    slides.forEach((x) => x.classList.remove('zoom'));
    gallery.scrollTo({ left: s.offsetLeft - (gallery.clientWidth - s.offsetWidth) / 2, behavior: reduced ? 'auto' : 'smooth' });
    return true;
  };
  // 사진의 왼쪽/오른쪽 가장자리 구역: 누르면 이전/다음 사진 (-1 / 1), 가운데는 0
  const zone = (clientX) => {
    if (slides.length < 2 || detail.querySelector('.slide.zoom')) return 0;
    const r = gallery.getBoundingClientRect();
    const f = (clientX - r.left) / r.width;
    const i = index();
    if (f < 0.3 && i > 0) return -1;
    if (f > 0.7 && i < slides.length - 1) return 1;
    return 0;
  };
  photos = { index, go, zone, count: slides.length };

  // 눈에 보이는 좌우 화살표 (넘길 사진이 있는 쪽만 표시)
  const prevBtn = h('button', { type: 'button', class: 'gnav prev', 'aria-label': 'Previous image', text: '←', hidden: true, onclick: () => go(index() - 1) });
  const nextBtn = h('button', { type: 'button', class: 'gnav next', 'aria-label': 'Next image', text: '→', hidden: slides.length < 2, onclick: () => go(index() + 1) });
  const stage = h('div', { class: 'stage' }, gallery, prevBtn, nextBtn);

  gallery.addEventListener('scroll', () => {
    const idx = index();
    prevBtn.hidden = idx === 0;
    nextBtn.hidden = idx >= slides.length - 1;
    dots.forEach((d, i) => d.setAttribute('aria-current', String(i === idx)));
    if (images.length > 1) count.textContent = `${idx + 1} / ${images.length}`;
  }, { passive: true });

  // PC: 클릭하면 확대, 커서 위치를 따라 살펴보기
  slides.forEach((slide) => {
    const img = slide.firstChild;
    const origin = (e) => {
      const r = slide.getBoundingClientRect();
      img.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
    };
    slide.addEventListener('click', (e) => {
      const z = zone(e.clientX);
      if (z) return void go(index() + z);
      if (!finePointer) return;
      origin(e);
      slide.classList.toggle('zoom');
    });
    slide.addEventListener('pointermove', (e) => slide.classList.contains('zoom') && origin(e));
    slide.addEventListener('pointerleave', () => slide.classList.remove('zoom'));
  });

  // PC: 사진 위에서 휠을 굴리면 사진이 넘어감. 휠 마우스는 한 칸에 한 장씩(빨리 굴리면 연달아),
  // 트랙패드·매직마우스는 한 번 쓸면 한 장 (손을 뗀 뒤 관성으로 계속 들어오는 신호는 무시)
  let wheelAt = 0, wheelIdx = null, wheelIdle, wheelAcc = 0, swiped = false, lastAbs = 0;
  stage.addEventListener('wheel', (e) => {
    if (slides.length < 2 || e.ctrlKey) return;
    e.preventDefault();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const abs = Math.abs(d);
    // 휠 마우스는 한 칸마다 wheelDelta가 120의 배수로 들어옴 (트랙패드는 자잘한 값).
    // 맥 크롬의 트랙패드는 wheelDelta = 이동량 × 3 이라 120의 배수가 우연히 나올 수 있어 그 경우는 트랙패드로 봄
    const wd = Math.abs(e.wheelDeltaY || e.wheelDelta || 0);
    const notch = e.deltaMode !== 0 || (wd !== 0 && wd % 120 === 0 && wd !== Math.round(abs * 3) && !e.deltaX);
    clearTimeout(wheelIdle);
    wheelIdle = setTimeout(() => { wheelAcc = 0; wheelIdx = null; swiped = false; lastAbs = 0; }, 140);
    const now = performance.now();
    const move = (sign) => {
      const from = wheelIdx ?? index();
      const to = Math.max(0, Math.min(slides.length - 1, from + sign));
      wheelAt = now;
      if (to === from) return;
      wheelIdx = to;
      go(to);
    };
    if (notch) {
      if (now - wheelAt >= 110) move(Math.sign(d));
      return;
    }
    // 관성 신호는 점점 작아짐. 다시 커지면 새로 쓸어 넘긴 것
    if (swiped && abs > lastAbs * 1.6 + 6 && now - wheelAt > 180) { swiped = false; wheelAcc = 0; }
    lastAbs = abs;
    if (swiped) return;
    wheelAcc += d;
    if (Math.abs(wheelAcc) < 40) return;
    swiped = true;
    move(Math.sign(wheelAcc));
    wheelAcc = 0;
  }, { passive: false });

  const closeBtn = h('button', { type: 'button', text: 'Close ×', onclick: close });
  let n = 0;

  const sheet = h(
    'div',
    { class: 'sheet', 'data-dir': dir || null },
    h(
      'section',
      { class: 'page plate' },
      h('div', { class: 'run' }, h('span', { text: it.code || '' }), h('span', { class: 'sold-mark', text: it.sold ? 'Sold' : '' })),
      stage,
      thumbs,
      h('div', { class: 'run' }, h('span', { text: pad2(current + 1) }), count),
    ),
    h(
      'section',
      { class: 'page spec' },
      h('div', { class: 'run' }, h('span', {}), closeBtn),
      // 본문만 스크롤되고 Order 버튼과 하단 내비게이션은 항상 보임
      h(
        'div',
        { class: 'body' },
        h('h1', { class: 'rise', style: `--i:${n++}`, text: it.name || it.code || '' }),
        h(
          'dl',
          {},
          row('Price', formatPrice(it), n++, 'price'),
          row('Size', it.size, n++),
          row('Material', it.material, n++),
          row('Note', it.description, n++),
        ),
      ),
      buy && !it.sold &&
        h('a', { class: 'buy rise', style: `--i:${n++}`, href: buy, target: '_blank', rel: 'noopener' }, h('span', { text: 'Order' }), h('span', { text: '→' })),
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
  sheet.classList.toggle('has-buy', !!(buy && !it.sold));
  fitSheet(sheet, slides);
  setupSwipe(sheet, gallery, images.length);
  closeBtn.focus({ preventScroll: true });
  return slides[0]?.firstChild;
}

/* 세로로 긴 사진이면 사진 칸(PC)을 좁혀 팝업 폭을 줄이고, 모바일은 사진 칸을 더 높게 → 사진 양옆 여백이 과하지 않게.
   기준은 처음 보이는 첫 번째 사진 하나. 비율은 상품에 마우스를 올릴 때 미리 알아둬서 팝업이 열린 뒤 폭이 바뀌지 않게 함 */
const ratios = new Map(); // 사진 주소 → 가로/세로 비율
const firstPhoto = (it) => (Array.isArray(it.detail_urls) ? it.detail_urls : []).filter(Boolean)[0] || it.image_url || it.thumb_url;
function preload(it) {
  const src = it && firstPhoto(it);
  if (!src || ratios.has(src)) return;
  ratios.set(src, 0);
  const im = new Image();
  im.onload = () => ratios.set(src, im.naturalWidth / im.naturalHeight || 0);
  im.onerror = () => ratios.delete(src);
  im.src = src;
}

let fitSheetNow = null;
function fitSheet(sheet, slides) {
  const imgs = slides.map((s) => s.firstChild).filter(Boolean);
  if (!imgs.length) return;
  const src = imgs[0].getAttribute('src');
  const apply = () => {
    if (!sheet.isConnected) return;
    // 첫 사진은 미리 알아둔 비율, 나머지는 불러온 것부터. 그중 가장 가로로 넓은 사진 기준 (가로 사진이 작게 보이지 않게)
    if (imgs[0].naturalWidth) ratios.set(src, imgs[0].naturalWidth / imgs[0].naturalHeight);
    const known = [ratios.get(src) || 0, ...imgs.slice(1).filter((im) => im.naturalWidth).map((im) => im.naturalWidth / im.naturalHeight)];
    const r = Math.max(...known) || 1;
    const stage = sheet.querySelector('.stage');
    if (matchMedia('(max-width: 767px)').matches) {
      sheet.style.removeProperty('--plate-w');
      // 사진 폭(82%)에 맞는 높이, 화면 높이의 72%까지
      stage.style.height = r < 0.95 ? `${Math.min((innerWidth * 0.82) / r, innerHeight * 0.72)}px` : '';
      return;
    }
    stage.style.height = '';
    const half = sheet.parentElement.clientWidth / 2;
    // 사진이 높이에 꽉 찰 때의 폭 + 좌우 여백(18%) — 반 화면보다 넓어지지 않게
    const w = Math.round(Math.min(half, Math.max(320, (stage.clientHeight * r) / 0.82)));
    if (r < 0.95 && w < half - 4) sheet.style.setProperty('--plate-w', `${w}px`);
    else sheet.style.removeProperty('--plate-w');
  };
  // 처음 한 번은 폭이 미끄러지듯 변하지 않고 바로 맞춰짐. 뒤늦게 불러온 사진이 더 넓으면 그때 부드럽게 넓어짐
  sheet.style.transition = 'none';
  apply();
  imgs.forEach((im, n) => {
    if (im.complete && (n || ratios.get(src))) return;
    im.addEventListener('load', apply, { once: true });
  });
  requestAnimationFrame(() => (sheet.style.transition = ''));
  fitSheetNow = apply;
}
addEventListener('resize', () => fitSheetNow?.());

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

const sameAsGrid = (it) => !(Array.isArray(it.detail_urls) ? it.detail_urls : []).some(Boolean);

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
  const show = (morph) => {
    if (thumb) thumb.style.viewTransitionName = '';
    current = i;
    detail.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    const hero = renderDetail();
    if (hero && morph) hero.style.viewTransitionName = 'hero';
    history.replaceState(null, '', `#${items[i].id}`);
    return hero;
  };
  // 상세 사진이 따로 있으면 그리드 사진과 다른 사진이 뜨므로, 늘어나는 전환 대신 부드럽게 나타남
  if (instant || reduced || !document.startViewTransition || !sameAsGrid(items[i])) {
    detail.classList.add('fade');
    show(false);
    return;
  }
  detail.classList.remove('fade');
  if (thumb) thumb.style.viewTransitionName = 'hero';
  withTransition(() => show(true)).then(() => {
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
  const morph = hero && thumbVisible && atFirst && sameAsGrid(items[current]);
  if (morph) hero.style.viewTransitionName = 'hero';

  withTransition(() => {
    current = -1;
    photos = null;
    fitSheetNow = null;
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
  // 좌우 화살표: 먼저 이 상품의 사진을 넘기고, 끝에 닿으면 이전/다음 상품으로
  else if (e.key === 'ArrowRight') photos?.go(photos.index() + 1) || step(1);
  else if (e.key === 'ArrowLeft') (photos?.index() > 0 && photos.go(photos.index() - 1)) || step(-1);
});

let hideTag;
try {
  all = await fetchItems();
  all.sort((a, b) => a.y - b.y || a.x - b.x);
  items = all.filter((it) => it.kind !== 'text');
  renderGrid();
  fitAll(grid, '.label');
  hideTag = setupPointer();
  // 마우스가 상품 위에 잠깐 머물면 그 상품의 첫 사진 비율을 미리 알아둠 (그냥 스쳐 지나가면 받지 않음)
  let warmTimer;
  grid.addEventListener('pointerover', (e) => {
    clearTimeout(warmTimer);
    if (e.pointerType !== 'mouse') return;
    const it = items[e.target.closest?.('.item')?.dataset.i];
    if (it) warmTimer = setTimeout(() => preload(it), 150);
  }, { passive: true });
  grid.addEventListener('pointerleave', () => clearTimeout(warmTimer), { passive: true });
  setupCursor();
  const id = decodeURIComponent(location.hash.slice(1));
  const i = id ? items.findIndex((it) => String(it.id) === id) : -1;
  if (i >= 0) open(i, { instant: true });
} catch (err) {
  console.error(err);
}
