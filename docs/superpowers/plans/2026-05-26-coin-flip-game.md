# AI-Run Casino — Plan 2 of 8: Coin Flip Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first real game on top of the Plan 1 substrate — a provably-fair coin flip with treasury accounting, playable at `/play/coin-flip`, and a `GameHandler` pattern that Plan 3 (roulette) will plug into. Also bundle five small carry-over fixes flagged by Plan 1's final review.

**Architecture:** Game lives under `apps/casino/games/coin-flip/` with a `GameHandler` contract. Per-bet rolling commit-reveal via a new `Commitment` table. Treasury ledger via a new `player_pool` wallet kind + atomic Prisma transactions. Anonymous browser sessions (unsigned cookie) for player identity, with a debug-flag-gated persona picker.

**Tech Stack:** Same as Plan 1 — Next.js 16 (App Router), TypeScript, Prisma 6 + Neon Postgres, Vitest, Tailwind v4. No new dependencies beyond what `@casino/web` already has.

**Spec reference:** `docs/superpowers/specs/2026-05-25-coin-flip-game-design.md`

---

## Block roadmap

19 tasks in 7 blocks. Each task is bite-sized (typically 2-5 steps).

- **Block A — Plan 1 carry-over** (3 tasks): housekeeping fixes flagged by Plan 1's final review.
- **Block B — Schema + treasury foundation** (3 tasks): Prisma migration, wallet seeding, game registry seed.
- **Block C — Shared game library** (4 tasks): types, RNG helpers, session, audit.
- **Block D — Coin flip handler** (1 task, TDD-heavy): the `settleBet` pure function.
- **Block E — API routes** (2 tasks): commitment GET, bet POST.
- **Block F — UI** (3 tasks): play page, verify page, debug persona picker.
- **Block G — Integration tests** (3 tasks): happy path, validation, treasury invariant.

---

## File layout (after this plan)

```
apps/casino/
├── games/
│   └── coin-flip/
│       ├── handler.ts            NEW — settleBet implementation
│       ├── handler.test.ts       NEW — unit tests
│       ├── math.json             NEW — config (payoutMultiplier, stakes)
│       └── README.md             NEW — what it is + how to verify
├── app/
│   ├── layout.tsx                MODIFY — replace boilerplate metadata
│   ├── play/coin-flip/
│   │   ├── page.tsx              NEW — playable UI
│   │   └── verify/page.tsx       NEW — public verification
│   └── api/
│       ├── coin-flip/
│       │   ├── commitment/route.ts  NEW
│       │   └── bet/route.ts         NEW
│       ├── dev/
│       │   └── players/route.ts     NEW (debug-gated)
│       └── health/route.ts          MODIFY (import from diagnostics)
├── lib/games/
│   ├── types.ts                  NEW — shared interfaces
│   ├── rng.ts                    NEW — crypto + sha256 + outcome derivation
│   ├── rng.test.ts               NEW — unit tests
│   ├── session.ts                NEW — anonymous-session player lookup/create
│   └── audit.ts                  NEW — treasury invariant helper
└── tests/
    ├── health.test.ts                       MODIFY — add afterAll disconnect
    ├── coin-flip-bet.test.ts                NEW — happy path
    ├── coin-flip-bet-validation.test.ts     NEW — error paths
    └── treasury-invariant.test.ts           NEW — wallet sum invariant

apps/dashboard/
├── app/layout.tsx                MODIFY — replace boilerplate metadata
├── app/api/health/route.ts       MODIFY — import from diagnostics
└── tests/health.test.ts          MODIFY — add afterAll disconnect

packages/db/
├── prisma/
│   ├── schema.prisma             MODIFY — Commitment, WalletKind+player_pool, Bet.commitmentId
│   └── migrations/<ts>_coin_flip/
│       └── migration.sql         NEW (generated)
├── seed/
│   ├── treasury.ts               NEW — seed 5 wallets
│   └── games.ts                  NEW — insert coin-flip Game row
└── src/
    ├── client.ts                 NEW — PrismaClient singleton (moved out)
    ├── index.ts                  MODIFY — re-export adjusted
    ├── diagnostics.ts            NEW — selftest re-export
    └── selftest.ts               MODIFY — import from ./client

pnpm-workspace.yaml               MODIFY — onlyBuiltDependencies += @casino/db
```

---

## Conventions

- All paths relative to repo root (`C:\Users\user\source\repos\workstation\casino`).
- Host: Windows + PowerShell, Bash tool available. Commands shown work in either unless noted.
- pnpm is the package manager. Don't use npm or yarn.
- After any task that modifies the Prisma schema OR adds DB-touching code, expect `pnpm install` to re-run the `prisma generate` postinstall (added in Plan 1).
- Tests need `DATABASE_URL` set. Local `.env` files already exist at four locations from Plan 1: `.env` (root), `packages/db/.env`, `apps/casino/.env.local`, `apps/dashboard/.env.local`.
- Commit messages follow the same style as Plan 1: `feat(scope): …`, `fix(scope): …`, `chore: …`, `refactor(scope): …`. One logical change per commit.

---

# Block A — Plan 1 carry-over (housekeeping)

## Task 1: Split `client.ts` from `index.ts` to break the circular import

**Why:** Plan 1's review flagged that `packages/db/src/selftest.ts` imports `prisma` from `./index`, and `index.ts` re-exports `selftest` from `./selftest` — a circular ES module reference that works only because of live-binding semantics.

**Files:**
- Create: `packages/db/src/client.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/selftest.ts`

- [ ] **Step 1: Create the singleton in its own file**

`packages/db/src/client.ts`:

```ts
import { PrismaClient } from '@prisma/client';

declare global {
  var __prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}

export type { PrismaClient };
```

- [ ] **Step 2: Update `index.ts` to re-export from `client.ts`**

Replace `packages/db/src/index.ts` entirely with:

```ts
export { prisma } from './client';
export type { PrismaClient } from './client';
export { selftest } from './selftest';
export type { SelftestResult } from './selftest';
```

- [ ] **Step 3: Update `selftest.ts` to import from `./client`**

Edit `packages/db/src/selftest.ts` and change the first line from `import { prisma } from './index';` to `import { prisma } from './client';`. Rest of the file unchanged.

- [ ] **Step 4: Verify**

```powershell
pnpm --filter @casino/db typecheck
pnpm --filter @casino/db test
pnpm --filter @casino/web test
pnpm --filter @casino/dashboard test
pnpm build
```

All five must exit 0.

- [ ] **Step 5: Commit**

```powershell
git add packages/db/src/client.ts packages/db/src/index.ts packages/db/src/selftest.ts
git commit -m "refactor(db): split prisma client into client.ts to break import cycle"
```

---

## Task 2: Small fixes bundle — `afterAll` disconnects + `onlyBuiltDependencies` + layout metadata

**Why:** Three small Plan 1 follow-ups, all under 5 lines each, bundled into one commit.

**Files:**
- Modify: `apps/casino/tests/health.test.ts`
- Modify: `apps/dashboard/tests/health.test.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `apps/casino/app/layout.tsx`
- Modify: `apps/dashboard/app/layout.tsx`

- [ ] **Step 1: Add `afterAll` to `apps/casino/tests/health.test.ts`**

Replace the entire file with:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { GET } from '../app/api/health/route';
import { prisma } from '@casino/db';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /api/health', () => {
  it('returns 200 with ok=true and lists tables', async () => {
    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.tables)).toBe(true);
    expect(body.tables).toContain('Player');
  });
});
```

- [ ] **Step 2: Add `afterAll` to `apps/dashboard/tests/health.test.ts`**

Replace the entire file with:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { GET } from '../app/api/health/route';
import { prisma } from '@casino/db';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /api/health (dashboard)', () => {
  it('returns 200 with ok=true and confirms DB connectivity', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.app).toBe('dashboard');
  });
});
```

- [ ] **Step 3: Add `@casino/db` to `onlyBuiltDependencies` in `pnpm-workspace.yaml`**

Replace the whole file with:

```yaml
packages:
  - "apps/*"
  - "packages/*"

onlyBuiltDependencies:
  - sharp
  - unrs-resolver
  - "@casino/db"
