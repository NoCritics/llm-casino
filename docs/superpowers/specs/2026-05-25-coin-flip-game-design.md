# Plan 2 — Coin Flip Game — Design Spec

**Date:** 2026-05-25
**Status:** Draft (brainstormed, awaiting review)
**Project:** AI-Run Casino — Plan 2 of 8
**Parent spec:** `docs/superpowers/specs/2026-05-18-ai-run-casino-design.md`
**Prior plan (foundation):** `docs/superpowers/plans/2026-05-18-foundation.md`

---

## 1. Vision

The first real game on top of the Plan 1 substrate. A 50/50 coin flip with provably-fair commit-reveal mechanics, real treasury accounting (1% house edge / 99% RTP), and a playable UI you can hit yourself.

This plan establishes the **game engine pattern** that Plan 3 (roulette) and beyond will plug into, the **bet/treasury lifecycle** that all future games will reuse, and the **commit-reveal primitive** that anchors the experiment's "honest casino" framing. It also bundles five small carry-over fixes flagged by Plan 1's final review.

Coin flip was chosen as the seed game (per parent spec §12) because its math is trivial — meaning the spec can focus on *patterns* (engine abstraction, commit-reveal, treasury ledger) without the math itself becoming the design challenge. Plan 3 will exercise the same patterns on a richer game.

---

## 2. Scope

### In scope (Plan 2)

- Game engine convention under `apps/casino/games/coin-flip/` with a `GameHandler` contract.
- Per-bet commit-reveal RNG via a new `Commitment` table.
- Treasury accounting through a new `player_pool` `WalletKind` + atomic Prisma transactions per bet.
- Playable UI at `/play/coin-flip` (anonymous-session + debug persona picker).
- Public verification page at `/play/coin-flip/verify`.
- Plan 1 housekeeping carry-over (§8).

### Out of scope (deferred)

- Multiple games (Plan 3 = roulette; later plans = more).
- Generic dispatcher route `/api/games/[gameId]/bet` (Plan 3 may introduce when justified).
- Hash-chain commit-reveal (Stake-style). Per-bet rolling commitment is the V1 model.
- VRF / on-chain randomness (the spec preserves the upgrade path; not built here).
- Real auth. Anonymous browser sessions + debug persona picker only.
- Coin-flip animation, sounds, particle effects (deferred polish).
- Playwright / E2E browser tests.
- Per-bet statistical RTP / property tests (Plan 6 / Math-agent territory).
- Per-PR ephemeral test database in CI (Plan 4 will revisit).

---

## 3. Architecture

### 3.1 File layout

```
apps/casino/
├── games/
│   └── coin-flip/
│       ├── handler.ts        — exports settleBet(input, player, commitment) → BetResult
│       ├── math.json         — { payoutMultiplier, minStake, maxStake, sides, rngBytes }
│       └── README.md         — what the game is, how to verify a flip
├── app/
│   ├── play/coin-flip/
│   │   ├── page.tsx                  — playable UI (server component shell + client form)
│   │   └── verify/page.tsx           — public verification page
│   └── api/coin-flip/
│       ├── commitment/route.ts       — GET → { commitmentId, commitmentHash }
│       └── bet/route.ts              — POST → BetResult + nextCommitment
└── lib/
    └── games/
        ├── types.ts          — GameHandler<Input,Result>, BetResult shared types
        ├── rng.ts            — crypto.randomBytes wrapper, sha256, outcome derivation
        └── session.ts        — anonymous-session player lookup/create + persona override
```

### 3.2 GameHandler interface (committed in `lib/games/types.ts`)

