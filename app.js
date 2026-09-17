// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// app.js — UI 배선. 계산은 cycle.js, AI 는 ai/ai.js 에 위임한다.

import {
  RANGES, normalizeSettings, phaseDurations, consumption,
  hygieneScore, maintenanceStatus, MAINT,
} from "./cycle.js";
import { askAI } from "./ai/ai.js";

const LS_KEY = "urinal-wiper.v1";
const $ = (id) => document.getElementById(id);

// ---------- 상태 ----------
const state = {
  settings: { detectDelaySec: RANGES.detectDelaySec.def, wiperSpeed: RANGES.wiperSpeed.def, detergentMl: RANGES.detergentMl.def },
  cycleCount: 0,
  detergentUsedMl: 0,
  theme: "auto",
  present: false,
  running: false,
};

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d.settings) state.settings = normalizeSettings(d.settings);
      if (Number.isFinite(d.cycleCount)) state.cycleCount = d.cycleCount;
      if (Number.isFinite(d.detergentUsedMl)) state.detergentUsedMl = d.detergentUsedMl;
      if (d.theme) state.theme = d.theme;
    }
  } catch (e) { /* localStorage 불가 환경 무시 */ }
}
function save() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      settings: state.settings, cycleCount: state.cycleCount,
      detergentUsedMl: state.detergentUsedMl, theme: state.theme,
    }));
  } catch (e) { /* 무시 */ }
}

