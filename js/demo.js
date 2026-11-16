// 로컬 연습 모드(?local)에서만 쓰는 샘플 상품. 실제 사이트에는 나오지 않습니다.
const svg = (w, h, body) =>
  'data:image/svg+xml,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${body}</svg>`);

const shapes = {
  chair: (c) => svg(100, 100, `<g fill="${c}"><rect x="30" y="8" width="8" height="52"/><rect x="30" y="52" width="44" height="8"/><rect x="30" y="60" width="5" height="32"/><rect x="69" y="60" width="5" height="32"/></g>`),
  table: (c) => svg(200, 100, `<g fill="${c}"><rect x="10" y="34" width="180" height="8"/><rect x="22" y="42" width="6" height="48"/><rect x="172" y="42" width="6" height="48"/></g>`),
  lamp: (c) => svg(100, 200, `<polygon fill="${c}" points="32,14 68,14 86,70 14,70"/><g fill="#111"><rect x="48" y="70" width="4" height="112"/><rect x="28" y="182" width="44" height="6"/></g>`),
  sofa: (c) => svg(200, 100, `<g fill="${c}"><rect x="8" y="22" width="184" height="30" rx="4"/><rect x="8" y="48" width="184" height="30" rx="4"/><rect x="2" y="38" width="20" height="40" rx="4"/><rect x="178" y="38" width="20" height="40" rx="4"/></g><g fill="#111"><rect x="16" y="78" width="5" height="12"/><rect x="179" y="78" width="5" height="12"/></g>`),
  lounge: (c) => svg(200, 200, `<path fill="${c}" d="M40 40 Q30 110 70 120 L150 120 Q170 120 168 100 L160 96 L80 96 Q70 60 62 36 Z"/><g fill="#111"><rect x="98" y="120" width="6" height="40"/><rect x="60" y="160" width="82" height="6"/></g>`),
  shelf: (c) => svg(100, 200, `<g fill="${c}"><rect x="18" y="8" width="5" height="184"/><rect x="77" y="8" width="5" height="184"/><rect x="18" y="8" width="64" height="5"/><rect x="18" y="52" width="64" height="5"/><rect x="18" y="97" width="64" height="5"/><rect x="18" y="142" width="64" height="5"/><rect x="18" y="187" width="64" height="5"/></g>`),
  stool: (c) => svg(100, 100, `<ellipse fill="${c}" cx="50" cy="32" rx="30" ry="8"/><g stroke="#111" stroke-width="4"><line x1="30" y1="36" x2="22" y2="92"/><line x1="70" y1="36" x2="78" y2="92"/><line x1="50" y1="40" x2="50" y2="92"/></g>`),
  vase: (c) => svg(100, 100, `<path fill="${c}" d="M42 10 h16 v14 q22 14 22 38 q0 28 -30 28 q-30 0 -30 -28 q0 -24 22 -38 z"/>`),
  cube: (c) => svg(100, 100, `<rect fill="${c}" x="20" y="24" width="60" height="60"/>`),
  bench: (c) => svg(200, 100, `<g fill="${c}"><rect x="6" y="44" width="188" height="12"/><rect x="18" y="56" width="10" height="34"/><rect x="172" y="56" width="10" height="34"/></g>`),
};

const rows = [
  ['chair', '#d9381e', 0, 0, 1, 1, 'Side Chair', 420000],
  ['table', '#111111', 1, 0, 2, 1, 'Dining Table', 1850000],
  ['lamp', '#f2c200', 3, 0, 1, 2, 'Floor Lamp', 680000],
  ['lounge', '#1f4fd8', 4, 0, 2, 2, 'Lounge Chair', 3200000],
  ['stool', '#c9b79c', 6, 0, 1, 1, 'Stool', 260000],
  ['shelf', '#111111', 7, 0, 1, 2, 'Shelf', 940000],
  ['sofa', '#d9381e', 8, 0, 2, 1, 'Sofa', 4100000],
  ['bench', '#c9b79c', 0, 1, 2, 1, 'Bench', 720000],
  ['vase', '#1f4fd8', 2, 1, 1, 1, 'Vase', 140000],
  ['cube', '#f2c200', 6, 1, 1, 1, 'Side Cube', 310000],
  ['chair', '#111111', 8, 1, 1, 1, 'Side Chair', 420000],
  ['stool', '#d9381e', 9, 1, 1, 1, 'Stool', 260000],
  ['sofa', '#2b2b2b', 0, 2, 2, 1, 'Sofa', 3900000],
  ['vase', '#d9381e', 2, 2, 1, 1, 'Vase', 140000],
  ['chair', '#1f4fd8', 3, 2, 1, 1, 'Side Chair', 420000],
  ['table', '#c9b79c', 4, 2, 2, 1, 'Low Table', 990000],
  ['cube', '#111111', 6, 2, 1, 1, 'Side Cube', 310000],
  ['lamp', '#d9381e', 9, 2, 1, 2, 'Floor Lamp', 680000],
];

const texts = [
  ['chairs, tables', 0, 3, 3, 1],
  ['lighting', 5, 3, 2, 1],
];

export function demoItems() {
  const labels = texts.map(([label, x, y, w, h], i) => ({
    id: `demo-text-${i + 1}`, kind: 'text', label, scale: 1, x, y, w, h,
    name: '', code: '', price: null, sold: false, size: '', material: '', description: '', buy_url: '', image_url: '', thumb_url: '', detail_urls: [],
  }));
  return [...products(), ...labels];
}

function products() {
  return rows.map(([shape, color, x, y, w, h, name, price], i) => {
    const url = shapes[shape](color);
    return {
      id: `demo-${i + 1}`,
      kind: 'product',
      label: '',
      scale: 1,
      name,
      code: `DM-${String(i + 1).padStart(2, '0')}`,
      price,
      sold: i === 6,
      size: 'W 577 × D 465 × H 657 mm',
      material: 'Aluminum, Bolts, Nuts',
      description: '로컬 연습 모드용 샘플 상품입니다.',
      buy_url: '',
      image_url: url,
      thumb_url: url,
      detail_urls: [],
      x, y, w, h,
    };
  });
}
