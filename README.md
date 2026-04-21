# TraceGraph

**Open-source corporate intelligence engine.** Enter a company name, get a full risk report with graph visualization, sanctions screening, PEP detection, financial analysis, and AI-powered narrative.

25+ intelligence sources | US, UK, India | Batch screening | Watchlist monitoring

---

## What it does

1. **Search** any company across US, UK, India, and 20+ jurisdictions
2. **Expand** the ownership network — directors, subsidiaries, addresses
3. **Enrich** from 25+ public data sources (SEC, NSE, Wikidata, OFAC, courts, etc.)
4. **Score** risk using 15+ anomaly detectors
5. **Generate** an AI-powered risk narrative with actionable recommendations

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Next.js Frontend (port 3000)                            │
│  Search · Graph Viz · Risk Report · Batch · Compare      │
├──────────────────────────────────────────────────────────┤
│  NestJS API (port 4000)                                  │
│  ┌────────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐ │
│  │Investigation│ │Enrichment│ │ Risk     │ │ Report    │ │
│  │ Processor  │ │ (25+src) │ │ Scoring  │ │ Generator │ │
│  └─────┬──────┘ └────┬─────┘ └────┬─────┘ └───────────┘ │
│        │ BullMQ      │            │                      │
├────────┼─────────────┼────────────┼──────────────────────┤
│  PostgreSQL    │  Redis      │  Neo4j (optional)         │
│  (entities +   │  (queue +   │  (graph algorithms)       │
│   graph nodes) │   cache)    │                           │
└──────────────────────────────────────────────────────────┘
```

## Intelligence Sources (25+)

| Source | Data | Jurisdiction |
|--------|------|-------------|
| SEC EDGAR | Company profile, Form 4 officers, 10-K, 8-K, DEF 14A | US |
| SEC XBRL | Revenue, profit margin, debt/equity, current ratio | US |
| NSE India | Shareholding pattern, financials, announcements | India |
| Wikidata | HQ, key people, subsidiaries, revenue, industry | All |
| OFAC SDN | US sanctions (26K+ names) | All |
| UK HMT | UK sanctions (12K+ names) | All |
| EU Sanctions | EU consolidated list (via OpenSanctions) | All |
| OpenSanctions | 4.1M sanctions/PEP/watchlist entities | All |
| ICIJ OffshoreLeaks | 770K+ offshore entities | All |
| PEP Detection | Political positions via Wikidata P39 | All |
| GDELT | Adverse media screening (30+ keywords) | All |
| CourtListener | US federal court cases | US |
| Indian Kanoon | Indian court cases | India |
| FEC | Political donations | US |
| Wayback Machine | Historical website age analysis | All |
| FATF | Grey/blacklist jurisdiction risk | All |
| EPA ECHO | Environmental violations | US |
| OSHA | Workplace safety violations | US |
| CFPB | Consumer complaints | US |
| Address Verification | Virtual office/formation agent detection | All |
| Website Verification | Domain age, SSL, parked detection | All |
| Google Patents | Patent portfolio | US |
| LinkedIn | Employee count, industry (via DuckDuckGo) | All |
| AI Narrative | LLM-generated risk summary (OpenRouter) | All |

## Quick Start

### Prerequisites
- Node.js 18+
- Docker and Docker Compose
- npm 9+

### Setup

```bash
# Clone
git clone https://github.com/anmolbhardwaj17/tracegraph.git
cd tracegraph

# Install dependencies
npm install

# Start infrastructure (PostgreSQL, Redis, Neo4j)
docker compose up -d postgres redis neo4j

# Copy environment file
cp .env.example .env
# Edit .env with your keys (see Environment Variables below)

# Run database migrations
cd apps/api && npm run migration:run

# Start both servers (from root)
cd ../.. && npm run dev
```

### Access
- **Frontend:** http://localhost:3000
- **API:** http://localhost:4000
- **Swagger Docs:** http://localhost:4000/api/docs

## API Endpoints

### Investigations
```bash
# Create investigation
POST /api/investigations
{ "query": "Amazon", "jurisdiction": "us", "tier": "STANDARD" }