// ---------- 테마 ----------
function applyTheme() {
  const root = document.documentElement;
  if (state.theme === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", state.theme);
}
function cycleTheme() {
  state.theme = state.theme === "auto" ? "light" : state.theme === "light" ? "dark" : "auto";
  applyTheme(); save();
}

// ---------- 탭 ----------
function initTabs() {
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach((t) => t.addEventListener("click", () => {
    tabs.forEach((x) => x.setAttribute("aria-selected", String(x === t)));
    document.querySelectorAll(".view").forEach((v) => (v.hidden = true));
    $("view-" + t.dataset.view).hidden = false;
  }));
}

// ---------- 메트릭 갱신 ----------
function refreshMetrics() {
  const s = state.settings;
  const cons = consumption(s);
  const ph = phaseDurations(s);
  const hy = hygieneScore(s);
  $("mHygiene").textContent = hy;
  $("mWater").textContent = cons.waterMl;
  $("mDet").textContent = cons.detergentMl;
  $("mTime").textContent = ph.activeSec;
  $("hygieneBar").style.width = hy + "%";
  $("mCycles").textContent = state.cycleCount;

  const m = maintenanceStatus(state.cycleCount, state.detergentUsedMl);
  $("mBlade").textContent = m.bladePct + "%";
  $("mTank").textContent = m.tankPct + "%";
  renderAlerts(m);
}

function renderAlerts(m) {
  const box = $("alerts");
  box.innerHTML = "";
  if (!m.alerts.length) {
    box.innerHTML = '<div class="alert ok">✔ 소모품 상태 정상 — 알림 없음.</div>';
    return;
  }
  for (const a of m.alerts) {
    const div = document.createElement("div");
    div.className = "alert " + (a.level === "crit" ? "crit" : "warn");
    div.textContent = (a.level === "crit" ? "⛔ " : "⚠ ") + a.msg;
    box.appendChild(div);
  }
}

// ---------- 슬라이더 ----------
function initControls() {
  bindRange("delay", "delayOut", "detectDelaySec", (v) => v.toFixed(0));
  bindRange("speed", "speedOut", "wiperSpeed", (v) => v.toFixed(1));
  bindRange("detergent", "detergentOut", "detergentMl", (v) => v.toFixed(0));
  // 초기 표시
  $("delay").value = state.settings.detectDelaySec;
  $("speed").value = state.settings.wiperSpeed;
  $("detergent").value = state.settings.detergentMl;
  $("delayOut").textContent = state.settings.detectDelaySec;
  $("speedOut").textContent = state.settings.wiperSpeed.toFixed(1);
  $("detergentOut").textContent = state.settings.detergentMl;
}
function bindRange(inputId, outId, key, fmt) {
  $(inputId).addEventListener("input", (e) => {
    const v = parseFloat(e.target.value);
    state.settings[key] = v;
    $(outId).textContent = fmt(v);
    refreshMetrics();
    save();
  });
}

// ---------- 시뮬레이션 애니메이션 ----------
let presenceTimer = null;
function setLed(color) { $("sensorLed").setAttribute("fill", color); }
function setPhase(label, running) {
  const b = $("phaseBadge");
  b.textContent = label;
  b.classList.toggle("run", !!running);
}
function setStatus(msg) { $("statusLine").textContent = msg; }
function show(el, on) { $(el).setAttribute("opacity", on ? "1" : "0"); }
function armAngle(deg) { $("arm").setAttribute("transform", `rotate(${deg} 395 292)`); }

function onPresenceToggle() {
  if (state.running) return; // 사이클 중엔 무시
  state.present = !state.present;
  const btn = $("btnPresence");
  btn.setAttribute("aria-pressed", String(state.present));
  btn.textContent = state.present ? "🚪 사용자 이탈" : "👤 사용자 진입";
  if (state.present) {
    show("person", true);
    setLed("var(--led-run)");
    setPhase("사용자 감지", false);
    setStatus("사용자 감지됨 — 안전 인터록 작동, 구동부 정지.");
    // 사용 중 얼룩 축적 표시
    show("splash", true);
  } else {
    show("person", false);
    setLed("var(--led-on)");
    startCycleAfterDelay();
  }
}

async function startCycleAfterDelay() {
  const delay = state.settings.detectDelaySec;
  setPhase("지연 대기 " + delay + "초", true);
  setStatus(`이탈 감지 — ${delay}초 후 세정 시작(오작동 방지 지연).`);
  clearTimeout(presenceTimer);
  presenceTimer = setTimeout(runCycle, Math.min(delay, 3) * 350); // 데모 가속(최대 ~1s)
}

async function runCycle() {
  state.running = true;
  const s = state.settings;
  const tankBefore = maintenanceStatus(state.cycleCount, state.detergentUsedMl);
  const dry = tankBefore.tankRemainingMl <= 0; // 세정액 소진 시 건식 스윕

  // 1) 스윕
  setPhase("와이퍼 스윕", true);
  setStatus("와이퍼 암 스윕 중…");
  const sweepMs = 900 / s.wiperSpeed;
  await sweepArm(sweepMs);

  // 2) 세정 분사
  if (!dry && s.detergentMl > 0) {
    setPhase("세정 분사", true);
    setStatus("세정액 분사 및 재스윕…");
    show("mist", true);
    await wait(700);
    show("mist", false);
    await sweepArm(sweepMs);
    state.detergentUsedMl += s.detergentMl;
  } else if (dry) {
    setStatus("세정액 소진 — 건식 스윕만 수행.");
  }

  // 얼룩 제거
  show("splash", false);

  // 3) 건조
  setPhase("송풍 건조", true);
  setStatus("송풍 건조 중…");
  show("dryair", true);
  await wait(700);
  show("dryair", false);

  // 완료
  state.cycleCount += 1;
  state.running = false;
  setPhase("대기", false);
  setLed("var(--led-off)");
  const m = maintenanceStatus(state.cycleCount, state.detergentUsedMl);
  setStatus(`세정 완료 — 누적 ${state.cycleCount}회. 위생 점수 ${hygieneScore(s)}/100.`);
  if (m.alerts.length) setStatus($("statusLine").textContent + " ⚠ 유지보수 알림 확인.");
  refreshMetrics();
  save();
}

function sweepArm(ms) {
  return new Promise((resolve) => {
    const start = performance.now();
    const half = ms / 2;
    function frame(now) {
      const t = now - start;
      let deg;
      if (t < half) deg = -70 * (t / half);
      else if (t < ms) deg = -70 * (1 - (t - half) / half);
      else deg = 0;
      armAngle(deg.toFixed(1));
      if (t < ms) requestAnimationFrame(frame);
      else { armAngle(0); resolve(); }
    }
    requestAnimationFrame(frame);
  });
}
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function resetSim() {
  clearTimeout(presenceTimer);
  state.present = false; state.running = false;
  $("btnPresence").setAttribute("aria-pressed", "false");
  $("btnPresence").textContent = "👤 사용자 진입";
  armAngle(0); show("person", false); show("splash", false); show("mist", false); show("dryair", false);
  setLed("var(--led-off)"); setPhase("대기", false);
  setStatus("초기화됨 — 대기 중.");
}

// ---------- 스펙 페이지 렌더 ----------
async function loadSpecs() {
  try {
    const [specs, parts] = await Promise.all([
      fetch("data/specs.json").then((r) => r.json()),
      fetch("data/parts.json").then((r) => r.json()),
    ]);
    renderSpecs(specs);
    renderBom(parts);
  } catch (e) {
    $("specConcept").textContent = "스펙 데이터를 불러오지 못했습니다. (로컬 서버에서 실행하세요: python -m http.server)";
  }
}
function renderSpecs(spec) {
  $("specConcept").textContent = spec.product.concept + " " + spec.product.goal;
  $("specStatus").textContent = "상태: " + spec.product.status;
  $("phaseList").innerHTML = spec.cycle_phases.map((p) => `<li><b>${esc(p.ko)}</b> — ${esc(p.desc)}</li>`).join("");
  $("subsysGrid").innerHTML = spec.subsystems.map((s) => `
    <div class="subsys">
      <h3>${esc(s.ko)}</h3>
      <div class="chips">${s.components.map((c) => `<span class="chip">${esc(c)}</span>`).join("")}</div>
      <p class="note">${esc(s.notes)}</p>
    </div>`).join("");
  $("hygieneNotes").innerHTML = spec.hygiene_notes.map((n) => `<li>${esc(n)}</li>`).join("");
  $("boundaries").innerHTML = spec.boundaries.map((n) => `<li>${esc(n)}</li>`).join("");
}
function renderBom(parts) {
  $("bomDisclaimer").textContent = parts.disclaimer;
  const tbody = $("bomTable").querySelector("tbody");
  let total = 0;
  tbody.innerHTML = parts.bom.map((p) => {
    const sum = p.qty * p.unit_price; total += sum;
    return `<tr><td>${esc(p.ko)}</td><td>${esc(p.category)}</td><td class="num">${p.qty}</td><td class="num">${fmtWon(p.unit_price)}</td><td class="num">${fmtWon(sum)}</td></tr>`;
  }).join("");
  $("bomTotal").textContent = fmtWon(total) + " 원";
}

// ---------- AI 배선 ----------
function aiPayload(extra = {}) {
  return { settings: state.settings, cycleCount: state.cycleCount, detergentUsedMl: state.detergentUsedMl, ...extra };
}
function initAI() {
  // 챗봇
  $("chatForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("chatInput");
    const q = input.value.trim();
    if (!q) return;
    appendChat("user", q);
    input.value = "";
    const aiEl = appendChat("ai", "…");
    aiEl.textContent = "";
    try {
      await askAI("chat", aiPayload({ message: q }), { onToken: (t) => { aiEl.textContent += t; scrollChat(); } });
    } catch (err) { aiEl.textContent = "오류: " + err.message; }
    scrollChat();
  });
  // 결과 설명
  $("btnExplain").addEventListener("click", async () => {
    const out = $("explainOut"); out.textContent = "";
    try { await askAI("explain", aiPayload(), { onToken: (t) => (out.textContent += t) }); }
    catch (err) { out.textContent = "오류: " + err.message; }
  });
  // 가이드
  $("btnGuide").addEventListener("click", async () => {
    const out = $("guideOut"); out.textContent = "";
    try { await askAI("guide", aiPayload({ place: $("placeInput").value.trim() }), { onToken: (t) => (out.textContent += t) }); }
    catch (err) { out.textContent = "오류: " + err.message; }
  });
}
// 무인 자동 브리핑: 페이지 로드 시 cycle 모델 + askAI("digest") 로 위생 팁/권장 세정 주기를 생성.
// AI_ENDPOINT 미설정/오류 시 askAI 가 Mock 으로 자동 폴백하므로 오프라인에서도 동작한다.
async function initDigest() {
  const out = $("digestOut");
  if (!out) return;
  out.textContent = "";
  try {
    await askAI("digest", aiPayload({ usesPerDay: 120 }), { onToken: (t) => { out.textContent += t; } });
  } catch (e) {
    out.textContent = "브리핑을 불러오지 못했습니다.";
  }
}