```

- [ ] **Step 4: Update `apps/casino/app/layout.tsx` metadata**

Open the file. Find the `metadata` export (likely `title: "Create Next App"` and `description: "Generated by create next app"` or similar). Replace it with:

```ts
export const metadata: Metadata = {
  title: 'casino',
  description: 'Provably-fair virtual-currency casino (AI-operated).',
};
```

(Leave the rest of `layout.tsx` — imports, font setup, body markup — unchanged.)

- [ ] **Step 5: Update `apps/dashboard/app/layout.tsx` metadata**

Same pattern. Find the `metadata` export and replace its body with:

```ts
export const metadata: Metadata = {
  title: 'casino — observer dashboard',
  description: 'Watch the AI org operate the casino in real time.',
};
```

- [ ] **Step 6: Verify**

```powershell
pnpm --filter @casino/web test
pnpm --filter @casino/dashboard test
pnpm build
```

All three must exit 0.

- [ ] **Step 7: Commit**

```powershell
git add apps/casino/tests/health.test.ts apps/dashboard/tests/health.test.ts pnpm-workspace.yaml apps/casino/app/layout.tsx apps/dashboard/app/layout.tsx
git commit -m "chore: Plan 1 carry-over — afterAll disconnects, build allowlist, app metadata"
```

---

## Task 3: Move `selftest` to `@casino/db/diagnostics` export path

**Why:** `selftest` is infrastructure/diagnostic, not a business API. Plan 1 review flagged it should not be on the package's main public surface where application code might accidentally depend on it.

**Files:**
- Create: `packages/db/src/diagnostics.ts`
- Modify: `packages/db/package.json` (add `exports` map)
- Modify: `packages/db/src/index.ts` (remove selftest re-export)
- Modify: `apps/casino/app/api/health/route.ts`
- Modify: `apps/dashboard/app/api/health/route.ts`
- Modify: `apps/casino/tests/health.test.ts`
- Modify: `apps/dashboard/tests/health.test.ts`

- [ ] **Step 1: Create `packages/db/src/diagnostics.ts`**

```ts
export { selftest } from './selftest';
export type { SelftestResult } from './selftest';
```

- [ ] **Step 2: Add an `exports` map to `packages/db/package.json`**

Edit `packages/db/package.json` and replace the top-level `"main"` and `"types"` fields with an `exports` block:

```json
{
  "name": "@casino/db",
  "version": "0.0.0",
  "private": true,
  "exports": {
    ".": "./src/index.ts",
    "./diagnostics": "./src/diagnostics.ts"
  },
  "scripts": {
    "build": "tsc --noEmit",
    "typecheck": "tsc --noEmit",
    "lint": "echo 'no lint'",
    "test": "vitest run",
    "prisma": "prisma",
    "postinstall": "prisma generate"
  },
  "dependencies": {
    "@prisma/client": "^6.0.0"
  },
  "devDependencies": {
    "prisma": "^6.0.0",
    "vitest": "^2.1.0",
    "@types/node": "^20",
    "vite": "^5"
  }
}
```

(Versions and other entries preserved as-is; the only changes are removing `"main"`/`"types"` and adding the `exports` block.)

- [ ] **Step 3: Remove selftest re-exports from `packages/db/src/index.ts`**

Replace `packages/db/src/index.ts` with:

```ts
export { prisma } from './client';
export type { PrismaClient } from './client';
```

- [ ] **Step 4: Update `apps/casino/app/api/health/route.ts`**

Change `import { selftest } from '@casino/db';` to `import { selftest } from '@casino/db/diagnostics';`. Rest unchanged.

- [ ] **Step 5: Update `apps/dashboard/app/api/health/route.ts`**

Same change: `import { selftest } from '@casino/db/diagnostics';`.

- [ ] **Step 6: Update test imports**

In both `apps/casino/tests/health.test.ts` and `apps/dashboard/tests/health.test.ts`, the imports of `prisma` stay as `import { prisma } from '@casino/db';` (still the main export). No change to those.

- [ ] **Step 7: Refresh install (because package.json exports changed)**

```powershell
pnpm install
```

- [ ] **Step 8: Verify everything still works**

```powershell
pnpm typecheck
pnpm --filter @casino/db test
pnpm --filter @casino/web test
pnpm --filter @casino/dashboard test
pnpm build
```

All five must exit 0. If the apps' Next.js builds complain about resolving `@casino/db/diagnostics`, check that `transpilePackages: ['@casino/db']` is still in each `next.config.ts` (it should be, from Plan 1).

- [ ] **Step 9: Commit**

```powershell
git add packages/db/src/diagnostics.ts packages/db/package.json packages/db/src/index.ts apps/casino/app/api/health/route.ts apps/dashboard/app/api/health/route.ts pnpm-lock.yaml
git commit -m "refactor(db): move selftest to @casino/db/diagnostics subpath export"
```

---

# Block B — Schema + treasury foundation

## Task 4: Prisma schema migration — `Commitment` table + `player_pool` enum + `Bet.commitmentId`

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create (generated): `packages/db/prisma/migrations/<ts>_coin_flip/migration.sql`

- [ ] **Step 1: Add `player_pool` to the `WalletKind` enum in `schema.prisma`**

Find this block:

```prisma
enum WalletKind {
  operating
  payout_reserve
  marketing_pool
  runway
}
```

And replace it with:

```prisma
enum WalletKind {
  operating
  payout_reserve
  marketing_pool
  runway
  player_pool
}
```

- [ ] **Step 2: Add the `Commitment` model**

Insert this block AFTER the existing `Bet` model and BEFORE the `enum WalletKind` block:

```prisma
model Commitment {
  id               String    @id @default(cuid())
  playerId         String
  gameId           String
  serverSeed       String
  serverSeedHashed String
  createdAt        DateTime  @default(now())
  consumedAt       DateTime?
  betId            String?   @unique

  player           Player    @relation(fields: [playerId], references: [id])
  game             Game      @relation(fields: [gameId], references: [id])
  bet              Bet?      @relation("BetCommitment")

  @@index([playerId, consumedAt])
}
```

- [ ] **Step 3: Add `commitmentId` field + relation to the `Bet` model**

Find the `Bet` model. Inside it, AFTER the existing fields (`id`, `playerId`, `gameId`, `stake`, `outcome`, `payout`, `rngSeed`, `settledAt`) and BEFORE the relation fields (`player Player @relation...`), add:

```prisma
  commitmentId String?     @unique
```

And add a new relation field alongside the existing `player` and `game` relations:

```prisma
  commitment   Commitment? @relation("BetCommitment", fields: [commitmentId], references: [id])
```

- [ ] **Step 4: Add inverse relations on `Player` and `Game`**

In the `Player` model, add a line in the relation block (alongside `bets Bet[]` and `tickets SupportTicket[]`):

```prisma
  commitments Commitment[]
```

In the `Game` model, add (alongside `bets Bet[]`):

```prisma
  commitments Commitment[]
```

- [ ] **Step 5: Format + validate**

```powershell
pnpm --filter @casino/db prisma format
pnpm --filter @casino/db prisma validate
```

Both must exit 0.

- [ ] **Step 6: Create and apply the migration**

```powershell
pnpm --filter @casino/db prisma migrate dev --name coin_flip
```

Expected: creates `packages/db/prisma/migrations/<timestamp>_coin_flip/migration.sql`, applies it to Neon, regenerates the Prisma client.

- [ ] **Step 7: Sanity-check by running the existing tests (they should still pass with the new schema)**

```powershell
pnpm --filter @casino/db test
pnpm --filter @casino/web test
pnpm --filter @casino/dashboard test
```

All three must exit 0.

- [ ] **Step 8: Commit**

```powershell
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add Commitment table + player_pool wallet kind + Bet.commitmentId"
```

---

## Task 5: Treasury wallets seed script

**Why:** The 5 wallets (4 from Plan 1 spec + new `player_pool`) need to exist with correct seed balances before any bet can settle.

**Files:**
- Create: `packages/db/seed/treasury.ts`
- Modify: `packages/db/package.json` (add a `db:seed:treasury` script)

- [ ] **Step 1: Create the seed script**

`packages/db/seed/treasury.ts`:

```ts
import { prisma } from '../src/client';

interface WalletSeed {
  name: string;
  kind: 'operating' | 'payout_reserve' | 'marketing_pool' | 'runway' | 'player_pool';
  balance: bigint;
}

const SEED_WALLETS: WalletSeed[] = [
  { name: 'operating',      kind: 'operating',      balance: 100_000n },
  { name: 'payout_reserve', kind: 'payout_reserve', balance: 800_000n },
  { name: 'marketing_pool', kind: 'marketing_pool', balance:  50_000n },
  { name: 'runway',         kind: 'runway',         balance:  50_000n },
  { name: 'player_pool',    kind: 'player_pool',    balance:       0n },
];

async function main() {
  for (const w of SEED_WALLETS) {
    await prisma.treasuryWallet.upsert({
      where: { name: w.name },
      update: {},          // do NOT overwrite existing balances on re-run
      create: { name: w.name, kind: w.kind, balance: w.balance },
    });
    // eslint-disable-next-line no-console
    console.log(`[treasury seed] ${w.name} (${w.kind}) ensured`);
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[treasury seed] failed:', err);
  process.exit(1);
});
```

The `upsert` with empty `update` means re-running the seed is idempotent and never clobbers a wallet that's accumulated real bet history.

- [ ] **Step 2: Add a script to `packages/db/package.json`**

In the `scripts` block, add `"db:seed:treasury": "tsx seed/treasury.ts"`. The full scripts block becomes:

```json
{
  "build": "tsc --noEmit",
  "typecheck": "tsc --noEmit",
  "lint": "echo 'no lint'",
  "test": "vitest run",
  "prisma": "prisma",
  "postinstall": "prisma generate",
  "db:seed:treasury": "tsx seed/treasury.ts"
}
```

Add `tsx` to devDependencies (it's needed to run TypeScript seed scripts directly):

```powershell
pnpm --filter @casino/db add -D tsx
```

- [ ] **Step 3: Run the seed script**

```powershell
pnpm --filter @casino/db db:seed:treasury
```

Expected output: 5 lines, one per wallet, then exit 0.

- [ ] **Step 4: Sanity-check by querying the DB directly**

```powershell
pnpm --filter @casino/db prisma studio
```

In the browser UI that opens, navigate to `TreasuryWallet` table; you should see all 5 rows with correct balances. Close Prisma Studio (Ctrl+C in the terminal).

Alternative quick check (no UI):

```powershell
pnpm --filter @casino/db prisma db execute --stdin <<< "SELECT name, kind, balance FROM `"TreasuryWallet`" ORDER BY name;"
```

(PowerShell quoting can be finicky here. If it fails, just trust Prisma Studio.)

- [ ] **Step 5: Commit**

```powershell
git add packages/db/seed/treasury.ts packages/db/package.json pnpm-lock.yaml
git commit -m "feat(db): treasury wallets seed script (5 wallets, 1M chips)"
```

---

## Task 6: Game registry seed — insert `coin-flip` `Game` row

**Why:** The `Bet.gameId` foreign key requires a `Game` row to exist. Seed it before any bet endpoint is hit.

**Files:**
- Create: `packages/db/seed/games.ts`
- Modify: `packages/db/package.json` (add a `db:seed:games` script + a top-level `db:seed` that runs both)

- [ ] **Step 1: Create the seed script**

`packages/db/seed/games.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '../src/client';

interface GameSeed {
  id: string;
  kind: string;
  mathConfigPath: string;   // relative to repo root
}

const SEED_GAMES: GameSeed[] = [
  {
    id: 'coin-flip',
    kind: 'coin_flip',
    mathConfigPath: 'apps/casino/games/coin-flip/math.json',
  },
];

async function main() {
  for (const g of SEED_GAMES) {
    const mathConfigRaw = readFileSync(
      join(process.cwd(), '..', '..', g.mathConfigPath),
      'utf8',
    );
    const mathConfig = JSON.parse(mathConfigRaw);

    await prisma.game.upsert({
      where: { id: g.id },
      update: { mathConfig, kind: g.kind },
      create: { id: g.id, kind: g.kind, mathConfig, version: 1 },
    });
    // eslint-disable-next-line no-console
    console.log(`[games seed] ${g.id} (${g.kind}) ensured`);
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[games seed] failed:', err);
  process.exit(1);
});
```

