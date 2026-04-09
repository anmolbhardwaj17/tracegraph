# Contributing to TraceGraph

Thanks for your interest in contributing! TraceGraph is an open-source corporate intelligence engine and we welcome PRs that add data connectors, anomaly detectors, finding types, or improve the UI.

## Development setup

```bash
git clone https://github.com/yourname/tracegraph
cd tracegraph
cp .env.example .env
npm install
docker compose up -d postgres redis
cd apps/api && npm run migration:run && npm run seed:demo
cd ../..
npm run dev
```

This brings up the API on `http://localhost:4000` and the web app on `http://localhost:3000`. The seeded **DEMO** investigation is visible in the recent list and exercises every feature.

## Running tests

```bash
npm run test          # entire monorepo
cd apps/api && npx jest --watch    # watch mode for API tests
```

## Project layout

```
apps/api          NestJS backend
apps/web          Next.js frontend
packages/shared   Shared TypeScript types
```

Inside `apps/api/src/modules`:
- `companies-house/` — UK CH client (rate-limited, cached, retried)
- `graph/` — BFS expansion + address normalization
- `open-sanctions/` + `offshore-leaks/` — bulk ingestion
- `entity-resolution/` — phonetic + fuzzy matching + sanctions proximity
- `anomaly/` — shell company / address / cycle / community / temporal detectors
- `risk-scoring/` — finding aggregation and 0–100 score
- `investigation/` — orchestrator, BullMQ processor, websocket gateway
- `report/` — PDF generation

## Conventions

- TypeScript strict mode; no `any` in new code unless boundary-justified.
- Every new service should have at least one Jest unit test.
- Commit messages: `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`.
- Run `npm run build && npm run test` before opening a PR.

## Adding a new data source

1. Create `apps/api/src/modules/<source-name>/`.
2. Add an entity + ingestion service.
3. Wire into `EntityResolutionService.resolveInvestigation` so it participates in matching.
4. Add a small sample dataset under `apps/api/data/<source-name>/` for tests.
5. Document the source in `README.md`.

## Adding a new anomaly detector

1. Create a service under `apps/api/src/modules/anomaly/`.
2. Run it from `RiskScoringService.run` and emit one or more `Finding` objects.
3. Add unit tests with crafted graph fixtures.

## Reporting issues

Use the GitHub issue templates. Please include reproduction steps and the relevant log output.

## License

By contributing, you agree your contributions will be licensed under the MIT License.
