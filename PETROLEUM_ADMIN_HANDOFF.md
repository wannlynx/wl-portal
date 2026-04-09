# Petroleum Local And Public Handoff (Admin Agent)

Use this file in a **new Codex agent launched from Administrator PowerShell**.

## Goal
Run `Petroleum` locally when needed, and keep the public deployment state on **Railway** and **Netlify** aligned with the current test/demo dataset.

## Mandatory Final Verification Rule
- No agent should say work is finished until the relevant local ports are checked again at the end of the task.
- Minimum checks:
  - legacy web: `http://localhost:5173`
  - API health: `http://localhost:4000/health`
- If the MUI frontend was touched, built, or tested, also check:
  - MUI web: `http://localhost:5174`
- The final handoff must state the exact ports checked and what each one returned.
- Do not rely on an earlier successful check if processes were restarted later in the task.

## Versioning Rule
- Frontend and API versions are separate and should not be forced to match.
- The Admin `Version` tab must show:
  - frontend version
  - frontend release date and time
  - API version
  - API release date and time
- Replace old `Update Rule` wording with `Information on Changes`.
- When frontend code changes:
  - bump `apps/web-mui/package.json`
  - record both `releaseDate` and `releaseDateTime`
- When API code changes:
  - bump `apps/api/package.json`
  - record both `releaseDate` and `releaseDateTime`
- Any future handoff should preserve this convention so release metadata stays usable during local and AWS verification.

## MUI Mobile UX Rule
- For `apps/web-mui`, phone usability is a primary requirement, not a polish pass.
- On phone, default to `summary -> drill-down` instead of showing summary and detail side-by-side.
- Do not carry desktop density directly onto phone screens.
- Prefer:
  - one compact list of entities first
  - simple tap targets
  - a focused detail view after selection
  - progressive disclosure for advanced fields
- Avoid:
  - duplicated data in both summary cards and detail panels on the same phone screen
  - large always-open filter forms
  - desktop-style tables as the primary mobile view
  - forcing the user to scroll through both a detail panel and the full list below it
- For mobile data cards, show only the most important fields first.
  - Typical first-line fields: name/label, status, fill %, volume, event
  - Move lower-priority fields like ullage, safe ullage, capacity, exact timestamps, and secondary metrics into the detail view
- Use compact filters on phone.
  - Keep only the most-used controls visible by default
  - Put lower-priority filters behind a secondary action, drawer, or expandable section
- Desktop can remain denser with split panes and more simultaneous context, but mobile should optimize for quick scanning with minimal scrolling.
- When migrating pages, assume layout hierarchy and duplicated data are more likely problems than font size alone.
- For information-dense analytics like `Allied`, prefer a layered flow:
  - `Portfolio` selection first
  - then one focused `Site Analysis` workspace
  - then one selected transaction/item detail view
- Do not rebuild dense analytics pages as one long mobile report.
  - Use tabs or segmented modes like `Overview`, `Issues`, `Pumps`, and `Transactions`
  - keep advanced filters compact
  - make KPI cards, issue cards, and pump rows act as drill-down selectors

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
  - secure jobber secret decryption also requires an app encryption key
  - the current local instance that was validated in this session used:
    - `PETROLEUM_SECRET_KEY=petroleum-local-dev-key`
    - `EIA_API_KEY` set in the API process env as a temporary fallback because the saved EIA DB secret was encrypted under an older app secret
  - use:

