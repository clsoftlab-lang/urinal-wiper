// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// cycle.js — 순수 계산 모듈 (DOM/브라우저 의존성 없음)
// 소변기 와이퍼(urinal wiper) 1회 세정 사이클의 타이밍·소비량·위생 점수를 계산한다.
// 이 파일은 check.mjs 의 단위 테스트 대상이며, MockProvider(ai/ai.js) 도 재사용한다.

/**
 * 기본 설정값. UI 슬라이더 범위와 일치한다.
 * @typedef {Object} WiperSettings
 * @property {number} detectDelaySec  사용자 이탈 후 세정 시작까지 지연(초)
 * @property {number} wiperSpeed      와이퍼 속도 배율 (0.5=느림 ~ 2.0=빠름)
 * @property {number} detergentMl     사이클당 세정액 사용량(mL)
 */

/** 슬라이더/입력 범위 (UI 와 check.mjs 가 공유) */
export const RANGES = Object.freeze({
  detectDelaySec: { min: 1, max: 15, step: 1, def: 4 },
  wiperSpeed: { min: 0.5, max: 2.0, step: 0.1, def: 1.0 },
  detergentMl: { min: 0, max: 50, step: 5, def: 15 },
});

/** 유지보수 임계값 */
export const MAINT = Object.freeze({
  bladeLifeCycles: 3000, // 와이퍼 블레이드 권장 교체 주기
  detergentTankMl: 2000, // 세정액 탱크 용량(mL)
});

/** 물리 상수(추정, 검증되지 않은 참고값) */
const PHYS = Object.freeze({
  sweepBaseSec: 6.0, // 속도 1.0 기준 1왕복 스윕 시간(초)
  rinseSecPerMl: 0.12, // 세정액 1mL 분사에 걸리는 시간
  dryBaseSec: 3.5, // 송풍 건조 기본 시간(초)
  waterMlPerMl: 4.0, // 세정액 1mL 당 헹굼수 사용량 추정(mL)
  waterBaseMl: 60, // 세정액 0일 때도 쓰는 기본 헹굼수(mL)
});

/** 숫자를 [min,max] 로 제한 */
export function clamp(v, min, max) {
  if (Number.isNaN(Number(v))) return min;
  return Math.min(max, Math.max(min, Number(v)));
}

/** 설정값을 유효 범위로 정규화한다. */
export function normalizeSettings(s = {}) {
  return {
    detectDelaySec: clamp(s.detectDelaySec ?? RANGES.detectDelaySec.def, RANGES.detectDelaySec.min, RANGES.detectDelaySec.max),
    wiperSpeed: clamp(s.wiperSpeed ?? RANGES.wiperSpeed.def, RANGES.wiperSpeed.min, RANGES.wiperSpeed.max),
    detergentMl: clamp(s.detergentMl ?? RANGES.detergentMl.def, RANGES.detergentMl.min, RANGES.detergentMl.max),
  };
}

/**
 * 1회 사이클의 구간별 소요시간(초)을 반환한다.
 * @param {WiperSettings} settings
 */
export function phaseDurations(settings) {
  const s = normalizeSettings(settings);
  const sweepSec = round1(PHYS.sweepBaseSec / s.wiperSpeed);
  const rinseSec = round1(s.detergentMl * PHYS.rinseSecPerMl);
  const drySec = round1(PHYS.dryBaseSec + s.detergentMl * 0.05);
  return {
    delaySec: s.detectDelaySec,
    sweepSec,
    rinseSec,
    drySec,
    // 지연은 대기 시간이므로 "가동시간"에는 포함하되 별도 표기
    activeSec: round1(sweepSec + rinseSec + drySec),
    totalSec: round1(s.detectDelaySec + sweepSec + rinseSec + drySec),
  };
}

/**
 * 1회 사이클의 자원 소비량 추정.
 * @param {WiperSettings} settings
 */
export function consumption(settings) {
  const s = normalizeSettings(settings);
  const detergentMl = s.detergentMl;
  const waterMl = round1(PHYS.waterBaseMl + detergentMl * PHYS.waterMlPerMl);
  return { waterMl, detergentMl };
}

