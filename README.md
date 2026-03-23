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
npm.cmd run seed
```

4. Start all apps locally:

```powershell
npm.cmd run dev
```

Services:

- Web: `http://localhost:5173`
- API: `http://localhost:4000`

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
npm run seed
```

3. Start all apps:

```bash
npm run dev
```

Services:

- Web: `http://localhost:5173`
- API: `http://localhost:4000`

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

Current production deployment has moved to Render. The Netlify and Railway notes below are legacy setup notes from the earlier MVP hosting path and should not be used as the source of truth for new auth work.

This repository is configured for:

- Frontend hosting: Netlify (`netlify.toml`)
- API hosting: Railway (`railway.json`) with a Railway PostgreSQL service

The exact live URL is not stored in this repo. You can find it in:

- Netlify site dashboard: Site URL
- Railway service dashboard: Deployment URL (and API domain)

## Deployment (Free): Netlify + Railway

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

## Pricing Dashboard

The `Pricing` tab adds an Energy Market Dashboard for crude, gasoline, diesel, inventories, and forward curve context.

- Benchmark KPI cards show current levels, daily and weekly moves, sparklines, and a simple rising/falling/stable status.
- The Price Trends panel plots WTI, Brent, gasoline, and diesel with `7D`, `30D`, `90D`, and `1Y` views.
- The Inventory Trends panel compares crude, gasoline, and distillate stocks in either absolute terms or week-over-week change, with annotation markers for notable draws and builds.
- The Futures / Forward Curve panel summarizes whether each market is in backwardation, contango, or roughly flat structure.
- The right-side insight cards generate concise drivers, a short outlook, and source coverage notes for business users.

Data and logic locations:

- Mock files live in `apps/web/src/pricing/data/benchmarkPrices.json`, `apps/web/src/pricing/data/inventoryTrends.json`, `apps/web/src/pricing/data/forwardCurves.json`, and `apps/web/src/pricing/data/narrativeDrivers.json`.
- The data service lives in `apps/web/src/pricing/services/marketDataService.ts`. That is the main place to connect production EIA, CME, ICE, and NRCan APIs later.
- Narrative and outlook logic lives in `apps/web/src/pricing/utils/marketCalculations.ts`. `buildInsightSummary()` controls the generated bullets, curve interpretation, confidence, and short outlook text.