```powershell
$env:DATABASE_URL='postgres://postgres:postgres@localhost:5432/petroleum'
$env:PGSSL='disable'
$env:PETROLEUM_SECRET_KEY='your-stable-secret-key'
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

### AWS Lightsail Low-Cost Deployment Path
- AWS CLI was configured locally and validated under:
  - account: `114354606772`
  - IAM user: `arn:aws:iam::114354606772:user/ai-agent-coding-deploy`
- Cost-sensitive AWS direction selected for the next deployment pass:
  - use a single **Ubuntu Lightsail instance**
  - keep **PostgreSQL** instead of rewriting the app to DynamoDB
  - avoid RDS/App Runner/Amplify for the first low-cost production cut unless a stronger managed posture is later required
- Lightsail instance created:
  - instance name: `wl-portal-prod`
  - region: `us-east-1`
  - availability zone: `us-east-1a`
  - blueprint: `ubuntu_24_04`
  - bundle: `nano_3_0`
  - public IP: `44.222.49.26`
  - login user: `ubuntu`
  - SSH key name: `LightsailDefaultKeyPair`
- Lightsail instance state at handoff:
  - running
  - ports `22` and `80` were confirmed open in Lightsail
  - `443` still needs to be explicitly opened if HTTPS has not already been added after this note
- Server bootstrap commands already validated on the instance:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx git curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

- Result of the validated Node install:
  - Node: `v20.20.2`
  - npm: `10.8.2`
- PostgreSQL state on the Lightsail host at this handoff:
  - `postgresql` and `postgresql-contrib` were installed
  - local database `petroleum` was created successfully
  - `psql -lqt` showed:
    - `petroleum`
    - `postgres`
    - `template0`
    - `template1`
  - the `postgres` user password was reset at least once during setup, but the final chosen password was not written into this handoff
- Repo state on the Lightsail host at this handoff:
  - cloned repo: `https://github.com/wannlynx/wl-portal.git`
  - working directory: `/home/ubuntu/wl-portal`
  - checked-out branch: `docs/aws-migration-handoff`
- Current blocker on the Lightsail host:
  - `npm install` does **not** complete on the `nano_3_0` instance
  - the install is being OOM-killed by the kernel on the `0.5 GB RAM` bundle
  - `npm ls --depth=0` showed unmet workspace dependencies after the interrupted installs
  - this should be treated as an infrastructure capacity issue first, not a repo/package.json bug
- Next required Lightsail steps after this handoff:
  - add swap on the host, then retry `npm install`
  - if install is still killed, resize the instance one step above `nano_3_0`
  - once dependencies finish installing:
    - create the minimal `.env`
    - run `npm run seed`
    - run `npm run build`
    - configure the API process manager
    - configure Nginx to serve `apps/web-mui/dist` and proxy the API
- PostgreSQL bootstrap commands prepared for the Lightsail host:

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'CHANGE_THIS_PASSWORD';"
sudo -u postgres createdb petroleum
sudo -u postgres psql -lqt
```

- Repo/bootstrap commands prepared for the Lightsail host:

```bash
cd /home/ubuntu
git clone https://github.com/wannlynx/wl-portal.git
cd wl-portal
git checkout docs/aws-migration-handoff
npm install
```

- Memory-pressure mitigation prepared for the Lightsail host:

```bash
sudo fallocate -l 3G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
free -h
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
cd /home/ubuntu/wl-portal
rm -rf node_modules
npm install
```

- Minimal first-boot `.env` shape prepared for the Lightsail host:

```bash
DATABASE_URL=postgresql://postgres:YOUR_POSTGRES_PASSWORD@localhost:5432/petroleum
PETROLEUM_SECRET_KEY=CHOOSE_A_STABLE_SECRET_KEY
WEB_BASE_URL=http://44.222.49.26
PORT=4000
```

- Important env note:
  - use the confirmed values below unless they are intentionally rotated later
  - if `PETROLEUM_SECRET_KEY` changes, existing encrypted rows in `jobber_secrets` will not decrypt
  - OPIS/EIA credentials can still be re-entered later after boot if needed

- Confirmed AWS Lightsail credentials and values used during this session:
  - local PostgreSQL password:
    - `AWSPassword1!`
  - current `DATABASE_URL` on the Lightsail host:
    - `postgresql://postgres:AWSPassword1!@localhost:5432/petroleum`
  - current `PETROLEUM_SECRET_KEY` on the Lightsail host:
    - `5fa864e1cc131d6283efe1f275c44b857b3c9d9eb0f77b284c249898b888f828`
  - current temporary `WEB_BASE_URL` used before final domain cutover:
    - `http://44.222.49.26`
  - demo login still present in app data:
    - `manager@demo.com / demo123`
  - OPIS fallback credentials found locally and available if re-entry is needed:
    - `OPIS_USERNAME=ram@xprotean.com`
    - `OPIS_PASSWORD=wp5MQfPTkvVPST!`