Note: this expects `apps/casino/games/coin-flip/math.json` to exist. We create that file in Task 8 (`Block D`). So this seed script will only succeed AFTER Task 8. Until then, running it errors out cleanly with "ENOENT". That's fine — we commit it now, run it later.

- [ ] **Step 2: Update `packages/db/package.json`**

Replace the scripts block with:

```json
{
  "build": "tsc --noEmit",
  "typecheck": "tsc --noEmit",
  "lint": "echo 'no lint'",
  "test": "vitest run",
  "prisma": "prisma",
  "postinstall": "prisma generate",
  "db:seed:treasury": "tsx seed/treasury.ts",
  "db:seed:games": "tsx seed/games.ts",
  "db:seed": "pnpm db:seed:treasury && pnpm db:seed:games"
}
```

- [ ] **Step 3: Verify the script compiles**

```powershell
pnpm --filter @casino/db typecheck
```

Exit 0.

- [ ] **Step 4: Commit (we will run the script after Task 8)**

```powershell
git add packages/db/seed/games.ts packages/db/package.json
git commit -m "feat(db): game registry seed script"
```

---

# Block C — Shared game library

## Task 7: `lib/games/types.ts` — `GameHandler` contract + shared types

**Files:**
- Create: `apps/casino/lib/games/types.ts`

- [ ] **Step 1: Create the file**

`apps/casino/lib/games/types.ts`:

```ts
/**
 * Shared types for game handlers. Plan 3 (roulette) and beyond use this contract.
 */

export interface GameConfig {
  kind: string;
  version: number;
  rngBytes: number;
  [key: string]: unknown;
}

export interface BetInput {
  stake: bigint;
  commitmentId: string;
}

export interface BetResult {
  betId: string;
  outcome: unknown;
  payout: bigint;
  balance: bigint;
  revealedSeed: string;
  commitmentHash: string;
  nextCommitment: { id: string; hash: string };
}

export interface GameHandler<I extends BetInput = BetInput, R extends BetResult = BetResult> {
  id: string;
  loadConfig(): GameConfig;
  settleBet(input: I, playerId: string): Promise<R>;
}

export class BetValidationError extends Error {
  constructor(public readonly httpStatus: number, message: string) {
    super(message);
    this.name = 'BetValidationError';
  }
}
```

`BetValidationError` is the typed error the API routes will catch and map to HTTP responses.

- [ ] **Step 2: Verify**

```powershell
pnpm --filter @casino/web typecheck
```

Exit 0.

- [ ] **Step 3: Commit**

```powershell
git add apps/casino/lib/games/types.ts
git commit -m "feat(games): GameHandler contract + shared types"
```

---

## Task 8: `lib/games/rng.ts` + tests (TDD)

**Files:**
- Create: `apps/casino/lib/games/rng.test.ts`
- Create: `apps/casino/lib/games/rng.ts`

- [ ] **Step 1: Write the failing tests FIRST**

`apps/casino/lib/games/rng.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  generateSeed,
  sha256Hex,
  deriveCoinFlipOutcome,
} from './rng';

describe('rng', () => {
  describe('generateSeed', () => {
    it('returns a 64-character hex string for 32 bytes', () => {
      const seed = generateSeed(32);
      expect(seed).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns distinct values across calls', () => {
      const a = generateSeed(32);
      const b = generateSeed(32);
      expect(a).not.toEqual(b);
    });
  });

  describe('sha256Hex', () => {
    it('computes SHA-256 of a hex string and returns hex', () => {
      // sha256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
      expect(sha256Hex('')).toEqual(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      );
    });

    it('matches a known fixture for a non-empty input', () => {
      // sha256("abc" as bytes) = ba7816bf...
      // We hash the HEX string "616263" (= "abc"), so the input we hash is the bytes [0x61, 0x62, 0x63].
      expect(sha256Hex('616263')).toEqual(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
    });
  });

  describe('deriveCoinFlipOutcome', () => {
    it('returns "heads" when the first byte is odd', () => {
      expect(deriveCoinFlipOutcome('05ff00')).toEqual('heads');
      expect(deriveCoinFlipOutcome('ff0000')).toEqual('heads');
    });

    it('returns "tails" when the first byte is even', () => {
      expect(deriveCoinFlipOutcome('04ff00')).toEqual('tails');
      expect(deriveCoinFlipOutcome('00aabb')).toEqual('tails');
    });

    it('throws on empty seed', () => {
      expect(() => deriveCoinFlipOutcome('')).toThrow(/seed must be non-empty/);
    });
  });
});
```

- [ ] **Step 2: Run the tests to confirm they FAIL**

```powershell
pnpm --filter @casino/web test rng
```

Expected: FAIL — `Cannot find module './rng'`.

- [ ] **Step 3: Implement `rng.ts`**

`apps/casino/lib/games/rng.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';

export type CoinFlipOutcome = 'heads' | 'tails';

export function generateSeed(byteCount: number): string {
  return randomBytes(byteCount).toString('hex');
}

export function sha256Hex(hexInput: string): string {
  const buf = Buffer.from(hexInput, 'hex');
  return createHash('sha256').update(buf).digest('hex');
}

export function deriveCoinFlipOutcome(seedHex: string): CoinFlipOutcome {
  if (seedHex.length < 2) {
    throw new Error('seed must be non-empty hex string');
  }
  const firstByte = parseInt(seedHex.slice(0, 2), 16);
  return (firstByte & 1) === 1 ? 'heads' : 'tails';
}
```

- [ ] **Step 4: Run the tests to confirm they PASS**

```powershell
pnpm --filter @casino/web test rng
```

Expected: PASS (8 tests / 3 describe blocks).

- [ ] **Step 5: Commit**

```powershell
git add apps/casino/lib/games/rng.ts apps/casino/lib/games/rng.test.ts
git commit -m "feat(games): RNG + sha256 + coin-flip outcome derivation (TDD)"
```

---

## Task 9: `lib/games/session.ts` — anonymous-session player lookup + persona override

**Why:** Every API request needs to know which `Player` row to attribute the bet to. V1: a long-lived unsigned cookie holds a `playerId`. If absent, create a new anonymous Player + grant 1000 chips. A header `X-Casino-Player-Id` overrides the cookie (used by the debug persona picker).

**Files:**
- Create: `apps/casino/lib/games/session.ts`

- [ ] **Step 1: Create the file**

`apps/casino/lib/games/session.ts`:

```ts
import { cookies, headers } from 'next/headers';
import { prisma } from '@casino/db';

const COOKIE_NAME = 'casino_player_id';
const ANON_GRANT_CHIPS = 1000n;
const PERSONA_HEADER = 'x-casino-player-id';

/**
 * Resolve the active player for the current request.
 *
 * Order of precedence:
 *   1. X-Casino-Player-Id header (debug persona picker)
 *   2. casino_player_id cookie
 *   3. Create a new anonymous Player + grant ANON_GRANT_CHIPS, set cookie
 *
 * @returns the playerId. Always non-null after this call (creates if needed).
 */
export async function resolvePlayerId(): Promise<string> {
  const hdrs = await headers();
  const headerPlayerId = hdrs.get(PERSONA_HEADER);
  if (headerPlayerId) {
    // Validate the requested persona exists; ignore if not.
    const existing = await prisma.player.findUnique({
      where: { id: headerPlayerId },
      select: { id: true },
    });
    if (existing) return existing.id;
  }

  const cookieStore = await cookies();
  const cookiePlayerId = cookieStore.get(COOKIE_NAME)?.value;
  if (cookiePlayerId) {
    const existing = await prisma.player.findUnique({
      where: { id: cookiePlayerId },
      select: { id: true },
    });
    if (existing) return existing.id;
    // Cookie pointed at a deleted player; fall through to create new.
  }

  // Create a new anonymous player atomically with the chip grant.
  const newPlayerId = await prisma.$transaction(async (tx) => {
    const player = await tx.player.create({
      data: {
        personaKind: 'lurker',
        balance: ANON_GRANT_CHIPS,
      },
    });

    await tx.treasuryWallet.update({
      where: { name: 'operating' },
      data: { balance: { decrement: ANON_GRANT_CHIPS } },
    });
    await tx.treasuryWallet.update({
      where: { name: 'player_pool' },
      data: { balance: { increment: ANON_GRANT_CHIPS } },
    });
    await tx.treasuryMove.create({
      data: {
        fromWallet: 'operating',
        toWallet: 'player_pool',
        amount: ANON_GRANT_CHIPS,
        reason: 'anonymous-player-grant',
        byRole: 'system',
      },
    });

    return player.id;
  });

  cookieStore.set(COOKIE_NAME, newPlayerId, {
    httpOnly: false,        // V1: not real-money, fine to expose for debug
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365, // 1 year
    path: '/',
  });

  return newPlayerId;
}
```

Notes:
- We trust the `X-Casino-Player-Id` header without auth in V1 (debug picker — explicit non-goal of real auth).
- The cookie is intentionally NOT `httpOnly` so the debug picker UI can read/clear it client-side.
- Anonymous-player creation is wrapped in a transaction to keep the treasury invariant intact.

- [ ] **Step 2: Verify**

```powershell
pnpm --filter @casino/web typecheck
```

Exit 0.

- [ ] **Step 3: Commit**

```powershell
git add apps/casino/lib/games/session.ts
git commit -m "feat(games): anonymous-session player lookup + persona override"
```

---

## Task 10: `lib/games/audit.ts` — treasury invariant helper + test

**Files:**
- Create: `apps/casino/lib/games/audit.ts`
- Create: `apps/casino/lib/games/audit.test.ts`

- [ ] **Step 1: Write the test FIRST**

`apps/casino/lib/games/audit.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@casino/db';
import { auditTreasury } from './audit';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('auditTreasury', () => {
  it('returns total balance summing all wallets', async () => {
    const result = await auditTreasury();
    expect(typeof result.totalChips).toBe('bigint');
    expect(result.totalChips).toBeGreaterThanOrEqual(0n);
    expect(Array.isArray(result.wallets)).toBe(true);
    expect(result.wallets.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```powershell
pnpm --filter @casino/web test audit
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `audit.ts`**

`apps/casino/lib/games/audit.ts`:

