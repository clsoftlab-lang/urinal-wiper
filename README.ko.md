<!--
SPDX-License-Identifier: Apache-2.0
Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
-->
# 🚻 소변기 자동 위생 와이퍼 — 인터랙티브 시뮬레이터 + 스펙

남성 소변기 옆에 설치되어, **사용자가 이탈하면(센서 감지)** 주변에 튄 소변을 자동으로 **닦고(와이퍼)·헹구고(세정액)·말리는(송풍)** 개념 장치의 **인터랙티브 메커니즘 시뮬레이터**와 **설계/스펙/BOM 문서**입니다.

> **English: [README.md](./README.md)**

**🔗 라이브 데모:** https://clsoftlab-lang.github.io/urinal-wiper/

> **⚠️ 데모 모드 + 개념 경계**
> **이 저장소는 개념 시뮬레이터 + 설계 문서이며, 실제 제조·판매 제품이 아닙니다.** 모든 수치(위생 점수·물/세정액 소비·시간)와 BOM 가격은 **추정·참고용이며 검증되지 않았습니다.** AI 기능은 **기본적으로 결정론적 Mock(데모)** 으로 동작합니다(API 키 미사용).

## 주요 기능

- **메커니즘 시뮬레이터** — 소변기 + 와이퍼 암의 인라인 SVG 측면도. 사용자 진입/이탈 토글 → 이탈 + 지연 후 와이퍼 스윕 → 세정 → 건조 사이클 실행.
- **실시간 추정** — 위생 점수, 사이클당 물·세정액, 가동 시간, 누적 사이클 카운터, 유지보수 알림(블레이드 교체·세정액 보충).
- **제어 파라미터** — 감지 지연 · 와이퍼 속도 · 세정액 사용량 슬라이더.
- **설계/스펙 페이지** — 센서·서보/모터·와이퍼 블레이드·세정액 노즐·드레인·위생 소재 + 개략 BOM(참고, 비검증).
- 타이밍/소비/위생 계산은 순수 모듈 `cycle.js` 에 분리(단위 테스트 대상).
- 빌드 없음. `index.html` 루트, ES 모듈, 상대 경로, 모바일 우선, 라이트+다크, 한국어 UI, 인라인 SVG, `localStorage`(설정/카운터).

## 로컬 실행

```bash
python -m http.server 9028
# http://localhost:9028/ 접속

node check.mjs   # JSON 파싱 + 단위 테스트 + AI Mock + 보안 검사
```

## 🤖 AI 기능 (API 연동)

데모에서는 세 기능 모두 **결정론적 한국어 Mock** 으로 동작합니다.

1. **AI 시설관리 도우미 챗봇** — 화장실 위생/유지보수 조언 + 청소 스케줄 제안
2. **시뮬 결과 설명** — 현재 설정 기준 물·세정액 트레이드오프 해설
3. **설치·유지보수 가이드 생성**

**실제 Claude 연동(선택):**

1. `server/` 배포 (Node + `@anthropic-ai/sdk`). `POST /api/ai` 에서
   `client.messages.stream({ model: "claude-opus-5", max_tokens: 2048, thinking: { type: "adaptive" }, ... })` 호출.
2. `ANTHROPIC_API_KEY` 를 **서버 환경변수로만** 설정 (`server/README.md`, `server/.env.example` 참고).
3. `ai/config.js` 의 `AI_ENDPOINT` 를 서버 URL 로 설정.

> **API 키는 서버에만 존재합니다. 브라우저/저장소에 절대 넣지 마세요.** `check.mjs` 가 `AI_ENDPOINT` 빈 값과 실제 키 형식(`sk-ant-…`) 미포함을 검증합니다.

## 🎓 아이디어 출처

**이일국 박사의 용인대학교(Yongin University) 창업 수업**에서 나온 한 학생의 돋보이는 아이디어에서 영감을 받았습니다. 감사드리며, 어떤 문장·자료도 복제하지 않은 **클린룸(clean-room)** 방식으로 개념만 독립 재구성했습니다. 개인정보·상표 미포함.

## 기여자

이일국 (Dr. Lee Il-guk) · LWJ · LMJ · Claude

## 라이선스

- 코드: **Apache-2.0** ([LICENSE](./LICENSE))
- 문서/디자인: **CC BY 4.0**

**Not an official Anthropic product.**