function appendChat(role, text) {
  const el = document.createElement("div");
  el.className = "msg " + role;
  el.textContent = text;
  $("chatLog").appendChild(el);
  scrollChat();
  return el;
}
function scrollChat() { const l = $("chatLog"); l.scrollTop = l.scrollHeight; }

// ---------- 유틸 ----------
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function fmtWon(n) { return n.toLocaleString("ko-KR"); }

// ---------- 초기화 ----------
function init() {
  load();
  applyTheme();
  initTabs();
  initControls();
  initAI();
  $("themeToggle").addEventListener("click", cycleTheme);
  $("btnPresence").addEventListener("click", onPresenceToggle);
  $("btnReset").addEventListener("click", resetSim);
  $("btnBlade").addEventListener("click", () => {
    // 블레이드 교체: 사이클 카운터를 현재 주기 시작점으로 리셋
    state.cycleCount = Math.ceil(state.cycleCount / MAINT.bladeLifeCycles) * MAINT.bladeLifeCycles;
    setStatus("와이퍼 블레이드 교체 완료.");
    refreshMetrics(); save();
  });
  $("btnRefill").addEventListener("click", () => {
    state.detergentUsedMl = 0;
    setStatus("세정액 탱크 보충 완료.");
    refreshMetrics(); save();
  });
  refreshMetrics();
  loadSpecs();
  initDigest();
}
init();