```ts
export interface GameConfig {
  kind: string;                          // "coin_flip" | "roulette" | ...
  version: number;
  rngBytes: number;
  [key: string]: unknown;                // game-specific extensions
}

export interface BetInput {
  stake: bigint;
  commitmentId: string;
  // game-specific extensions e.g. { side: "heads" | "tails" }
}

export interface BetResult {
  betId: string;
  outcome: unknown;                      // game-specific (e.g. "heads")
  payout: bigint;                        // 0 on loss
  balance: bigint;                       // player's new balance
  revealedSeed: string;                  // hex
  commitmentHash: string;                // the hash the player saw pre-bet
  nextCommitment: { id: string; hash: string };
}

export interface GameHandler<I extends BetInput = BetInput, R extends BetResult = BetResult> {
  id: string;                                                          // "coin-flip"
  loadConfig(): GameConfig;                                            // reads math.json
  settleBet(input: I, playerId: string): Promise<R>;                   // one Prisma txn
}
```

Coin flip's handler implements this with `I = BetInput & { side: "heads" | "tails" }` and `R = BetResult & { outcome: "heads" | "tails" }`. Plan 3's roulette handler will subclass the same shape with different input/outcome types.

### 3.3 Data flow (one bet)

```
Browser                                    Server                        DB
   │                                          │                            │
   │── GET /api/coin-flip/commitment ────────▶│                            │
   │                                          │── find pending OR create ─▶│
   │                                          │◀── Commitment row ─────────│
   │◀──── { commitmentId, commitmentHash } ──│                            │
   │                                          │                            │
   │  [user picks stake + side, clicks FLIP]  │                            │
   │                                          │                            │
   │── POST /api/coin-flip/bet ──────────────▶│                            │
   │   { commitmentId, stake, side }          │                            │
   │                                          │── BEGIN TRANSACTION ──────▶│
   │                                          │     lock pending commitment│
   │                                          │     validate stake/balance │
   │                                          │     compute outcome         │
   │                                          │     create Bet              │
   │                                          │     mark Commitment used    │
   │                                          │     create next Commitment  │
   │                                          │     TreasuryMove × 1 or 2   │
   │                                          │     update Player.balance   │
   │                                          │── COMMIT ─────────────────▶│
   │◀── BetResult + nextCommitment ──────────│                            │
   │                                          │                            │
   │  [UI shows reveal, verifies hash live]   │                            │
```

---

## 4. Math config

`apps/casino/games/coin-flip/math.json` — committed by us in Plan 2; later owned by the Math agent (Plan 6) which may bump the version and tune values:

```json
{
  "kind": "coin_flip",
  "version": 1,
  "payoutMultiplier": 1.98,
  "minStake": 10,
  "maxStake": 10000,
  "rngBytes": 32,
  "sides": ["heads", "tails"]
}
```

- 50/50 fair coin — bias lives in the 1.98x payout: EV per bet = `0.5 × 1.98 - 0.5 × 1 = 0.99`, i.e. **1% house edge / 99% RTP**. Stake-class.
- Outcome derivation: `seed[0] & 1 === 1 ? "heads" : "tails"` (odd first byte → heads, even → tails).
- Payout (on win): `Math.floor(Number(stake) * payoutMultiplier)` computed in float, then `BigInt` for storage. Loss: payout = 0n.
- Stake bounded so tests stay well-behaved and small-balance NPCs don't all-in.

When the `mathConfig` JSON column on the `Game` row diverges from this file, the handler reads from the `Game.mathConfig` (DB-side) — the file is the source of truth for code review and the seed for the DB row.

---

## 5. Treasury accounting

### 5.1 Schema changes

Two changes to the Plan 1 schema (one Prisma migration in Plan 2):

**1. Add `player_pool` to `WalletKind` enum**

```prisma
enum WalletKind {
  operating
  payout_reserve
  marketing_pool
  runway
  player_pool                              // NEW — virtual wallet for total player chips
}
```

**2. Add `Commitment` table** (see §6 for usage)

```prisma
model Commitment {
  id               String    @id @default(cuid())
  playerId         String
  gameId           String
  serverSeed       String                              // hex; NEVER exposed until consumed
  serverSeedHashed String                              // hex sha256(serverSeed); public
  createdAt        DateTime  @default(now())
  consumedAt       DateTime?
  betId            String?   @unique

  player           Player    @relation(fields: [playerId], references: [id])
  game             Game      @relation(fields: [gameId], references: [id])
  bet              Bet?      @relation("BetCommitment")

  @@index([playerId, consumedAt])
}

model Bet {
  // ...existing fields...
  commitmentId  String?     @unique
  commitment    Commitment? @relation("BetCommitment", fields: [commitmentId], references: [id])
}
```