```ts
import { prisma } from '@casino/db';

export interface TreasuryAuditResult {
  totalChips: bigint;
  wallets: Array<{ name: string; kind: string; balance: bigint }>;
}

/**
 * Sum all wallet balances. The total should equal the initial treasury seed
 * (1,000,000 by default) for as long as no chips enter or leave the closed
 * system. New-player grants are internal redistributions (operating ->
 * player_pool) and do NOT change the total.
 */
export async function auditTreasury(): Promise<TreasuryAuditResult> {
  const wallets = await prisma.treasuryWallet.findMany({
    select: { name: true, kind: true, balance: true },
    orderBy: { name: 'asc' },
  });

  const totalChips = wallets.reduce(
    (sum, w) => sum + w.balance,
    0n,
  );

  return { totalChips, wallets };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```powershell
pnpm --filter @casino/web test audit
```

Expected: PASS.

(If you haven't run the treasury seed script yet from Task 5 — the test still passes because all wallets default to 0 balance; the total will just be 0. The test only asserts non-negative.)

- [ ] **Step 5: Commit**

```powershell
git add apps/casino/lib/games/audit.ts apps/casino/lib/games/audit.test.ts
git commit -m "feat(games): treasury invariant audit helper"
```

---

# Block D — Coin flip handler

## Task 11: `coin-flip/handler.ts` with TDD

**Why:** The core game logic. Pure function: given a stake, side choice, and an unconsumed commitment, atomically settle the bet (treasury moves, player balance update, bet creation, commitment consumption, next commitment creation).

**Files:**
- Create: `apps/casino/games/coin-flip/math.json`
- Create: `apps/casino/games/coin-flip/README.md`
- Create: `apps/casino/games/coin-flip/handler.test.ts`
- Create: `apps/casino/games/coin-flip/handler.ts`

This task is broken into more steps than usual because it has the most logic.

- [ ] **Step 1: Create `math.json`**

`apps/casino/games/coin-flip/math.json`:

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

- [ ] **Step 2: Create `README.md`**

`apps/casino/games/coin-flip/README.md`:

```markdown
# Coin flip

50/50 fair coin. Bias lives in the 1.98x payout (1% house edge / 99% RTP).

## Outcome derivation
The revealed server seed (32 bytes, hex) determines the outcome:
- `seed[0] & 1 === 1` → `heads`
- `seed[0] & 1 === 0` → `tails`

## Provably fair (per-bet rolling commitment)
Before each bet, the server commits a SHA-256 hash of the next seed. The
player sees the hash, places their bet, and the server reveals the seed.
Anyone can verify `sha256(revealed_seed) === committed_hash` and recompute
the outcome to confirm the result was not chosen post-hoc.

The verification page at `/play/coin-flip/verify` does this off-line.

## Config
`math.json` is the source of truth for code review. At runtime the handler
reads `Game.mathConfig` from the database (the Math agent — Plan 6 — owns
the DB copy).
```

- [ ] **Step 3: Run the games seed (now that math.json exists)**

```powershell
pnpm --filter @casino/db db:seed:games
```

Expected: `[games seed] coin-flip (coin_flip) ensured` then exit 0.

(If it fails because the script path is wrong, check that `mathConfigPath` in `seed/games.ts` is `'apps/casino/games/coin-flip/math.json'` and that you're running from `packages/db/`.)

- [ ] **Step 4: Write the failing handler tests**

`apps/casino/games/coin-flip/handler.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Player, Commitment } from '@prisma/client';
import { settleCoinFlipBet, type CoinFlipInput } from './handler';
import { BetValidationError } from '../../lib/games/types';

