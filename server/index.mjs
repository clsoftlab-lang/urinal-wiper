// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// 선택적 백엔드 프록시. 브라우저가 절대 API 키를 보지 못하도록,
// 실제 Claude 호출은 이 서버에서만 이루어진다.
// 실행:  ANTHROPIC_API_KEY=sk-ant-... node server/index.mjs
// CI 에서는 절대 실행하거나 설치하지 않는다.

import http from "node:http";
import Anthropic from "@anthropic-ai/sdk";

const PORT = process.env.PORT || 8787;
const MODEL = "claude-opus-5";

// 키는 서버 환경변수에서만 읽는다. 클라이언트로 노출 금지.
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEMS = {
  chat: "당신은 화장실 위생·시설관리 도우미입니다. 소변기 자동 위생 와이퍼(urinal wiper)의 운용·청소 스케줄·유지보수를 한국어로 간결히 조언하세요. 안전 인터록과 친환경 세정액 미량 사용을 항상 강조하세요.",
  explain: "당신은 시뮬레이션 결과 해설가입니다. 주어진 설정값과 소비/위생 수치를 바탕으로 물·세정액 트레이드오프를 한국어로 설명하세요. 수치는 추정임을 명시하세요.",
  guide: "당신은 설치·유지보수 가이드 작성자입니다. 소변기 와이퍼의 설치 절차, 권장 설정, 유지보수 주기를 한국어로 단계별로 작성하세요.",
};

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

  try {
    const body = await readBody(req);
    const { task = "chat", payload = {} } = JSON.parse(body || "{}");
    const system = SYSTEMS[task] || SYSTEMS.chat;
    const userText = buildUserMessage(task, payload);

    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });

    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 2048,
      thinking: { type: "adaptive" },
      system,
      messages: [{ role: "user", content: userText }],
    });

    stream.on("text", (t) => res.write(t));
    await stream.finalMessage();
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