### 5.2 Seed wallets (one-time Prisma seed script in Plan 2)

| Wallet name | Kind | Seed balance | Purpose |
|---|---|---:|---|
| `operating` | operating | 100,000 | day-to-day expenses |
| `payout_reserve` | payout_reserve | 800,000 | pool bets pay out of |
| `marketing_pool` | marketing_pool | 50,000 | reserved for CMO ad spend (Plan 7) |
| `runway` | runway | 50,000 | buffer / months-of-runway |
| `player_pool` | player_pool | 0 | total chips outstanding to all players |

Total seed: 1,000,000 virtual chips, matching parent spec §12.

### 5.3 Bet accounting (per Prisma transaction)

**On bet placed (always):**
- `TreasuryMove(player_pool → payout_reserve, amount=stake, by="system")`
- `Player.balance -= stake`

**On bet won:**
- `TreasuryMove(payout_reserve → player_pool, amount=payout, by="system")`
- `Player.balance += payout`

**On bet lost:** nothing further; stake stays in `payout_reserve` (this is the house's realized margin per-bet).

### 5.4 New anonymous-player chip grant

When `lib/games/session.ts` creates an anonymous Player on first visit:
- `TreasuryMove(operating → player_pool, amount=1000, by="system", reason="anonymous-player-grant")`
- `Player.balance = 1000`
- `Player.personaKind = lurker` (default for anonymous)

The grant is debited from `operating` (not `payout_reserve`) — semantically it's marketing / new-user incentive, not a payout obligation.

### 5.5 Balance invariant

Sum across all wallets must equal initial seed (1,000,000) for as long as no chips enter/leave the system from outside. Anonymous player grants from `operating` are an internal redistribution. The invariant is verified by a small `lib/games/audit.ts` helper used in tests and as a future Math-agent diagnostic.

---

## 6. Bet flow + commit-reveal

### 6.1 Rolling commitment model

A player has *at most one* pending `Commitment` at any time. Each bet consumes it and atomically creates the next one in the same response. The UI always shows exactly one prominent commitment hash. Simpler than Stake's hash-chain pattern; equally honest at our flip frequency.

### 6.2 API contract

#### `GET /api/coin-flip/commitment`

Authenticated by anonymous-session cookie + optional persona override.

- If player has an unconsumed `Commitment` → return it.
- Else create a new `Commitment` row: `serverSeed = crypto.randomBytes(32).toString('hex')`, `serverSeedHashed = sha256(serverSeed)`. Return its public fields.

Response (200): `{ commitmentId: string, commitmentHash: string }`
Response (4xx): standard error JSON `{ ok: false, error: string }`

#### `POST /api/coin-flip/bet`

Body: `{ commitmentId: string, stake: number, side: "heads" | "tails" }`

Wrapped in one `prisma.$transaction([...])` with `SELECT ... FOR UPDATE` semantics on the Commitment row (Prisma `findUnique` inside the transaction is sufficient for Postgres serializable isolation when paired with the unique constraint on `consumedAt`).

Steps:
1. Look up `Commitment` by id. Must belong to authenticated player, must be unconsumed. → 409 if missing/consumed.
2. Validate `stake` is integer in `[minStake, maxStake]`. → 400 if not.
3. Load `Player`. Must have `balance >= stake`. → 400 if not.
4. Outcome: `seed[0] & 1 === 1 ? "heads" : "tails"` where `seed = Buffer.from(commitment.serverSeed, 'hex')`.
5. Win iff `outcome === side`. Payout = `BigInt(Math.floor(Number(stake) * payoutMultiplier))` on win, `0n` on loss.
6. Create `Bet` row with `commitmentId`, `rngSeed = serverSeed`, `outcome` (game-specific JSON), `payout`, `stake`.
7. Mark `Commitment` consumed: `consumedAt = now()`, `betId = bet.id`.
8. Treasury moves + Player.balance per §5.3.
9. Create the next `Commitment` for this player.

Response (200):
```json
{
  "betId": "ckxyz...",
  "outcome": "heads",
  "payout": "198",            // stringified bigint
  "balance": "1098",          // stringified bigint
  "revealedSeed": "4f8a2b...",
  "commitmentHash": "a3f5b9...",
  "nextCommitment": { "id": "ckxyz2...", "hash": "b7c8d9..." }
}
```

### 6.3 Verification

Two layers:

**In-line in the bet result panel:**
- Show `revealedSeed`
- Compute `sha256(revealedSeed)` client-side and display it
- Visually confirm it equals the `commitmentHash` that was shown *before* the bet
- Show the outcome derivation (the byte, the `& 1`, the resulting side)

**Public page** at `/play/coin-flip/verify`:
- Stateless form: paste `seed`, `commitmentHash`, `side`, `outcome`
- Client-side compute; show ✓/✗ for `sha256(seed) === commitmentHash` and for outcome derivation
- Suitable for someone who didn't play but wants to audit a published bet

The hash function lives in `apps/casino/lib/games/rng.ts` and is imported by both server (for commit) and client (for verify). Single source of truth.

---

## 7. UI / visual scope

### 7.1 Style direction

- Dark theme: Tailwind `bg-slate-900` / `text-slate-100`
- Accent colors: `emerald-500` for win / verified, `red-500` for loss / error
- Monospace (`font-mono`) for hashes, seeds, chip amounts
- Tailwind v4 only (already in Plan 1 apps)
- **No images, no SVG illustrations, no animation in V1.** Plain text + utility classes. Animation, coin imagery, sounds are deferred polish.

### 7.2 Page layout (`/play/coin-flip`)

```
┌──────────────────────────────────────────────────┐
│ casino          [debug? persona ▼]   🪙 1,000     │
├──────────────────────────────────────────────────┤
│                                                   │
│              Server commitment                    │
│  ────────────────────────────────                 │
│  a3f5b9c1d2e8...  [copy]                          │
│                                                   │
│   ┌─────────────────────────────────┐             │
│   │  Stake:   [   100   ] chips     │             │
│   │  Side:    ◉ Heads   ○ Tails     │             │
│   │           [     FLIP     ]      │             │
│   └─────────────────────────────────┘             │
│                                                   │
│  Recent bets: HEADS +98 · TAILS −50 · HEADS +98   │
└──────────────────────────────────────────────────┘
```

### 7.3 Bet result panel (replaces form for ~3s, then auto-resets)

```
🪙 HEADS — you won 198 chips

  Revealed seed:        4f8a2bc1...92e
  sha256(seed):         a3f5b9c1...    ✓ matches commitment
  Derivation:           seed[0]=0x4f, &1=1 → heads

  Next commitment:      b7c8d9e0...

  [  Play again  ]   [ Verify externally → ]
```

### 7.4 Persona picker (debug-only)

- Hidden by default. Appears when URL has `?debug=1` OR `localStorage.casino_debug === '1'`.
- Dropdown of `Player` rows fetched from a new `GET /api/dev/players` endpoint (gated to debug mode server-side too).
- Picking sets `localStorage.casino_player_id`; subsequent API requests carry it via header `X-Casino-Player-Id`.
- "← Back to anonymous" clears the override; reverts to session-cookie-based player lookup.

### 7.5 Verification page (`/play/coin-flip/verify`)

- Public, stateless, no auth.
- Inputs: `seed` (hex), `commitment hash` (hex), `side` (heads/tails), `expected outcome` (heads/tails).
- Live client-side compute. Shows ✓/✗ for hash match and outcome match.
- Brief copy explaining what the math means.

---

## 8. Plan 1 carry-over (housekeeping bundled in Plan 2)

Five items flagged by Plan 1's final review. Done as the opening task block of Plan 2, before any game code:

1. **Split `packages/db/src/client.ts`** out of `index.ts` to break the circular import between `index.ts` and `selftest.ts`. New shape: `client.ts` owns the singleton; both `index.ts` and `selftest.ts` import `prisma` from `./client`. `index.ts` re-exports the public surface.
2. **Add `afterAll(() => prisma.$disconnect())`** to `apps/casino/tests/health.test.ts` and `apps/dashboard/tests/health.test.ts` (matching `packages/db/tests/selftest.test.ts`).
3. **Add `@casino/db` to `onlyBuiltDependencies`** in `pnpm-workspace.yaml` — defensive against future pnpm 10 silently skipping the prisma generate postinstall.
4. **Replace `"Create Next App"` boilerplate** in `apps/casino/app/layout.tsx` + `apps/dashboard/app/layout.tsx` metadata: title `casino` / `casino — observer dashboard`, description matching.
5. **Move `selftest` to `@casino/db/diagnostics`** export path (new `packages/db/src/diagnostics.ts` re-export). Update the two `/api/health/route.ts` imports. Removes infra from the package's business-facing public surface.

---

## 9. Test strategy

### 9.1 Unit tests (no DB)

- `apps/casino/lib/games/rng.test.ts` — hash helpers + outcome derivation. Fixtures: `seed[0]=0x04 → tails`, `seed[0]=0x05 → heads`, etc.
- `apps/casino/games/coin-flip/handler.test.ts` — `settleBet` as a pure function with the Prisma client mocked (`vi.mock`). Cases:
  - Win on correct prediction (fixed seed → known outcome)
  - Loss on wrong prediction
  - Payout = `floor(stake × multiplier)` on win, `0n` on loss
  - Throws on stake out of `[minStake, maxStake]`
  - Throws on insufficient balance
  - Throws on missing / already-consumed commitment

### 9.2 Integration tests (live DB)

Matches the Plan 1 health-test pattern; uses the same loadEnv'd Vitest config.

- `apps/casino/tests/coin-flip-bet.test.ts` — full happy path:
  1. Set up test Player + ensure 5 wallets seeded
  2. `GET /api/coin-flip/commitment` → assert response shape
  3. `POST /api/coin-flip/bet` with valid payload → assert response shape + DB state (`Bet` exists, `Commitment` consumed, `TreasuryMove` rows present, `Player.balance` correct, next `Commitment` created)
  4. Does NOT assert specific win/loss outcome — unit tests cover deterministic math; integration verifies wiring.

- `apps/casino/tests/coin-flip-bet-validation.test.ts` — error paths via the API:
  - 400 on stake out of range
  - 400 on insufficient balance
  - 409 on consumed / missing commitment

- `apps/casino/tests/treasury-invariant.test.ts` — runs `audit()` after N bets, asserts sum of wallet balances = initial seed.

### 9.3 TDD discipline

- Handler unit tests written FIRST (red), then implementation (green). Same loop pattern as Plan 1's `selftest`.
- Integration tests can be written after handler is green — they're verifying wiring, not deriving design.
- Each commit moves through red → green → refactor on its piece.

### 9.4 CI implications

- The Plan 1 GitHub Actions workflow excludes tests because they need a live DB. Plan 2 keeps that exclusion.
- Plan 2 adds the new Prisma migration; CI's existing `prisma validate` step covers it (already has dummy `DATABASE_URL`).
- Plan 4 will revisit when wiring agent runtime — likely a per-PR Neon branch.

---

## 10. Non-goals (recap)

Deliberately deferred to keep Plan 2 focused:

- Generic dispatcher route at `/api/games/[gameId]/bet`
- Hash-chain commit-reveal
- VRF / on-chain randomness
- Real auth (Sign in with Vercel, OAuth, magic link)
- Animation, sounds, polished gameplay feel
- Multi-game UI (the casino "lobby" — Plan 3 may add)
- Playwright / E2E browser tests
- Per-bet statistical / property-based RTP tests
- Ephemeral CI test database

---

## 11. Open questions to revisit during planning

- **Anonymous-session implementation choice.** Cookie-based with `httpOnly + sameSite=lax`, or Next.js encrypted session helper, or simple unsigned `localStorage` ID. Lean: simple unsigned cookie for V1 (no real value at stake). Resolved in the plan.
- **Race condition on rolling commitment.** Two simultaneous bet attempts from the same player would race for the single pending commitment. Postgres unique on (`playerId`, `consumedAt IS NULL`) partial index can serialize. Worth implementing? Coin flip's UX is single-click-blocking so race is unlikely. Lean: skip the partial index in V1; document as known.
- **math.json in DB vs in code.** Both are tracked. Source of truth at runtime: `Game.mathConfig` (DB). Source of truth for review: the file. Plan 2 seed: file value gets copied into DB on `Game` row creation. Math agent (Plan 6) will write to DB only. Acceptable.
- **Persona picker server-side gating.** `GET /api/dev/players` should probably require an env-var-gated header (`X-Debug-Mode: 1` matching a `DEBUG_API_TOKEN` env var) so production isn't trivially trolled. Resolved in plan.
- **Number-vs-BigInt edge in payout math.** `Number(BigInt(stake)) * 1.98` is safe for stakes ≤ 2^53. Our `maxStake = 10000` is fine. Documented.

---

## Appendix A — Files touched / created (preview)

```
NEW:
  apps/casino/games/coin-flip/handler.ts
  apps/casino/games/coin-flip/handler.test.ts
  apps/casino/games/coin-flip/math.json
  apps/casino/games/coin-flip/README.md
  apps/casino/app/play/coin-flip/page.tsx
  apps/casino/app/play/coin-flip/verify/page.tsx
  apps/casino/app/api/coin-flip/commitment/route.ts
  apps/casino/app/api/coin-flip/bet/route.ts
  apps/casino/app/api/dev/players/route.ts                 (debug-gated)
  apps/casino/lib/games/types.ts
  apps/casino/lib/games/rng.ts
  apps/casino/lib/games/rng.test.ts
  apps/casino/lib/games/session.ts
  apps/casino/lib/games/audit.ts
  apps/casino/tests/coin-flip-bet.test.ts
  apps/casino/tests/coin-flip-bet-validation.test.ts
  apps/casino/tests/treasury-invariant.test.ts
  packages/db/prisma/migrations/<ts>_coin_flip/migration.sql
  packages/db/src/client.ts                                (carry-over §8)
  packages/db/src/diagnostics.ts                           (carry-over §8)
  packages/db/seed/                                        (Prisma seed scripts)
    treasury.ts
    games.ts                                                (inserts "coin-flip" Game row)

MODIFY:
  packages/db/prisma/schema.prisma                         (Commitment, WalletKind+player_pool, Bet.commitmentId)
  packages/db/src/index.ts                                 (re-exports adjusted)
  packages/db/src/selftest.ts                              (import from ./client)
  apps/casino/tests/health.test.ts                         (afterAll disconnect)
  apps/dashboard/tests/health.test.ts                      (afterAll disconnect)
  apps/casino/app/layout.tsx                               (metadata)
  apps/dashboard/app/layout.tsx                            (metadata)
  apps/casino/app/api/health/route.ts                      (import from diagnostics)
  apps/dashboard/app/api/health/route.ts                   (import from diagnostics)
  pnpm-workspace.yaml                                      (onlyBuiltDependencies += @casino/db)
```

## Appendix B — Why per-bet rolling commit-reveal (not hash-chain)

A hash-chain (Stake-style) is the industry standard for high-frequency games like slots and dice — one chain commit covers N future bets, and players can pre-verify any bet's outcome once they know the seed. The complexity it adds: a `seed_chains` table, an "advance to next chain" UX (the player must "regenerate seed" to get a fresh chain), and `N` chained hash computations per verification.

Coin flip is low-frequency (each flip is a discrete click → result → next click). The rolling-commitment pattern gives the same per-bet provable-fairness guarantee with simpler UX: always exactly one commitment hash on screen, always one click away from the next bet. The hash-chain abstraction earns its complexity in Plan 3 (roulette) or later when a higher-frequency game lands.
