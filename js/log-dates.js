// 브랜드 로그의 날짜 도구. 날짜는 모두 'YYYY-MM-DD' 문자열이고, 하루의 경계는 한국 시간 자정입니다.
// 계산은 UTC 정오 기준 Date로 해서 시간대·서머타임 영향을 받지 않게 합니다.

const DAY = 86400000;
const KST = 9 * 3600000;

const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const toDate = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
};

export function kstToday(now = new Date()) {
  return toKey(new Date(now.getTime() + KST));
}

// 시각(ISO 문자열 또는 Date)이 속한 한국 날짜
export function kstDateOf(at) {
  return toKey(new Date(new Date(at).getTime() + KST));
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(date, n) {
  return toKey(new Date(toDate(date).getTime() + n * DAY));
}

export function diffDays(a, b) {
  return Math.round((toDate(b) - toDate(a)) / DAY);
}

export function yearDates(year) {
  const out = [];
  for (let d = `${year}-01-01`; d.startsWith(String(year)); d = addDays(d, 1)) out.push(d);
  return out;
}

// 0 = 월요일 … 6 = 일요일
export function weekday(date) {
  return (toDate(date).getUTCDay() + 6) % 7;
}

// 그 주의 월요일
export function weekStart(date) {
  return addDays(date, -weekday(date));
}

// 한 달을 월요일 시작 주 단위로. 달에 속하지 않는 칸은 null.
export function monthWeeks(year, month) {
  const first = `${year}-${pad(month)}-01`;
  const cells = Array(weekday(first)).fill(null);
  for (let d = 1; d <= daysInMonth(year, month); d++) cells.push(`${year}-${pad(month)}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
