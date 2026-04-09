# TraceGraph

```
████████ ██████   █████   ██████ ███████  ██████  ██████   █████  ██████  ██   ██
   ██    ██   ██ ██   ██ ██      ██      ██       ██   ██ ██   ██ ██   ██ ██   ██
   ██    ██████  ███████ ██      █████   ██   ███ ██████  ███████ ██████  ███████
   ██    ██   ██ ██   ██ ██      ██      ██    ██ ██   ██ ██   ██ ██      ██   ██
   ██    ██   ██ ██   ██  ██████ ███████  ██████  ██   ██ ██   ██ ██      ██   ██
```

**Open-source corporate intelligence engine — enter a company, get a complete risk report.**

TraceGraph autonomously investigates UK companies by walking ownership and director networks across multiple public data sources, then surfaces shell-company patterns, sanctions exposure, and structural anomalies in a single interactive report.

---

## Features

- **Multi-source intelligence** — UK Companies House (live API), OpenSanctions (FollowTheMoney), and ICIJ OffshoreLeaks (Panama / Paradise / Pandora Papers) unified into one network view.
- **Recursive graph expansion** — BFS through directors, PSCs, and addresses with cycle detection, deduplication, and large-corp pruning.
- **Entity resolution** — name normalization, Double Metaphone phonetic keys, Jaro-Winkler fuzzy matching, and DOB/nationality scoring with explainable evidence.
- **Anomaly detection** — shell-company scoring, virtual-office address clustering, circular ownership detection (DFS back-edge), Louvain community detection, bridge-node identification, and temporal anomalies (mass incorporation, rapid dissolution, pre-event resignations).
- **Risk scoring** — every signal aggregated into a 0–100 score with severity-weighted findings (CRITICAL / HIGH / MEDIUM / LOW), each carrying evidence and a recommendation.
- **Interactive D3 graph** — force-directed visualization with type-colored nodes, risk-colored borders, hover tooltips, click-to-inspect side panels, and zoom/pan/drag.
- **Real-time progress** — WebSocket-streamed expansion, resolution, and scoring updates with a live counter and mini graph preview.
- **PDF export** — A4 report with risk gauge, executive summary, findings, matches, and discovered entities.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                            Next.js (apps/web)                       │
│        Search · D3 Graph · Tabbed Report · Live Progress · PDF      │
└──────────────────┬──────────────────────────────────┬───────────────┘
                   │ REST + WebSocket                 │ PDF download
┌──────────────────▼──────────────────────────────────▼───────────────┐
│                           NestJS API (apps/api)                     │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │ Investiga-  │→ │ Companies   │→ │ Graph        │→ │ Entity    │  │
│  │ tion ctrl   │  │ House       │  │ Expansion    │  │ Resolution│  │
│  │ (BullMQ)    │  │ (rate-lim)  │  │ (BFS + dedup)│  │ (M+JW+DOB)│  │
│  └─────────────┘  └─────────────┘  └──────┬───────┘  └─────┬─────┘  │
│                                           ▼                ▼        │
│                              ┌────────────────┐  ┌────────────────┐ │
│                              │ Anomaly        │  │ Risk Scoring   │ │
│                              │ shell/cycle/   │  │ findings → 0-100│ │
│                              │ temporal/comm. │  └────┬────────────┘ │
│                              └────────────────┘       │              │
│                                                       ▼              │
│                                              ┌──────────────┐        │
│                                              │ PDF Report   │        │
│                                              └──────────────┘        │
└──────────┬─────────────────────┬─────────────────────┬───────────────┘
           │                     │                     │
      ┌────▼────┐          ┌─────▼─────┐         ┌─────▼─────┐
      │ Postgres│          │   Redis   │         │  Neo4j    │
      │ + pg_trgm│          │ BullMQ +  │         │ (reserved │
      │         │          │   cache   │         │  Phase 4+)│
      └─────────┘          └───────────┘         └───────────┘
