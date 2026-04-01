# Customer Pricing Implementation Plan

## Purpose
This document is the working guideline for building the customer pricing system described in:

- `C:\Users\deepa\Downloads\Requirements Document (Software).docx`
- `C:\Users\deepa\Downloads\Updated CostCalculator_.xlsx`

The goal is to build a production pricing workflow inside Petroleum that:

- ingests daily pricing inputs
- stores customer-specific pricing rules and overrides
- calculates daily sell prices for fuel products
- generates customer-ready pricing outputs

This is not a spreadsheet-clone project. It is a pricing engine plus customer output system.

## Product Goal
Support the daily BMI Petroleum pricing workflow by combining:

- market source inputs
- customer pricing configuration
- editable business formulas
- generated customer pricing outputs

The system must be maintainable, auditable, and adaptable as formulas, vendors, taxes, and customer requirements change.

## Scope
### In Scope
- Daily source intake for market data and branded pricing
- Customer setup and maintenance
- Formula/rule configuration
- Versioned tax and pricing logic
- Daily price calculation
- Output preview and export
- Audit/history of generated pricing

### Out of Scope For Initial Phase
- Full automation of inbound email/PDF parsing
- Fax infrastructure
- Complex workflow approvals
- Advanced forecasting
- Replacing the existing market-monitoring dashboard

## Business Workflow
### Daily
- Update OPIS values
- Update branded zone pricing
- Update branded area pricing
- Review customer-specific overrides if needed
- Generate daily customer prices
- Export/send pricing in customer-required format

### Periodic
- Update gas tax
- Update diesel tax
- Update formula logic such as LCFS/GHG changes
- Add or update vendors used in "lowest of" logic
- Add new customers

## Core Product Modules
### 1. Source Data Intake
Store dated pricing inputs from:

- OPIS
- branded zone pricing
- branded area pricing
- tax schedules

The system should store snapshots by pricing date, not just current values.

### 2. Customer Pricing Profiles
Each customer needs:

- name
- address
- terminal
- freight miles
- freight cost for gas
- freight cost for diesel
- rack margin
- discounts by product
- preferred output format
- branded/unbranded behavior where relevant

### 3. Pricing Rule Engine
The pricing engine should:

- run on the server
- support effective dates
- support editable components and multipliers
- support vendor-selection rules
- support branded and unbranded branches
- produce traceable calculation outputs

### 4. Output Generation
The system should generate:

- customer price previews
- exportable pricing sheets
- email-ready formats
- later, additional output templates

## Formula Direction
The workbook indicates that pricing logic is component-based and editable.

### Formula Inputs
Likely input categories:

- spot values
- ethanol values
- RIN values
- LCFS values
- GHG values
- taxes
- freight
- margins
- discounts
- branded zone/area prices
- unbranded rack/contract values

### Formula Patterns
Observed patterns in the workbook:

- spot gas formulas using weighted components
- ethanol blend factors
- RIN credits
- branded vs unbranded branches
- market-specific adders
- terminal discount tables
- diesel-specific spot logic
- "lowest of vendor set" rules

### Implementation Rule
Formulas should not live as the final source of truth in React.
They should be represented in backend-owned rule models and services.

## Data Model Direction
Recommended backend tables:

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

### Reuse Existing Tables
These existing tables remain useful:

- `jobbers`
- `sites`
- `jobber_secrets`
- `jobber_pricing_configs`

### Multi-Tenancy
All customer pricing entities should be scoped to the current `jobber`.

## API Direction
Recommended backend areas:

- source ingestion service
- pricing calculation service
- rule evaluation service
- template rendering/export service
- pricing history/audit service

Likely route groups:

- `/customers`
- `/pricing/sources`
- `/pricing/taxes`
- `/pricing/rules`
- `/pricing/runs`
- `/pricing/outputs`
- `/pricing/templates`

## Frontend Direction
Recommended screens:

- Customers
- Customer Pricing Profile
- Daily Source Inputs
- Tax Schedule Maintenance
- Rule Editor
- Daily Price Run / Preview
- Export / Send Queue
- Pricing History

The existing Pricing page can remain useful for:

- OPIS review
- raw source visibility
- market monitoring

But it should not be the final home for the customer pricing production workflow.

## Phased Implementation Plan
### Phase 1. Requirements Normalization
Deliverables:

- source data map
- customer field map
- formula map
- output format map
- open questions list

Goal:

- eliminate ambiguity before schema and service work

### Phase 2. Backend Domain Model
Deliverables:

- new database tables
- migration/init updates
- typed API models

Goal:

- persist source data, customer configs, rules, and generated outputs

### Phase 3. Pricing Engine
Deliverables:

- backend calculation engine
- effective-date-aware rule evaluation
- vendor minimum/selection logic
- formula test coverage

Goal:

- generate trustworthy daily pricing outputs from stored inputs

### Phase 4. Admin Workflows
Deliverables:

- customer CRUD
- daily source input screens
- tax editor
- rule editor

Goal:

- operational users can maintain pricing inputs without editing spreadsheets

### Phase 5. Output Generation
Deliverables:

- Format 1 output support
- additional template support
- preview and export
- batch generation

Goal:

- replace the manual mail merge workflow with managed output generation

### Phase 6. Automation
Deliverables:

- worker-driven pricing runs
- reminders / exceptions for missing sources
- later, optional inbound document processing

Goal:

- reduce daily manual work while preserving review control

## Recommended First Build Steps
1. Convert the workbook into a formal formula specification.
2. Define the customer pricing schema.
3. Build the backend pricing engine with tests.
4. Build customer/profile maintenance screens.
5. Build daily source-entry screens.
6. Build the first customer output template.

## Key Risks
### 1. Requirements Ambiguity
The Word document references missing pages and incomplete export-format details.

Mitigation:

- create a structured open-questions list for the customer before deep implementation

### 2. Formula Drift
Spreadsheet logic may change over time and by effective year.

Mitigation:

- use versioned rule sets and effective dates

### 3. Vendor Logic Expansion
"Lowest of Valero, PSX, Tesoro..." cannot be hardcoded safely.

Mitigation:

- store vendor sets and selection rules as data

### 4. Source Ingestion Complexity
Some source data currently arrives via PDF/email, not API.

Mitigation:

- support manual normalized entry first
- automate intake later

## Open Questions For Customer
- What are all required output formats beyond Format 1?
- Which daily inputs are entered manually vs imported?
- Are branded zone pricing and branded area pricing overrides or primary sources?
- What exact holidays suppress the daily pricing run?
- Which customer fields are mandatory at onboarding?
- How should midgrade be handled when not supplied explicitly?
- What historical audit/reporting is required for generated customer prices?
- Should outputs be stored as rendered documents, structured data, or both?

## Current Repo Reuse Summary
Reusable infrastructure already in Petroleum:

- OPIS integration
- EIA integration
- encrypted provider credential storage
- pricing page scaffolding
- basic pricing config persistence
- jobber/site tenancy

Missing core product pieces:

- customer model
- source snapshot model
- server-side pricing engine
- generated output model
- template/export pipeline

## Working Principle
Build the pricing engine first, then the customer workflows, then the export pipeline.

Do not make the spreadsheet or the current Pricing page the long-term system of record.
