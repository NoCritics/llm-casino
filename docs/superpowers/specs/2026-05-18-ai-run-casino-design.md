# AI-Run Casino — Design Spec

**Date:** 2026-05-18
**Status:** Draft (brainstormed, awaiting review)
**Codename (working):** *casino*

---

## 1. Vision

A live, observable experiment in which a C-suite of Claude agents builds and operates a real casino platform end-to-end — code, math, marketing, treasury, support — within a thinly simulated business world. **Games are real and playable; the surrounding world (VCs, marketing channels, NPC players, regulators, news) is simulated.** The human supervisor watches via a dashboard and can pause / intervene at any layer.

The casino vertical is well-chosen for AI-agent experimentation:

- Rich strategic surface: game design, RTP tuning, promos, retention, fraud, KYC theater, affiliate marketing, treasury management.
- The real industry runs largely on crypto rails — so there is a plausible "make it real" path later (virtual currency → on-chain currency is a config change, not a rewrite).
- Morally legible: casinos optimize against their own customers, so the operator agents' behavior is inherently revealing.

The experiment is **observable, replayable (git-backed), pausable, and (eventually) streamable.**

---

## 2. Scope & boundary

### Real

- The casino platform — games, accounts, balances, bets, payouts — in **virtual currency only**.
- Agent code shipping. The CTO actually commits, Vercel auto-deploys.
- Game math. Real RTPs, real bet outcomes, real treasury accounting.

### Simulated

- NPC players (mass: statistical sampling; "interesting" subset: LLM-driven personas).
- Marketing channels (CMO "buys ads"; the world reacts with NPC traffic).
- VCs / investors, regulators, news cycle, competitor casinos (NPC counterparties).
- Sim clock at **1:1 with wall clock** for V1 (hybrid time model — real-time for players, cadenced for agents).

### Out of scope (V1)

- Real money / real crypto rails.
- Real ad placements.
- Real KYC / compliance machinery.
- Public sign-ups (closed test until proven).
- Multi-region scale, accelerated time, synchronous agent meetings.

**The architecture preserves the option to "go real" later** (virtual currency → on-chain, NPC traffic → real traffic, sim marketing → real ad APIs) **without rewriting the core.**

---

## 3. Experiment shape

Three loci:

1. **The Operator org** — a C-suite of specialized Claude agents (§5).
2. **The World** — simulated player population, marketing channels, external events (§9).
3. **The Observer** — you + a dashboard. Watches, pauses, files memos, puppets players, fires world events (§11).

---

## 4. Time model — hybrid

- **Player-facing time = wall-clock.** Real players (you, mates if invited) and NPCs can play any time.
- **Agent cadence = cron + event.** Daily standup, weekly strategy, monthly board review, plus event triggers for crises.
- **Sim clock = wall clock 1:1** in V1. (Future toggle for 4× / 24× "binge mode" possible, deferred.)

This is the only time model where the experiment is steadily watchable AND real humans can drop in to play without breaking the sim.

---

## 5. The agent org

| Agent | Cron wake | Event triggers | Per-wake budget |
|---|---|---|---|
| **CEO** | Daily 9am standup, weekly Mon board review | Crises, CFO red alerts | Tight (decisions only) |
| **CTO** | 2× daily (plan AM, ship PM) | Prod incidents, CEO directives | Generous (spawns subagents) |
| **Head of Math** | Weekly + on-demand | CTO math request, RTP variance | Generous (long-think OK) |
| **CMO** | Daily | Campaign anomaly | Medium |
| **CFO / Treasury** | Hourly silent check, daily report | Variance / threshold breach | Mostly read-only |
| **Risk / Support** | Daily summary | Fraud signals, complaints (primary) | Bursty |

Each role has:

- A persistent **system prompt** at `/agents/{role}/system.md`
- A **tool manifest** at `/agents/{role}/tools.json` (server-side enforced)
- A **private notebook** at `/org/notebooks/{role}/` (markdown, committed)
- A **wake protocol** (§7)

