// 브랜드 로그 데이터 계층. 실제(Supabase)와 연습 모드(?local, 이 브라우저에만 저장)가 같은 메서드를 가집니다.
import { SUPABASE_URL, SUPABASE_KEY, TABLE, LOCAL, LOCAL_KEY, loadLocal } from './common.js?v=1795604839';
import { addDays, kstToday } from './log-dates.js?v=1795604839';

export const DEFAULT_CHANNELS = ['DM', '스마트스토어', '후르츠패밀리'];
// 낱개(piece)는 사진·이름을 찾을 때 쓰인다 (만든 개수는 catalog_events로 셈)
const pickItems = (rows) =>
  rows.filter((r) => r.kind === 'product' || r.kind === 'piece').map(({ id, name, thumb_url, image_url, kind, hidden, parent_id, no }) => ({ id, name, thumb_url, image_url, kind, hidden: !!hidden, parent_id: parent_id ?? null, no: no ?? null }));

export async function createLogApi() {
  return LOCAL ? localApi() : remoteApi();
}

/* ───────── 실제 (Supabase) ───────── */

async function remoteApi() {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  const ok = ({ data, error }) => {
    if (error) throw error;
    return data;
  };
  // 한 번에 1000줄까지만 오므로 나눠서 전부 받는다
  const all = async (build) => {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const rows = ok(await build().range(from, from + 999));
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  };

  return {
    async user() {
      return (await sb.auth.getSession()).data.session?.user ?? null;
    },
    async isAdmin() {
      return !!ok(await sb.from('admins').select('user_id').maybeSingle());
    },
    async load() {
      const [days, work, sales, events, items, options] = await Promise.all([
        all(() => sb.from('log_days').select('date').order('date')),
        all(() => sb.from('log_work').select('id,date,title,minutes,span_key,item_id,created_at').order('created_at')),
        all(() => sb.from('log_sales').select('id,date,item_id,title,channel,amount,qty,gift,created_at').order('created_at')),
        all(() => sb.from('catalog_events').select('item_id,event,at,parent_id').order('id')),
        all(() => sb.from(TABLE).select('id,name,thumb_url,image_url,kind,hidden,parent_id,no')),
        all(() => sb.from('log_options').select('key,value')),
      ]);
      const opt = Object.fromEntries(options.map((o) => [o.key, o.value]));
      return { days, work, sales, events, items: pickItems(items), channels: opt.channels ?? DEFAULT_CHANNELS, settings: opt.settings ?? {} };
    },
    async entries(date) {
      return ok(await sb.from('log_entries').select('id,text,created_at').eq('date', date).order('created_at'));
    },
    async save(draft) {
      ok(await sb.rpc('log_save_day', { payload: draft }));
    },
    async updateWork(id, patch) {
      ok(await sb.from('log_work').update(patch).eq('id', id).select('id').single());
    },
    async deleteWork(id) {
      ok(await sb.from('log_work').delete().eq('id', id));
    },
    async updateSale(id, patch) {
      ok(await sb.from('log_sales').update(patch).eq('id', id).select('id').single());
    },
    async deleteSale(id) {
      ok(await sb.from('log_sales').delete().eq('id', id));
    },
    async saveSettings(settings) {
      ok(await sb.from('log_options').upsert({ key: 'settings', value: settings }));
    },
    async saveChannels(channels) {
      ok(await sb.from('log_options').upsert({ key: 'channels', value: channels }));
    },
  };
}

/* ───────── 연습 모드 (?local) ───────── */

const KEY = 'brand-log-local-v1';

async function localApi() {
  const catalog = await loadLocal();
  let db;
  try {
    db = JSON.parse(localStorage.getItem(KEY));
  } catch {
    db = null;
  }
  if (!db) {
    // 연습 상품들이 지난 두 달 동안 하나씩 올라온 것처럼 이벤트를 만들어 둔다 (달력에 스티커가 보이도록)
    const today = kstToday();
    const products = catalog.filter((i) => i.kind === 'product' && !i.hidden);
    const events = products.map((p, i) => ({
      item_id: p.id,
      event: 'added',
      at: new Date(`${addDays(today, -Math.round((products.length - i) * 3.3))}T12:00:00+09:00`).toISOString(),
    }));
    // 좌판의 낱개는 오늘 올린 것으로
    for (const p of catalog.filter((i) => i.kind === 'piece')) events.push({ item_id: p.id, event: 'added', at: new Date().toISOString(), parent_id: p.parent_id });
    db = { days: [], entries: [], work: [], sales: [], events, channels: DEFAULT_CHANNELS, settings: {} };
  }
  const persist = () => localStorage.setItem(KEY, JSON.stringify(db));
  persist();

  const find = (list, id) => {
    const row = list.find((r) => r.id === id);
    if (!row) throw new Error('기록을 찾지 못했습니다');
    return row;
  };

  return {
    async user() { return { email: 'local' }; },
    async isAdmin() { return true; },
    async load() {
      const items = pickItems(await loadLocal());
      return structuredClone({ days: db.days, work: db.work, sales: db.sales, events: db.events, items, channels: db.channels, settings: db.settings });
    },
    async entries(date) {
      return structuredClone(db.entries.filter((e) => e.date === date));
    },
    async save(draft) {
      const now = new Date().toISOString();
      const { date } = draft;
      if (!db.days.some((d) => d.date === date)) {
        db.days.push({ date });
        db.days.sort((a, b) => (a.date < b.date ? -1 : 1));
      }
      if (draft.text?.trim()) db.entries.push({ id: crypto.randomUUID(), date, text: draft.text, created_at: now });
      for (const w of draft.work) if (w.title?.trim()) db.work.push({ id: crypto.randomUUID(), date, title: w.title, minutes: w.minutes, span_key: w.span_key || null, item_id: w.item_id || null, created_at: now });
      for (const s of draft.sales) db.sales.push({ id: crypto.randomUUID(), date, item_id: s.item_id, title: s.title, channel: s.channel, amount: s.amount, qty: s.qty, gift: s.gift, created_at: now });
      const sold = draft.sales.filter((s) => s.mark_sold && s.item_id).map((s) => s.item_id);
      if (sold.length) {
        const items = await loadLocal();
        for (const it of items) if (sold.includes(it.id)) it.sold = true;
        localStorage.setItem(LOCAL_KEY, JSON.stringify(items));
      }
      persist();
    },
    async updateWork(id, patch) { Object.assign(find(db.work, id), patch); persist(); },
    async deleteWork(id) { db.work = db.work.filter((w) => w.id !== id); persist(); },
    async updateSale(id, patch) { Object.assign(find(db.sales, id), patch); persist(); },
    async deleteSale(id) { db.sales = db.sales.filter((s) => s.id !== id); persist(); },
    async saveSettings(settings) { db.settings = settings; persist(); },
    async saveChannels(channels) { db.channels = channels; persist(); },
  };
}
