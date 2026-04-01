# Customer Pricing Schema Foundation

## Purpose
This document defines the initial canonical keys and enum-style values for the customer pricing system.

It should be used before creating database tables or API contracts so that:

- source values use consistent identifiers
- rules can reference stable keys
- customer profiles do not depend on freeform labels

Related docs:

- [customer-pricing-implementation-plan.md](C:/Users/deepa/source/repos/Petroleum/docs/customer-pricing-implementation-plan.md)
- [customer-pricing-phase1-spec.md](C:/Users/deepa/source/repos/Petroleum/docs/customer-pricing-phase1-spec.md)
- [customer-pricing-backlog.md](C:/Users/deepa/source/repos/Petroleum/docs/customer-pricing-backlog.md)

## Design Rule
Use stable internal keys for storage and logic.
Use editable display labels only for UI.

## Product Families
These are the first canonical product-family keys.

| Key | Label | Notes |
|---|---|---|
| `regular` | Regular | 87 where applicable |
| `mid` | Midgrade | 89 where applicable |
| `premium` | Premium | 91/93 where applicable |
| `diesel` | Diesel | Includes ULSD/CARB diesel cases unless rule-specific split is needed |

## Pricing Branches
These distinguish logic branches.

| Key | Label |
|---|---|
| `branded` | Branded |
| `unbranded` | Unbranded |
| `spot` | Spot |
| `rack` | Rack |

## Product Keys
These should be used for more detailed source references and formula targeting.

| Key | Label | Product Family |
|---|---|---|
| `reg_87_carb` | 87 CARB | `regular` |
| `mid_89_carb` | 89 CARB | `mid` |
| `premium_91_carb` | 91 CARB | `premium` |
| `diesel_carb_ulsd` | CARB ULSD | `diesel` |
| `diesel_red` | Red Diesel | `diesel` |
| `ethanol` | Ethanol | n/a |
| `rin` | RIN | n/a |
| `lcfs_gasoline` | LCFS Gasoline | n/a |
| `lcfs_diesel` | LCFS Diesel | n/a |
| `ghg_gasoline` | GHG Gasoline | n/a |
| `ghg_diesel` | GHG Diesel | n/a |

## Market Keys
These should identify pricing markets, not customer delivery addresses.

| Key | Label |
|---|---|
| `san_francisco` | San Francisco |
| `benicia` | Benicia |
| `sacramento` | Sacramento |
| `san_jose` | San Jose |
| `stockton` | Stockton |
| `bay_area` | Bay Area |

## Terminal Keys
These are operational terminals or location anchors used for delivery/pricing selection.

| Key | Label |
|---|---|
| `benicia_terminal` | Benicia |
| `stockton_terminal` | Stockton |
| `sacramento_terminal` | Sacramento |
| `san_jose_terminal` | San Jose |
| `san_francisco_terminal` | San Francisco |

## Vendor Keys
These should be stored as normalized identifiers.

Initial set observed or referenced:

| Key | Label |
|---|---|
| `valero` | Valero |
| `psx` | Phillips 66 |
| `tesoro` | Tesoro |
| `marathon` | Marathon |
| `shell` | Shell |
| `chevron` | Chevron |
| `bp` | BP |

## Source Types
These identify where a value entered the system from.

| Key | Label |
|---|---|
| `opis` | OPIS |
| `branded_zone` | Branded Zone Pricing |
| `branded_area` | Branded Area Pricing |
| `tax` | Tax Schedule |
| `manual_adjustment` | Manual Adjustment |
| `derived` | Derived Value |

## Source Value Keys
These identify normalized source values that formulas may reference.

Initial proposed set:

| Key | Label |
|---|---|
| `sf_spot_reg` | SF Spot Regular |
| `sf_spot_premium` | SF Spot Premium |
| `sf_spot_diesel` | SF Spot Diesel |
| `ethanol_prompt_sf` | Ethanol Prompt SF |
| `rin_us` | U.S. RIN Value |
| `unbranded_low_rack_reg` | Unbranded Low Rack Regular |
| `unbranded_low_rack_premium` | Unbranded Low Rack Premium |
| `unbranded_low_rack_diesel` | Unbranded Low Rack Diesel |
| `gas_tax` | Gas Tax |
| `diesel_tax` | Diesel Tax |
| `lcfs_gasoline` | LCFS Gasoline |
| `lcfs_diesel` | LCFS Diesel |
| `ghg_gasoline` | GHG Gasoline |
| `ghg_diesel` | GHG Diesel |
| `market_adder` | Market Adder |
| `contract_minus` | Contract Minus |

## Quote Codes
Quote codes should be stored as metadata, not as business keys.

Examples from workbook:

- `SFRCRR`
- `SFRCRP`
- `SFRCN2`
- `SFR799`
- `USARNC`
- `CAL1EP`
- `CAL1AP`
- `CAL1GP`
- `CAL1DP`

These should live in `quote_code` or `metadata_json`, not replace canonical keys.

## Delivery Methods
For output/contact workflows.

| Key | Label |
|---|---|
| `email` | Email |
| `fax_email` | Fax Through Email |
| `manual` | Manual Delivery |

## Template Channels
For generated outputs.

| Key | Label |
|---|---|
| `email_html` | HTML Email |
| `email_text` | Plain Text Email |
| `printable` | Printable |
| `pdf` | PDF |

## Snapshot Status Values
For daily source entry workflows.

| Key | Meaning |
|---|---|
| `draft` | Snapshot created but incomplete |
| `ready` | All required values entered |
| `locked` | Finalized for pricing run |
| `superseded` | Replaced by later snapshot |

## Rule Set Status Values
For pricing rule lifecycle.

| Key | Meaning |
|---|---|
| `draft` | Editable, not active |
| `active` | Current rule set in force |
| `retired` | No longer used |

## Generated Price Status Values
For output lifecycle.

| Key | Meaning |
|---|---|
| `generated` | Price calculated |
| `reviewed` | Reviewed by user |
| `exported` | Output exported/generated |
| `sent` | Sent to customer |
| `failed` | Generation/export/send failed |

## Vendor Selection Modes
These are required for “lowest of” logic.

| Key | Meaning |
|---|---|
| `lowest` | Lowest value across vendor set |
| `highest` | Highest value across vendor set |
| `first_available` | First available source in priority order |
| `specific_vendor` | Force one vendor |

## Formula Component Source Kinds
These define where a rule component gets its input.

| Key | Meaning |
|---|---|
| `source_value` | Pulled from normalized source snapshot data |
| `tax_schedule` | Pulled from tax table |
| `customer_profile` | Pulled from customer pricing profile |
| `constant` | Fixed configured value |
| `derived_component` | Uses output of another component |

## Recommended Immediate Usage
These definitions should be used next for:

1. initial database schema
2. API request/response modeling
3. pricing-engine component design
4. customer/profile form design

## Current Status
As of `2026-03-31`, the first database schema pass using these canonical keys has started in:

- `apps/api/src/db.js`

The next step is to make sure repository and API code use these keys consistently rather than introducing freeform values.

## Open Items
These need confirmation before finalizing the first schema migration.

- Whether `diesel_red` needs to be a first-class detailed product key in Phase 1
- Whether `bay_area` should be a market key, a branded-zone key, or both
- Whether `mid` is always required or optional by customer
- Whether branded area pricing needs a separate terminal hierarchy