**CEO is strategic only** — cannot ship code, move money, or change RTPs. Writes OKRs, makes decisions, sends directives via inbox, and may `pause_role()` a direct report (a deliberately interesting power dynamic).

---

## 6. State storage

Two backends, deliberately split.

### 6a. Postgres (Neon via Vercel Marketplace) — product state + high-frequency org state

Core tables:

```sql
players(id, persona_kind, balance, created_at, frozen, flags jsonb, ...)
bets(id, player_id, game_id, stake, outcome, rng_seed, settled_at, ...)
games(id, kind, version, math_config jsonb, deployed_at, ...)
treasury_wallets(name, balance, kind)             -- operating | payout_reserve | marketing_pool | runway
treasury_moves(from_wallet, to_wallet, amount, reason, by_role, at)
campaigns(id, channel, audience jsonb, budget, copy, status, by_role, ...)
support_tickets(id, player_id, body, status, replied_by_role, ...)

messages(id, from_role, to_role, subject, body_md,
         refs_md_paths text[], thread_id, replied_to_id,
         priority, sent_at, read_at, replied_at)

events(id, type, source, payload jsonb, severity,
       created_at, processed_by_role, processed_at)

agent_runs(id, role, reason, wake_packet_summary,
           started_at, ended_at,
           tokens_in, tokens_out, tool_calls jsonb, outcome)

pause_flags(scope, paused, reason, set_by, at)    -- scope ∈ {role_name, "all"}
```

### 6b. Git monorepo — code + deliberative org state

```
/apps/casino/             — the playable Next.js casino (App Router, AI Gateway)
/apps/dashboard/          — Next.js observer dashboard
/apps/traffic-gen/        — NPC traffic generator (Vercel cron + Queues)
/org/
  okrs/                   — CEO writes; everyone reads
  strategy/               — CEO + role-specific memos
  decisions/              — append-only decision log (one md per decision)
  math/                   — game designs, RTP analyses, EV proofs
  marketing/              — campaigns, copy, post-mortems
  finance/                — treasury reports, P&L summaries; /daily/YYYY-MM-DD.md
  risk/                   — fraud reports, support transcripts
  standup/YYYY-MM-DD/     — async standup notes per role per day
  notebooks/{role}/       — private reflection memory per agent
/sim/                     — NPC personas, traffic-model params, world events
/agents/
  {role}/system.md        — system prompt per role
  {role}/tools.json       — tool manifest per role
```

**Every commit is authored by the agent** (`CEO Claude <ceo@casino.sim>`, `CTO Claude <cto@casino.sim>`, etc.) so `git log` and `git blame` remain legible.

**Rationale for the split:** product state needs atomic ops, queryable indexes, sub-second writes; deliberation state benefits from versioning, diffability, `git checkout`-style replay, and human readability. Inbox is in Postgres (atomic ack); deliberation artifacts are in git.

---

## 7. The nervous system

### 7a. Inbox (Postgres)

Async role-to-role comms. `send_message` is a tool. Replies thread. Every wake pulls **unread + last 24 h** into the context pack. `urgent` priority can fire an immediate wake.

### 7b. Events (Postgres)

Programmatic signals. Seed event types:

- `rtp_variance` — observed RTP drifts beyond tolerance on a game
- `daily_ggr_drop` — gross gaming revenue down >X% day-over-day
- `fraud_signal` — heuristic-based suspicious player behavior
- `support_complaint` — new NPC complaint
- `prod_error_spike` — Vercel error rate breach
- `treasury_threshold` — wallet balance below floor
- `npc_traffic_anomaly` — funnel anomaly vs campaign expectation
- `world_event` — human-fired (regulator inquiry, media buzz, competitor launch)

Severity-based routing: routine events log only; medium → role inbox; high → immediate wake. New event types are cheap; agents themselves can file a memo to you proposing one.

### 7c. Wake protocol

**n8n** owns the trigger schedule + simple event routing (visual cron, easy to edit, easy to disable). It is NOT the source of truth — it's a configurable dispatcher.

