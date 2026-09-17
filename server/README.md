<!--
SPDX-License-Identifier: Apache-2.0
Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
-->
# AI Proxy (선택 사항)

이 프록시는 브라우저에 **API 키를 절대 노출하지 않기 위해** 존재합니다.
데모(GitHub Pages)는 이 서버 없이 결정론적 Mock 으로 동작합니다.
실제 Claude 응답을 원할 때만 아래를 실행하세요.

## 실행 (Node)

```bash
cd server
npm install                 # @anthropic-ai/sdk 설치
cp .env.example .env        # 그리고 .env 에 실제 키 입력
node --env-file=.env index.mjs
# 또는:  ANTHROPIC_API_KEY=sk-ant-... node index.mjs
```

- 서버는 `POST /api/ai` 를 받아 `client.messages.stream(...)` 로 스트리밍합니다.
- 기동 후, 루트의 `ai/config.js` 에 이 서버 URL 을 넣으세요:
  `export const AI_ENDPOINT = "http://localhost:8787/api/ai";`

## 무인·저비용 정책

- **모델(비용 우선)**: 기본 `claude-haiku-4-5`. `AI_MODEL` 로 `claude-sonnet-5` / `claude-opus-5` 상향 가능.
- **프롬프트 캐싱**: 안정적인 태스크 시스템 프롬프트를 `cache_control: { type: "ephemeral" }` 블록으로 전송 → 반복 호출 비용↓.
- **thinking/effort**: `claude-haiku*` 는 미지원이므로 전송하지 않음(400 방지). 그 외 모델은 `thinking:{type:"adaptive"}` + `output_config:{effort: AI_EFFORT|low}`.
- **출력 상한**: 태스크별 소박한 `max_tokens`(기본 ~700).
- **비용 가드레일**: IP당 분당 20회 레이트리밋 + 월간 토큰 예산 `AI_MONTHLY_TOKEN_CAP`(기본 2,000,000). 초과 시 `429 {fallback:true}` → 클라이언트는 Mock 으로 폴백(무인).

### 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `ANTHROPIC_API_KEY` | (필수) | 서버에만 존재. 브라우저/저장소 금지. |
| `AI_MODEL` | `claude-haiku-4-5` | 상향: `claude-sonnet-5` / `claude-opus-5` |
| `AI_EFFORT` | `low` | 비-Haiku 모델의 effort |
| `AI_MONTHLY_TOKEN_CAP` | `2000000` | 월간 토큰 예산 |
| `PORT` | `8787` | (Node 프록시) |

## 무료 배포 (Cloudflare Workers · 무인)

관리할 서버가 없는 무료 티어 변형. `worker.js` + `wrangler.toml` 사용.

```bash
cd server
npx wrangler deploy
npx wrangler secret put ANTHROPIC_API_KEY   # 키는 시크릿에만
# (선택) 모델 상향: wrangler.toml 의 [vars] AI_MODEL = "claude-sonnet-5"
```

- 배포된 라우트(예: `https://urinal-wiper-ai.<계정>.workers.dev/api/ai`)를 `ai/config.js` 의 `AI_ENDPOINT` 에 설정.
- Worker 도 Node 프록시와 동일한 태스크 라우팅·모델·캐싱 규칙을 따릅니다.

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