- Database restore state on the Lightsail host:
  - uploaded backup:
    - `/home/ubuntu/petroleum-full-2026-04-01.backup`
  - restore command had to use a newer `pg_restore`
  - `pg_restore` reported one ignored warning:
    - `unrecognized configuration parameter "transaction_timeout"`
  - that warning came from the dump header and did **not** block the restore
  - after restore, the API started successfully with:
    - `petroleum-api listening on 4000 (dbReady=true)`

- HTTP validation completed on the Lightsail host:
  - `curl http://127.0.0.1:4000/health` returned:
    - `{"ok":true,"service":"petroleum-api","dbConfigured":true,"apiVersion":"2026-03-07-tank-info"}`
  - `curl -I http://127.0.0.1` returned `200 OK`
  - `curl -I http://44.222.49.26` returned `200 OK`

- Frontend/API deployment method note for future AWS updates:
  - do **not** rely on multiline SSH paste for config files or long shell payloads
  - this terminal wraps pasted lines and corrupts Nginx configs and long commands
  - preferred update method:
    - build locally on Windows
    - upload changed artifacts/config files with `scp`
    - move them into place on the server
  - for non-file payloads, use a single-line encoded transport format such as `base64` rather than raw multiline paste
  - practical examples from this session:
    - upload built frontend zip with `scp`
    - upload `wl-portal.nginx.conf` with `scp`
    - avoid editing `/etc/nginx/...` interactively over wrapped SSH paste
  - standard deployment workflow going forward:
    - develop and test locally first
    - commit and push to GitHub
    - for frontend changes:
      - build `apps/web-mui` locally on Windows
      - package `apps/web-mui/dist` into `web-mui-dist.zip`
      - upload `web-mui-dist.zip` with `scp`
      - unzip it into `/home/ubuntu/wl-portal/apps/web-mui/dist`
    - for config changes:
      - create or edit the config locally
      - upload the config file with `scp`
      - move it into place on the server
      - validate with `nginx -t` before reload/restart when Nginx is involved
    - for backend-only source changes:
      - use `git pull` on the server in `/home/ubuntu/wl-portal`
      - then restart the API process
    - do **not** build the frontend on the Lightsail VM unless the instance size changes materially; the current VM is too small for reliable Vite production builds

- Canonical frontend deployment commands from Windows:

```powershell
cd C:\Users\deepa\source\repos\Petroleum
npm.cmd --workspace apps/web-mui run build
Compress-Archive -Path .\apps\web-mui\dist\* -DestinationPath .\web-mui-dist.zip -Force
scp -i "C:\Users\deepa\.ssh\LightsailDefaultKey-us-east-1.pem" "C:\Users\deepa\source\repos\Petroleum\web-mui-dist.zip" ubuntu@44.222.49.26:/home/ubuntu/
```

- Canonical frontend deployment commands on the Lightsail host:

```bash
unzip -o /home/ubuntu/web-mui-dist.zip -d /home/ubuntu/wl-portal/apps/web-mui/dist
```

- Canonical config deployment pattern:

```powershell
scp -i "C:\Users\deepa\.ssh\LightsailDefaultKey-us-east-1.pem" "C:\Users\deepa\source\repos\Petroleum\wl-portal.nginx.conf" ubuntu@44.222.49.26:/home/ubuntu/
```

```bash
sudo mv /home/ubuntu/wl-portal.nginx.conf /etc/nginx/sites-available/wl-portal
sudo nginx -t
sudo systemctl restart nginx
```

- Canonical backend source deployment pattern on the Lightsail host:

```bash
cd /home/ubuntu/wl-portal
git pull
```

- Domain / HTTPS state:
  - DNS target selected:
    - `portal.wannlynx.com -> 44.222.49.26`
  - Let’s Encrypt certificate request succeeded for:
    - `portal.wannlynx.com`
  - certificate files created at:
    - `/etc/letsencrypt/live/portal.wannlynx.com/fullchain.pem`
    - `/etc/letsencrypt/live/portal.wannlynx.com/privkey.pem`
  - initial Certbot install step failed because Nginx still had:
    - `server_name 44.222.49.26;`
  - next required HTTPS steps if not yet finished after this handoff:
    - change Nginx `server_name` to `portal.wannlynx.com`
    - run `sudo certbot install --cert-name portal.wannlynx.com`
    - choose redirect from HTTP to HTTPS
    - update `.env`:
      - `WEB_BASE_URL=https://portal.wannlynx.com`
    - restart the API process after changing `.env`

