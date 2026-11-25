// 좌판: 같은 상품의 개체 여러 점. 화면과 상관없는 계산만 둔다 (테스트: tests/stall.test.mjs)

export const pad3 = (n) => String(n).padStart(3, '0');

// 전체 목록에서 낱개를 빼내 대표 상품별로 번호순으로 묶는다. 대표 상품이 없는(숨긴) 낱개는 버린다
export function groupPieces(all) {
  const products = all.filter((i) => i.kind !== 'piece');
  const ids = new Set(products.map((i) => i.id));
  const stalls = new Map();
  for (const p of all) {
    if (p.kind !== 'piece' || !ids.has(p.parent_id)) continue;
    if (!stalls.has(p.parent_id)) stalls.set(p.parent_id, []);
    stalls.get(p.parent_id).push(p);
  }
  for (const list of stalls.values()) list.sort((a, b) => a.no - b.no);
  return { products, stalls };
}

// 비어 있는 값은 대표 상품의 것을 쓴다. 사진 확대·위치는 항상 대표 상품의 것 (같은 틀로 찍으므로)
export function resolvePiece(parent, piece) {
  const own = (k) => (piece[k] == null || piece[k] === '' ? parent[k] : piece[k]);
  return {
    ...piece,
    name: own('name') || '',
    code: own('code') || '',
    price: own('price') ?? null,
    size: own('size') || '',
    material: own('material') || '',
    description: own('description') || '',
    buy_url: own('buy_url') || '',
    sold: !!(piece.sold || parent.sold),
    scale: parent.scale,
    style: parent.style,
  };
}

// 가장 큰 번호 다음. 중간에 지운 번호는 채우지 않는다
export const nextNo = (pieces) => pieces.reduce((m, p) => Math.max(m, p.no || 0), 0) + 1;

// 대표 상품의 타일에서 보이는 만큼이 좌판의 사진 상자(boxW×boxH)에 꽉 차게 하는 확대·위치.
// 타일은 w×h칸이고 사진 상자는 그 80%이며, 확대값이 크면 사진이 타일 밖으로 넘쳐 잘린다 (r = 사진 가로/세로)
export function frame(parent, r, boxW, boxH) {
  const w = parent.w || 1, hh = parent.h || 1;
  const contain = (W, H) => Math.min(W, H * r);
  const tw = contain(0.8 * w, 0.8 * hh) * (Number(parent.scale) || 1); // 타일에서의 사진 폭 (칸 단위)
  const f = Math.min(boxW / Math.min(w, tw), boxH / Math.min(hh, tw / r)); // 칸 1개 → px
  const st = parent.style || {};
  return {
    s: (tw * f) / contain(boxW, boxH),
    ox: ((Number(st.ox) || 0) * 0.8 * w * f) / boxW,
    oy: ((Number(st.oy) || 0) * 0.8 * hh * f) / boxH,
  };
}

// 타일에서 보이는 범위의 가로/세로 (지나치게 길쭉하면 제한)
export function aspectOf(parent, r) {
  const w = parent.w || 1, hh = parent.h || 1;
  const tw = Math.min(0.8 * w, 0.8 * hh * r) * (Number(parent.scale) || 1);
  return Math.max(0.6, Math.min(2.2, Math.min(w, tw) / Math.min(hh, tw / r)));
}

const MIN_CELL = 80;     // PC에서 칸의 최소 폭
const PHONE_COLS = 6;    // 모바일에서 최대 열 수
const LOW = 0.64, HIGH = 1.5; // 칸 높이 / 폭 (사진이 정사각일 때. 가로로 긴 사진이면 그만큼 낮아짐)
const MIN_ROW = 44;      // 손가락으로 누를 수 있는 최소 높이

// n점을 W×H 화면에 까는 방법. 제목이 첫 줄의 남는 칸을 전부 차지해 구멍 없는 직사각형이 된다.
// 한 화면에 들어오면서 사진이 가장 커지는 열 수를 고르고, 너무 많으면 최소 칸 크기로 빽빽하게 깔고 스크롤한다.
export function layout(n, W, H, aspect = 1) {
  const maxCols = Math.max(1, W < 768 ? PHONE_COLS : Math.floor(W / MIN_CELL));
  let best = null;
  for (let cols = 1; cols <= maxCols; cols++) {
    const cell = W / cols;
    const rows = Math.ceil((n + 1) / cols);
    const label = cols * rows - n; // 1 이상 cols 이하
    const rowH = Math.max(MIN_ROW, Math.min((cell * HIGH) / aspect, Math.max((cell * LOW) / aspect, H / rows)));
    const photo = Math.min(cell * 0.84, rowH * 0.8 * aspect); // style.css의 사진 상자 (번호 자리를 뺀 크기)
    const over = (rows * rowH) / H;
    const fits = over <= 1.0001;
    // 화면에서 사진이 차지하는 넓이가 클수록 좋다. 넘치면 넘친 만큼 크게 깎는다
    const score = fits ? (n * photo * (photo / aspect)) / (W * H) : -over;
    if (!best || score > best.score) best = { cols, rows, label, cell, rowH, score };
  }
  const { score, ...out } = best;
  return out;
}
