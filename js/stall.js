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

const MIN_CELL = 80;     // PC에서 칸의 최소 폭
const PHONE_COLS = 6;    // 모바일에서 최대 열 수
const LOW = 0.64, HIGH = 1.5; // 칸 높이 / 폭
const MIN_ROW = 44;      // 손가락으로 누를 수 있는 최소 높이

// n점을 W×H 화면에 까는 방법. 제목이 첫 줄의 남는 칸을 전부 차지해 구멍 없는 직사각형이 된다.
// 한 화면에 들어오면서 사진이 가장 커지는 열 수를 고르고, 너무 많으면 최소 칸 크기로 빽빽하게 깔고 스크롤한다.
export function layout(n, W, H) {
  const maxCols = Math.max(1, W < 768 ? PHONE_COLS : Math.floor(W / MIN_CELL));
  let best = null;
  for (let cols = 1; cols <= maxCols; cols++) {
    const cell = W / cols;
    const rows = Math.ceil((n + 1) / cols);
    const label = cols * rows - n; // 1 이상 cols 이하
    const rowH = Math.min(cell * HIGH, Math.max(cell * LOW, MIN_ROW, H / rows));
    const photo = Math.min(cell, rowH);
    const over = (rows * rowH) / H;
    const fits = over <= 1.0001;
    // 화면에서 사진이 차지하는 넓이가 클수록 좋다. 넘치면 넘친 만큼 크게 깎는다
    const score = fits ? (n * photo * photo) / (W * H) : -over;
    if (!best || score > best.score) best = { cols, rows, label, cell, rowH, score };
  }
  const { score, ...out } = best;
  return out;
}