- If the low-cost Lightsail path is kept, the intended public architecture becomes:
  - Nginx on `80/443`
  - API on local `:4000`
  - PostgreSQL on local `:5432`
  - static frontend served from the built `apps/web-mui/dist`

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

### 3. Live EIA data wiring was migrated to official EIA API v2
- Frontend `Update now` no longer only restamps the page.
- API route added:
  - `GET /market/pricing`
- Route now fetches live EIA pricing/inventory data through official `https://api.eia.gov/v2/seriesid/...` calls.
- The old `LeafHandler.ashx` scraping path was removed after EIA started returning `403`.
- The route requires an EIA API key.
- The EIA key can come from either:
  - `EIA_API_KEY` in the API process env, or
  - encrypted jobber secret storage in the local database
- Frontend service now calls that route and only falls back to local mock JSON if the live request fails.
- Forward curves and some narrative inputs are still mock-backed for now.
- Relevant files:
  - `apps/api/src/server.js`
  - `apps/api/src/secrets.js`
  - `apps/web/src/api.js`
  - `apps/web/src/pricing/services/marketDataService.ts`

### 4. OPIS credentials moved to encrypted jobber-level database storage
- OPIS no longer has to rely only on `OPIS_USERNAME` and `OPIS_PASSWORD` in the process env.
- Current lookup order for OPIS credentials:
  - encrypted `jobber_secrets` row for provider `opis` first
  - `OPIS_USERNAME` / `OPIS_PASSWORD` env vars second as fallback
- Admin UI now has an `OPIS Credentials` form under the Branding workspace for jobber admins.
- Credentials are encrypted before they are stored in Postgres.
- If an OPIS secret cannot be decrypted with the current `PETROLEUM_SECRET_KEY`, the backend now returns a clearer error telling the user to re-save the credentials in Admin.

### 5. EIA API key moved to encrypted jobber-level database storage
- Current lookup order for EIA credentials:
  - encrypted `jobber_secrets` row for provider `eia` first
  - `EIA_API_KEY` env var second as fallback
- Admin UI now has an `EIA API Key` form under the Branding workspace for jobber admins.
- The backend normalizes pasted EIA email text and extracts the actual token if the full email body was pasted by mistake.
- If an EIA secret cannot be decrypted with the current `PETROLEUM_SECRET_KEY`, the backend now returns a clearer error telling the user to re-save the key in Admin.

### 6. OPIS page redesign and pricing workflow changes
- The OPIS view is now a simpler market monitor:
  - top card with `State`, `City`, and `Refresh`
  - market table below with `Low`, `High`, `Avg`, `Spot USD/gal`, `Change`, and `Est. Price`
- Clicking `Est. Price` opens a single editable pricing panel below instead of showing many cards at once.
- The save button is a single bottom-right button.
- Saved editable values now populate the form inputs as the starting values.

### 7. Pricing persistence is now jobber/location/fuel scoped
- Editable pricing values are no longer stored per site.
- Current persistence model is:
  - per `jobber`
  - per `location` / `market_label`
  - per `fuel type bucket` / formula bucket
- The table storing this is `jobber_pricing_configs`.
- Displayed estimated prices are still calculated per visible OPIS row using that row’s own market average.
- Saved multipliers/adders are shared at the jobber/location/fuel bucket level.

### 8. EIA regional fuel grades added to Pricing cards
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

### 9. Prior functional changes from the earlier session still exist
- Tank review UI and charts
- revised Work Queue incident behavior
- brighter dropdown styling
- tank history / seed data updates

### 10. OPIS Raw report now uses supplier detail and summary detail together
- The `OPIS Raw` tab under Pricing was significantly reworked to be closer to the bundled sample report.
- The backend raw route:
  - `GET /market/opis/raw`
  - now combines:
    - `SupplierPrices` for supplier/body rows
    - `Summary` for benchmark-style metric lines
- The live raw report is no longer just a JSON dump rendered in the page.
- The page now generates OPIS-style report text from the live payload and compares it against the bundled sample report.
- The raw report remains an approximation of the sample format, not a byte-for-byte reproduction.
- Key frontend file:
  - `apps/web/src/pricing/pages/PricingPage.tsx`
