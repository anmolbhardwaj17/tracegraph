# CLAUDE.md — TraceGraph Master Instructions

## Project Overview
TraceGraph is an open-source corporate intelligence engine. User enters a company name → system ingests data from multiple public sources → builds a relationship graph → runs anomaly detection → produces a risk report with interactive graph visualization.

## Tech Stack
- **Backend:** NestJS + TypeScript
- **Frontend:** Next.js + React + Tailwind CSS
- **Graph DB:** Neo4j Community Edition
- **Cache/Queue:** Redis + BullMQ
- **Primary DB:** PostgreSQL
- **Graph Viz:** D3.js force-directed layout
- **Monorepo:** Turborepo with `apps/api`, `apps/web`, `packages/shared`

## Project Structure
```
tracegraph/
├── CLAUDE.md                    # This file
├── apps/
│   ├── api/                     # NestJS backend
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── investigation/   # Core investigation orchestrator
│   │   │   │   ├── companies-house/  # UK Companies House connector
│   │   │   │   ├── open-sanctions/   # OpenSanctions connector
│   │   │   │   ├── offshore-leaks/   # ICIJ OffshoreLeaks connector
│   │   │   │   ├── entity-resolution/ # Fuzzy matching + entity merging
│   │   │   │   ├── graph/            # Graph construction + algorithms
│   │   │   │   ├── anomaly/          # Anomaly detection engine
│   │   │   │   ├── risk-scoring/     # Risk score calculation
│   │   │   │   └── report/           # Report generation
│   │   │   ├── common/
│   │   │   │   ├── rate-limiter/     # Token bucket rate limiter
│   │   │   │   ├── cache/            # Redis caching layer
│   │   │   │   └── queue/            # BullMQ job management
│   │   │   └── main.ts
│   │   └── test/
│   └── web/                     # Next.js frontend
│       ├── app/
│       │   ├── page.tsx              # Search page
│       │   ├── investigate/[id]/     # Investigation progress + results
│       │   └── report/[id]/          # Full report view
│       └── components/
│           ├── SearchBar.tsx
│           ├── GraphVisualization.tsx  # D3.js force-directed graph
│           ├── RiskReport.tsx
│           └── InvestigationProgress.tsx
├── packages/
│   └── shared/                  # Shared types, constants, utils
│       └── src/
│           ├── types/               # Company, Officer, Investigation types
│           └── constants/           # Risk thresholds, scoring weights
├── docker-compose.yml           # Postgres + Redis + Neo4j
├── .env.example
└── turbo.json
```

## Scope Rules
- Only modify files within this repository
- Never access files outside the tracegraph directory
- Never commit secrets, API keys, or credentials to git
- Use environment variables for all API keys (Companies House API key etc)
- Always use `.env.example` with placeholder values, never real keys
- Write tests for every major module
- Commit after each working milestone with descriptive commit messages
- If tests fail, fix the code (not the tests) unless the test is genuinely wrong

## Coding Standards
- TypeScript strict mode everywhere
- Use NestJS dependency injection properly (providers, modules, services)
- All API clients must have: rate limiting, retry with exponential backoff, caching, error handling
- All database queries must use parameterized queries (no SQL injection)
- Use DTOs for all API inputs with class-validator decorators
- Every service must have an interface (for testing/mocking)
- Use structured logging (pino) — no console.log in production code
- All async operations must have proper error handling (try/catch or .catch)
- Entity resolution confidence scores must always be between 0-100

## Data Sources (Priority Order)

### P0 — UK Companies House API (Core)
- Docs: https://developer.company-information.service.gov.uk/
- Free API key required (set as COMPANIES_HOUSE_API_KEY env var)
- Rate limit: 600 requests per 5 minutes (use token bucket)
- Endpoints needed: company profile, officers, PSC, filing history, charges, registered office
- Auth: HTTP Basic Auth with API key as username, empty password
- Base URL: https://api.company-information.service.gov.uk

### P1 — OpenSanctions
- Docs: https://www.opensanctions.org/docs/
- Bulk data download (not API for MVP): https://data.opensanctions.org/
- Format: JSON lines (FollowTheMoney schema)
- Ingest into PostgreSQL on startup
- Match entities using fuzzy name matching

### P1 — ICIJ OffshoreLeaks
- Download: https://offshoreleaks.icij.org/pages/database
- CSV files: entities, officers, intermediaries, addresses, relationships
- Ingest into PostgreSQL on startup
- Match entities using fuzzy name matching

## Phase Execution Plan

### Phase 1: Foundation + Companies House (Weeks 1-3)
**Goal:** Enter a company number → see profile + directors + their other directorships

