# Repo orientation — casino

This repo runs an experiment: a C-suite of Claude agents builds and operates a real (virtual-currency) casino platform. Human supervisor watches via a dashboard and can pause/intervene at any layer.

## Substrate
- pnpm + Turborepo workspace.
- `apps/casino` — playable casino (Next.js 16, App Router, Vercel).
- `apps/dashboard` — observer dashboard (Next.js 16).
- `apps/traffic-gen` — NPC traffic generator (added in Plan 7).
- `packages/db` — Prisma schema + client (shared).

## State storage (spec §6)
- **Postgres (Neon via Vercel Marketplace)** — product state + nervous system (messages, events, agent_runs, pause_flags).
- **Git** — code + deliberative state under `/org`. Every agent action that produces a document is a commit.

## Where to start reading
1. Design spec: `docs/superpowers/specs/2026-05-18-ai-run-casino-design.md`
2. Plan roadmap and current plan: `docs/superpowers/plans/2026-05-18-foundation.md`

## Commands
- `pnpm dev` — turbo run dev across all apps
- `pnpm build` — turbo run build
- `pnpm test` — turbo run test
- `pnpm typecheck` — turbo run typecheck
- `pnpm db:migrate` — Prisma migrate
- `pnpm db:studio` — open Prisma Studio
