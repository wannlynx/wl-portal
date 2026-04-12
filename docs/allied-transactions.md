# Allied Transactions

Site Detail now includes an `Allied` tab for site-specific transaction analytics.

Implemented pieces:

- Postgres table: `allied_transactions`
- Seeded demo transaction stream per site with aborts, fallback spikes, malformed PAN/expiry cases, auth mismatches, zero-dollar completes, and pump concentration patterns
- Indexed filters on site/timestamp plus requested operational dimensions
- API endpoints:
  - `GET /sites/:id/allied-transactions/summary`
  - `GET /sites/:id/allied-transactions`
  - `GET /sites/:id/allied-transactions/export`
- Frontend page sections:
  - filters and quick presets
  - KPI cards
  - trend charts
  - issue insights
  - pump health
  - paginated detail table
  - detail drawer with derived validation checks

Interaction model:

- Clicking a KPI applies its linked filter to the detail table
- Clicking a payment/card/entry/denial chart bucket applies a matching filter
- Clicking an issue card applies the issue drill-down filter set
- Clicking a pump health row filters to that fuel position

Notes:

- The page uses business transaction `timestamp` for analytics.
- Export respects the active filters.
- The drawer includes a placeholder note for future event-timeline support if Allied transaction stage events are later added.
- Before treating Allied UI work as verified, confirm both `http://localhost:5173` and `http://localhost:4000` are up. Do not sign off based on code changes alone when the local API or web host is down.
