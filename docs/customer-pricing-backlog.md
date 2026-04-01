# Customer Pricing Backlog

## Purpose
This backlog turns the customer pricing planning documents into an execution list.

Related docs:

- [customer-pricing-implementation-plan.md](C:/Users/deepa/source/repos/Petroleum/docs/customer-pricing-implementation-plan.md)
- [customer-pricing-phase1-spec.md](C:/Users/deepa/source/repos/Petroleum/docs/customer-pricing-phase1-spec.md)

## Working Rule
Build the backend model and pricing engine before building heavy customer-output UI.

## Now
These items should be done first.

### 1. Normalize domain keys
- Define canonical product families:
  - regular
  - mid
  - premium
  - diesel
  - branded and unbranded variants where needed
- Define canonical market keys:
  - benicia
  - stockton
  - sacramento
  - san_jose
  - san_francisco
- Define source type taxonomy:
  - opis
  - branded_zone
  - branded_area
  - tax
  - manual_adjustment

### 2. Add database tables
- Done in initial schema pass on `2026-03-31`:
  - `customers`
  - `customer_contacts`
  - `customer_pricing_profiles`
  - `pricing_source_snapshots`
  - `pricing_source_values`
  - `pricing_tax_schedules`
  - `pricing_rule_sets`
  - `pricing_rule_components`
  - `pricing_rule_vendor_sets`
  - `generated_customer_prices`
  - `pricing_export_templates`
  - `pricing_export_jobs`
- Next for this milestone:
  - validate local DB initialization
  - add repository/query helpers
  - add first customer/source APIs

### 3. Add backend model/repository layer
- Add query helpers for customers
- Add query helpers for source snapshots and values
- Add query helpers for tax schedules
- Add query helpers for pricing rules
- Add query helpers for generated outputs

### 4. Formalize workbook formulas
- Convert workbook sections into named rule groups
- Identify every required input cell/value
- Identify every derived output
- Mark which values are:
  - source data
  - customer config
  - formula constant
  - computed output
- Document any formulas that are still ambiguous

### 5. Build pricing-engine skeleton
- Create server-side pricing calculation module
- Accept:
  - pricing date
  - customer profile
  - source snapshot group
  - rule set
- Return:
  - base prices
  - taxes
  - totals
  - component trace

### 6. Add test coverage for core formulas
- Spot formula path
- Unbranded formula path
- Diesel path
- Vendor minimum logic
- Tax application
- Missing-input handling

## Next
These items should follow immediately after the core backend foundation exists.

### 7. Customer APIs
- Initial pass completed on `2026-03-31`:
  - `GET /customers`
  - `POST /customers`
  - `GET /customers/:id`
  - `PATCH /customers/:id`
  - `GET /customers/:id/pricing-profile`
  - `PUT /customers/:id/pricing-profile`
- Next:
  - add customer contacts CRUD
  - add validation tightening
  - add audit logging

### 8. Source input APIs
- Initial pass completed on `2026-03-31`:
  - `GET /pricing/sources`
  - `POST /pricing/sources`
- `GET /pricing/sources/:id`
- `POST /pricing/sources/:id/values`
- `GET /pricing/taxes`
- `PUT /pricing/taxes`

### 9. Rule APIs
- `GET /pricing/rules`
- `POST /pricing/rules`
- `GET /pricing/rules/:id`
- `PATCH /pricing/rules/:id`
- `PUT /pricing/rules/:id/components`
- `PUT /pricing/rules/:id/vendor-sets`

### 10. Pricing run APIs
- `POST /pricing/runs`
- `GET /pricing/runs/:date`
- `GET /pricing/outputs`
- `GET /pricing/outputs/:id`

### 11. Customer UI
- Customer list page
- Customer detail page
- Customer pricing profile form
- Customer contacts form

### 12. Daily source input UI
- Pricing-date source snapshot page
- Entry forms for:
  - OPIS-related values
  - branded zone values
  - branded area values
  - taxes
- Missing-data warnings

### 13. Rule editor UI
- Rule set list
- Rule set detail
- Component editor
- Vendor selection editor

## Later
These items should come after the first end-to-end pricing run works.

### 14. Generated output preview
- Price sheet preview per customer
- Component trace view
- Side-by-side comparison with current workflow if needed

### 15. Template system
- Implement Format 1
- Add merge-field schema
- Add alternate template support

### 16. Export pipeline
- Export HTML/email-ready output
- Export printable/PDF-friendly output
- Add export job history

### 17. Worker automation
- Scheduled source completeness checks
- Scheduled pricing runs
- Exception reporting for missing source data

### 18. Source import automation
- Optional import from structured files
- Later parsing support for inbound PDFs/emails

### 19. Audit and history
- Generated-price history
- Template/version history
- Rule change history
- Source snapshot history

## Suggested Ticket Breakdown
### Backend Foundation
- Define pricing enums and keys
- Add new pricing tables to DB init
  - initial pass completed in `apps/api/src/db.js`
- Add customer repository
- Add source snapshot repository
- Add tax schedule repository
- Add pricing rule repository
- Add generated output repository

### Pricing Engine
- Implement pricing-engine module
- Implement component evaluation
- Implement vendor minimum selector
- Implement tax resolver by effective date
- Implement detailed result trace
- Add unit tests for workbook-derived formulas

### Frontend Foundation
- Add customer pricing routes/navigation
- Add customer list/detail pages
- Add source input pages
- Add rule editor pages
- Add price-run page

### Output Layer
- Add template data model
- Add Format 1 renderer
- Add preview screen
- Add export job screen

## Dependencies
### Required before customer UI
- canonical product/market keys
- customer schema
- source snapshot schema

### Required before output generation
- pricing engine
- generated output schema
- template schema

### Required before automation
- stable source input workflow
- stable generation workflow

## Open Questions To Resolve Early
- Exact Format 2 requirements
- Holiday/weekend pricing behavior
- Whether outputs should be immutable once generated
- Whether branded area pricing is a source input or override layer
- Whether customer pricing profiles require approval workflow

## Recommended Immediate Start Order
1. Define enums and canonical keys
2. Add schema tables
3. Build pricing-engine skeleton
4. Write formula tests from workbook logic
5. Add customer and source APIs
6. Add customer/source maintenance UI
