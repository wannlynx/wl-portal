# Customer Pricing Phase 1 Spec

## Purpose
This document expands the high-level plan in:

- [customer-pricing-implementation-plan.md](C:/Users/deepa/source/repos/Petroleum/docs/customer-pricing-implementation-plan.md)

Phase 1 is focused on converting the requirements and workbook into an implementation-ready foundation for backend and frontend work.

## Phase 1 Goal
Define the first production-ready shape of the customer pricing system by specifying:

- backend entities
- core API surface
- frontend screen list
- formula ownership
- milestone order

This phase should remove ambiguity before deeper implementation starts.

## Deliverables
- normalized source-data model
- normalized customer-pricing model
- initial rule-engine model
- initial output-template model
- API endpoint proposal
- screen/workflow proposal
- milestone backlog
- open-questions tracker

## Current Implementation Status
As of `2026-03-31`, the first schema pass has been added in:

- `apps/api/src/db.js`

Tables now present in code:

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

This is the schema foundation only.
The following still need to be built next:

- repository/query helpers
- API routes
- pricing-engine service
- frontend CRUD flows

## Domain Breakdown
### 1. Source Data Domain
This domain stores daily or periodic market inputs.

#### Required inputs
- OPIS-derived source values
- branded zone pricing
- branded area pricing
- gas tax
- diesel tax
- RIN values
- ethanol values
- LCFS values
- GHG values
- market adders

#### Proposed tables
- `pricing_source_snapshots`
- `pricing_source_values`
- `pricing_tax_schedules`

#### Proposed fields
##### `pricing_source_snapshots`
- `id`
- `jobber_id`
- `pricing_date`
- `source_type`
- `source_label`
- `status`
- `received_at`
- `created_at`
- `created_by`
- `notes`

##### `pricing_source_values`
- `id`
- `snapshot_id`
- `market_key`
- `terminal_key`
- `product_key`
- `vendor_key`
- `quote_code`
- `value`
- `unit`
- `effective_date`
- `metadata_json`

##### `pricing_tax_schedules`
- `id`
- `jobber_id`
- `product_family`
- `tax_name`
- `value`
- `unit`
- `effective_start`
- `effective_end`
- `created_at`
- `created_by`

### 2. Customer Domain
This domain stores customer setup and pricing-related overrides.

#### Proposed tables
- `customers`
- `customer_contacts`
- `customer_pricing_profiles`

#### Proposed fields
##### `customers`
- `id`
- `jobber_id`
- `name`
- `address_line1`
- `address_line2`
- `city`
- `state`
- `postal_code`
- `terminal_key`
- `status`
- `created_at`
- `updated_at`

##### `customer_contacts`
- `id`
- `customer_id`
- `name`
- `email`
- `phone`
- `fax_email`
- `is_primary`
- `delivery_method`

##### `customer_pricing_profiles`
- `id`
- `customer_id`
- `effective_start`
- `effective_end`
- `freight_miles`
- `freight_cost_gas`
- `freight_cost_diesel`
- `rack_margin_gas`
- `rack_margin_diesel`
- `discount_regular`
- `discount_mid`
- `discount_premium`
- `discount_diesel`
- `output_template_id`
- `rules_json`
- `created_at`
- `updated_at`

### 3. Rule Engine Domain
This domain stores formula structure and vendor-selection logic.

#### Proposed tables
- `pricing_rule_sets`
- `pricing_rule_components`
- `pricing_rule_vendor_sets`

#### Proposed fields
##### `pricing_rule_sets`
- `id`
- `jobber_id`
- `name`
- `product_family`
- `effective_start`
- `effective_end`
- `status`
- `version_label`
- `notes`
- `created_at`
- `updated_at`

##### `pricing_rule_components`
- `id`
- `rule_set_id`
- `component_key`
- `label`
- `source_kind`
- `source_ref`
- `default_value`
- `multiplier`
- `sort_order`
- `is_editable`
- `metadata_json`

##### `pricing_rule_vendor_sets`
- `id`
- `rule_set_id`
- `selection_mode`
- `product_family`
- `market_key`
- `vendors_json`

#### Initial rule capabilities
- weighted source components
- additive adjustments
- subtractive credits
- market-specific adders
- customer-specific overrides
- branded/unbranded branch support
- vendor minimum logic:
  - lowest of configured vendor set

### 4. Generated Output Domain
This domain stores daily generated customer pricing.

#### Proposed tables
- `generated_customer_prices`
- `pricing_export_templates`
- `pricing_export_jobs`

