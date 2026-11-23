// 브랜드 로그: 관리자가 쓴 하루 평문을 Claude가 작업·판매로 나눠 JSON으로 돌려준다.
// 비밀값: ANTHROPIC_API_KEY (Supabase 대시보드 → Edge Functions → Secrets). SUPABASE_URL, SUPABASE_ANON_KEY는 기본 제공.
// 클라이언트(js/log-parse-local.js의 normalizeParse)가 결과를 다시 검사하므로 여기서는 모양만 맞춘다.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = ["https://sply14.github.io", "http://127.0.0.1:4396", "http://localhost:4396"];

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

const nullable = (type: string) => ({ type: [type, "null"] });

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["date", "rest", "work", "sales"],
  properties: {
    date: { type: "string", description: "YYYY-MM-DD" },
    rest: { type: "boolean" },
    work: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "minutes", "span_key"],
        properties: { title: { type: "string" }, minutes: nullable("integer"), span_key: nullable("string") },
      },
    },
    sales: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item_id", "title", "channel", "amount", "qty", "gift"],
        properties: {
          item_id: nullable("string"),
          title: { type: "string" },
          channel: nullable("string"),
          amount: nullable("integer"),
          qty: { type: "integer" },
          gift: { type: "boolean" },
        },
      },
    },
  },
};

const system = `너는 가죽 소품 브랜드 운영자의 하루 기록을 정리한다. 입력은 JSON(today, text, items, channels, openSpans)이다.
- text를 작업(work)과 판매(sales)로 나눈다. 문장에 없는 것은 지어내지 않는다.
- 작업 title은 짧게, 원문 표현을 살린다.
- minutes: 시간은 분 단위 정수(2시간=120, 반나절=240, 하루 종일=480). 말하지 않았으면 null.
- amount: 금액은 원 단위 정수("3만원"=30000, "만오천원"=15000). 말하지 않았으면 null. qty는 개수, 기본 1. 선물로 줬으면 gift true.
- channel: channels 중 가장 가까운 것("후르츠"=후르츠패밀리, "스스"=스마트스토어, "디엠"=DM). 없으면 null.
- item_id: 판 물건이 items의 name과 같은 물건이면 그 id, 확실하지 않으면 null. title에는 판 물건 이름을 쓴다.
- date: "어제", "그저께"는 today 기준으로 계산한다. 언급이 없으면 today. 미래 날짜는 쓰지 않는다.
- rest: 쉬었다는 내용뿐이면 true, 아니면 false.
- span_key: 이어지는 작업이면 openSpans의 span_key를 그대로 쓴다. 새 작업이 여러 날 이어질 것 같으면 짧은 영문 소문자 key(예: "card-wallet")를 만들고, 아니면 null.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "POST only" });

  // 관리자만
  const authorization = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: admin, error: adminError } = await sb.from("admins").select("user_id").maybeSingle();
  if (adminError || !admin) return json(req, 403, { error: "admin only" });

  let body: { text?: string; today?: string; items?: unknown[]; channels?: unknown[]; openSpans?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { error: "invalid json" });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text || text.length > 4000) return json(req, 400, { error: "text must be 1-4000 characters" });

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema } },
      system,
      messages: [{
        role: "user",
        content: JSON.stringify({
          today: body.today,
          text,
          items: body.items ?? [],
          channels: body.channels ?? [],
          openSpans: body.openSpans ?? [],
        }),
      }],
    } as never);
    // deno-lint-ignore no-explicit-any
    const msg = response as any;
    if (msg.stop_reason === "refusal") return json(req, 422, { error: "refused" });
    // deno-lint-ignore no-explicit-any
    const block = msg.content.find((b: any) => b.type === "text");
    if (!block) return json(req, 502, { error: "no output" });
    return json(req, 200, JSON.parse(block.text));
  } catch (err) {
    console.error(err);
    return json(req, 502, { error: "parse failed" });
  }
});
