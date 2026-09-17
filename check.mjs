// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// check.mjs — 빌드 없는 정적 사이트 검증기.
//  1) data/*.json JSON 파싱
//  2) 모든 JS(ai/, server/ 포함) node --check 문법 검사
//  3) index.html 필수 컨테이너 확인
//  4) cycle.js 단위 테스트
//  5) AI Mock 결정론 검증
//  6) AI_ENDPOINT 빈 값 + 저장소에 실제 키 형식(sk-ant- 접두 + 20자 이상) 없음
//
// 실행:  node check.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const fails = [];

function ok(name) { pass++; console.log("  ✓ " + name); }
function bad(name, detail) { fail++; fails.push(name); console.log("  ✗ " + name + (detail ? " — " + detail : "")); }
function assert(cond, name, detail) { cond ? ok(name) : bad(name, detail); }
function almost(a, b, name, eps = 0.05) { assert(Math.abs(a - b) <= eps, name, `기대 ${b}, 실제 ${a}`); }

// ---------- 1) JSON ----------
console.log("\n[1] data/*.json 파싱");
const dataDir = join(ROOT, "data");
for (const f of readdirSync(dataDir).filter((x) => x.endsWith(".json"))) {
  try { JSON.parse(readFileSync(join(dataDir, f), "utf8")); ok("data/" + f); }
  catch (e) { bad("data/" + f, e.message); }
}

// ---------- 2) node --check 모든 JS ----------
console.log("\n[2] node --check (ai/, server/ 포함)");
function collectJs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === ".github") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...collectJs(p));
    else if (/\.(mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}
const jsFiles = collectJs(ROOT);
let sawAi = false, sawServer = false;
for (const f of jsFiles) {
  const rel = relative(ROOT, f).replace(/\\/g, "/");
  if (rel.startsWith("ai/")) sawAi = true;
  if (rel.startsWith("server/")) sawServer = true;
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); ok(rel); }
  catch (e) { bad(rel, String(e.stderr || e.message).split("\n")[0]); }
}
assert(sawAi, "ai/ JS 존재 및 검사됨");
assert(sawServer, "server/ JS 존재 및 검사됨");

// ---------- 3) index.html 컨테이너 ----------
console.log("\n[3] index.html 필수 컨테이너");
const html = readFileSync(join(ROOT, "index.html"), "utf8");
for (const id of ["scene", "arm", "btnPresence", "delay", "speed", "detergent",
  "mHygiene", "mWater", "mDet", "mTime", "mCycles", "hygieneBar", "alerts",
  "bomTable", "subsysGrid", "phaseList", "chatForm", "explainOut", "guideOut",
  "digestOut"]) {
  assert(html.includes(`id="${id}"`), `#${id} 존재`);
}
assert(/type="module"\s+src="app\.js"/.test(html), "app.js 모듈 로드");

// ---------- 4) cycle.js 단위 테스트 ----------
console.log("\n[4] cycle.js 단위 테스트");
const cyc = await import("./cycle.js");
{
  const def = cyc.normalizeSettings({});
  assert(def.detectDelaySec === 4 && def.wiperSpeed === 1.0 && def.detergentMl === 15, "기본값 정규화");
  const cl = cyc.normalizeSettings({ detectDelaySec: 999, wiperSpeed: -5, detergentMl: 9999 });
  assert(cl.detectDelaySec === 15 && cl.wiperSpeed === 0.5 && cl.detergentMl === 50, "범위 clamp");
  assert(cyc.clamp(NaN, 2, 8) === 2, "NaN clamp → min");

  const c0 = cyc.consumption({ detergentMl: 0 });
  assert(c0.waterMl === 60 && c0.detergentMl === 0, "세정액 0 소비");
  const c15 = cyc.consumption({ detergentMl: 15 });
  almost(c15.waterMl, 120, "세정액 15 → 물 120mL");

  const h0 = cyc.hygieneScore({ detergentMl: 0, wiperSpeed: 1, detectDelaySec: 4 });
  const h30 = cyc.hygieneScore({ detergentMl: 30, wiperSpeed: 1, detectDelaySec: 4 });
  assert(h30 > h0, "세정액↑ → 위생 점수↑");
  assert(h0 >= 0 && h30 <= 100, "위생 점수 0~100 범위");
  const hFast = cyc.hygieneScore({ detergentMl: 30, wiperSpeed: 2.0, detectDelaySec: 4 });
  assert(hFast < h30, "속도 과속 → 위생 점수 감점");

  const p = cyc.phaseDurations({ wiperSpeed: 1, detergentMl: 15, detectDelaySec: 4 });
  assert(p.totalSec > p.activeSec, "총 시간 > 가동 시간(지연 포함)");
  const pFast = cyc.phaseDurations({ wiperSpeed: 2, detergentMl: 15, detectDelaySec: 4 });
  assert(pFast.sweepSec < p.sweepSec, "속도↑ → 스윕 시간↓");

  const mFresh = cyc.maintenanceStatus(0, 0);
  assert(mFresh.bladePct === 100 && mFresh.tankPct === 100, "초기 유지보수 100%");
  const mLow = cyc.maintenanceStatus(2900, 1900);
  assert(mLow.alerts.length >= 2, "소모품 임박 알림 발생");
  const mDry = cyc.maintenanceStatus(10, 2000);
  assert(mDry.alerts.some((a) => a.level === "crit"), "세정액 소진 crit 알림");

  const u = cyc.projectUsage({ detergentMl: 15 }, 100);
  assert(u.daily.cycles === 100 && u.monthly.cycles === 3000, "일/월 사이클 추정");
}