/**
 * 위생 점수(0~100) 추정.
 * - 세정액이 많을수록, 스윕이 (너무 빠르지 않게) 적정할수록 높다.
 * - 지연이 너무 길면 얼룩이 마르므로 소폭 감점.
 * @param {WiperSettings} settings
 * @returns {number} 0~100 정수
 */
export function hygieneScore(settings) {
  const s = normalizeSettings(settings);
  // 세정액 기여: 0mL=50점, 30mL 부근 포화
  const detergentScore = 50 + 40 * (1 - Math.exp(-s.detergentMl / 15));
  // 속도 기여: 1.0 근처가 최적, 너무 빠르면 닦임 불량, 너무 느리면 큰 차이 없음
  const speedPenalty = s.wiperSpeed > 1.3 ? (s.wiperSpeed - 1.3) * 18 : 0;
  // 지연 감점: 8초 초과부터 마름
  const delayPenalty = s.detectDelaySec > 8 ? (s.detectDelaySec - 8) * 1.5 : 0;
  const raw = detergentScore - speedPenalty - delayPenalty;
  return Math.round(clamp(raw, 0, 100));
}

/**
 * 누적 카운터 기반 유지보수 상태.
 * @param {number} cycleCount 총 누적 사이클 수
 * @param {number} detergentUsedMl 마지막 보충 이후 사용한 세정액(mL)
 */
export function maintenanceStatus(cycleCount = 0, detergentUsedMl = 0) {
  const bladeRemaining = Math.max(0, MAINT.bladeLifeCycles - (cycleCount % MAINT.bladeLifeCycles === 0 && cycleCount > 0 ? MAINT.bladeLifeCycles : cycleCount % MAINT.bladeLifeCycles));
  const bladePct = round1((bladeRemaining / MAINT.bladeLifeCycles) * 100);
  const tankRemainingMl = Math.max(0, MAINT.detergentTankMl - detergentUsedMl);
  const tankPct = round1((tankRemainingMl / MAINT.detergentTankMl) * 100);
  const alerts = [];
  if (bladePct <= 15) alerts.push({ type: 'blade', level: 'warn', msg: '와이퍼 블레이드 교체가 필요합니다.' });
  if (tankPct <= 15) alerts.push({ type: 'detergent', level: 'warn', msg: '세정액 보충이 필요합니다.' });
  if (tankRemainingMl <= 0) alerts.push({ type: 'detergent', level: 'crit', msg: '세정액이 소진되었습니다. 세정 없이 건식 스윕만 동작합니다.' });
  return { bladeRemaining, bladePct, tankRemainingMl, tankPct, alerts };
}

/**
 * 일간/월간 추정 소비량 (하루 사용횟수 가정).
 * @param {WiperSettings} settings
 * @param {number} usesPerDay 하루 평균 사용(=사이클) 횟수
 */
export function projectUsage(settings, usesPerDay = 120) {
  const c = consumption(settings);
  const t = phaseDurations(settings);
  return {
    daily: {
      cycles: usesPerDay,
      waterL: round2((c.waterMl * usesPerDay) / 1000),
      detergentMl: c.detergentMl * usesPerDay,
      activeMin: round1((t.activeSec * usesPerDay) / 60),
    },
    monthly: {
      cycles: usesPerDay * 30,
      waterL: round2((c.waterMl * usesPerDay * 30) / 1000),
      detergentL: round2((c.detergentMl * usesPerDay * 30) / 1000),
    },
  };
}

/** 한 번의 계산으로 UI 가 필요로 하는 모든 파생값을 묶어 반환 */
export function summarize(settings, cycleCount = 0, detergentUsedMl = 0) {
  const s = normalizeSettings(settings);
  return {
    settings: s,
    phases: phaseDurations(s),
    consumption: consumption(s),
    hygiene: hygieneScore(s),
    maintenance: maintenanceStatus(cycleCount, detergentUsedMl),
  };
}

function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round(n * 100) / 100; }
