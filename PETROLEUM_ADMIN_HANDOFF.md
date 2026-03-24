# Petroleum Local And Public Handoff (Admin Agent)

Use this file in a **new Codex agent launched from Administrator PowerShell**.

## Goal
Run `Petroleum` locally when needed, and keep the public deployment state on **Railway** and **Netlify** aligned with the current test/demo dataset.

## Repo Path
`C:\Users\deepa\source\repos\Petroleum`

## Current Repo Status
- GitHub remote:
  - `https://github.com/DWANNER1/Petroleum.git`
- Current branch:
  - `main`
- More recent pushed commits after the original handoff:
  - `1fb6a72` - `Update auth, pricing dashboard, and admin workflows`
  - `0843bba` - `Reduce local SQL dump tank history density`
- `petroleum-local.sql` was reduced from roughly `79 MB` to roughly `13 MB` by thinning tank history from `5-minute` intervals to `30-minute` intervals.
- Local git identity observed in this environment:
  - `user.name = DWANNER1`
  - `user.email = 114098810+DWANNER1@users.noreply.github.com`

## Local Runtime Status
- PostgreSQL is installed locally via Chocolatey.
- PostgreSQL service is running:
  - Service name: `postgresql-x64-18`
  - Install path: `C:\Program Files\PostgreSQL\18`
- PostgreSQL is listening on `localhost:5432`.
- Local database:
  - database: `petroleum`
  - user: `postgres`
  - password: `postgres`
- Local API health was validated at:
  - `http://localhost:4000/health`
- Local web app was validated at:
  - `http://localhost:5173`
- Important startup note:
  - the API must be started with local database env vars set, or login will fail with `Postgres connection is missing`
  - use:

```powershell
$env:DATABASE_URL='postgres://postgres:postgres@localhost:5432/petroleum'
$env:PGSSL='disable'
```

## Public Deployment Status
### Netlify
- Netlify config remains:
  - build command: `npm install && npm --workspace apps/web run build`
  - publish dir: `apps/web/dist`
- No Netlify config changes were required for the work in this session.
- Frontend redeploy is only needed when there is a new pushed commit or a manual redeploy is triggered.

### Railway
- Railway config remains:
  - build command: `npm install && npm --workspace apps/api run build`
  - start command: `npm --workspace apps/api run start`
- No Railway config changes were required for the work in this session.
- The active Railway API database was confirmed to be:
  - `postgresql://postgres:yjozCjlXHUkRQSMVHVXobjxSxWWBPAqt@centerbeam.proxy.rlwy.net:23971/railway`
- An older extra Railway/Postgres connection was also seen during this session and should **not** be treated as the active app database:
  - `postgresql://postgres:VyfqGzHwTXIgqHNQXNsTpfFxRDnfrbyD@tramway.proxy.rlwy.net:12652/railway`
- If deleting the duplicate Railway Postgres, keep the `centerbeam.proxy.rlwy.net:23971` database because that is the one the Railway API service is actually using.

## What Changed Since The Original Handoff
### 1. Pricing tab added between Users and Admin
- New `Pricing` tab was added in the web app navigation.
- The page is a React + TypeScript pricing dashboard under:
  - `apps/web/src/pricing`
- The Pricing page is lazy-loaded from:
  - `apps/web/src/App.jsx`

### 2. Pricing dashboard UI was simplified
- Final layout direction at handoff:
  - single top-right `Market Monitor` card
  - `Section` dropdown inside that card with `Prices` and `Trends`
  - `Prices` is the default view
  - `Trends` gives full-width charts
  - chart commentary is shown in hover popups on chart titles instead of separate side cards
- Header source badges now show source detail on hover rather than using a dedicated `Source coverage` card.

### 3. Live EIA data wiring added
- Frontend `Update now` no longer only restamps the page.
- API route added:
  - `GET /market/pricing`
- Route currently fetches live EIA pricing/inventory data and returns dashboard snapshot JSON.
- Frontend service now calls that route and only falls back to local mock JSON if the live request fails.
- Forward curves and some narrative inputs are still mock-backed for now.
- Relevant files:
  - `apps/api/src/server.js`
  - `apps/web/src/api.js`
  - `apps/web/src/pricing/services/marketDataService.ts`