A **Next.js API route** on the casino app owns the wake protocol itself.

```
n8n cron / event watcher
        │
        ▼
POST /api/wake { role, reason: "cron"|"event"|"directive"|"human-memo", payload? }
        │
        ▼  (handler)
1. Check pause flags → bail if paused
2. Assemble wake packet (deterministic harness; not LLM)
3. Spawn Agent SDK process for the role with the packet
4. Stream the run to dashboard + persist to agent_runs
5. Validate outputs, apply state changes, commit any /org/* writes
```

**Wake packet — always the same shape:**

- role, time, reason, triggering payload (if any)
- inbox slice (unread + last 24 h)
- current OKR + this role's slice of strategy
- recent decisions log relevant to this role
- role-tailored metrics snapshot
- tail of own private notebook (last N entries)

**Standup is async.** Each agent commits `/org/standup/YYYY-MM-DD/{role}.md` before 9am sim-time. CEO's 9am wake reads them all and issues directives back via inbox. No live meeting, no scheduling fragility, everything persists as readable artifacts.

---

## 8. Agent tool belts

Tools delivered three ways: **local Node functions** (DB, messaging), **HTTP endpoints** on the casino app (`/api/tools/...`, role-authenticated), and **MCP servers** (Claude Code, Vercel logs). Role boundaries are enforced **server-side** — a `/api/tools/move_treasury` request from a CTO-authenticated wake returns 403.

### CEO
- Read all of `/org`, read top-line KPIs
- Write `/org/okrs/*`, `/org/strategy/*`, `/org/decisions/*`
- `send_message`, `set_okr`, `record_decision`
- `pause_role(role)` / `unpause_role(role)`
- `escalate_to_human(question)` — surfaces in dashboard
- **NO** product code, treasury moves, RTP changes, marketing copy

### CTO — the only role that ships code, but rarely writes it
- Read `/org/*`, prod logs (Vercel MCP), DB schemas
- Write `/org/decisions/`, `/org/strategy/tech/`
- `spawn_dev_task(spec_path, branch_name, budget)` — fires an **ephemeral Claude Code subagent** with a bounded budget to do the coding work and commit. CTO is the architect / PM; coding labor is delegated.
- `rollback(commit_hash)`, `run_tests()`, `query_db_readonly()`
- Vercel auto-deploys on push — no explicit `deploy` lever
- **NO** treasury, RTP authority (proposes; Math owns), marketing copy

### Head of Math — co-owns games with CTO
- Read all
- Write `/org/math/*` **AND** `/apps/casino/games/{id}/math.json` directly (math config is the game; not "code")
- `simulate_game(spec, n_trials)` — Monte Carlo with seeded RNG
- `solve_rtp(spec, target_rtp)` — analytic / numerical RTP solver
- `compute_house_edge(rules)`, `compute_volatility(spec)`
- `analyze_bet_history(game_id, since)` — real player data
- **NO** engine code, marketing, treasury

### CMO — spends sim dollars; conjures sim traffic
- Read all
- Write `/org/marketing/*`
- `create_campaign(channel, audience, budget, copy, duration)` — read by NPC traffic gen, drives the funnel
- `spend_ad_budget(channel, amount)` — debits sim treasury, the world reacts
- `generate_creative(brief)` — calls AI Gateway (image / copy)
- `analyze_campaign(id)`
- **NO** code, RTPs, treasury beyond ad-spend

### CFO / Treasury — the brake pedal
- Read all
- Write `/org/finance/*`
- `move_treasury(from_wallet, to_wallet, amount, reason)` between sim wallets
- `propose_budget(role, period, amount)`, `freeze_spending(role)`
- `daily_close()` — commits `/org/finance/daily/YYYY-MM-DD.md`
- **NO** marketing, code, RTPs

### Risk / Support — adversary-of-the-business
- Read all incl. player behavior
- Write `/org/risk/*`
- `flag_account`, `freeze_account`, `unfreeze_account` (with reason)
- `reply_to_support_ticket(ticket_id, draft)`
- `propose_rule_change(rule, rationale)` — CTO implements
- `escalate_to_ceo(issue)`
- **NO** treasury, code, marketing

