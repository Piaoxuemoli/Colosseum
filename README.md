# Colosseum

LLM Agent Arena: an A2A-based multi-agent game platform.

## Status

R0 rebuild era: the requirements system has been rebuilt in `docs/prd/`; the implementation layer will be reworked task by task against the PRD. See `AGENTS.md` and `docs/INDEX.md` for the full map.

## Tech Stack

- Next.js 15 App Router
- TypeScript strict mode
- Drizzle ORM with SQLite for local development
- Docker Compose for Postgres 16 and Redis 7 development infrastructure
- Vercel AI SDK, `@a2a-js/sdk`, and `ioredis`
- Tailwind CSS 4

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

## Quality Gate

```bash
npm run check
```

(`check:surfaces && lint && typecheck && build` — the single release gate while the new test/CI system is being rebuilt, see `docs/rules/linting-and-quality.md`.)

## Project Layout

```
.
├── src/
│   ├── app/              # Next.js App Router (pages + API routes)
│   ├── frontend/         # Components, stores, client utilities
│   ├── backend/          # Orchestrator, agent runtime, A2A core, auth, match logic
│   ├── platform/         # DB, Redis, LLM gateway, telemetry, core registry, engine contracts
│   └── games/            # Self-contained poker and werewolf packages
├── docs/                 # Single authoritative docs tree (start at docs/INDEX.md)
├── ops/                  # Docker Compose, deployment pipeline, dev environment
└── scripts/              # bootstrap / sync / doctor / a2ui surface validation
```

## Key Docs

- `AGENTS.md`: AI collaboration entry point
- `docs/INDEX.md`: universal documentation index (read this first)
- `docs/prd/`: product truth — PRD, roadmap, design system
- `docs/rules/`: collaboration rules for AI agents
- `docs/specs/`: active subsystem specs
- `docs/legacy/`: archived 2026-05~06 rewrite-era specs and plans (read-only)
- `docs/deploy/vercel.md` + `ops/deploy/README.md`: deployment guides
