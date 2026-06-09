# Pachangas Fishing — competition standings

App to automate fishing-competition standings (individual and pairs) with AI
reading of scorecards via WhatsApp. See [`PRD.md`](./PRD.md).

> The PRD and issue files (`.scratch/`) are written in Spanish (the product
> spec); the **code** uses an English domain vocabulary. Glossary:
> `manga→round`, `plica→scorecard`, `pieza→catch`, `pescador→angler`,
> `pareja→pair`, `dorsal→bib`, `inscripción→entry`, `reclamación→claim`,
> `auditoría→audit_log`.

## Stack

- **Next.js 15 (App Router) + TypeScript** — web, API and webhooks (single monorepo).
- **Supabase** — Postgres, Auth (committee only), private Storage (scorecard photos).
- **Declarative rules engine** (`src/domain`) — pure, I/O-free, tested with Vitest.

## Local setup

```bash
npm install
cp .env.example .env.local        # fill in with your Supabase project
npx supabase start                # Postgres + Auth + Storage locally (needs Docker)
npx supabase db reset             # applies supabase/migrations + seed.sql
npm run dev                       # http://localhost:3000
```

Create a committee user in Supabase Auth (Studio → Authentication) to sign in at
`/admin`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm test` | Domain + utility tests (Vitest) |
| `npm run typecheck` | `tsc --noEmit` |

## Structure

```
src/
├── domain/              # PURE, tested core (no Next/Supabase)
│   ├── scoring.ts          # slice 04: points per catch (declarative)
│   ├── ranking.ts          # slice 05: sum of placings + FEPyC tiebreaks
│   ├── pairs.ts            # slice 06: pairs standings
│   ├── validation.ts       # slice 08: checksum validation
│   ├── reading-schema.ts   # slice 07: AI reading JSON contract (zod)
│   └── round-status.ts     # slice 12: round state machine
├── lib/
│   ├── standings.ts        # assembles DB → domain (computes standings)
│   ├── data.ts             # server loaders (Supabase)
│   ├── ai/reader.ts        # ScorecardReader interface + mock (real model: HITL)
│   ├── whatsapp/           # number whitelist + payload parsing
│   └── supabase/           # server/browser clients + DB types
├── app/
│   ├── page.tsx            # public landing (rounds)
│   ├── round/[id]/         # public live standings (polling 20s)
│   ├── admin/              # committee (auth): roster, scorecards, HITL queue, states
│   └── api/                # standings (polling) + WhatsApp webhook
└── middleware.ts           # protects /admin (Supabase Auth)
supabase/migrations/        # 0001 core · 0002 roster · 0003 scorecards · 0004 storage · 0005 claims+audit
```

## Implementation status (by PRD slice)

| Slice | Status |
|---|---|
| 01 Skeleton + model + empty standings | ✅ code (Supabase provisioning pending) |
| 02 Round roster | ✅ |
| 03 Manual scorecard entry + photo | ✅ |
| 04 Rules engine (points per catch) | ✅ tested |
| 05 Sum of placings + individual | ✅ tested |
| 06 Pairs standings | ✅ tested |
| 07 AI reading → JSON | ⚙️ schema + mock reader (real model = HITL) |
| 08 Checksum validation | ✅ tested |
| 09 Committee HITL queue | ✅ |
| 10 WhatsApp webhook + queue | ⚙️ skeleton (verify + 200 + whitelist); Meta + queue pending |
| 11 Quality-loop bot | ⛔ blocked by 10 |
| 12 Provisional→final states + audit | ✅ (appeals-window duration to be set) |
| 13 Push summary to the group | ⛔ blocked by 10 |

What is pending needs your input: see the manual tasks the agent left you.