### 4. EIA regional fuel grades added to Pricing cards
- Pricing cards now include:
  - `WTI Crude`
  - `Brent Crude`
  - `Regular Gasoline`
  - `Midgrade Gasoline`
  - `Premium Gasoline`
  - `Diesel`
  - plus the inventory KPI cards
- EIA regional dropdowns were added to the applicable fuel cards.
- Regions currently provided:
  - `U.S.`
  - `East Coast`
  - `Midwest`
  - `Gulf Coast`
  - `Rocky Mountain`
  - `West Coast`
- KPI sparkline tooltips now use real EIA date anchors instead of synthetic `1, 2, 3...` labels.

### 5. Prior functional changes from the earlier session still exist
- Tank review UI and charts
- revised Work Queue incident behavior
- brighter dropdown styling
- tank history / seed data updates

## Validation Completed
- Web build succeeded multiple times with:
  - `npm.cmd --workspace apps/web run build`
- API syntax check succeeded with:
  - `node --check apps/api/src/server.js`
- Local API health endpoint succeeded:
  - `http://localhost:4000/health`
- Local Pricing API route was verified after restart with demo login.
- Verified live pricing payload included:
  - benchmark keys: `wti, brent, gasoline, regular, midgrade, premium, diesel`
  - regional sets for `regular` and `diesel`: `NUS, R10, R20, R30, R40, R50`
- Earlier tank validations from the original handoff still apply, but note the local SQL dump was later thinned back to `30-minute` history.

## Railway Database Reseed Status
- The active Railway database is test/demo data and was treated as safe to overwrite.
- A reseed was started against the **active** Railway database in the background during this session.
- Background process id observed:
  - `19684`
- Background log file:
  - `C:\Users\deepa\source\repos\Petroleum\railway-seed-active.log`
- Important: completion of that background reseed was **not confirmed** before this handoff update.
- If the public GUI is stuck on `Connecting...`, the in-progress Railway reseed is the most likely reason.

## Commands To Re-Run Locally
Open Admin PowerShell and run:

```powershell
cd C:\Users\deepa\source\repos\Petroleum

$env:DATABASE_URL='postgres://postgres:postgres@localhost:5432/petroleum'
$env:PGSSL='disable'

npm.cmd run seed
npm.cmd run dev
```

If starting the API and web separately, use:

```powershell
cd C:\Users\deepa\source\repos\Petroleum

$env:DATABASE_URL='postgres://postgres:postgres@localhost:5432/petroleum'
$env:PGSSL='disable'

npm.cmd --workspace apps/api run dev
npm.cmd --workspace apps/web run dev
```

## Command To Reseed Active Railway Database
Only use this for the test/demo Railway database:

```powershell
cd C:\Users\deepa\source\repos\Petroleum

$env:DATABASE_URL='postgresql://postgres:yjozCjlXHUkRQSMVHVXobjxSxWWBPAqt@centerbeam.proxy.rlwy.net:23971/railway'
$env:PGSSL='disable'

npm.cmd --workspace apps/api run seed
```

## Expected Local URLs
- Web: `http://localhost:5173`
- API health: `http://localhost:4000/health`
- Pricing page:
  - `http://localhost:5173/pricing`

## Demo Login
- `manager@demo.com` / `demo123`

## Important Notes For New Agent
- Treat `centerbeam.proxy.rlwy.net:23971` as the active Railway app database.
- Do **not** assume the duplicate `tramway` database is the live one.
- If the Railway GUI is stuck on `Connecting...`, first check whether the remote seed is still running or whether the remote database is only partially populated.
- Railway schema changes are applied on API startup by `initDb()`, but data refresh still requires an explicit seed if the database is not empty.
- Netlify and Railway config files did not require code changes for this session's work.
- Pricing page notes:
  - current live market route is `GET /market/pricing`
  - route uses live EIA public pages for benchmark and inventory data
  - forward curves are still mock data
  - `Update now` triggers a fresh dashboard reload, but only EIA-backed sections are truly live
  - if the Pricing page stops updating, check whether the API was started without `DATABASE_URL` and `PGSSL`
- EIA key note:
  - an EIA API key was provided in chat during this session, but the current implementation does **not** depend on it because the route is scraping EIA public `LeafHandler` history pages
  - if a future agent moves to official EIA API endpoints, store the key in env vars and remove it from chat-dependent workflow
