<!--
SPDX-License-Identifier: Apache-2.0
Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
-->
# AI Proxy (선택 사항)

이 프록시는 브라우저에 **API 키를 절대 노출하지 않기 위해** 존재합니다.
데모(GitHub Pages)는 이 서버 없이 결정론적 Mock 으로 동작합니다.
실제 Claude 응답을 원할 때만 아래를 실행하세요.

## 실행

```bash
cd server
npm install                 # @anthropic-ai/sdk 설치
cp .env.example .env        # 그리고 .env 에 실제 키 입력
node --env-file=.env index.mjs
# 또는:  ANTHROPIC_API_KEY=sk-ant-... node index.mjs
```

- 서버는 `POST /api/ai` 를 받아 `client.messages.stream(...)` 로 스트리밍합니다.
- 모델: `claude-opus-5`, `max_tokens: 2048`, `thinking: { type: "adaptive" }`.
- 기동 후, 루트의 `ai/config.js` 에 이 서버 URL 을 넣으세요:
  `export const AI_ENDPOINT = "http://localhost:8787/api/ai";`

## 보안

- **키는 서버 환경변수(`ANTHROPIC_API_KEY`)에만 존재합니다.**
- `.env` 는 커밋하지 마세요(`.gitignore` 로 차단됨).
- 브라우저/저장소 어디에도 키를 넣지 마세요.
- CI 는 이 폴더를 설치·실행하지 않고 `node --check` 만 수행합니다.

## 요청 형식

```json
{ "task": "chat" | "explain" | "guide", "payload": { "message": "...", "settings": { } } }
```

응답은 `text/plain` 스트림(누적하면 전체 텍스트).
