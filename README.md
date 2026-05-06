# Colosseum

LLM Agent Arena: an A2A-based multi-agent game platform.

## Status

- Phase 0 skeleton: complete in code, with mocked M1/M2 automated validation
- Phase 1 poker MVP: next
- Phase 2 A2A formalization: planned
- Phase 3 Werewolf: planned
- Phase 4 production deployment: planned

## Tech Stack

- Next.js 15 App Router
- TypeScript strict mode
- Drizzle ORM with SQLite for local development
- Docker Compose for Postgres 16 and Redis 7 development infrastructure
- Vercel AI SDK, `@a2a-js/sdk`, and `ioredis`
- Tailwind CSS 4
- Vitest

## Quick Start

```bash
npm run bootstrap
cp .env.example .env
npm run db:migrate
npm run dev
```

Docker-backed services can be started with:

```bash
npm run infra:up
```

Open `http://localhost:3000`.

## Quality Gates

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

## Phase 0 Milestones

M1, mocked automation:

```bash
npm test tests/api/llm-ping.test.ts
```

M1, manual real LLM:

```bash
curl -N -X POST http://localhost:3000/api/llm/ping \
  -H "content-type: application/json" \
  -d "{\"prompt\":\"用一句话介绍 A2A 协议\"}"
```

M2, mocked end to end:

```bash
npm test tests/api/agent-e2e.test.ts
```

M2, manual toy agent:

```bash
curl http://localhost:3000/api/agents/toy-poker/.well-known/agent-card.json

curl -N -X POST http://localhost:3000/api/agents/toy-poker/message/stream \
  -H "content-type: application/json" \
  -H "X-Match-Token: test" \
  -d "{\"message\":{\"messageId\":\"m1\",\"taskId\":\"t1\",\"role\":\"user\",\"parts\":[{\"kind\":\"data\",\"data\":{}}]}}"
```

## Key Docs

- `AGENTS.md`: stable AI collaboration entry point
- `docs/ai/rules/`: detailed AI rules
- `docs/superpowers/specs/2026-05-06-colosseum-rewrite-brief.md`: brief design
- `docs/superpowers/specs/2026-05-06-colosseum-rewrite-design.md`: full technical design
- `docs/superpowers/plans/`: implementation plans
- `old/`: archived reference project