```

---

## Tech stack

| Layer       | Choice                                     |
| ----------- | ------------------------------------------ |
| Backend     | NestJS · TypeScript                        |
| Frontend    | Next.js 14 · React 18 · Tailwind CSS · D3  |
| Queue       | BullMQ (Redis)                             |
| Primary DB  | PostgreSQL 16 + `pg_trgm`                  |
| Graph DB    | Neo4j 5 Community (reserved for expansion) |
| Cache       | Redis 7                                    |
| Realtime    | Socket.IO via @nestjs/websockets           |
| PDF         | PDFKit                                     |
| Monorepo    | Turborepo                                  |

---

## Quick start

```bash
git clone https://github.com/yourname/tracegraph
cd tracegraph
cp .env.example .env
docker compose up -d
# wait for postgres to be healthy, then:
cd apps/api && npm run migration:run && npm run seed:demo
# open http://localhost:3000
```

Click the seeded **DEMO: Petrov Holdings UK Ltd** investigation in the recent list to explore the full feature set without an API key.

To run live investigations, get a free Companies House API key from https://developer.company-information.service.gov.uk/ and set `COMPANIES_HOUSE_API_KEY` in `.env`.

---

## Screenshots

> *(Replace these descriptions with real screenshots after first run.)*

1. **Home / search** — Hero, search bar, three feature cards, recent investigations list with risk pills.
2. **Investigation overview tab** — Circular SVG risk gauge, six stat cards, top 3 critical findings.
3. **Graph tab** — Full-width D3 force-directed network with colored nodes, risk borders, side panel showing the selected entity's details.
4. **Findings tab** — Severity-sorted expandable rows with evidence and recommendations.
5. **Matches tab** — Cross-source matches with OpenSanctions / ICIJ badges and confidence pills.
6. **Live progress** — 5-stage indicator, live counters, mini graph that grows during expansion.

---

## Data sources

| Source                    | Type      | Coverage                                         |
| ------------------------- | --------- | ------------------------------------------------ |
| UK Companies House        | Live API  | Company profiles, officers, PSC, filing history  |
| OpenSanctions             | Bulk JSON | Global sanctions, PEPs, criminal entities (FtM)  |
| ICIJ OffshoreLeaks        | Bulk CSV  | Panama / Paradise / Pandora Papers, Bahamas Leaks|

All sources are **public**. TraceGraph never scrapes, never uses leaked data beyond what ICIJ has officially published, and rate-limits Companies House to 600 requests per 5 minutes.

---

## How it works

1. **Resolve** — User submits a company name or number. The API resolves it via Companies House search.
2. **Fetch** — The root company profile, officers, and PSC list are pulled from Companies House (cached in Redis for 24h, retried with exponential backoff on 429/5xx).
3. **Expand** — A BullMQ worker walks the network: for each director, fetch their other appointments; for each new company, fetch its officers; for each address, attach all companies sharing it. Cycles detected via visited sets, dedup via per-investigation unique node lookup, large-corp pruning above 100 officers.
4. **Resolve entities** — Every person and company is matched against OpenSanctions and ICIJ via trigram fuzzy search + a weighted scoring pipeline (exact name 40 + phonetic 20 + JW>0.85 15 + DOB 30 + nationality 10).
5. **Score proximity** — Multi-source BFS from every sanctioned node propagates hop distance through the graph (0=CRITICAL, 1=HIGH, 2=MEDIUM, 3+=LOW).
6. **Detect anomalies** — Shell-company scoring, address clustering, circular ownership detection (DFS), label-propagation community detection with bridge nodes, and temporal clustering (mass incorporation, rapid dissolution, resignation clusters).
7. **Aggregate findings** — Each signal becomes a structured Finding (severity, evidence, recommendation). Severity-weighted sum produces a 0–100 risk score.
8. **Render** — WebSocket events stream live progress to the frontend; on completion the tabbed report is rendered with the D3 graph and PDF export.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). PRs welcome — every signal, every connector, every finding type is meant to be extensible.

---

## License

[MIT](./LICENSE) © 2026 TraceGraph contributors
