// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// worker.js — Cloudflare Workers 변형(무인·무료 호스팅).
// 관리할 서버가 없어(free tier) 앱이 스스로 굴러간다.
// Anthropic REST 를 직접 호출한다. 키는 Worker 시크릿에만 존재:
//   wrangler secret put ANTHROPIC_API_KEY
// 모델 상향(선택):  wrangler.toml [vars] AI_MODEL = "claude-sonnet-5"
//
// 요청: POST /api/ai  { task, payload }   →   text/plain 응답(전체 텍스트)
// 실패 시 429 {fallback:true} 를 돌려주어 클라이언트가 Mock 으로 폴백하게 한다(무인, 앱 불파손).

const SYSTEMS = {
  chat: "당신은 화장실 위생·시설관리 도우미입니다. 소변기 자동 위생 와이퍼(urinal wiper)의 운용·청소 스케줄·유지보수를 한국어로 간결히 조언하세요. 안전 인터록과 친환경 세정액 미량 사용을 항상 강조하세요.",
  explain: "당신은 시뮬레이션 결과 해설가입니다. 주어진 설정값과 소비/위생 수치를 바탕으로 물·세정액 트레이드오프를 한국어로 설명하세요. 수치는 추정임을 명시하세요.",
  guide: "당신은 설치·유지보수 가이드 작성자입니다. 소변기 와이퍼의 설치 절차, 권장 설정, 유지보수 주기를 한국어로 단계별로 작성하세요.",
  digest: "당신은 시설 위생 브리핑 작성자입니다. 주어진 소변기 와이퍼 상태·소비 수치를 바탕으로 '오늘의 위생 관리 팁'과 '권장 세정/점검 주기'를 한국어로 간결하게 제시하세요. 수치는 추정임을 명시하고, 안전 인터록과 친환경 세정액 미량 사용을 강조하세요.",
};

const MAX_TOKENS = { chat: 700, explain: 700, digest: 700, guide: 900 };

// 초경량 인메모리 IP 레이트리밋(아이솔레이트 수명 동안 유효)
const ipHits = new Map();
const RATE_MAX = 20;
const RATE_WINDOW_MS = 60_000;
function rateLimited(ip) {
  const now = Date.now();
  const arr = (ipHits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  arr.push(now);
  ipHits.set(ip, arr);
  return arr.length > RATE_MAX;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function buildUserMessage(task, payload) {
  const ctx = JSON.stringify(payload, null, 2);
  if (task === "explain") return `다음 시뮬레이션 설정/결과를 해설해 주세요:\n${ctx}`;
  if (task === "guide") return `다음 조건으로 설치·유지보수 가이드를 작성해 주세요:\n${ctx}`;
  if (task === "digest") return `다음 시설 상태를 바탕으로 '오늘의 위생 관리 팁'과 '권장 세정 주기'를 간결히 작성해 주세요:\n${ctx}`;
  return `사용자 문의: ${payload.message || payload.q || ""}\n참고 상태:\n${ctx}`;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    const url = new URL(request.url);
    if (request.method !== "POST" || !url.pathname.startsWith("/api/ai")) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "content-type": "application/json", ...corsHeaders() },
      });
    }

    // 비용 우선 기본값. env.AI_MODEL 로 상향 가능(claude-sonnet-5 / claude-opus-5).
    const MODEL = env.AI_MODEL || "claude-haiku-4-5";
    const IS_HAIKU = MODEL.startsWith("claude-haiku");
    const EFFORT = env.AI_EFFORT || "low";

    const ip = (request.headers.get("cf-connecting-ip") || "unknown").split(",")[0].trim();
    if (rateLimited(ip)) {
      return new Response(JSON.stringify({ fallback: true }), {
        status: 429,
        headers: { "content-type": "application/json", ...corsHeaders() },
      });
    }

    try {
      const { task = "chat", payload = {} } = await request.json();
      const systemText = SYSTEMS[task] || SYSTEMS.chat;

      const body = {
        model: MODEL,
        max_tokens: MAX_TOKENS[task] || 700,
        // 프롬프트 캐싱: 안정적 시스템 프롬프트를 ephemeral 캐시 블록으로.
        system: [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: buildUserMessage(task, payload) }],
      };
      // Haiku 4.5 는 thinking/effort 미지원(400 방지). 그 외 모델만 적용.
      if (!IS_HAIKU) {
        body.thinking = { type: "adaptive" };
        body.output_config = { effort: EFFORT };
      }

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY, // Worker 시크릿에만 존재
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        // 상류 오류 → 폴백 신호(무인). 클라이언트는 Mock 으로 전환.
        return new Response(JSON.stringify({ fallback: true }), {
          status: 429,
          headers: { "content-type": "application/json", ...corsHeaders() },
        });
      }

      const data = await resp.json();
      const text = (data.content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");

      return new Response(text, {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8", ...corsHeaders() },
      });
    } catch (_e) {
      return new Response(JSON.stringify({ fallback: true }), {
        status: 429,
        headers: { "content-type": "application/json", ...corsHeaders() },
      });
    }
  },
};
