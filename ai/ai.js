// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// ai.js — 프론트엔드 AI 클라이언트.
// AI_ENDPOINT 가 비어있으면 결정론적 한국어 MockProvider 로 응답한다(데모).
// 설정되어 있으면 백엔드 프록시로 POST 하고 스트림을 받는다.
// 어떤 경우에도 브라우저에는 API 키가 없다.

import { AI_ENDPOINT } from "./config.js";
import { summarize, projectUsage, MAINT } from "../cycle.js";

/**
 * @param {"chat"|"explain"|"guide"|"digest"} task
 * @param {object} payload
 * @param {{onToken?: (t:string)=>void}} [opts]
 * @returns {Promise<string>} 전체 응답 텍스트
 *
 * 무인(autonomous) 정책: 엔드포인트 실패 / 429 {fallback:true} / 네트워크 오류 시
 * 결정론적 Mock 으로 자동 폴백한다 → 앱은 절대 깨지지 않는다.
 */
export async function askAI(task, payload = {}, { onToken } = {}) {
  if (!AI_ENDPOINT) {
    return mockRespond(task, payload, onToken);
  }
  let full = "";
  let streamed = false;
  try {
    // 실제 백엔드 프록시 호출 (스트리밍)
    const res = await fetch(AI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, payload }),
    });
    // 예산/레이트 초과(429 fallback) → 무인 폴백
    if (res.status === 429) {
      return mockRespond(task, payload, onToken);
    }
    if (!res.ok || !res.body) {
      throw new Error(`AI 백엔드 오류: ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      full += chunk;
      streamed = true;
      if (onToken) onToken(chunk);
    }
    return full;
  } catch (_err) {
    // 네트워크 오류/백엔드 다운 → Mock 으로 폴백(무인).
    // 이미 일부 토큰이 흘러갔다면 중복 방지를 위해 받은 만큼만 반환.
    if (streamed) return full;
    return mockRespond(task, payload, onToken);
  }
}

/** 스트리밍을 흉내 내며 문자열을 조각내어 콜백에 흘려보낸다. */
async function stream(text, onToken) {
  if (!onToken) return text;
  const parts = text.match(/[\s\S]{1,24}/g) || [text];
  for (const p of parts) {
    onToken(p);
    // 데모용 짧은 지연 (테스트/노드 환경에서는 setTimeout 이 즉시 처리됨)
    await new Promise((r) => setTimeout(r, 12));
  }
  return text;
}

/**
 * 결정론적 Mock — 동일 입력 → 동일 출력. cycle.js 계산을 재사용한다.
 * check.mjs 가 이 결정론성을 검증한다.
 */
export function mockRespond(task, payload = {}, onToken) {
  const text = buildMock(task, payload);
  if (onToken) return stream(text, onToken);
  return Promise.resolve(text);
}

/** 결정론적 텍스트 생성 (순수 함수) */
export function buildMock(task, payload = {}) {
  const settings = payload.settings || {};
  const cycleCount = Number(payload.cycleCount || 0);
  const detergentUsedMl = Number(payload.detergentUsedMl || 0);
  const s = summarize(settings, cycleCount, detergentUsedMl);
  const usage = projectUsage(s.settings, Number(payload.usesPerDay || 120));

  if (task === "explain") {
    return [
      "【시뮬 결과 설명 · 데모(Mock)】",
      "",
      `현재 설정: 감지지연 ${s.settings.detectDelaySec}초, 와이퍼 속도 ${s.settings.wiperSpeed}배, 세정액 ${s.settings.detergentMl}mL/사이클`,
      `추정 위생 점수: ${s.hygiene}/100`,
      `사이클당 소비: 물 ${s.consumption.waterMl}mL · 세정액 ${s.consumption.detergentMl}mL · 가동 ${s.phases.activeSec}초`,
      "",
      "물·세정액 트레이드오프:",
      s.settings.detergentMl >= 25
        ? "- 세정액을 넉넉히 써서 위생 점수는 높지만, 물/세정액 소비와 헹굼 시간이 늘어납니다. 유동인구가 적은 시간대에는 줄이는 편이 경제적입니다."
        : s.settings.detergentMl <= 5
        ? "- 세정액을 거의 쓰지 않아 절약되지만 얼룩 제거력이 약합니다. 위생이 중요한 장소라면 15mL 내외를 권장합니다."
        : "- 세정액 15mL 내외는 위생과 소비의 균형점입니다. 피크 시간에만 상향하는 스케줄을 고려하세요.",
      s.settings.wiperSpeed > 1.3
        ? "- 와이퍼 속도가 빠르면 사이클은 짧지만 닦임 품질이 떨어질 수 있습니다."
        : "- 와이퍼 속도는 적정 범위입니다.",
      "",
      `하루 ${usage.daily.cycles}회 가정 시 물 약 ${usage.daily.waterL}L/일, 월 세정액 약 ${usage.monthly.detergentL}L.`,
      "(수치는 추정 모델이며 실측이 아닙니다.)",
    ].join("\n");
  }

  if (task === "digest") {
    // 무인 자동 브리핑: cycle 모델에서 위생 팁 + 권장 세정/점검 주기를 산출.
    const usesPerDay = Number(payload.usesPerDay || 120);
    const perDayDet = s.consumption.detergentMl * usesPerDay;
    const bladeDays = Math.max(1, Math.round(MAINT.bladeLifeCycles / usesPerDay));
    const tankDays = perDayDet > 0 ? Math.max(1, Math.round(MAINT.detergentTankMl / perDayDet)) : null;
    const tip =
      s.hygiene >= 80
        ? "현재 설정은 위생 점수가 높습니다. 피크 시간 외에는 세정액을 소폭 낮춰 소비를 절약하세요."
        : s.hygiene >= 60
        ? "위생과 소비의 균형 구간입니다. 냄새가 느껴지면 세정액을 5mL 상향해 보세요."
        : "위생 점수가 낮습니다. 세정액을 15mL 내외로 올리고 와이퍼 속도를 1.0배로 맞추세요.";
    return [
      "【오늘의 시설 위생 관리 브리핑 · 데모(Mock)】",
      "",
      `추정 위생 점수 ${s.hygiene}/100 · 사이클당 물 ${s.consumption.waterMl}mL · 세정액 ${s.consumption.detergentMl}mL`,
      "",
      "위생 관리 팁:",
      "· " + tip,
      "· 트레이·노즐 항균 세척은 주 1회, 건조(송풍) 단계는 생략하지 마세요.",
      "· 사람 감지 중에는 구동부가 멈추도록 안전 인터록을 항상 확인하세요.",
      "",
      `권장 세정 주기 (하루 ${usesPerDay}회 가정):`,
      `· 와이퍼 블레이드 점검/교체: 약 ${bladeDays}일마다 (권장 ${MAINT.bladeLifeCycles}사이클)`,
      tankDays
        ? `· 세정액 탱크 보충: 약 ${tankDays}일마다 (${MAINT.detergentTankMl}mL 기준)`
        : "· 세정액 미사용 설정 — 탱크 보충 불필요(건식 스윕).",
      `· 일 물 사용 추정 약 ${usage.daily.waterL}L, 월 세정액 약 ${usage.monthly.detergentL}L.`,
      "(수치는 추정 모델이며 실측이 아닙니다.)",
    ].join("\n");
  }

  if (task === "guide") {
    const place = payload.place || "일반 사무실 화장실";
    return [
      "【설치·유지보수 가이드 · 데모(Mock)】",
      "",
      `대상: ${place}`,
      "",
      "설치",
      "1) 소변기 우측 벽면에 하우징을 수평으로 고정하고 배수 트레이를 기존 드레인 쪽으로 경사지게 맞춥니다.",
      "2) PIR/ToF 센서가 사용자 서는 위치를 향하도록 각도를 조정합니다(오작동 방지 인터록 확인).",
      "3) 세정액 탱크(2L)를 채우고 펌프 프라이밍 후 노즐 분사 패턴을 점검합니다.",
      "",
      "권장 설정",
      `- 감지지연 ${s.settings.detectDelaySec}초 / 와이퍼 속도 ${s.settings.wiperSpeed}배 / 세정액 ${s.settings.detergentMl}mL`,
      "",
      "유지보수 주기",
      `- 와이퍼 블레이드: 약 ${s.maintenance.bladePct}% 잔여(권장 3000사이클 교체)`,
      `- 세정액 탱크: 약 ${s.maintenance.tankPct}% 잔여`,
      s.maintenance.alerts.length
        ? "- 알림: " + s.maintenance.alerts.map((a) => a.msg).join(" ")
        : "- 현재 소모품 알림 없음.",
      "- 트레이/노즐은 주 1회 항균 세척을 권장합니다.",
    ].join("\n");
  }

  // 기본: 챗봇 (시설관리 도우미)
  const q = String(payload.message || payload.q || "").trim();
  const tips = [
    "· 사람이 감지되는 동안에는 구동부가 절대 동작하지 않도록 인터록을 먼저 확인하세요.",
    "· 세정액은 친환경·인체무해 등급을 미량만 사용하고, 노즐 막힘을 주기적으로 점검하세요.",
    "· 오수는 기존 소변기 배수로 유도해 별도 배관을 최소화합니다.",
  ];
  let answer;
  if (/청소|스케줄|주기|schedule/i.test(q)) {
    answer = `청소 스케줄 제안: 이용량이 많은 오전/점심 피크에는 세정액을 ${Math.min(30, s.settings.detergentMl + 5)}mL 로 상향, 야간에는 절약 모드로 낮추세요. 트레이·노즐 항균 세척은 주 1회, 블레이드 점검은 월 1회를 권장합니다.`;
  } else if (/세정액|물|소비|비용|water|detergent/i.test(q)) {
    answer = `현재 설정 기준 사이클당 물 ${s.consumption.waterMl}mL, 세정액 ${s.consumption.detergentMl}mL 를 씁니다. 위생 점수 ${s.hygiene}/100. 소비를 줄이려면 세정액을 낮추되 위생 점수 하락을 확인하세요.`;
  } else if (/냄새|위생|세균|hygien/i.test(q)) {
    answer = `위생 관리 팁: 항균 하우징 표면과 트레이를 주기적으로 세척하고, 건조(송풍) 단계를 생략하지 마세요. 현재 추정 위생 점수는 ${s.hygiene}/100 입니다.`;
  } else {
    answer = `문의 요약: "${q || "(내용 없음)"}". 시설 위생·유지보수 관점에서 도와드립니다. 현재 추정 위생 점수 ${s.hygiene}/100, 사이클당 세정액 ${s.consumption.detergentMl}mL.`;
  }
  return ["【AI 시설관리 도우미 · 데모(Mock)】", "", answer, "", "위생/유지보수 참고:", ...tips].join("\n");
}
