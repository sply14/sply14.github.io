// 브랜드 레벨 (0 ~ 100, 100 = 구찌급). 수치마다 세부 레벨을 구하고 가중 평균한다.
// 곡선: 레벨 = 100 × (내 수치 ÷ 구찌 기준)^(1/p). 초반엔 잘 오르고 위로 갈수록 기하급수적으로 어려워진다.

export const DEFAULT_METRICS = {
  works: { label: '작품', baseline: 10000, p: 2.6, weight: 30, source: '구찌 온라인 상품 수 규모 추정치' },
  revenue: { label: '매출', baseline: 11e12, p: 7, weight: 40, source: '케링 연차보고서 구찌 연매출 약 76억 유로(2024)' },
  social: { label: '소셜', baseline: 50_000_000, p: 5.7, weight: 30, source: '구찌 인스타그램 팔로워 약 5천만' },
};

export function metricLevel(value, m) {
  if (!(value > 0)) return 0;
  return Math.min(100, 100 * (value / m.baseline) ** (1 / m.p));
}

export function brandLevel(values, metrics = DEFAULT_METRICS) {
  const parts = {};
  let sum = 0, weights = 0;
  for (const [key, m] of Object.entries(metrics)) {
    parts[key] = metricLevel(values[key] ?? 0, m);
    sum += parts[key] * m.weight;
    weights += m.weight;
  }
  return { total: weights > 0 ? sum / weights : 0, parts };
}

// 표시·비교용: 소수 첫째 자리 내림 (반올림하면 7.95가 8.0으로 보였다가 안 오른 것처럼 보인다)
export function floor1(x) {
  return Math.floor(x * 10 + 1e-9) / 10;
}

// 설계안 §5-3-1 표 그대로 (이런 브랜드 = name, 누가 아는가 = who)
export const TIERS = [
  { min: 0, max: 0, name: '아직 시작하지 않은 이름', who: '나만 안다' },
  { min: 1, max: 9, name: '첫 작품과 첫 판매가 생긴 1인 작업실', who: '친구와 친구의 친구' },
  { min: 10, max: 19, name: '취미를 넘어선 1인 브랜드. 사 간 사람이 다시 찾아온다', who: '가죽·빈티지 같은 작은 커뮤니티의 수백 명' },
  { min: 20, max: 29, name: '작은 독립 브랜드. 편집숍 한두 곳에 놓이고, 이름으로 검색하는 팬이 생긴다', who: '국내 패션 관심층 1만 명 중 1명' },
  { min: 30, max: 39, name: '국내 인디 브랜드로 자리 잡음. 온라인 패션 플랫폼에서 스스로 팔린다', who: '국내 패션 관심층 1천 명 중 1명' },
  { min: 40, max: 49, name: '국내에서 옷 좋아하는 사람이면 아는 이름. 해외 편집숍 입점이 시작된다', who: '국내 패션 관심층 100명 중 1명' },
  { min: 50, max: 59, name: '동아시아 패션 씬에서 통하는 브랜드. 서울·도쿄·상하이에 매장이 있다', who: '동아시아 일반인 1천 명 중 1명' },
  { min: 60, max: 69, name: '아시아를 대표하는 디자이너 브랜드. 파리·밀라노 패션위크에 이름이 오른다', who: '동아시아 일반인 100명 중 1명' },
  { min: 70, max: 79, name: '세계적인 디자이너 하우스. 전 세계 패션 업계가 다 안다', who: '전 세계 대도시 일반인 100명 중 1명' },
  { min: 80, max: 89, name: '글로벌 럭셔리 하우스의 반열. 대도시 길거리에서 로고를 알아본다', who: '전 세계 대도시 일반인 10명 중 1명' },
  { min: 90, max: 99, name: '세계 최정상급 하우스이자 문화 아이콘', who: '전 세계 일반인 다수' },
  { min: 100, max: 100, name: '구찌급. 사실상 도달 불가능한 끝', who: '전 세계 거의 모두' },
];

// 화면에 0.0으로 보이는 동안만 0 단계("시작 전"). 0.1부터는 시작한 것이라 1~9 단계.
export function tierOf(level, tiers = TIERS) {
  const shown = floor1(level);
  if (shown <= 0) return tiers[0];
  const at = Math.max(shown, 1);
  return tiers.filter((t) => t.min <= at).pop();
}

export function nextTier(level, tiers = TIERS) {
  const cur = tierOf(level, tiers);
  const i = tiers.indexOf(cur);
  return i >= 0 && i < tiers.length - 1 ? tiers[i + 1] : null;
}
