<!--
SPDX-License-Identifier: Apache-2.0
Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
-->
# 🚻 Urinal Auto-Hygiene Wiper — Interactive Simulator + Spec

An **interactive mechanism simulator** and **spec / BOM design doc** for a concept device installed beside a men's urinal that, after the user leaves (sensor), automatically **wipes / rinses / dries** splashed urine from the surrounding surface to keep restrooms hygienic.

> **한국어 문서: [README.ko.md](./README.ko.md)**

**🔗 LIVE DEMO:** https://clsoftlab-lang.github.io/urinal-wiper/

> **⚠️ DEMO-MODE + CONCEPT BOUNDARIES**
> **This is a concept simulator and design document — not a real, manufactured, or sold product.** All numbers (hygiene score, water/detergent consumption, cycle time) and BOM prices are **estimates for reference and are NOT verified.** AI features run as a **deterministic mock by default** (no API key involved).

## Features

- **Interactive mechanism simulator** — inline-SVG side view of a urinal + wiper arm. Toggle 사용자 감지 (enter / leave); after the user leaves + delay, the wiper arm sweeps, then a rinse + dry cycle runs.
- **Live estimates** — hygiene score, water & detergent per cycle, active time; a cycle counter and maintenance alerts (blade replacement / detergent refill).
- **Controls** — 감지 지연 · 와이퍼 속도 · 세정액 사용량 sliders.
- **Design / spec page** — sensor, servo/motor, wiper blade, detergent nozzle, drain, hygienic materials; a rough BOM ("reference, not verified").
- **Pure math module** `cycle.js` for all timing / consumption / hygiene math (unit-tested).
- No build. Static site: `index.html` at root, ES-module JS, relative paths, mobile-first, light + dark, Korean UI, inline-SVG art, `localStorage` for settings/counters.

## Run locally

```bash
# from the repo root
python -m http.server 9028
# open http://localhost:9028/
```

Then run the verifier:

```bash
node check.mjs        # JSON parse + unit tests + AI mock + security checks
```

## 🤖 AI 기능 (API 연동)

Three AI features, all working via a **deterministic Korean mock** in the demo:

1. **AI 시설관리 도우미 챗봇** — restroom hygiene / maintenance advice + cleaning-schedule suggestions.
2. **시뮬 결과 설명** — explains the water vs. detergent tradeoff from the current settings.
3. **설치·유지보수 가이드 생성** — generates an install + maintenance guide.

**Enable real Claude** (optional):

1. Deploy `server/` (Node + `@anthropic-ai/sdk`). It exposes `POST /api/ai` and calls
   `client.messages.stream({ model: "claude-opus-5", max_tokens: 2048, thinking: { type: "adaptive" }, ... })`.
2. Set `ANTHROPIC_API_KEY` **on the server only** (env var). See `server/README.md` and `server/.env.example`.
3. Set `AI_ENDPOINT` in `ai/config.js` to the server URL.

> **The API key lives server-side only. Never put a key in the browser or the repo.** `check.mjs` asserts `AI_ENDPOINT` is empty and that no real key format (`sk-ant-…`) is present.

## Repo layout

```
index.html          # UI (simulator / spec / AI / about) + inline SVG
styles.css          # light + dark theming
app.js              # UI wiring (imports cycle.js + ai/ai.js)
cycle.js            # pure timing/consumption/hygiene math (unit-tested)
data/specs.json     # subsystems, phases, hygiene notes, boundaries
data/parts.json     # rough BOM (reference, not verified)
ai/config.js        # export const AI_ENDPOINT = ""
ai/ai.js            # askAI() → mock (default) or backend stream
server/             # optional proxy: index.mjs, package.json, .env.example, README
check.mjs           # static verifier (run in CI)
.github/workflows/ci.yml
```

## 🎓 아이디어 출처 / Idea origin

Inspired by a standout student idea from **Dr. Lee Il-guk's entrepreneurship class at Yongin University (용인대학교)**. Built **clean-room** with gratitude — no copied sentences, no PII, no trademarks.

## Contributors

Dr. Lee Il-guk (이일국) · LWJ · LMJ · Claude

## License

- Code: **Apache-2.0** (see [LICENSE](./LICENSE)).
- Docs & design: **CC BY 4.0**.

**Not an official Anthropic product.**