- Key parser utility:
  - `apps/web/src/pricing/utils/opisRawParser.ts`

### 11. OPIS Raw filters now affect the displayed reports
- The `OPIS Raw` tab now includes:
  - `Market Filter`
  - `Type Filter`
- The `Type Filter` uses:
  - live OPIS product/type names in live mode
  - parsed section titles in sample mode
- These filters now affect:
  - the main raw report textarea
  - the sample report pane
  - the generated live report pane
  - the live supplier rows table
- The textarea is editable only when:
  - sample/manual mode is active, and
  - `All Markets` is selected
- When a specific market is selected, the textarea becomes a filtered read-only view of the report.

### 12. Customer pricing planning docs were added
- A new customer-pricing workstream was started based on:
  - `C:\Users\deepa\Downloads\Requirements Document (Software).docx`
  - `C:\Users\deepa\Downloads\Updated CostCalculator_.xlsx`
- New planning docs were added under `docs`:
  - `docs/customer-pricing-implementation-plan.md`
  - `docs/customer-pricing-phase1-spec.md`
  - `docs/customer-pricing-backlog.md`
  - `docs/customer-pricing-schema-foundation.md`
- These documents now serve as the implementation guideline for the new customer pricing engine and output system.
- Key conclusion:
  - this should be built as a pricing engine plus customer output workflow
  - not as a spreadsheet clone and not as an extension of the current React-only pricing formulas

### 13. Customer pricing schema foundation was added in code
- The first database schema pass was added in:
  - `apps/api/src/db.js`
- New tables added:
  - `customers`
  - `customer_contacts`
  - `customer_pricing_profiles`
  - `pricing_source_snapshots`
  - `pricing_source_values`
  - `pricing_tax_schedules`
  - `pricing_rule_sets`
  - `pricing_rule_components`
  - `pricing_rule_vendor_sets`
  - `pricing_export_templates`
  - `generated_customer_prices`
  - `pricing_export_jobs`
- Supporting indexes were also added in `apps/api/src/db.js`.
- This remains the schema foundation for the customer pricing engine and output workflow.

### 14. Customer pricing backend and admin workspace now extend beyond the initial schema/API pass
- The first API pass was added in:
  - `apps/api/src/server.js`
- Initial routes implemented:
  - `GET /customers`
  - `POST /customers`
  - `GET /customers/:id`
  - `PATCH /customers/:id`
  - `GET /customers/:id/pricing-profile`
  - `PUT /customers/:id/pricing-profile`
  - `GET /pricing/sources`
  - `POST /pricing/sources`
- Additional backend routes were added after that initial pass:
  - `GET /pricing/sources/:id`
  - `POST /pricing/sources/:id/values`
  - `GET /pricing/taxes`
  - `PUT /pricing/taxes`
  - `GET /pricing/rules`
  - `POST /pricing/rules`
  - `GET /pricing/rules/:id`
  - `PATCH /pricing/rules/:id`
  - `PUT /pricing/rules/:id/components`
  - `PUT /pricing/rules/:id/vendor-sets`
  - `POST /pricing/runs/preview`
  - `POST /customers/:id/contacts`
  - `PATCH /customers/:id/contacts/:contactId`
  - `DELETE /customers/:id/contacts/:contactId`
- These routes are jobber-scoped and use the existing auth/role middleware patterns.
- Supporting backend modules now exist:
  - repository/query layer:
    - `apps/api/src/pricing/repositories.js`
  - pricing engine skeleton:
    - `apps/api/src/pricing/engine.js`
- The pricing preview engine is now rule-aware instead of being only a placeholder:
  - it can evaluate components sourced from:
    - `source_value`
    - `tax`
    - `customer_profile`
    - `vendor_min`
    - `constant/default`
  - it returns a traceable preview shape per product family
  - workbook-oriented profile token references like `$profile.marketKey` and `$profile.terminalKey` are supported in rule metadata/source refs

### 15. Customer pricing workbook-derived test data loader was added
- A local workbook-driven data population script was added:
  - `apps/api/src/applyWorkbookPricingTestData.js`