---

## 9. The world (non-agent infra)

### NPC traffic generator (`/apps/traffic-gen`)
A Vercel cron + Queues worker. Reads active CMO campaigns. Computes daily funnel per channel:

- Visitors per channel per day = f(ad spend, channel quality, market base rate)
- Signups = visitors × signup_rate(channel)
- First deposits = signups × first_deposit_rate(persona_mix)
- Retention modeled per persona

**Personas:** whales, grinders, casuals, refund-seekers, bonus-abusers, lurkers. Channel-conditional distribution.

- **Mass NPCs** play statistically — bet patterns from distributions, no LLM. Cheap, high volume.
- **"Interesting" NPCs** (~20–50 active) are LLM-driven (Haiku) — file support tickets, write reviews, complain, occasionally go viral. They give the org something to *respond* to.

### Simulated counterparties
- **VCs / investors** — NPC agents. CEO "files a pitch deck" to a virtual mailbox; an NPC responds with term-sheet, ask-for-more-info, or rejection. Heuristic + LLM prose.
- **Regulator** — periodic NPC events (audits, inquiries) routed to Risk.
- **News cycle** — occasional world events you (or a random schedule) inject (PR opportunity, scandal, competitor launch). Read by CEO/CMO.

### You (the observer) — dashboard `/apps/dashboard`
- Live wake timeline (who's running, what they're doing)
- All inboxes, all decisions, all metrics
- `pause_role(role)` / `pause_all()` levers
- File a memo to any agent (intervention)
- Puppet as player(s) — one or many personas simultaneously
- Fire world events into the bus
- Rewind / replay via `git checkout` of `/org`

---

## 10. Code shipping flow

CTO is the architect / PM. Coding labor is delegated to bounded **Claude Code subagents**.

```
CTO wake
  ├─ reads inbox + agenda
  ├─ identifies tasks (e.g. "ship roulette per /org/math/roulette-v1.md")
  └─ for each task:
       spawn_dev_task(spec_path, branch_name, budget)
         ↓
       Claude Code subagent with bounded budget:
         - checkout branch
         - access to repo + DB schemas
         - commits + pushes to branch
         - on green tests: merge into main (fast-forward)
         - report result back to CTO via inbox
  └─ reviews subagent reports, decides what merges / reverts
```

Vercel auto-deploys main. CTO commits authored as `CTO Claude <cto@casino.sim>`. Subagents commit under the same author with a `Co-Authored-By: dev-subagent@casino.sim` trailer for log clarity.

---

## 11. Observability, safety, and human-in-the-loop

### Observability
- All wakes streamed to dashboard live (Postgres LISTEN/NOTIFY → SSE)
- All tool calls logged with args + results + cost in `agent_runs.tool_calls`
- All `/org/*` writes are commits — `git log` is the company's history
- Daily roll-up report committed by you (or a small narrator service) to `/org/observer/daily/YYYY-MM-DD.md`

### Safety levers
- `pause_role(role)` / `pause_all()` checked on every wake — no force-quit needed
- Per-wake budget caps (tokens + tool-calls + wall-time)
- Per-role per-day token budget (cost ceiling)
- Auto-revert: every CTO commit recorded in `agent_runs` with hash; dashboard "revert this commit" button = `git revert` + `pause_role(CTO)`
- Tool calls authenticated by role at the HTTP layer; cross-role calls return 403
- World events you inject are logged — you are auditable too

### Streaming (deferred)
Replay / timeline UI suitable for a public stream — spoiler-safe defaults, pause / redaction tooling. Not built into V1.

---

## 12. Seed plan (day 0 state)

You commit:

- **Two seed games:**
  - **Coin flip** — trivial, pure house-edge proof-of-life
  - **Single-zero roulette** — well-understood math, decent surface area for tuning