Tasks:
1. Initialize Turborepo monorepo with apps/api (NestJS), apps/web (Next.js), packages/shared
2. Set up docker-compose.yml with PostgreSQL 16, Redis 7, Neo4j 5 Community
3. Design and create PostgreSQL schema:
   - companies (company_number, name, status, incorporation_date, address, sic_codes, company_type, jurisdiction)
   - officers (id, name, date_of_birth_month, date_of_birth_year, nationality, role, appointed_on, resigned_on)
   - company_officers (company_id, officer_id, role) — junction table
   - addresses (id, address_line_1, address_line_2, locality, region, postal_code, country, normalized)
   - psc (id, company_id, name, kind, natures_of_control, notified_on)
   - investigations (id, query, status, created_at, completed_at, metadata)
4. Build Companies House API client service:
   - Token bucket rate limiter (600/5min) stored in Redis
   - Retry with exponential backoff on 429/500/503
   - Response caching in Redis (24h TTL)
   - Methods: getCompany, getOfficers, getPersonsOfSignificantControl, getFilingHistory, getCharges
5. Build Investigation module:
   - POST /api/investigations — accepts company name or number, creates investigation
   - GET /api/investigations/:id — returns investigation status + results
   - Investigation state machine: QUEUED → FETCHING → COMPLETE → FAILED
6. Build basic Next.js frontend:
   - Search page with company name/number input
   - Results page showing company profile card + directors list
   - Each director shows their other company appointments
7. Write integration tests for Companies House client (mock API responses)
8. Test with real Companies House API against 5-10 real companies
9. Commit working Phase 1

**Success criteria:** Can search "Tesco PLC" and see full company profile with all directors and their other appointments.

### Phase 2: Recursive Graph Expansion (Weeks 4-6)
**Goal:** One company → automatic expansion through directors and addresses → complete network graph

Tasks:
1. Build GraphExpansionService:
   - BFS with priority queue (direct connections first)
   - Configurable max depth (default: 2 hops for directors, 1 hop for addresses)
   - Cycle detection using visited set (company_number + officer_id)
   - Entity deduplication during expansion
   - Expansion heuristics: skip expanding companies with >100 officers (likely large public corp)
2. Build job orchestrator with BullMQ:
   - Investigation job spawns expansion jobs
   - Each expansion job: fetch company → fetch officers → queue officer expansion jobs
   - Respect rate limits across all concurrent jobs
   - Track progress (entities discovered, API calls made, current depth)
3. WebSocket gateway for real-time progress:
   - Client subscribes to investigation ID
   - Server emits: entity_discovered, edge_created, progress_update, investigation_complete
4. Store expanded graph in PostgreSQL (nodes + edges tables):
   - graph_nodes (id, investigation_id, entity_type, entity_id, label, metadata)
   - graph_edges (id, investigation_id, source_node_id, target_node_id, relationship_type, metadata)
5. Address reverse lookup: find all companies at same address
   - Normalize addresses before comparison (lowercase, remove punctuation, standardize abbreviations)
6. Frontend updates:
   - Investigation progress page with live WebSocket updates
   - Show expanding graph in real-time (simple node count + edge count for now)
7. Test expansion on real data: start with a known suspicious company pattern
8. Handle edge cases: circular references, very large networks (>1000 nodes), API failures mid-expansion

**Success criteria:** Search a company → watch it expand to 100+ connected entities in real-time → see the full network stored in database.

### Phase 3: Entity Resolution + Multi-Source (Weeks 7-9)
**Goal:** Match entities across Companies House, OpenSanctions, and ICIJ OffshoreLeaks

Tasks:
1. Build OpenSanctions data ingestion:
   - Download bulk dataset (default.json lines)
   - Parse FollowTheMoney entities
   - Store in PostgreSQL: sanctions_entities (id, schema, properties JSONB)
   - Build trigram index on name fields for fast fuzzy search
2. Build ICIJ OffshoreLeaks ingestion:
   - Download CSV files
   - Parse and store: offshore_entities, offshore_officers, offshore_intermediaries, offshore_addresses
   - Build trigram index on name fields
3. Build EntityResolutionService:
   - Name normalization: remove titles, handle name order, expand abbreviations
   - Phonetic matching: Double Metaphone implementation
   - String similarity: Jaro-Winkler distance
   - Attribute matching: date of birth (month/year), nationality, address
   - Co-occurrence: shared company links across sources
   - Confidence score: weighted combination (0-100)
   - Threshold: >85 auto-merge, 50-85 flag, <50 separate
4. After graph expansion, run entity resolution:
   - For each person in the expanded graph, check against OpenSanctions
   - For each company in the expanded graph, check against ICIJ OffshoreLeaks
   - Store matches with confidence scores
5. Add sanctions proximity scoring:
   - Shortest path from any entity to nearest sanctioned entity
   - 1 hop = CRITICAL, 2 hops = HIGH, 3 hops = MEDIUM, 4+ = LOW
