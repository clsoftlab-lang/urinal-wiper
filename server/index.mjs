// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// 선택적 백엔드 프록시. 브라우저가 절대 API 키를 보지 못하도록,
// 실제 Claude 호출은 이 서버에서만 이루어진다.
// 실행:  ANTHROPIC_API_KEY=sk-ant-... node server/index.mjs
// CI 에서는 절대 실행하거나 설치하지 않는다.
//
// 비용 합리화(저비용) 정책:
//  - 기본 모델은 비용 우선(claude-haiku-4-5). AI_MODEL 로 상향 가능.
//  - 안정적인 태스크별 시스템 프롬프트를 프롬프트 캐시(ephemeral)로 전송 → 반복 호출 비용 절감.
//  - 태스크별 소박한 max_tokens 상한.
//  - 인메모리 IP 레이트리밋 + 월간 토큰 예산. 초과 시 429 {fallback:true}.

import http from "node:http";
import Anthropic from "@anthropic-ai/sdk";

const PORT = process.env.PORT || 8787;

// 비용 우선 기본값. 품질이 더 필요하면 AI_MODEL 로 claude-sonnet-5 또는 claude-opus-5 로 상향.
const MODEL = process.env.AI_MODEL || "claude-haiku-4-5";
// Haiku 4.5 는 adaptive thinking / effort 를 받지 않는다(400 방지).
const IS_HAIKU = MODEL.startsWith("claude-haiku");
const EFFORT = process.env.AI_EFFORT || "low";

// 비용 가드레일
const RATE_MAX = 20;              // IP 당 분당 최대 요청
const RATE_WINDOW_MS = 60_000;
const MONTHLY_TOKEN_CAP = Number(process.env.AI_MONTHLY_TOKEN_CAP || 2_000_000);

// 태스크별 출력 상한(소박하게; 정말 필요한 태스크만 상향)
const MAX_TOKENS = { chat: 700, explain: 700, digest: 700, guide: 900 };

// 키는 서버 환경변수에서만 읽는다. 클라이언트로 노출 금지.
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEMS = {
  chat: "당신은 화장실 위생·시설관리 도우미입니다. 소변기 자동 위생 와이퍼(urinal wiper)의 운용·청소 스케줄·유지보수를 한국어로 간결히 조언하세요. 안전 인터록과 친환경 세정액 미량 사용을 항상 강조하세요.",
  explain: "당신은 시뮬레이션 결과 해설가입니다. 주어진 설정값과 소비/위생 수치를 바탕으로 물·세정액 트레이드오프를 한국어로 설명하세요. 수치는 추정임을 명시하세요.",
  guide: "당신은 설치·유지보수 가이드 작성자입니다. 소변기 와이퍼의 설치 절차, 권장 설정, 유지보수 주기를 한국어로 단계별로 작성하세요.",
  digest: "당신은 시설 위생 브리핑 작성자입니다. 주어진 소변기 와이퍼 상태·소비 수치를 바탕으로 '오늘의 위생 관리 팁'과 '권장 세정/점검 주기'를 한국어로 간결하게 제시하세요. 수치는 추정임을 명시하고, 안전 인터록과 친환경 세정액 미량 사용을 강조하세요.",
};

// ---------- 비용 가드레일 상태(인메모리) ----------
const ipHits = new Map(); // ip -> number[] (요청 timestamp)
let monthlyTokens = 0;
let monthKey = new Date().toISOString().slice(0, 7); // "YYYY-MM"

function rateLimited(ip) {
  const now = Date.now();
  const arr = (ipHits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  arr.push(now);
  ipHits.set(ip, arr);
  return arr.length > RATE_MAX;
}
function budgetExceeded() {
  const mk = new Date().toISOString().slice(0, 7);
  if (mk !== monthKey) { monthKey = mk; monthlyTokens = 0; } // 월 경계에서 리셋
  return monthlyTokens >= MONTHLY_TOKEN_CAP;
}
function addUsage(usage) {
  if (!usage) return;
  monthlyTokens +=
    (usage.input_tokens || 0) +
    (usage.output_tokens || 0) +
    (usage.cache_creation_input_tokens || 0) +
    (usage.cache_read_input_tokens || 0);
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== "POST" || !req.url.startsWith("/api/ai")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  // 비용 가드레일: 초과 시 429 {fallback:true} → 클라이언트는 Mock 으로 폴백
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
  if (rateLimited(ip) || budgetExceeded()) {
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ fallback: true }));
    return;
  }

  try {
    const body = await readBody(req);
    const { task = "chat", payload = {} } = JSON.parse(body || "{}");
    const systemText = SYSTEMS[task] || SYSTEMS.chat;
    const userText = buildUserMessage(task, payload);

    // 프롬프트 캐싱: 안정적인 태스크 시스템 프롬프트를 ephemeral 캐시 블록으로 전송.
    const system = [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }];

    const params = {
      model: MODEL,
      max_tokens: MAX_TOKENS[task] || 700,
      system,
      messages: [{ role: "user", content: userText }],
    };
    // Haiku 4.5 는 thinking/effort 미지원(400 방지). 그 외 모델만 adaptive thinking + effort.
    if (!IS_HAIKU) {
      params.thinking = { type: "adaptive" };
      params.output_config = { effort: EFFORT };
    }

    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });

    const stream = client.messages.stream(params);
    stream.on("text", (t) => res.write(t));
    const finalMessage = await stream.finalMessage();
    addUsage(finalMessage && finalMessage.usage); // 최종 메시지 usage 누적
    res.end();
  } catch (err) {
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
  }
});

function buildUserMessage(task, payload) {
  const ctx = JSON.stringify(payload, null, 2);
  if (task === "explain") return `다음 시뮬레이션 설정/결과를 해설해 주세요:\n${ctx}`;
  if (task === "guide") return `다음 조건으로 설치·유지보수 가이드를 작성해 주세요:\n${ctx}`;
  if (task === "digest") return `다음 시설 상태를 바탕으로 '오늘의 위생 관리 팁'과 '권장 세정 주기'를 간결히 작성해 주세요:\n${ctx}`;
  return `사용자 문의: ${payload.message || payload.q || ""}\n참고 상태:\n${ctx}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

server.listen(PORT, () => {
  console.log(`[urinal-wiper] AI proxy listening on :${PORT} (model ${MODEL})`);
});
