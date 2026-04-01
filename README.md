# Petroleum Monitoring Dashboard

MVP scaffold for a multi-site gas station monitoring platform based on:

- `data/CODEX_BUILD_SPEC.md`
- `data/sample_site_config.yaml`
- `data/sample_layout.json`

## Stack

- `apps/web`: React + Vite dashboard
- `apps/api`: Node.js + Express API + SSE + PostgreSQL
- `apps/worker`: Node.js simulator worker (local/dev)

## Database

The API requires `DATABASE_URL` and persists all app data in PostgreSQL.

Secret-backed integrations also require a stable app encryption key:

- `PETROLEUM_SECRET_KEY` is used to encrypt and decrypt saved OPIS and EIA credentials in `jobber_secrets`.
- If this key changes between restarts, previously saved OPIS and EIA values will no longer decrypt.
- If that happens, re-save the credentials from the Admin UI or provide `OPIS_USERNAME` / `OPIS_PASSWORD` and `EIA_API_KEY` in the process environment.

## Local-Only Workflow (Recommended)

Use this flow to make and test all changes locally first, then deploy only when ready.

1. Run one-time setup (Windows PowerShell):

```powershell
npm.cmd run setup:local
```

This creates `.env` from `.env.example` and installs dependencies.

2. Install/start PostgreSQL locally with:

- DB: `petroleum`
- User: `postgres`
- Password: `postgres`
- Port: `5432`

3. Seed the database:

```powershell
$env:DATABASE_URL='postgres://postgres:postgres@localhost:5432/petroleum'
$env:PGSSL='disable'
$env:PETROLEUM_SECRET_KEY='your-stable-secret-key'
npm.cmd run seed
```

This also seeds deterministic Allied controller transaction test data into `allied_transactions`.

4. Start all apps locally:

```powershell
$env:DATABASE_URL='postgres://postgres:postgres@localhost:5432/petroleum'
$env:PGSSL='disable'
$env:PETROLEUM_SECRET_KEY='your-stable-secret-key'
npm.cmd run dev
```

Services:

- Web: `http://localhost:5173`
- API: `http://localhost:4000`

## Customer Pricing Setup

The customer pricing workspace now lives in the repo and can be initialized from a fresh clone.

1. Start with the normal base seed:

```powershell
$env:DATABASE_URL='postgres://postgres:postgres@localhost:5432/petroleum'
$env:PGSSL='disable'
$env:PETROLEUM_SECRET_KEY='your-stable-secret-key'
npm.cmd run seed
```

2. Apply the workbook-derived pricing test data:

```powershell
$env:DATABASE_URL='postgres://postgres:postgres@localhost:5432/petroleum'
$env:PGSSL='disable'
$env:PETROLEUM_SECRET_KEY='your-stable-secret-key'
npm.cmd --workspace apps/api run seed:pricing-workbook
```

Notes:

- The pricing schema is created by `apps/api/src/db.js` during API startup or seed execution.
- `apps/api/src/applyWorkbookPricingTestData.js` seeds deterministic pricing snapshots, rules, customer profiles, and taxes.
- The workbook values are already embedded in the seed script, so another developer does not need your local `C:\Users\deepa\Downloads\Updated CostCalculator_.xlsx` file to run the seed.
- If needed, `PRICING_WORKBOOK_PATH` can still be set to document which workbook the values came from in logs and seeded notes.

Mandatory verification before sign-off:

- Do not report work as complete until both local services are verified as reachable.
- Check that the web host returns successfully on `http://localhost:5173`.
- Check that the API returns successfully on `http://localhost:4000`.
- After the final restart, re-check the actual running services rather than relying on an earlier result.
- If login, pricing, Allied, or any other page depends on the API, verify the API is actually running before concluding the feature is working.
- If you add or change an API route, probe that route directly and confirm it does not return `Cannot GET ...`.
- In any status update or handoff, explicitly state whether the web and API ports were checked and what they returned.

Demo users:

- System Manager: `system.manager@demo.com` / `demo123`
- Manager: `manager@demo.com` / `demo123`
- Service Tech: `tech@demo.com` / `demo123`
- Operator: `operator@demo.com` / `demo123`
- California Admin: `admin.ca@demo.com` / `demo123`
- California Manager: `manager.ca@demo.com` / `demo123`
- Non-California Admin: `admin.nonca@demo.com` / `demo123`
- Non-California Manager: `manager.nonca@demo.com` / `demo123`

## Quick Start (Cross-platform Manual)

1. Install dependencies:

```bash
npm install
```

2. Set local DB env and seed data from sample config/layout:

```bash
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/petroleum
export PGSSL=disable
export PETROLEUM_SECRET_KEY=your-stable-secret-key
npm run seed
```

This also seeds deterministic Allied controller transaction test data into `allied_transactions`.

3. Start all apps:

```bash
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/petroleum
export PGSSL=disable
export PETROLEUM_SECRET_KEY=your-stable-secret-key
npm run dev
```

Services:

- Web: `http://localhost:5173`
- API: `http://localhost:4000`

Mandatory verification before sign-off:

