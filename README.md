# TraceGraph

**Open-source M&A due diligence engine.** Enter an acquisition target, get a complete DD package: ownership chains, sanctions screening, director track records, capital history, an AI-generated IC memo, and an interactive network graph — all from public data.

Built for mid-market PE, M&A advisors, corporate development teams, and family offices who need bank-grade intelligence without the bank-grade price tag.

---

## What it does

- **Ownership & UBO** — traces beneficial ownership through every offshore layer to the real controller
- **Director track records** — every company a founder has run, outcomes (active/dissolved/acquired), co-director networks
- **Sanctions & PEP screening** — OFAC, UK HMT, OpenSanctions, EU lists across the full corporate network
- **Capital history** — UK SH01 allotments and SEC Form D raises surfaced automatically
- **IC Memo generator** — one-click investment committee memo with deal verdict, risk profile, and next-step DD scope
- **Deal pipeline** — kanban board to track acquisition targets from sourcing through closing
- **Tracey AI** — senior M&A analyst built into every investigation, answers in deal language not compliance jargon
- **Team collaboration** — share investigations, add notes, invite colleagues
- **Watchlist & alerts** — automated monitoring with email alerts on risk score changes, new sanctions, new litigation

---

## Quick start

### Option 1: Docker (recommended)

```bash
git clone https://github.com/yourusername/tracegraph
cd tracegraph
cp .env.example .env
# Edit .env — add COMPANIES_HOUSE_API_KEY and OPENROUTER_API_KEY (both free)
docker-compose up
```

Open http://localhost:3000 — the app is ready.

> **First run:** migrations run automatically. The setup wizard at `/setup` shows which features are active.

### Option 2: Local development

```bash
git clone https://github.com/yourusername/tracegraph
cd tracegraph
cp .env.example .env
# Edit .env — add your keys
npm install

# Start infrastructure
docker-compose up postgres redis -d

# Start API and web
npm run dev
```

API runs on http://localhost:7778, web on http://localhost:3000.

---

## Configuration

Two keys are required for core functionality. Everything else is optional.

| Variable | Required | Where to get | What it unlocks |
|---|---|---|---|
| `COMPANIES_HOUSE_API_KEY` | Yes | [developer.company-information.service.gov.uk](https://developer.company-information.service.gov.uk/) | UK company investigations (free) |
| `OPENROUTER_API_KEY` | Yes | [openrouter.ai/keys](https://openrouter.ai/keys) | Tracey AI chat + IC memo generation (free tier) |
| `JWT_SECRET` | Yes (prod) | Random string | Auth token signing |
| `RESEND_API_KEY` | Optional | [resend.com](https://resend.com) | Watchlist email alerts (100/day free) |
| `OPENCORPORATES_API_KEY` | Optional | [opencorporates.com](https://opencorporates.com/api_accounts/new) | Non-UK company coverage |
| `GOOGLE_CLIENT_ID` | Optional | Google Cloud Console | Login with Google |

Full list: see `.env.example`

---

## Architecture

```
tracegraph/
├── apps/
│   ├── api/          NestJS backend — 25+ enrichment modules, BullMQ pipeline
│   └── web/          Next.js frontend — investigation UI, graph, pipeline
├── packages/
│   └── shared/       Shared TypeScript types
├── docker-compose.yml
└── .env.example
```

**Stack:** NestJS · Next.js · PostgreSQL 16 · Redis 7 · Turborepo

**Data sources:** Companies House (UK) · SEC EDGAR (US) · OpenSanctions · ICIJ OffshoreLeaks · OFAC · UK HMT · Wikidata · CourtListener · GDELT · Wayback Machine · GLEIF · OpenCorporates · India MCA · France SIRENE · Germany NorthData

---

## Investigation tiers

| Tier | Time | Entities | Sources | Best for |
|---|---|---|---|---|
| **Initial Screen** (free) | 30s–2min | Up to 200 | Companies House only | First look at a target |
| **Standard DD** | 2–10min | Up to 1,000 | All sources + full anomaly detection | Standard pre-LOI DD |
| **Full DD + Memo** | 10–45min | Up to 5,000 | Enhanced resolution + extra signals | Full acquisition DD, IC memo included |

---

## Self-hosting notes

- **Neo4j is optional** — start without it: `docker-compose up` (without `--profile graph`)
- **Migrations run automatically** on startup — no manual step needed
- **Setup wizard** at `/setup` shows which features are active based on your env vars
- **Port:** API on 7778, Web on 3000, Postgres on 5433 (host) → 5432 (container)
- **Sensitive data:** all investigation data stays in your PostgreSQL instance

---

## Development

```bash
# Run all tests
npm run test

# Type-check
npx tsc --noEmit --project apps/api/tsconfig.json
npx tsc --noEmit --project apps/web/tsconfig.json

# Run a specific migration manually (if needed)
cd apps/api && npx typeorm-ts-node-commonjs migration:run -d src/data-source.ts
```

---

## Releasing

Tag a commit to trigger Docker image publish to GitHub Container Registry:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Images published to `ghcr.io/yourusername/tracegraph-api:v1.0.0` and `ghcr.io/yourusername/tracegraph-web:v1.0.0`.

---

## License

MIT — use it, fork it, self-host it.