#### Proposed fields
##### `generated_customer_prices`
- `id`
- `jobber_id`
- `customer_id`
- `pricing_date`
- `rule_set_id`
- `source_snapshot_group_json`
- `regular_base`
- `mid_base`
- `premium_base`
- `diesel_base`
- `regular_total`
- `mid_total`
- `premium_total`
- `diesel_total`
- `detail_json`
- `status`
- `created_at`
- `created_by`

##### `pricing_export_templates`
- `id`
- `jobber_id`
- `name`
- `channel`
- `template_body`
- `template_schema_json`
- `is_default`
- `created_at`
- `updated_at`

##### `pricing_export_jobs`
- `id`
- `jobber_id`
- `pricing_date`
- `template_id`
- `status`
- `requested_by`
- `started_at`
- `completed_at`
- `result_json`

## API Proposal
### Customer APIs
- Implemented initial pass in `apps/api/src/server.js`:
  - `GET /customers`
  - `POST /customers`
  - `GET /customers/:id`
  - `PATCH /customers/:id`
  - `GET /customers/:id/pricing-profile`
  - `PUT /customers/:id/pricing-profile`

### Source Data APIs
- Implemented initial pass in `apps/api/src/server.js`:
  - `GET /pricing/sources`
  - `POST /pricing/sources`
- `GET /pricing/sources/:id`
- `POST /pricing/sources/:id/values`
- `GET /pricing/taxes`
- `PUT /pricing/taxes`

### Rule APIs
- `GET /pricing/rules`
- `POST /pricing/rules`
- `GET /pricing/rules/:id`
- `PATCH /pricing/rules/:id`
- `PUT /pricing/rules/:id/components`
- `PUT /pricing/rules/:id/vendor-sets`

### Generation APIs
- `POST /pricing/runs`
- `GET /pricing/runs/:date`
- `GET /pricing/outputs`
- `GET /pricing/outputs/:id`

### Template APIs
- `GET /pricing/templates`
- `POST /pricing/templates`
- `PATCH /pricing/templates/:id`
- `POST /pricing/export-jobs`

## Frontend Screen Proposal
### Admin / Pricing Workspace
- `Customers`
- `Customer Detail`
- `Daily Source Inputs`
- `Tax Schedules`
- `Pricing Rules`
- `Price Run`
- `Generated Outputs`
- `Templates`

### Existing Pricing Page Reuse
Current Pricing page should remain focused on:

- market monitor
- OPIS review
- raw-source validation

It can link into the production pricing workspace, but should not own the full customer pricing workflow.

## Screen Responsibilities
### Customers
- list customers
- create/edit customer
- attach contacts
- assign terminal

### Customer Detail
- freight and margin configuration
- discounts by product
- output template selection
- rule override review

### Daily Source Inputs
- create pricing-date snapshot
- enter or import source values
- review missing required inputs
- mark snapshot ready

### Tax Schedules
- create new effective-date tax rows
- review historical tax changes

### Pricing Rules
- define formula components
- assign source references
- define vendor-selection logic
- preview formulas

### Price Run
- select pricing date
- validate source completeness
- generate prices for all customers or selected customers
- review exceptions

### Generated Outputs
- preview customer-specific output
- export document/email body
- track generated history

### Templates
- manage Format 1
- add future formats
- define merge fields

## Milestone Backlog
### Milestone 1. Modeling
- define table schemas
- define enums/keys
- define product families and market keys
- define source type taxonomy

### Milestone 2. Persistence
- add schema creation in API
- add repository/query layer
- add typed response models

### Milestone 3. Calculation Engine
- implement rule execution
- implement effective-date resolution
- implement vendor minimum logic
- add unit tests for workbook-derived formulas

### Milestone 4. Customer Workflows
- build customer CRUD
- build pricing profile editor

### Milestone 5. Source Workflows
- build source snapshot entry UI
- build tax maintenance UI

### Milestone 6. Daily Price Generation
- run daily calculations
- persist outputs
- support preview

### Milestone 7. Export Templates
- build Format 1 template
- preview export output
- support future alternate formats

## Open Questions To Resolve Before Milestone 2
- What exact fields define Format 2 and any other required formats?
- Which source values are manual entry versus imported from provider feeds?
- What should the canonical product keys be for:
  - regular
  - mid
  - premium
  - diesel
  - branded and unbranded variants
- How should terminal keys be standardized?
- Should generated outputs be immutable after creation?
- Should customer pricing be generated for weekends/holidays using prior-day inputs?
- How should missing daily source values block or warn on price generation?

## Recommended Immediate Next Task
Start Milestone 1 by writing the first concrete schema plan for:

- product families
- market keys
- customer pricing profile fields
- source snapshot structure
- rule set/component structure

That should be the first coding-oriented design artifact before database changes begin.