- Do not report work as complete until both local services are verified as reachable.
- Check that the web host returns successfully on `http://localhost:5173`.
- Check that the API returns successfully on `http://localhost:4000`.
- After the final restart, re-check the actual running services rather than relying on an earlier result.
- If login, pricing, Allied, or any other page depends on the API, verify the API is actually running before concluding the feature is working.
- If you add or change an API route, probe that route directly and confirm it does not return `Cannot GET ...`.
- In any status update or handoff, explicitly state whether the web and API ports were checked and what they returned.

Demo users:

- System Manager: `system.manager@demo.com` / `demo123`
- Manager: `manager@demo.com` / `demo123`
- Service Tech: `tech@demo.com` / `demo123`
- Operator: `operator@demo.com` / `demo123`
- California Admin: `admin.ca@demo.com` / `demo123`
- California Manager: `manager.ca@demo.com` / `demo123`
- Non-California Admin: `admin.nonca@demo.com` / `demo123`
- Non-California Manager: `manager.nonca@demo.com` / `demo123`

## Hosting

Current production deployment has moved to Render. The Netlify and Railway notes below are legacy setup notes from the earlier MVP hosting path. Keep them only as reference for older infrastructure, not as the current source of truth for production auth or deployment.

This repository is configured for:

- Frontend hosting: Netlify (`netlify.toml`)
- API hosting: Railway (`railway.json`) with a Railway PostgreSQL service

The exact live URL is not stored in this repo. You can find it in:

- Netlify site dashboard: Site URL
- Railway service dashboard: Deployment URL (and API domain)

## Deployment (Free): Netlify + Railway

This section documents the previous free-hosting path kept in the repo via `netlify.toml` and `railway.json`. Use it only if you intentionally want to reproduce that older setup.

### API on Railway

1. In Railway, create a new project from this GitHub repo.
2. Set service root to repository root (default).
3. Railway reads `railway.json` and uses:
   - Build: `npm install && npm --workspace apps/api run build`
   - Start: `npm --workspace apps/api run start`
4. Add a PostgreSQL service in Railway and attach/connect it to the API service so `DATABASE_URL` is available.
5. After first deploy, copy the API URL (for example `https://petroleum-api-production.up.railway.app`).

### Web on Netlify

1. In Netlify, import this repository.
2. Build settings:
   - Base directory: *(leave empty)*
   - Build command: `npm install && npm --workspace apps/web run build`
   - Publish directory: `apps/web/dist`
3. Add environment variable:
   - `VITE_API_BASE_URL` = your Railway API URL
4. Deploy site.

`netlify.toml` is included with SPA redirect support.

## Notes

- Auth/JWT is simplified for MVP scaffold.
- API data is durable only when backed by PostgreSQL (`DATABASE_URL`).
- Ingestion protocols (ATG/Gilbarco) are simulator-only in this iteration.
- Forecourt layout editor and layout version save are implemented in MVP form.
- Portfolio map uses OpenStreetMap tiles and geocodes sites from `address + postal_code`.
- Allied transaction generator and usage notes live in `docs/allied-transactions.md`.
- AWS migration handoff notes live in `docs/aws-migration-handoff.md`.

## Pricing Dashboard

The `Pricing` tab adds an Energy Market Dashboard for crude, gasoline, diesel, inventories, and forward curve context.

- Benchmark KPI cards show current levels, daily and weekly moves, sparklines, and a simple rising/falling/stable status.
- The dashboard includes `WTI Crude`, `Brent Crude`, `RBOB Gasoline`, `Regular Gasoline`, `Midgrade Gasoline`, `Premium Gasoline`, and `Diesel`, plus inventory KPI cards.
- The market monitor supports a `Section` switch between `Prices` and `Trends`.
- Regional EIA views are available for the retail fuel cards with `U.S.`, `East Coast`, `Midwest`, `Gulf Coast`, `Rocky Mountain`, and `West Coast`.
- The Price Trends and inventory views use live EIA-backed data where available. Forward curves and some narrative inputs remain mock-backed.
- OPIS market pricing is exposed separately through the OPIS market views and API routes.

Data and logic locations:

- Live pricing data is served by `GET /market/pricing` in `apps/api/src/server.js` and consumed by `apps/web/src/pricing/services/marketDataService.ts`.
- The API uses official EIA API v2 `seriesid` endpoints for crude, retail fuel pricing, and inventory series.
- The EIA API key can come from `EIA_API_KEY` in the process environment or from encrypted jobber-level storage configured in Admin.
- OPIS market data is served by `GET /market/opis` and `GET /market/opis/raw`.
- Mock files still live in `apps/web/src/pricing/data/benchmarkPrices.json`, `apps/web/src/pricing/data/inventoryTrends.json`, `apps/web/src/pricing/data/forwardCurves.json`, and `apps/web/src/pricing/data/narrativeDrivers.json` as fallbacks or for non-live sections.
- Narrative and outlook logic lives in `apps/web/src/pricing/utils/marketCalculations.ts`. `buildInsightSummary()` controls the generated bullets, curve interpretation, confidence, and short outlook text.