- A starting **treasury** (e.g. 1,000,000 virtual chips split: operating / payout reserve / marketing pool / runway)
- An initial **OKR draft** from you (e.g. *"Q1: find product-market fit on virtual play; ship a third game; show D7 retention >15%"*)
- **~100 seed NPC players** (persona mix) so the casino isn't empty on day 1
- **V1 system prompts** for each role (drafts — agents may propose evolutions via decision log entries)

Start the wake schedule. Watch.

---

## 13. Tech stack

- **Hosting:** Vercel (Fluid Compute, Node.js 24 LTS, default 300 s timeouts)
- **App framework:** Next.js (App Router) for both `/apps/casino` and `/apps/dashboard`
- **Project config:** `vercel.ts` (typed) at each app root
- **Database:** Neon Postgres via Vercel Marketplace
- **AI runtime:** Vercel AI Gateway + AI SDK v6
  - `anthropic/claude-opus-4-7` for CEO, CTO, Head of Math (strategic, expensive, rare)
  - `anthropic/claude-sonnet-4-6` for CMO, CFO, Risk/Support (frequent, balanced)
  - `anthropic/claude-haiku-4-5` for NPC personas, ephemeral dev-subagents (cheap, many)
- **Agent runtime:** Claude Agent SDK (TS) per role wake handler. CTO's coding labor delegated to ephemeral Claude Code subagents.
- **Trigger orchestration:** n8n (self-hosted or cloud) for cron schedules + event-routing webhooks
- **Object storage:** Vercel Blob for ad creatives, replay snapshots
- **Live updates:** Postgres LISTEN/NOTIFY → SSE to dashboard
- **Observability:** Vercel logs + `agent_runs` + git log as canonical sources

---

## 14. Non-goals (V1)

- Real-money gambling (deliberately deferred; architecture preserves the option)
- Real ad placements
- Public sign-ups
- Multi-region scale
- Accelerated time
- Synchronous / live agent meetings (everything async via inbox)
- Sophisticated KYC, regulatory, compliance machinery (NPC theater only)

---

## 15. Open questions to revisit during planning

- Exact per-role token budgets and a credible monthly cost ceiling estimate
- Whether the CTO subagent's branch merges to main automatically on green tests, or requires the CTO Claude to explicitly bless each merge in its next wake (V1 default: explicit bless)
- How to handle agent-on-agent disagreements (CEO directive vs CFO freeze). V1 default: CEO override + decision logged + you can revert.
- NPC behavior fidelity vs cost — how many LLM-driven NPCs to keep active simultaneously
- When (if ever) to flip the "make it real" lever — and the gating criteria

---

## Appendix A — Repo layout summary

```
casino/                                           (this repo)
├── apps/
│   ├── casino/                                   Next.js: games, accounts, bets, API
│   ├── dashboard/                                Next.js: observer UI
│   └── traffic-gen/                              Vercel cron worker for NPCs
├── org/                                          deliberative state (markdown, committed)
│   ├── okrs/  strategy/  decisions/
│   ├── math/  marketing/  finance/  risk/
│   ├── standup/YYYY-MM-DD/{role}.md
│   └── notebooks/{role}/
├── sim/                                          NPC personas, world params
├── agents/{role}/{system.md, tools.json}         system prompts + tool manifests
├── docs/superpowers/specs/                       this document and successors
├── vercel.ts                                     typed Vercel config
└── package.json                                  pnpm/turbo workspace
```

## Appendix B — Author identities for commits

| Agent | Git author |
|---|---|
| CEO | `CEO Claude <ceo@casino.sim>` |
| CTO | `CTO Claude <cto@casino.sim>` |
| Head of Math | `Math Claude <math@casino.sim>` |
| CMO | `CMO Claude <cmo@casino.sim>` |
| CFO / Treasury | `CFO Claude <cfo@casino.sim>` |
| Risk / Support | `Risk Claude <risk@casino.sim>` |
| Dev subagent | (same as CTO) + `Co-Authored-By: dev-subagent@casino.sim` |
| Observer (you) | your own git identity |