6. Frontend: show matched entities with source badges and confidence scores
7. Test entity resolution accuracy against known matches

**Success criteria:** Investigation finds cross-source matches. "Director X has an 87% match to a PEP in OpenSanctions database."

### Phase 4: Graph Algorithms + Anomaly Detection (Weeks 10-12)
**Goal:** Automatic detection of shell companies, suspicious patterns, and risk signals

Tasks:
1. Build or use Neo4j for graph algorithm execution:
   - Import PostgreSQL graph into Neo4j for algorithm computation
   - Or implement algorithms directly on PostgreSQL adjacency lists
2. Implement detection algorithms:
   - Shell Company Score: multi-factor (director count >10, rapid dissolutions, dormant accounts, virtual office address, no web presence)
   - Address Clustering: company density per normalized address vs national baseline
   - Circular Ownership: directed cycle detection in ownership sub-graph (DFS with back-edge detection)
   - Community Detection: Louvain algorithm to find tightly connected clusters
   - Centrality Analysis: betweenness centrality to find bridge nodes
   - Temporal Anomalies: clustering incorporation/dissolution dates
   - Sanctions Proximity: shortest path scoring (from Phase 3)
   - Financial Inconsistency: micro-entity accounts with large director network
3. Build RiskScoringService:
   - Each anomaly produces a finding with: type, severity, confidence, evidence, recommendation
   - Overall risk score: weighted sum of findings (0-100)
   - Severity levels: CRITICAL (>80), HIGH (60-80), MEDIUM (40-60), LOW (<40)
4. Build ReportService:
   - Compile all findings into structured report
   - Include evidence chains (which data, from which source, supports each finding)
   - Generate executive summary
5. Test against known patterns:
   - Find a real UK shell company network (Companies House has enforcement cases)
   - Verify detection algorithms catch known patterns
   - Tune thresholds to minimize false positives

**Success criteria:** Investigation automatically detects and reports "Director X operates 31 companies, 14 dissolved within 2 years, from a shared virtual office address. Shell company network risk: HIGH."

### Phase 5: Frontend + Graph Visualization (Weeks 13-15)
**Goal:** Beautiful, interactive investigation UI with graph explorer

Tasks:
1. Build D3.js force-directed graph visualization:
   - Nodes colored by type: company (blue), person (green), address (gray)
   - Node border color by risk: red (flagged), yellow (warning), green (clean)
   - Node size by centrality/connection count
   - Edge types visualized differently: director (solid), ownership (dashed), address (dotted)
   - Click node → side panel shows entity details
   - Hover → highlight connected edges
   - Zoom, pan, filter by entity type
   - Highlight shortest path to sanctioned entities
   - Support 500+ nodes at 60fps (use WebGL fallback if needed)
2. Build risk report page:
   - Summary header: company name, risk score (0-100 with gauge), investigation stats
   - Findings list sorted by severity with expandable evidence
   - Company profile section
   - Director network section
   - Timeline of key events
3. Build investigation progress page:
   - Real-time graph expansion animation
   - Data source progress bars
   - Entity/edge counter
4. Build PDF export:
   - Generate downloadable PDF report
   - Include graph visualization as static image
5. Polish UI: loading states, error handling, empty states, responsive design

**Success criteria:** A non-technical person can enter a company name, watch the investigation happen live, explore the graph interactively, and download a PDF report.

### Phase 6: Polish + Launch (Weeks 16-18)
**Goal:** Production-ready open-source release

Tasks:
1. Test against 100+ real UK companies across different profiles
2. Tune all anomaly detection thresholds based on false positive rates
3. Handle all error edge cases gracefully
4. Add comprehensive logging and monitoring
5. Write unit tests (target 80%+ coverage on core services)
6. Write integration tests for full investigation pipeline
7. Create 3-5 pre-computed demo investigations for landing page
8. Write comprehensive README with architecture diagram
9. Set up GitHub Actions CI/CD (lint, test, build, Docker publish)
10. Create Docker images for one-command deployment
11. Record demo video
12. Write launch blog post

**Success criteria:** Anyone can `docker-compose up`, search a company, and get a complete risk report.

## Testing Strategy
- Unit tests: Jest for all services (mock external APIs)
- Integration tests: Test full pipeline with recorded API responses
- E2E tests: Playwright for critical frontend flows
- Test data: Maintain fixtures of known company profiles for consistent testing
- Never call real APIs in CI — always use mocked/recorded responses

## Git Conventions
- Branch naming: `phase-{n}/{feature-name}` (e.g., `phase-1/companies-house-client`)
- Commit messages: `feat:`, `fix:`, `test:`, `docs:`, `refactor:` prefixes
- Commit after each working milestone — do not accumulate large uncommitted changes
- Always ensure tests pass before committing