# Get results
GET /api/investigations/:id

# Get overview (score, intelligence, narrative)
GET /api/investigations/:id/overview

# Compare investigations
GET /api/investigations/compare?ids=id1,id2

# Export PDF
POST /api/investigations/:id/export
```

### Batch Screening
```bash
# Screen up to 500 companies
POST /api/batch
{ "companies": ["Apple", "Microsoft", "Tesla"], "tier": "QUICK", "jurisdiction": "us" }

# Check results
GET /api/batch/:id
```

### Watchlist
```bash
# Add to watchlist
POST /api/watchlist
{ "companyNumber": "00445790", "companyName": "Tesco PLC" }

# Trigger monitoring
POST /api/watchlist/monitor

# Get alerts
GET /api/watchlist/alerts/list
```

## Environment Variables

```bash
# Required
POSTGRES_HOST=localhost
POSTGRES_PORT=5433
POSTGRES_USER=tracegraph
POSTGRES_PASSWORD=tracegraph
POSTGRES_DB=tracegraph
REDIS_HOST=localhost
REDIS_PORT=6379
PORT=4000

# Optional
COMPANIES_HOUSE_API_KEY=     # UK Companies House (free — get at developer.company-information.service.gov.uk)
OPENROUTER_API_KEY=          # AI narrative (OpenRouter)
OPENROUTER_MODEL=google/gemini-2.0-flash-001
NEXT_PUBLIC_API_URL=http://localhost:4000
```

## Investigation Tiers

| Tier | Depth | Max Nodes | Sources | Typical Time |
|------|-------|-----------|---------|-------------|
| QUICK | 1 hop | 200 | Basic profile | 30s - 2min |
| STANDARD | 2 hops | 1,000 | All 25+ | 2 - 5min |
| DEEP | 3 hops | 5,000 | All, no filtering | 10 - 30min |

## India Data

Indian company investigations use three data layers:
1. **NSE India API** — live stock data for listed companies (shareholding, financials)
2. **Tofler + DuckDuckGo** — company profiles for any Indian company
3. **Local MCA database** — auto-populates as companies are investigated

Optional bulk import from MCA:
```bash
# Download CSVs from mca.gov.in > Data & Reports > Company/LLP Information
# Place in apps/api/data/india/
cd apps/api && npm run ingest:india
```

## Tech Stack

- **Backend:** NestJS + TypeScript
- **Frontend:** Next.js 14 + React 18 + Tailwind CSS
- **Database:** PostgreSQL 16
- **Cache/Queue:** Redis 7 + BullMQ
- **Graph Viz:** D3.js force-directed layout
- **Monorepo:** Turborepo

## Project Structure

```
tracegraph/
├── apps/
│   ├── api/                     # NestJS backend
│   │   └── src/
│   │       ├── modules/
│   │       │   ├── investigation/   # Pipeline orchestrator
│   │       │   ├── enrichment/      # 25+ intelligence services
│   │       │   ├── graph/           # Graph construction
│   │       │   ├── anomaly/         # 15+ risk detectors
│   │       │   ├── batch/           # Batch screening
│   │       │   ├── watchlist/       # Monitoring + alerts
│   │       │   ├── india/           # MCA data + search
│   │       │   └── report/          # PDF generation
│   │       └── common/
│   │           ├── redis/           # Redis cache
│   │           ├── cache/           # Enrichment cache
│   │           ├── rate-limiter/    # API rate coordination
│   │           └── resilience/      # Circuit breakers
│   └── web/                     # Next.js frontend
│       ├── app/
│       │   ├── page.tsx             # Landing + search
│       │   ├── investigate/[id]/    # Investigation results
│       │   ├── compare/             # Side-by-side comparison
│       │   └── dashboard/           # Investigation list
│       └── components/
│           ├── GraphVisualization.tsx
│           ├── ProgressView.tsx
│           └── Insights.tsx
├── packages/shared/             # Shared types
├── docker-compose.yml
└── .env.example
```

## License

MIT