- API package script added:
  - `npm.cmd --workspace apps/api run seed:pricing-workbook`
- The script uses workbook-derived values from:
  - `C:\Users\deepa\Downloads\Updated CostCalculator_.xlsx`
- Workbook-derived references that were applied into local test data include:
  - spot quote ids:
    - `SFRCRR`
    - `SFRCRP`
    - `SFRCN2`
  - RIN and ethanol references:
    - `USARNC`
    - `SFR799`
  - market adders from workbook row `33`
  - contract-minus values from workbook rows `51-54`
- The script populates local workbook test data for the current local date context:
  - customers
  - customer pricing profiles
  - source snapshot plus source values
  - tax schedules
  - active rule sets and vendor sets
- This script was executed successfully in this session against the local database and reported:
  - `Applied workbook pricing test data for 2 jobber(s) on 2026-03-31. Workbook present=true`

### 16. Separate Price Tables tab was added to the web app
- The existing `Pricing` market dashboard still exists.
- A separate top-level admin workflow tab was added:
  - `Price Tables`
- Key frontend files:
  - `apps/web/src/App.jsx`
  - `apps/web/src/api.js`
  - `apps/web/src/pages/PriceTablesPage.jsx`
  - `apps/web/src/styles.css`
- Current `Price Tables` functionality includes:
  - customer list and customer editing
  - structured customer contact editing
  - pricing profile editing with structured fields for:
    - `branch`
    - `marketKey`
    - `terminalKey`
    - `extraRulesJson` as an escape hatch
  - structured rule editing for:
    - rule components
    - vendor sets
  - structured tax editing
  - source snapshot creation and source-value row entry
  - source snapshot detail viewing
  - pricing preview using `POST /pricing/runs/preview`
- Current route:
  - `http://localhost:5173/price-tables`

## Validation Completed
- Web build succeeded multiple times with:
  - `npm.cmd --workspace apps/web run build`
- API syntax check succeeded with:
  - `node --check apps/api/src/server.js`
- DB schema file syntax check succeeded with:
  - `node --check apps/api/src/db.js`
- Local API health endpoint succeeded:
  - `http://localhost:4000/health`
- Local Pricing API route was verified after restart with demo login.
- Verified pricing payload shape included:
  - benchmark keys: `wti, brent, gasoline, regular, midgrade, premium, diesel`
  - regional sets for `regular` and `diesel`: `NUS, R10, R20, R30, R40, R50`
- Verified encrypted secret save paths were added for:
  - `GET/PUT /jobber/opis-credentials`
  - `GET/PUT /jobber/eia-credentials`
- Verified on localhost at the end of this session:
  - `http://localhost:5173` -> `200`
  - `http://localhost:5173/pricing` -> `200`
  - `http://localhost:4000/health` -> `200`
  - `GET /market/pricing` with demo login -> `200`
  - `GET /market/opis/raw?timing=0&state=ALL&fuelType=all` with demo login -> `200`
- Verified current local secret rows exist for:
  - `jobber-california / opis`
  - `jobber-california / eia`
- Important local secret note:
  - both saved DB secrets currently fail decryption under `PETROLEUM_SECRET_KEY=petroleum-local-dev-key`
  - this means they were encrypted earlier under a different app secret
  - local pricing works right now because the API process was relaunched with the EIA key in env as fallback
  - the next agent should re-save OPIS and EIA secrets in Admin under the current stable app secret
- Earlier tank validations from the original handoff still apply, but note the local SQL dump was later thinned back to `30-minute` history.
- Customer pricing work verification completed:
  - `node --check apps/api/src/db.js` passed after schema changes
  - `node --check apps/api/src/server.js` passed after customer/source/rule/contact API changes
  - `node --check apps/api/src/pricing/repositories.js` passed
  - `node --check apps/api/src/pricing/engine.js` passed
  - `node --check apps/api/src/applyWorkbookPricingTestData.js` passed
  - `npm.cmd --workspace apps/api run build` passed
  - `npm.cmd --workspace apps/web run build` passed
  - the web build still shows the existing Vite large chunk warning, but it is not a build failure

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
$env:PETROLEUM_SECRET_KEY='your-stable-secret-key'

