# Customer Pricing Handoff

## Current State

The customer-pricing workstream has moved from planning into a working admin workflow called `Price Tables`.

Implemented files of record:

- `apps/api/src/server.js`
- `apps/api/src/pricing/repositories.js`
- `apps/api/src/pricing/engine.js`
- `apps/api/src/applyWorkbookPricingTestData.js`
- `apps/web/src/App.jsx`
- `apps/web/src/api.js`
- `apps/web/src/pages/PriceTablesPage.jsx`
- `apps/web/src/styles.css`

The source document from the requirements phase is stored in:

- `docs/source-materials/requirements-document-software.docx`

## What Works Now

- Customer CRUD
- Customer contacts CRUD
- Customer pricing profile editing
- Pricing source snapshots and source values
- Tax schedule CRUD
- Rule set CRUD
- Rule component editing
- Vendor-set editing
- Pricing preview with per-product trace output
- Generated pricing run persistence
- Generated output browsing and detail viewing
- Workbook-derived local seed data for demo/test use

## Operator Steps

1. Start the API with local env vars set:

```powershell
$env:DATABASE_URL='postgres://postgres:postgres@localhost:5432/petroleum'
$env:PGSSL='disable'
$env:PETROLEUM_SECRET_KEY='your-stable-secret-key'
```

2. If you need the workbook-derived demo data, run:

```powershell
npm.cmd --workspace apps/api run seed:pricing-workbook
```

3. Start the API again after any backend edits.

4. Open the web app and use the `Price Tables` tab:

- `/price-tables`

## Known Gaps

- The pricing engine is still a skeleton, not the full workbook clone.
- Workbook-specific branching and branded/unbranded orchestration are not fully finished.
- Export templates and actual email/fax output generation are not implemented yet.
- The UI can preview and persist outputs, but it does not yet produce customer-facing files in the required formats.
- Validation is still light on some rule/profile/source inputs.
- Automated tests for the new pricing engine and output workflow are still missing.

## Requirements vs Implementation

The requirements doc asks for daily pricing updates, customer-specific formulas, and customer-ready outputs.

Current implementation coverage:

- Daily-ish inputs are represented as source snapshots, tax schedules, and rule sets.
- Customer-specific pricing profiles exist and are editable.
- Preview and persisted output history exist.

Current mismatch points:

- The requirements call out Format 1 and additional formats for email/fax delivery, but the app only has preview/history so far.
- The requirements talk about daily OPIS, branded zone, and branded area updates as business inputs, while the implementation stores normalized source snapshots and source values rather than a dedicated import pipeline.
- Some workbook concepts are still modeled as flexible JSON or generic source metadata instead of hard canonical selectors.

## Next Milestones

1. Add output template models and renderers.
2. Add generated customer output exports for the first required format.
3. Tighten canonical keys and dropdowns in the `Price Tables` editor.
4. Add formula tests for the workbook-derived rule paths.
5. Add source-import workflow improvements if the team wants to move beyond manual snapshot entry.