// ---------- 5) AI Mock 결정론 ----------
console.log("\n[5] AI Mock 결정론");
const ai = await import("./ai/ai.js");
{
  const payload = { settings: { detergentMl: 15, wiperSpeed: 1, detectDelaySec: 4 }, message: "청소 스케줄 추천" };
  const a1 = ai.buildMock("chat", payload);
  const a2 = ai.buildMock("chat", payload);
  assert(a1 === a2 && a1.length > 0, "chat Mock 결정론");
  assert(/스케줄/.test(a1), "chat 스케줄 키워드 반영");
  const e1 = ai.buildMock("explain", payload);
  const e2 = ai.buildMock("explain", payload);
  assert(e1 === e2 && /위생 점수/.test(e1), "explain Mock 결정론");
  const g1 = ai.buildMock("guide", { ...payload, place: "카페" });
  const g2 = ai.buildMock("guide", { ...payload, place: "카페" });
  assert(g1 === g2 && /설치/.test(g1), "guide Mock 결정론");
  const d1 = ai.buildMock("digest", payload);
  const d2 = ai.buildMock("digest", payload);
  assert(d1 === d2 && /권장 세정 주기/.test(d1), "digest Mock 결정론(무인 브리핑)");
  const r = await ai.mockRespond("chat", payload);
  assert(r === a1, "mockRespond === buildMock");
}

// ---------- 6) 보안: AI_ENDPOINT 빈 값 + 키 미포함 ----------
console.log("\n[6] 보안 검사");
const cfg = await import("./ai/config.js");
assert(cfg.AI_ENDPOINT === "", "AI_ENDPOINT 빈 값(데모 기본)");
{
  // 저장소 전체에서 실제 키 형식만 탐지 (sk-ant- + 20자 이상). .env.example 은 placeholder.
  // 정규식을 문자열 연결로 구성하여 이 파일/README 의 'sk-ant…' 언급이 자기 자신을 오탐하지 않게 한다.
  const KEY_RE = new RegExp('sk-' + 'ant-[A-Za-z0-9_-]{20,}');
  const skip = new Set(["node_modules", ".git", ".github"]);
  let found = null;
  (function scan(dir) {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) { scan(p); continue; }
      if (name === ".env") { found = p; return; }
      if (!/\.(js|mjs|json|html|css|md|txt|example)$/.test(name)) continue;
      const txt = readFileSync(p, "utf8");
      if (KEY_RE.test(txt) && !/your-real-key|sk-ant-your/.test(txt.match(KEY_RE)[0])) {
        found = relative(ROOT, p) + " :: " + txt.match(KEY_RE)[0].slice(0, 12) + "…";
      }
    }
  })(ROOT);
  assert(!found, "실제 API 키 형식 미포함", found || "");
}

// ---------- 결과 ----------
console.log(`\n결과: ${pass} passed, ${fail} failed`);
if (fail) { console.error("실패 항목: " + fails.join(", ")); process.exit(1); }
console.log("모든 검사 통과 ✓");