npm.cmd run seed
npm.cmd run dev
```

If starting the API and web separately, use:

```powershell
cd C:\Users\deepa\source\repos\Petroleum

$env:DATABASE_URL='postgres://postgres:postgres@localhost:5432/petroleum'
$env:PGSSL='disable'
$env:PETROLEUM_SECRET_KEY='your-stable-secret-key'

npm.cmd --workspace apps/api run dev
npm.cmd --workspace apps/web run dev
```

If the next agent needs the local Pricing page to work immediately before re-saving the EIA key in Admin, they can temporarily start the API with:

```powershell
$env:EIA_API_KEY='[current valid local EIA key]'
```

That should be treated as a temporary fallback only until the DB secret is re-saved under the active app secret.

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
- MUI Web: `http://localhost:5174`
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
  - route now uses official EIA API v2 seriesid endpoints
  - it requires a valid EIA key from env or encrypted jobber storage
  - forward curves are still mock data
  - `Update now` triggers a fresh dashboard reload, but only EIA-backed sections are truly live
  - if the Pricing page stops updating, check `DATABASE_URL`, `PGSSL`, `PETROLEUM_SECRET_KEY`, and whether the current jobber has an EIA key configured
- Customer pricing workstream notes:
  - implementation guidance now lives under `docs/customer-pricing-*.md`
  - schema foundation keys now live in `docs/customer-pricing-schema-foundation.md`
  - current backend files to read first:
    - `apps/api/src/server.js`
    - `apps/api/src/pricing/repositories.js`
    - `apps/api/src/pricing/engine.js`
    - `apps/api/src/applyWorkbookPricingTestData.js`
  - current frontend files to read first:
    - `apps/web/src/App.jsx`
    - `apps/web/src/api.js`
    - `apps/web/src/pages/PriceTablesPage.jsx`
    - `apps/web/src/styles.css`
  - workbook-derived local pricing test data was applied on `2026-03-31`
  - after the latest backend edits, restart the local API again before testing newer customer-pricing routes/UI
  - current next logical coding steps are:
    - add generated pricing run/history/output screens to `Price Tables`
    - then replace freeform canonical market/product/vendor key inputs with controlled dropdowns/selects
    - then continue toward export templates and generated customer output workflows
- Allied MUI notes:
  - route is now under `apps/web-mui/src/pages/AlliedPage.jsx`
  - first pass is intentionally layered instead of copying the full legacy density
  - current flow is:
    - portfolio site selection
    - focused site header and KPI strip
    - tabbed analysis: `overview`, `issues`, `pumps`, `transactions`
    - selected transaction detail only after tap/click
  - if extending this page, preserve phone-first selection and avoid reintroducing always-open desktop-style filter grids
- Admin MUI notes:
  - `apps/web-mui/src/pages/AdminPreviewPage.jsx` is no longer just a placeholder
  - first MUI admin slice is jobber-first:
    - `overview`
    - `branding`
    - `credentials`
    - `pricing`
  - current scope is:
    - jobber branding edit
    - OPIS credential save
    - EIA key save
    - read-only pricing config status
  - do not jump straight from this into the full legacy station editor inside MUI
  - if extending Admin next, keep the same pattern:
    - summary/status first
    - write forms below
    - one admin task at a time on phone
- OPIS page notes:
  - current live market route is `GET /market/opis`
  - it requires valid OPIS credentials from env or encrypted jobber storage
  - Admin > Branding now includes both OPIS and EIA credential forms for jobber admins
- OPIS raw page notes:
  - current raw route is `GET /market/opis/raw`
  - it now combines `SupplierPrices` and `Summary`
  - the raw report generator uses `SupplierPrices` for supplier rows and `Summary` for benchmark metric rows where possible
  - current filters in the raw tab are:
    - `Market Filter`
    - `Type Filter`
  - if the displayed report does not change with filters, inspect `apps/web/src/pricing/pages/PricingPage.tsx`
- Secret storage note:
  - encrypted secrets are stored in `jobber_secrets`
  - pricing rate configs are stored in `jobber_pricing_configs`
  - if `PETROLEUM_SECRET_KEY` changes between restarts, previously saved encrypted secrets will no longer decrypt
  - when that happens, the fix is to re-save the affected secret in Admin under the active app secret