// In-memory mock of the bits of Prisma the handler touches.
const mockTx = {
  commitment: {
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  player: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  bet: {
    create: vi.fn(),
  },
  treasuryWallet: {
    update: vi.fn(),
  },
  treasuryMove: {
    create: vi.fn(),
  },
  game: {
    findUniqueOrThrow: vi.fn(),
  },
};

vi.mock('@casino/db', () => ({
  prisma: {
    $transaction: async (fn: any) => fn(mockTx),
  },
}));

beforeEach(() => {
  for (const namespace of Object.values(mockTx)) {
    for (const fn of Object.values(namespace as Record<string, any>)) {
      if (typeof fn === 'function' && 'mockReset' in fn) fn.mockReset();
    }
  }
});

// Fixtures
const PLAYER: Player = {
  id: 'pl-1',
  personaKind: 'lurker',
  balance: 1000n,
  createdAt: new Date(),
  frozen: false,
  flags: {} as any,
} as Player;

// seed[0] = 0x05 (odd) -> heads
const SEED_HEADS = '05ff00112233445566778899aabbccddeeff00112233445566778899aabbccdd';
// seed[0] = 0x04 (even) -> tails
const SEED_TAILS = '04ff00112233445566778899aabbccddeeff00112233445566778899aabbccdd';

function commitment(seed: string): Commitment {
  return {
    id: 'cm-1',
    playerId: 'pl-1',
    gameId: 'coin-flip',
    serverSeed: seed,
    serverSeedHashed: 'hash-' + seed.slice(0, 6),
    createdAt: new Date(),
    consumedAt: null,
    betId: null,
  } as Commitment;
}

const GAME_ROW = {
  id: 'coin-flip',
  kind: 'coin_flip',
  version: 1,
  mathConfig: {
    kind: 'coin_flip',
    version: 1,
    payoutMultiplier: 1.98,
    minStake: 10,
    maxStake: 10000,
    rngBytes: 32,
    sides: ['heads', 'tails'],
  },
  deployedAt: new Date(),
};

describe('settleCoinFlipBet', () => {
  it('pays out 1.98x on a winning bet (heads predicted, heads outcome)', async () => {
    mockTx.commitment.findUnique.mockResolvedValue(commitment(SEED_HEADS));
    mockTx.player.findUnique.mockResolvedValue(PLAYER);
    mockTx.game.findUniqueOrThrow.mockResolvedValue(GAME_ROW);
    mockTx.bet.create.mockResolvedValue({ id: 'bet-1' });
    mockTx.commitment.create.mockResolvedValue({
      id: 'cm-2',
      serverSeedHashed: 'hash-next',
    });

    const input: CoinFlipInput = { commitmentId: 'cm-1', stake: 100n, side: 'heads' };
    const result = await settleCoinFlipBet(input, 'pl-1');

    expect(result.outcome).toBe('heads');
    expect(result.payout).toBe(198n);   // floor(100 * 1.98)
    expect(result.balance).toBe(1098n); // 1000 - 100 + 198
    expect(result.revealedSeed).toBe(SEED_HEADS);
  });

  it('returns 0 payout on a losing bet (heads predicted, tails outcome)', async () => {
    mockTx.commitment.findUnique.mockResolvedValue(commitment(SEED_TAILS));
    mockTx.player.findUnique.mockResolvedValue(PLAYER);
    mockTx.game.findUniqueOrThrow.mockResolvedValue(GAME_ROW);
    mockTx.bet.create.mockResolvedValue({ id: 'bet-2' });
    mockTx.commitment.create.mockResolvedValue({
      id: 'cm-2',
      serverSeedHashed: 'hash-next',
    });

    const input: CoinFlipInput = { commitmentId: 'cm-1', stake: 100n, side: 'heads' };
    const result = await settleCoinFlipBet(input, 'pl-1');

    expect(result.outcome).toBe('tails');
    expect(result.payout).toBe(0n);
    expect(result.balance).toBe(900n);  // 1000 - 100
  });

  it('throws BetValidationError(400) on stake below minStake', async () => {
    mockTx.commitment.findUnique.mockResolvedValue(commitment(SEED_HEADS));
    mockTx.player.findUnique.mockResolvedValue(PLAYER);
    mockTx.game.findUniqueOrThrow.mockResolvedValue(GAME_ROW);

    const input: CoinFlipInput = { commitmentId: 'cm-1', stake: 5n, side: 'heads' };
    await expect(settleCoinFlipBet(input, 'pl-1')).rejects.toMatchObject({
      name: 'BetValidationError',
      httpStatus: 400,
      message: expect.stringMatching(/stake/i),
    });
  });

  it('throws BetValidationError(400) on stake above maxStake', async () => {
    mockTx.commitment.findUnique.mockResolvedValue(commitment(SEED_HEADS));
    mockTx.player.findUnique.mockResolvedValue(PLAYER);
    mockTx.game.findUniqueOrThrow.mockResolvedValue(GAME_ROW);

    const input: CoinFlipInput = { commitmentId: 'cm-1', stake: 20000n, side: 'heads' };
    await expect(settleCoinFlipBet(input, 'pl-1')).rejects.toMatchObject({
      httpStatus: 400,
    });
  });

  it('throws BetValidationError(400) on insufficient balance', async () => {
    mockTx.commitment.findUnique.mockResolvedValue(commitment(SEED_HEADS));
    mockTx.player.findUnique.mockResolvedValue({ ...PLAYER, balance: 50n });
    mockTx.game.findUniqueOrThrow.mockResolvedValue(GAME_ROW);

    const input: CoinFlipInput = { commitmentId: 'cm-1', stake: 100n, side: 'heads' };
    await expect(settleCoinFlipBet(input, 'pl-1')).rejects.toMatchObject({
      httpStatus: 400,
      message: expect.stringMatching(/balance/i),
    });
  });

  it('throws BetValidationError(409) when commitment is missing', async () => {
    mockTx.commitment.findUnique.mockResolvedValue(null);
    mockTx.player.findUnique.mockResolvedValue(PLAYER);
    mockTx.game.findUniqueOrThrow.mockResolvedValue(GAME_ROW);

    const input: CoinFlipInput = { commitmentId: 'missing', stake: 100n, side: 'heads' };
    await expect(settleCoinFlipBet(input, 'pl-1')).rejects.toMatchObject({
      httpStatus: 409,
    });
  });

  it('throws BetValidationError(409) when commitment is already consumed', async () => {
    const consumed = { ...commitment(SEED_HEADS), consumedAt: new Date() };
    mockTx.commitment.findUnique.mockResolvedValue(consumed);
    mockTx.player.findUnique.mockResolvedValue(PLAYER);
    mockTx.game.findUniqueOrThrow.mockResolvedValue(GAME_ROW);

    const input: CoinFlipInput = { commitmentId: 'cm-1', stake: 100n, side: 'heads' };
    await expect(settleCoinFlipBet(input, 'pl-1')).rejects.toMatchObject({
      httpStatus: 409,
    });
  });
});
```

- [ ] **Step 5: Run the tests to confirm they FAIL**

```powershell
pnpm --filter @casino/web test handler
```

Expected: FAIL — `Cannot find module './handler'`.

- [ ] **Step 6: Implement the handler**

`apps/casino/games/coin-flip/handler.ts`:

```ts
import { prisma } from '@casino/db';
import {
  BetInput,
  BetResult,
  BetValidationError,
  GameConfig,
  GameHandler,
} from '../../lib/games/types';
import {
  deriveCoinFlipOutcome,
  generateSeed,
  sha256Hex,
  type CoinFlipOutcome,
} from '../../lib/games/rng';
import mathFile from './math.json';

const GAME_ID = 'coin-flip';

export interface CoinFlipInput extends BetInput {
  side: CoinFlipOutcome;
}

export interface CoinFlipResult extends BetResult {
  outcome: CoinFlipOutcome;
}

interface CoinFlipMath extends GameConfig {
  payoutMultiplier: number;
  minStake: number;
  maxStake: number;
  sides: ['heads', 'tails'];
}

export async function settleCoinFlipBet(
  input: CoinFlipInput,
  playerId: string,
): Promise<CoinFlipResult> {
  return prisma.$transaction(async (tx) => {
    const game = await tx.game.findUniqueOrThrow({ where: { id: GAME_ID } });
    const config = game.mathConfig as unknown as CoinFlipMath;

    // 1. Commitment
    const commitment = await tx.commitment.findUnique({
      where: { id: input.commitmentId },
    });
    if (!commitment || commitment.playerId !== playerId) {
      throw new BetValidationError(409, 'commitment not found');
    }
    if (commitment.consumedAt !== null) {
      throw new BetValidationError(409, 'commitment already consumed');
    }

    // 2. Stake bounds
    if (input.stake < BigInt(config.minStake) || input.stake > BigInt(config.maxStake)) {
      throw new BetValidationError(
        400,
        `stake must be between ${config.minStake} and ${config.maxStake}`,
      );
    }

    // 3. Player + balance
    const player = await tx.player.findUnique({ where: { id: playerId } });
    if (!player) throw new BetValidationError(409, 'player not found');
    if (player.balance < input.stake) {
      throw new BetValidationError(400, 'insufficient balance');
    }

    // 4. Outcome
    const outcome = deriveCoinFlipOutcome(commitment.serverSeed);
    const won = outcome === input.side;
    const payout = won
      ? BigInt(Math.floor(Number(input.stake) * config.payoutMultiplier))
      : 0n;

    // 5. Treasury moves + balance update
    // Stake moves from player_pool to payout_reserve regardless.
    await tx.treasuryWallet.update({
      where: { name: 'player_pool' },
      data: { balance: { decrement: input.stake } },
    });
    await tx.treasuryWallet.update({
      where: { name: 'payout_reserve' },
      data: { balance: { increment: input.stake } },
    });
    await tx.treasuryMove.create({
      data: {
        fromWallet: 'player_pool',
        toWallet: 'payout_reserve',
        amount: input.stake,
        reason: `coin-flip stake ${commitment.id}`,
        byRole: 'system',
      },
    });

    if (won) {
      // Payout returns from payout_reserve to player_pool.
      await tx.treasuryWallet.update({
        where: { name: 'payout_reserve' },
        data: { balance: { decrement: payout } },
      });
      await tx.treasuryWallet.update({
        where: { name: 'player_pool' },
        data: { balance: { increment: payout } },
      });
      await tx.treasuryMove.create({
        data: {
          fromWallet: 'payout_reserve',
          toWallet: 'player_pool',
          amount: payout,
          reason: `coin-flip payout ${commitment.id}`,
          byRole: 'system',
        },
      });
    }

    const newBalance = player.balance - input.stake + payout;
    await tx.player.update({
      where: { id: playerId },
      data: { balance: newBalance },
    });

    // 6. Bet record
    const bet = await tx.bet.create({
      data: {
        playerId,
        gameId: GAME_ID,
        stake: input.stake,
        outcome: { side: input.side, result: outcome, won } as any,
        payout,
        rngSeed: commitment.serverSeed,
        commitmentId: commitment.id,
      },
    });

    // 7. Consume the current commitment
    await tx.commitment.update({
      where: { id: commitment.id },
      data: { consumedAt: new Date(), betId: bet.id },
    });

    // 8. Create the next commitment for this player
    const nextSeed = generateSeed(config.rngBytes);
    const nextHash = sha256Hex(nextSeed);
    const nextCommitment = await tx.commitment.create({
      data: {
        playerId,
        gameId: GAME_ID,
        serverSeed: nextSeed,
        serverSeedHashed: nextHash,
      },
    });

    return {
      betId: bet.id,
      outcome,
      payout,
      balance: newBalance,
      revealedSeed: commitment.serverSeed,
      commitmentHash: commitment.serverSeedHashed,
      nextCommitment: { id: nextCommitment.id, hash: nextCommitment.serverSeedHashed },
    };
  });
}

export const coinFlipHandler: GameHandler<CoinFlipInput, CoinFlipResult> = {
  id: GAME_ID,
  // The runtime source of truth is the DB Game.mathConfig column (used inside settleBet).
  // loadConfig() returns the file copy for consumers that don't want a DB hit.
  loadConfig: () => mathFile as unknown as CoinFlipMath,
  settleBet: settleCoinFlipBet,
};
```

- [ ] **Step 7: Run the tests to confirm they PASS**

```powershell
pnpm --filter @casino/web test handler
```

Expected: PASS (7 tests).

- [ ] **Step 8: Run the full test suite (regression check)**

```powershell
pnpm --filter @casino/web test
```

Expected: all tests pass (including the rng, audit, and health tests from earlier tasks).

- [ ] **Step 9: Commit**

```powershell
git add apps/casino/games/coin-flip
git commit -m "feat(games): coin-flip handler with TDD + math.json + readme"
```

---

# Block E — API routes

## Task 12: `GET /api/coin-flip/commitment`

**Files:**
- Create: `apps/casino/app/api/coin-flip/commitment/route.ts`

- [ ] **Step 1: Create the route**

`apps/casino/app/api/coin-flip/commitment/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { prisma } from '@casino/db';
import { resolvePlayerId } from '../../../../lib/games/session';
import { generateSeed, sha256Hex } from '../../../../lib/games/rng';

const GAME_ID = 'coin-flip';
const RNG_BYTES = 32;

export async function GET() {
  try {
    const playerId = await resolvePlayerId();

    const existing = await prisma.commitment.findFirst({
      where: { playerId, gameId: GAME_ID, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      return NextResponse.json({
        commitmentId: existing.id,
        commitmentHash: existing.serverSeedHashed,
      });
    }

    const serverSeed = generateSeed(RNG_BYTES);
    const serverSeedHashed = sha256Hex(serverSeed);
    const created = await prisma.commitment.create({
      data: {
        playerId,
        gameId: GAME_ID,
        serverSeed,
        serverSeedHashed,
      },
    });

    return NextResponse.json({
      commitmentId: created.id,
      commitmentHash: created.serverSeedHashed,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Smoke-test in the dev server**

```powershell
pnpm --filter @casino/web dev
```

In another terminal:

```powershell
curl http://localhost:3000/api/coin-flip/commitment
```

Expected JSON: `{"commitmentId":"ck...","commitmentHash":"<64-hex-chars>"}`. Run twice — the second call should return the SAME id (no new commitment created until one is consumed).

Stop the dev server (Ctrl+C).

- [ ] **Step 3: Commit**

```powershell
git add apps/casino/app/api/coin-flip/commitment
git commit -m "feat(api): GET /api/coin-flip/commitment (rolling per-player commitment)"
```

---

## Task 13: `POST /api/coin-flip/bet`

**Files:**
- Create: `apps/casino/app/api/coin-flip/bet/route.ts`

- [ ] **Step 1: Create the route**

`apps/casino/app/api/coin-flip/bet/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { resolvePlayerId } from '../../../../lib/games/session';
import { settleCoinFlipBet, type CoinFlipInput } from '../../../../games/coin-flip/handler';
import { BetValidationError } from '../../../../lib/games/types';

interface RawBody {
  commitmentId?: unknown;
  stake?: unknown;
  side?: unknown;
}

export async function POST(req: NextRequest) {
  try {
    const playerId = await resolvePlayerId();
    const raw = (await req.json()) as RawBody;

    const commitmentId = typeof raw.commitmentId === 'string' ? raw.commitmentId : null;
    const stakeNum = typeof raw.stake === 'number' && Number.isFinite(raw.stake) ? raw.stake : null;
    const side = raw.side === 'heads' || raw.side === 'tails' ? raw.side : null;

    if (!commitmentId || stakeNum === null || side === null) {
      return NextResponse.json(
        { ok: false, error: 'invalid body: require { commitmentId: string, stake: number, side: "heads"|"tails" }' },
        { status: 400 },
      );
    }
    if (!Number.isInteger(stakeNum) || stakeNum <= 0) {
      return NextResponse.json(
        { ok: false, error: 'stake must be a positive integer' },
        { status: 400 },
      );
    }

    const input: CoinFlipInput = {
      commitmentId,
      stake: BigInt(stakeNum),
      side,
    };

    const result = await settleCoinFlipBet(input, playerId);

    return NextResponse.json({
      betId: result.betId,
      outcome: result.outcome,
      payout: result.payout.toString(),
      balance: result.balance.toString(),
      revealedSeed: result.revealedSeed,
      commitmentHash: result.commitmentHash,
      nextCommitment: result.nextCommitment,
    });
  } catch (err) {
    if (err instanceof BetValidationError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.httpStatus });
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Smoke-test the full GET→POST flow**

```powershell
pnpm --filter @casino/web dev
```

In another terminal:

```powershell
# Get commitment (also auto-creates a player + cookie)
curl -c cookies.txt http://localhost:3000/api/coin-flip/commitment

# Capture the commitmentId from the response, then bet:
curl -b cookies.txt -X POST http://localhost:3000/api/coin-flip/bet `
  -H "Content-Type: application/json" `
  -d '{"commitmentId":"<paste-id-here>","stake":100,"side":"heads"}'
```

Expected: a JSON response with `outcome`, `payout` (stringified bigint), `balance`, `revealedSeed`, `commitmentHash`, `nextCommitment`. Re-running with the same `commitmentId` should return 409.

Stop dev server.

- [ ] **Step 3: Commit**

```powershell
git add apps/casino/app/api/coin-flip/bet
git commit -m "feat(api): POST /api/coin-flip/bet (settle bet, return reveal + next commitment)"
```

---

# Block F — UI

## Task 14: `/play/coin-flip` page

**Files:**
- Create: `apps/casino/app/play/coin-flip/page.tsx`

This page is a Client Component (interactivity required). It manages local state for stake/side selection, calls the two API routes, displays the commitment + result.

- [ ] **Step 1: Create the page**

`apps/casino/app/play/coin-flip/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';

type Side = 'heads' | 'tails';

interface CommitmentResponse {
  commitmentId: string;
  commitmentHash: string;
}

interface BetResponse {
  betId: string;
  outcome: Side;
  payout: string;
  balance: string;
  revealedSeed: string;
  commitmentHash: string;
  nextCommitment: { id: string; hash: string };
}

interface RecentBet {
  outcome: Side;
  netDelta: bigint;   // payout - stake (negative on loss)
}

export default function CoinFlipPage() {
  const [commitment, setCommitment] = useState<CommitmentResponse | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [stake, setStake] = useState<string>('100');
  const [side, setSide] = useState<Side>('heads');
  const [busy, setBusy] = useState(false);
  const [lastBet, setLastBet] = useState<BetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentBet[]>([]);

  // Fetch initial commitment on mount.
  useEffect(() => {
    void refreshCommitment();
  }, []);

  async function refreshCommitment() {
    setError(null);
    try {
      const res = await fetch('/api/coin-flip/commitment', {
        headers: personaHeader(),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`commitment ${res.status}`);
      const body = (await res.json()) as CommitmentResponse;
      setCommitment(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function placeBet() {
    if (!commitment || busy) return;
    setBusy(true);
    setError(null);
    try {
      const stakeNum = Number.parseInt(stake, 10);
      if (!Number.isFinite(stakeNum) || stakeNum <= 0) {
        throw new Error('stake must be a positive integer');
      }
      const res = await fetch('/api/coin-flip/bet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...personaHeader() },
        credentials: 'include',
        body: JSON.stringify({
          commitmentId: commitment.commitmentId,
          stake: stakeNum,
          side,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `bet ${res.status}`);
      const bet = body as BetResponse;
      setLastBet(bet);
      setBalance(BigInt(bet.balance));
      setCommitment({
        commitmentId: bet.nextCommitment.id,
        commitmentHash: bet.nextCommitment.hash,
      });
      const netDelta = BigInt(bet.payout) - BigInt(stakeNum);
      setRecent((r) => [{ outcome: bet.outcome, netDelta }, ...r].slice(0, 10));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-900 text-slate-100 p-6 font-sans">
      <header className="flex justify-between items-center mb-8 max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold">casino — coin flip</h1>
        <div className="font-mono">
          🪙 {balance !== null ? balance.toString() : '…'}
        </div>
      </header>

      <section className="max-w-3xl mx-auto space-y-6">
        <div className="rounded border border-slate-700 p-4">
          <div className="text-sm text-slate-400 mb-1">Server commitment</div>
          <div className="font-mono text-emerald-400 break-all">
            {commitment?.commitmentHash ?? 'loading…'}
          </div>
        </div>

        <div className="rounded border border-slate-700 p-4 space-y-4">
          <label className="block">
            <span className="text-sm text-slate-400">Stake (chips)</span>
            <input
              type="number"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              min={10}
              max={10000}
              className="mt-1 w-full rounded bg-slate-800 border border-slate-700 p-2 font-mono"
              disabled={busy}
            />
          </label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={side === 'heads'}
                onChange={() => setSide('heads')}
                disabled={busy}
              />
              Heads
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={side === 'tails'}
                onChange={() => setSide('tails')}
                disabled={busy}
              />
              Tails
            </label>
          </div>
          <button
            onClick={placeBet}
            disabled={busy || !commitment}
            className="w-full rounded bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:cursor-not-allowed py-3 font-bold"
          >
            {busy ? 'FLIPPING…' : 'FLIP'}
          </button>
          {error && <div className="text-red-400 text-sm">{error}</div>}
        </div>

        {lastBet && (
          <div className="rounded border border-slate-700 p-4 space-y-2">
            <div className="font-bold">
              🪙 {lastBet.outcome.toUpperCase()} —{' '}
              {BigInt(lastBet.payout) > 0n ? (
                <span className="text-emerald-400">you won {lastBet.payout} chips</span>
              ) : (
                <span className="text-red-400">you lost</span>
              )}
            </div>
            <div className="text-sm text-slate-400">
              Revealed seed: <span className="font-mono break-all">{lastBet.revealedSeed}</span>
            </div>
            <div className="text-sm text-slate-400">
              Commitment hash:{' '}
              <span className="font-mono break-all text-emerald-400">{lastBet.commitmentHash}</span>{' '}
              ✓
            </div>
            <a
              href={`/play/coin-flip/verify?seed=${lastBet.revealedSeed}&hash=${lastBet.commitmentHash}&side=${side}&outcome=${lastBet.outcome}`}
              className="inline-block mt-2 text-emerald-400 underline text-sm"
            >
              Verify externally →
            </a>
          </div>
        )}

        {recent.length > 0 && (
          <div className="rounded border border-slate-700 p-4">
            <div className="text-sm text-slate-400 mb-2">Recent bets</div>
            <div className="flex flex-wrap gap-2 font-mono text-sm">
              {recent.map((r, i) => (
                <span
                  key={i}
                  className={r.netDelta > 0n ? 'text-emerald-400' : 'text-red-400'}
                >
                  {r.outcome.toUpperCase()} {r.netDelta > 0n ? '+' : ''}
                  {r.netDelta.toString()}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function personaHeader(): HeadersInit {
  if (typeof window === 'undefined') return {};
  const persona = window.localStorage.getItem('casino_player_id');
  return persona ? { 'X-Casino-Player-Id': persona } : {};
}
```

- [ ] **Step 2: Smoke-test in the dev server**

```powershell
pnpm --filter @casino/web dev
```

Open http://localhost:3000/play/coin-flip in a browser. Verify:
- Commitment hash appears within 1-2 seconds
- Can input stake, pick side, click FLIP
- After flip: result panel appears, balance updates, new commitment shown, recent bets list grows
- Multiple flips work; verification link goes to `/play/coin-flip/verify?…`

Stop dev server.

- [ ] **Step 3: Commit**

```powershell
git add apps/casino/app/play/coin-flip/page.tsx
git commit -m "feat(ui): coin-flip play page (commitment + bet + reveal + history)"
```

---

## Task 15: `/play/coin-flip/verify` page

**Files:**
- Create: `apps/casino/app/play/coin-flip/verify/page.tsx`

- [ ] **Step 1: Create the page**

`apps/casino/app/play/coin-flip/verify/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type Side = 'heads' | 'tails';

async function sha256HexClient(hex: string): Promise<string> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function deriveOutcome(seedHex: string): Side | null {
  if (seedHex.length < 2) return null;
  const firstByte = parseInt(seedHex.slice(0, 2), 16);
  if (Number.isNaN(firstByte)) return null;
  return (firstByte & 1) === 1 ? 'heads' : 'tails';
}

export default function VerifyPage() {
  const params = useSearchParams();
  const [seed, setSeed] = useState(params.get('seed') ?? '');
  const [hash, setHash] = useState(params.get('hash') ?? '');
  const [side, setSide] = useState<Side>((params.get('side') as Side) ?? 'heads');
  const [outcome, setOutcome] = useState<Side>((params.get('outcome') as Side) ?? 'heads');

  const [computedHash, setComputedHash] = useState<string | null>(null);

  useEffect(() => {
    if (!seed) {
      setComputedHash(null);
      return;
    }
    void sha256HexClient(seed).then(setComputedHash);
  }, [seed]);

  const hashMatches = computedHash !== null && computedHash === hash;
  const derived = deriveOutcome(seed);
  const outcomeMatches = derived !== null && derived === outcome;

  return (
    <main className="min-h-screen bg-slate-900 text-slate-100 p-6 font-sans">
      <section className="max-w-2xl mx-auto space-y-6">
        <header>
          <h1 className="text-2xl font-bold">coin-flip — verify</h1>
          <p className="text-sm text-slate-400 mt-1">
            Paste the revealed seed + committed hash to verify a coin-flip result was fair.
          </p>
        </header>

        <label className="block">
          <span className="text-sm text-slate-400">Revealed server seed (hex)</span>
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value.trim())}
            className="mt-1 w-full rounded bg-slate-800 border border-slate-700 p-2 font-mono break-all"
            placeholder="32 bytes hex…"
          />
        </label>

        <label className="block">
          <span className="text-sm text-slate-400">Committed hash (the hash you saw before the flip)</span>
          <input
            value={hash}
            onChange={(e) => setHash(e.target.value.trim())}
            className="mt-1 w-full rounded bg-slate-800 border border-slate-700 p-2 font-mono break-all"
            placeholder="sha256 hex…"
          />
        </label>

        <div className="flex gap-6">
          <label className="block flex-1">
            <span className="text-sm text-slate-400">Side bet</span>
            <select
              value={side}
              onChange={(e) => setSide(e.target.value as Side)}
              className="mt-1 w-full rounded bg-slate-800 border border-slate-700 p-2"
            >
              <option value="heads">heads</option>
              <option value="tails">tails</option>
            </select>
          </label>
          <label className="block flex-1">
            <span className="text-sm text-slate-400">Reported outcome</span>
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as Side)}
              className="mt-1 w-full rounded bg-slate-800 border border-slate-700 p-2"
            >
              <option value="heads">heads</option>
              <option value="tails">tails</option>
            </select>
          </label>
        </div>

        <div className="rounded border border-slate-700 p-4 space-y-3 text-sm">
          <div>
            <div className="text-slate-400">sha256(seed):</div>
            <div className="font-mono break-all">{computedHash ?? '…'}</div>
            <div className={hashMatches ? 'text-emerald-400 mt-1' : 'text-red-400 mt-1'}>
              {hashMatches ? '✓ matches committed hash' : '✗ does NOT match committed hash'}
            </div>
          </div>
          <div>
            <div className="text-slate-400">Derived outcome (seed[0] & 1):</div>
            <div className="font-mono">{derived ?? '—'}</div>
            <div className={outcomeMatches ? 'text-emerald-400 mt-1' : 'text-red-400 mt-1'}>
              {outcomeMatches ? '✓ matches reported outcome' : '✗ does NOT match reported outcome'}
            </div>
          </div>
          <div>
            <div className="text-slate-400">Player wins:</div>
            <div className="font-mono">{derived === side ? 'YES' : 'NO'}</div>
          </div>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Smoke-test in the dev server**

```powershell
pnpm --filter @casino/web dev
```

Open http://localhost:3000/play/coin-flip, play a flip, click "Verify externally →". The verify page should open with all fields populated and the checks showing ✓.

Stop dev server.

- [ ] **Step 3: Commit**

```powershell
git add apps/casino/app/play/coin-flip/verify
git commit -m "feat(ui): public coin-flip verify page (client-side sha256 + outcome check)"
```

---

## Task 16: `/api/dev/players` debug route + persona picker UI

**Why:** The debug-flag-gated persona picker referenced in the spec. Only listed under "debug" because the UI is hidden behind a flag; the API itself is gated by a header check matching an env var.

**Files:**
- Create: `apps/casino/app/api/dev/players/route.ts`
- Modify: `apps/casino/app/play/coin-flip/page.tsx` (add the picker UI)

- [ ] **Step 1: Create the debug players route**

`apps/casino/app/api/dev/players/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@casino/db';

const DEBUG_TOKEN_HEADER = 'x-debug-token';

export async function GET(req: NextRequest) {
  const expected = process.env.DEBUG_API_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: 'debug API disabled (no DEBUG_API_TOKEN env)' },
      { status: 404 },
    );
  }
  const token = req.headers.get(DEBUG_TOKEN_HEADER);
  if (token !== expected) {
    return NextResponse.json(
      { ok: false, error: 'invalid debug token' },
      { status: 403 },
    );
  }

  const players = await prisma.player.findMany({
    select: {
      id: true,
      personaKind: true,
      balance: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return NextResponse.json({
    players: players.map((p) => ({
      id: p.id,
      personaKind: p.personaKind,
      balance: p.balance.toString(),
      createdAt: p.createdAt.toISOString(),
    })),
  });
}
```

- [ ] **Step 2: Add `DEBUG_API_TOKEN` to your local `.env.local` for the casino app**

Edit `apps/casino/.env.local` and append a line:

```
DEBUG_API_TOKEN=local-dev-debug
```

(This is a local-only secret; do NOT commit. The Vercel prod env can be set later via `vercel env add` if needed.)

- [ ] **Step 3: Add the picker UI to the coin-flip page**

Edit `apps/casino/app/play/coin-flip/page.tsx`. At the top, after the existing `useState` declarations, add:

```tsx
const [debugMode, setDebugMode] = useState(false);
const [debugToken, setDebugToken] = useState<string>('');
const [personas, setPersonas] = useState<Array<{ id: string; personaKind: string; balance: string }>>([]);
const [activePersona, setActivePersona] = useState<string | null>(null);
```

Then in the existing first `useEffect`, after `void refreshCommitment();`, add:

```tsx
// Pick up debug flag from URL or localStorage
if (typeof window !== 'undefined') {
  const params = new URLSearchParams(window.location.search);
  const flag = params.get('debug') === '1' || window.localStorage.getItem('casino_debug') === '1';
  setDebugMode(flag);
  if (flag) {
    window.localStorage.setItem('casino_debug', '1');
    setDebugToken(window.localStorage.getItem('casino_debug_token') ?? '');
    setActivePersona(window.localStorage.getItem('casino_player_id'));
  }
}
```

Add a function to fetch personas:

```tsx
async function fetchPersonas() {
  if (!debugToken) return;
  try {
    const res = await fetch('/api/dev/players', {
      headers: { 'X-Debug-Token': debugToken },
    });
    if (!res.ok) throw new Error(`personas ${res.status}`);
    const body = await res.json();
    setPersonas(body.players);
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e));
  }
}

function selectPersona(id: string | null) {
  if (id) {
    window.localStorage.setItem('casino_player_id', id);
  } else {
    window.localStorage.removeItem('casino_player_id');
  }
  setActivePersona(id);
  // Reload to re-fetch commitment + balance for the new player
  window.location.reload();
}
```

In the `<header>` block, add a picker (only when `debugMode` is true):

```tsx
{debugMode && (
  <div className="flex items-center gap-2 text-sm">
    {personas.length === 0 ? (
      <>
        <input
          type="password"
          placeholder="debug token"
          value={debugToken}
          onChange={(e) => {
            setDebugToken(e.target.value);
            window.localStorage.setItem('casino_debug_token', e.target.value);
          }}
          className="rounded bg-slate-800 border border-slate-700 px-2 py-1"
        />
        <button
          onClick={fetchPersonas}
          className="rounded bg-slate-700 px-2 py-1"
        >
          load personas
        </button>
      </>
    ) : (
      <select
        value={activePersona ?? ''}
        onChange={(e) => selectPersona(e.target.value || null)}
        className="rounded bg-slate-800 border border-slate-700 px-2 py-1 font-mono"
      >
        <option value="">— anonymous —</option>
        {personas.map((p) => (
          <option key={p.id} value={p.id}>
            {p.personaKind} · 🪙 {p.balance} · {p.id.slice(0, 8)}
          </option>
        ))}
      </select>
    )}
  </div>
)}
```

- [ ] **Step 4: Smoke-test**

```powershell
pnpm --filter @casino/web dev
```

Open http://localhost:3000/play/coin-flip?debug=1 — the picker should appear in the header. Enter `local-dev-debug` as the token, click "load personas". Pick a persona; the page reloads with the picked player's balance. Switching back to "— anonymous —" reverts.

(Note: at this point you'll only have a few auto-created anonymous players. Plan 7 will seed many.)

Stop dev server.

- [ ] **Step 5: Commit**

```powershell
git add apps/casino/app/api/dev/players apps/casino/app/play/coin-flip/page.tsx
git commit -m "feat(ui): debug persona picker + GET /api/dev/players (token-gated)"
```

---

# Block G — Integration tests

## Task 17: Integration test — happy path (`coin-flip-bet.test.ts`)

**Why:** Exercises the full GET commitment → POST bet flow against the real DB. Verifies wiring (route handlers + handler + transaction + treasury moves + Prisma client). Does NOT assert win/loss — handler unit tests already cover deterministic math.

**Files:**
- Create: `apps/casino/tests/coin-flip-bet.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@casino/db';
import { GET as GET_COMMITMENT } from '../app/api/coin-flip/commitment/route';
import { POST as POST_BET } from '../app/api/coin-flip/bet/route';

// Stub out next/headers since we're calling route handlers directly outside a real request.
// The session helper reads cookies() and headers(); we set up a fake player manually instead.
import { vi } from 'vitest';

let testPlayerId: string;

beforeAll(async () => {
  // Ensure seed wallets exist (idempotent — Task 5's seed script may already have run)
  for (const w of [
    { name: 'operating',      kind: 'operating'      as const, balance: 100_000n },
    { name: 'payout_reserve', kind: 'payout_reserve' as const, balance: 800_000n },
    { name: 'marketing_pool', kind: 'marketing_pool' as const, balance:  50_000n },
    { name: 'runway',         kind: 'runway'         as const, balance:  50_000n },
    { name: 'player_pool',    kind: 'player_pool'    as const, balance:       0n },
  ]) {
    await prisma.treasuryWallet.upsert({
      where: { name: w.name },
      update: {},
      create: w,
    });
  }
  // Ensure coin-flip Game row exists
  await prisma.game.upsert({
    where: { id: 'coin-flip' },
    update: {},
    create: {
      id: 'coin-flip',
      kind: 'coin_flip',
      version: 1,
      mathConfig: {
        kind: 'coin_flip',
        version: 1,
        payoutMultiplier: 1.98,
        minStake: 10,
        maxStake: 10000,
        rngBytes: 32,
        sides: ['heads', 'tails'],
      },
    },
  });
  // Create a test player with a known balance, deposit chips from operating
  const player = await prisma.player.create({
    data: { personaKind: 'lurker', balance: 5000n },
  });
  testPlayerId = player.id;
  await prisma.treasuryWallet.update({
    where: { name: 'operating' },
    data: { balance: { decrement: 5000n } },
  });
  await prisma.treasuryWallet.update({
    where: { name: 'player_pool' },
    data: { balance: { increment: 5000n } },
  });
});

afterAll(async () => {
  // Cleanup test player + their bets/commitments
  await prisma.bet.deleteMany({ where: { playerId: testPlayerId } });
  await prisma.commitment.deleteMany({ where: { playerId: testPlayerId } });
  await prisma.player.delete({ where: { id: testPlayerId } });
  await prisma.$disconnect();
});

// Mock the session helper to return our test player
vi.mock('../lib/games/session', () => ({
  resolvePlayerId: async () => testPlayerId,
}));

describe('coin-flip happy path (integration)', () => {
  it('GET /api/coin-flip/commitment returns a commitment', async () => {
    const res = await GET_COMMITMENT();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.commitmentId).toBe('string');
    expect(typeof body.commitmentHash).toBe('string');
    expect(body.commitmentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('POST /api/coin-flip/bet settles and returns the full result', async () => {
    // Fresh commitment
    const cmRes = await GET_COMMITMENT();
    const { commitmentId } = await cmRes.json();

    const req = new Request('http://localhost/api/coin-flip/bet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commitmentId, stake: 100, side: 'heads' }),
    });
    const res = await POST_BET(req as any);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(['heads', 'tails']).toContain(body.outcome);
    expect(typeof body.payout).toBe('string');
    expect(typeof body.balance).toBe('string');
    expect(body.revealedSeed).toMatch(/^[0-9a-f]{64}$/);
    expect(body.commitmentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.nextCommitment.hash).toMatch(/^[0-9a-f]{64}$/);

    // DB state checks
    const bet = await prisma.bet.findUnique({ where: { id: body.betId } });
    expect(bet).not.toBeNull();
    expect(bet?.playerId).toBe(testPlayerId);
    expect(bet?.commitmentId).toBe(commitmentId);

    const consumed = await prisma.commitment.findUnique({ where: { id: commitmentId } });
    expect(consumed?.consumedAt).not.toBeNull();
    expect(consumed?.betId).toBe(body.betId);

    const next = await prisma.commitment.findUnique({ where: { id: body.nextCommitment.id } });
    expect(next?.consumedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test**

```powershell
pnpm --filter @casino/web test coin-flip-bet
```

Expected: PASS (2 tests).

- [ ] **Step 3: Commit**

```powershell
git add apps/casino/tests/coin-flip-bet.test.ts
git commit -m "test(integration): coin-flip happy path (GET commitment + POST bet)"
```

---

## Task 18: Integration test — validation error paths

**Files:**
- Create: `apps/casino/tests/coin-flip-bet-validation.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@casino/db';
import { GET as GET_COMMITMENT } from '../app/api/coin-flip/commitment/route';
import { POST as POST_BET } from '../app/api/coin-flip/bet/route';

let testPlayerId: string;

beforeAll(async () => {
  // Reuse fixture-setup pattern (idempotent)
  for (const w of [
    { name: 'operating',      kind: 'operating'      as const, balance: 100_000n },
    { name: 'payout_reserve', kind: 'payout_reserve' as const, balance: 800_000n },
    { name: 'marketing_pool', kind: 'marketing_pool' as const, balance:  50_000n },
    { name: 'runway',         kind: 'runway'         as const, balance:  50_000n },
    { name: 'player_pool',    kind: 'player_pool'    as const, balance:       0n },
  ]) {
    await prisma.treasuryWallet.upsert({
      where: { name: w.name },
      update: {},
      create: w,
    });
  }
  await prisma.game.upsert({
    where: { id: 'coin-flip' },
    update: {},
    create: {
      id: 'coin-flip',
      kind: 'coin_flip',
      version: 1,
      mathConfig: {
        kind: 'coin_flip',
        version: 1,
        payoutMultiplier: 1.98,
        minStake: 10,
        maxStake: 10000,
        rngBytes: 32,
        sides: ['heads', 'tails'],
      },
    },
  });
  const player = await prisma.player.create({
    data: { personaKind: 'lurker', balance: 50n },  // intentionally low for the insufficient-balance test
  });
  testPlayerId = player.id;
});

afterAll(async () => {
  await prisma.bet.deleteMany({ where: { playerId: testPlayerId } });
  await prisma.commitment.deleteMany({ where: { playerId: testPlayerId } });
  await prisma.player.delete({ where: { id: testPlayerId } });
  await prisma.$disconnect();
});

vi.mock('../lib/games/session', () => ({
  resolvePlayerId: async () => testPlayerId,
}));

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/coin-flip/bet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('coin-flip validation (integration)', () => {
  it('returns 400 on missing fields', async () => {
    const res = await POST_BET(makeReq({}) as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 on stake below minStake', async () => {
    const cm = await GET_COMMITMENT().then((r) => r.json());
    const res = await POST_BET(
      makeReq({ commitmentId: cm.commitmentId, stake: 5, side: 'heads' }) as any,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 on stake above maxStake', async () => {
    const cm = await GET_COMMITMENT().then((r) => r.json());
    const res = await POST_BET(
      makeReq({ commitmentId: cm.commitmentId, stake: 99999, side: 'heads' }) as any,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 on insufficient balance', async () => {
    const cm = await GET_COMMITMENT().then((r) => r.json());
    const res = await POST_BET(
      makeReq({ commitmentId: cm.commitmentId, stake: 100, side: 'heads' }) as any,
    );
    expect(res.status).toBe(400);  // player has only 50 chips
  });

  it('returns 409 on missing commitmentId', async () => {
    const res = await POST_BET(
      makeReq({ commitmentId: 'does-not-exist', stake: 50, side: 'heads' }) as any,
    );
    expect(res.status).toBe(409);
  });

  it('returns 409 on already-consumed commitment', async () => {
    // Top up the player's balance so the bet itself doesn't 400 on balance
    await prisma.player.update({
      where: { id: testPlayerId },
      data: { balance: 500n },
    });
    await prisma.treasuryWallet.update({
      where: { name: 'operating' },
      data: { balance: { decrement: 450n } },
    });
    await prisma.treasuryWallet.update({
      where: { name: 'player_pool' },
      data: { balance: { increment: 450n } },
    });

    const cm = await GET_COMMITMENT().then((r) => r.json());
    const first = await POST_BET(
      makeReq({ commitmentId: cm.commitmentId, stake: 50, side: 'heads' }) as any,
    );
    expect(first.status).toBe(200);

    const second = await POST_BET(
      makeReq({ commitmentId: cm.commitmentId, stake: 50, side: 'heads' }) as any,
    );
    expect(second.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run the test**

```powershell
pnpm --filter @casino/web test coin-flip-bet-validation
```

Expected: PASS (6 tests).

- [ ] **Step 3: Commit**

```powershell
git add apps/casino/tests/coin-flip-bet-validation.test.ts
git commit -m "test(integration): coin-flip validation error paths"
```

---

## Task 19: Integration test — treasury invariant

**Why:** Asserts that after N bets, the sum of all wallet balances equals the post-test-setup expected total. Catches accounting bugs (forgot to debit one wallet, double-credit, etc.).

**Files:**
- Create: `apps/casino/tests/treasury-invariant.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@casino/db';
import { auditTreasury } from '../lib/games/audit';
import { GET as GET_COMMITMENT } from '../app/api/coin-flip/commitment/route';
import { POST as POST_BET } from '../app/api/coin-flip/bet/route';

let testPlayerId: string;
let initialTotal: bigint;

beforeAll(async () => {
  // Ensure base wallets + game row exist (idempotent)
  for (const w of [
    { name: 'operating',      kind: 'operating'      as const, balance: 100_000n },
    { name: 'payout_reserve', kind: 'payout_reserve' as const, balance: 800_000n },
    { name: 'marketing_pool', kind: 'marketing_pool' as const, balance:  50_000n },
    { name: 'runway',         kind: 'runway'         as const, balance:  50_000n },
    { name: 'player_pool',    kind: 'player_pool'    as const, balance:       0n },
  ]) {
    await prisma.treasuryWallet.upsert({
      where: { name: w.name },
      update: {},
      create: w,
    });
  }
  await prisma.game.upsert({
    where: { id: 'coin-flip' },
    update: {},
    create: {
      id: 'coin-flip',
      kind: 'coin_flip',
      version: 1,
      mathConfig: {
        kind: 'coin_flip',
        version: 1,
        payoutMultiplier: 1.98,
        minStake: 10,
        maxStake: 10000,
        rngBytes: 32,
        sides: ['heads', 'tails'],
      },
    },
  });
  const player = await prisma.player.create({
    data: { personaKind: 'lurker', balance: 10_000n },
  });
  testPlayerId = player.id;
  await prisma.treasuryWallet.update({
    where: { name: 'operating' },
    data: { balance: { decrement: 10_000n } },
  });
  await prisma.treasuryWallet.update({
    where: { name: 'player_pool' },
    data: { balance: { increment: 10_000n } },
  });

  // Capture the total RIGHT NOW (after our test player grant) so we can verify it stays constant.
  const audit = await auditTreasury();
  initialTotal = audit.totalChips;
});

afterAll(async () => {
  await prisma.bet.deleteMany({ where: { playerId: testPlayerId } });
  await prisma.commitment.deleteMany({ where: { playerId: testPlayerId } });
  const player = await prisma.player.findUnique({ where: { id: testPlayerId } });
  if (player) {
    // Return their balance back to operating to keep the invariant for OTHER tests
    await prisma.treasuryWallet.update({
      where: { name: 'player_pool' },
      data: { balance: { decrement: player.balance } },
    });
    await prisma.treasuryWallet.update({
      where: { name: 'operating' },
      data: { balance: { increment: player.balance } },
    });
    await prisma.player.delete({ where: { id: testPlayerId } });
  }
  await prisma.$disconnect();
});

vi.mock('../lib/games/session', () => ({
  resolvePlayerId: async () => testPlayerId,
}));

async function placeOneBet(stake: number, side: 'heads' | 'tails') {
  const cm = await GET_COMMITMENT().then((r) => r.json());
  const req = new Request('http://localhost/api/coin-flip/bet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commitmentId: cm.commitmentId, stake, side }),
  });
  const res = await POST_BET(req as any);
  expect(res.status).toBe(200);
}

describe('treasury invariant', () => {
  it('total chips remains constant across 20 bets', async () => {
    for (let i = 0; i < 20; i++) {
      const side = i % 2 === 0 ? 'heads' : 'tails';
      await placeOneBet(50, side);
    }
    const after = await auditTreasury();
    expect(after.totalChips).toBe(initialTotal);
  });
});
```

- [ ] **Step 2: Run the test**

```powershell
pnpm --filter @casino/web test treasury-invariant
```

Expected: PASS.

- [ ] **Step 3: Commit**

```powershell
git add apps/casino/tests/treasury-invariant.test.ts
git commit -m "test(integration): treasury invariant holds across many bets"
```

---

## Plan-completion verification

After Task 19, run all of these and confirm exit 0:

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm --filter @casino/db test
pnpm --filter @casino/web test
pnpm --filter @casino/dashboard test
```

Smoke-test the playable URL in a browser: http://localhost:3000/play/coin-flip — place 5 bets, verify the commitment hash updates after each, click "Verify externally →" and confirm the verify page shows ✓ ✓.

Push to main; both Vercel deploys should turn green. Open the production casino URL + `/play/coin-flip` and play a few bets against the real Neon DB.

If everything's green: Plan 2 done. Plan 3 (roulette) will lean on the `GameHandler` contract, the rolling commitment pattern, and the treasury ledger established here.

---

## Open items deferred to later plans

- **Per-bet hash-chain commit-reveal** — useful for high-frequency games (slots, dice). Add when a game lands that justifies it (likely Plan 3 or later).
- **Real auth** (Sign in with Vercel, magic link) — deferred until the experiment justifies it.
- **Coin flip animation / sounds / polish** — easy to bolt on later; CSS-only animation is a one-file change.
- **Multi-game lobby** — Plan 3 introduces a second game and may add a lobby page at `/`.
- **CI test database** — still excluded from CI (per Plan 1). Plan 4 will revisit when wiring the agent runtime needs per-PR DB branches.
- **Generic dispatcher route** `/api/games/[gameId]/bet` — defer to Plan 3 if the second game shape makes it worth the abstraction.
