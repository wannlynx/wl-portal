# Price Tables User Guide

## Purpose

`Price Tables` is the customer pricing workspace for setting up customers, maintaining pricing inputs, previewing calculated prices, and reviewing generated daily outputs.

Use it when you need to:

- create or update a customer
- manage customer contacts
- save a customer pricing profile
- enter taxes for a pricing date
- create source snapshots and source values
- configure rule sets, components, and vendor sets
- preview daily pricing
- generate and review persisted pricing outputs

Current route:

- `http://localhost:5173/price-tables`

## Before You Start

Make sure the local API is running.

Typical local startup:

```powershell
cd C:\Users\deepa\source\repos\Petroleum

$env:DATABASE_URL='postgres://postgres:postgres@localhost:5432/petroleum'
$env:PGSSL='disable'
$env:PETROLEUM_SECRET_KEY='your-stable-secret-key'

powershell -ExecutionPolicy Bypass -File .\scripts\start-local-api.ps1
```

If you want workbook-based local demo data, run:

```powershell
cd C:\Users\deepa\source\repos\Petroleum
npm.cmd --workspace apps/api run seed:pricing-workbook
```

Then refresh the web app.

## What The Screen Contains

The `Price Tables` page is organized around these work areas:

1. `Customer and profile`
2. `Preview`
3. `Price Run`
4. `Generated Outputs`
5. rule, tax, and source input work areas in the same page workflow

The `Pricing Date` at the top controls which taxes, source snapshots, preview data, and generated outputs you are working with.

## Recommended Daily Workflow

Use this order for the cleanest workflow:

1. Set the `Pricing Date`
2. Select or create the customer
3. Save the customer pricing profile
4. Add or update customer contacts
5. Save taxes for the date
6. Create a source snapshot and enter source values
7. Confirm the active rule set is correct
8. Run `Preview`
9. Fix any missing inputs shown in the warning area
10. Generate the output
11. Review the generated output history and detail

## Customer And Profile

### Create a customer

1. Open `Price Tables`
2. In the `Customers` panel, click `New Customer`
3. Fill in the customer fields
4. Click `Save Customer`

Important notes:

- `name` is required
- `terminalKey` must match a valid terminal key accepted by the system
- customer status should normally remain `active` unless the customer should no longer be used

### Save a pricing profile

The pricing profile stores the customer-specific pricing inputs used by the pricing engine.

Common fields:

- `effectiveStart`
- `effectiveEnd`
- `freightMiles`
- `freightCostGas`
- `freightCostDiesel`
- `rackMarginGas`
- `rackMarginDiesel`
- `discountRegular`
- `discountMid`
- `discountPremium`
- `discountDiesel`
- `branch`
- `marketKey`
- `terminalKey`

Steps:

1. Select the customer
2. Enter or update the profile fields
3. Click `Save Profile`

Notes:

- `branch` should match the intended pricing branch, such as `unbranded` or `branded`
- `marketKey` and `terminalKey` must use valid canonical keys
- `extraRulesJson` is an advanced field and should only be edited if you know the exact JSON structure required

## Contacts

Use the `Contacts` section to manage who receives pricing communication.

Steps:

1. Select the customer
2. Click `Add Contact` to create a new row
3. Enter contact details
4. Mark `Primary` when needed
5. Set the delivery method
6. Click `Save Contacts`

Current supported delivery methods:

- `email`
- `fax_email`
- `manual`

## Taxes

Use the tax section to save effective tax schedules for the selected pricing date.

Each row includes:

- `productFamily`
- `taxName`
- `value`
- `unit`
- `effectiveStart`
- `effectiveEnd`

Steps:

1. Set the correct `Pricing Date`
2. Review or enter tax rows for each product family
3. Click `Save Taxes`

Important notes:

- taxes are date-sensitive
- the preview requires active tax schedules for each product family
- if taxes are missing, preview will show a warning and generation will be incomplete

## Source Snapshots And Source Values

Source snapshots represent the daily pricing input set for the selected date.

### Create a source snapshot

1. Set the `Pricing Date`
2. Enter the source snapshot fields
3. Add source-value rows
4. Click the button to create the snapshot

Common source fields:

- `sourceType`
- `sourceLabel`
- `status`
- `notes`

Common source-value fields:

- `marketKey`
- `terminalKey`
- `productKey`
- `vendorKey`
- `quoteCode`
- `value`
- `unit`
- `effectiveDate`

Important notes:

- only source snapshots in `ready` or `locked` status are used by preview and generation
- `draft` snapshots will not be treated as runnable inputs
- canonical keys must be valid, or the save will fail

## Rules

Use the rules area to define how prices are calculated by product family.

Each rule set contains:

- header information such as `name`, `productFamily`, `status`, and effective dates
- component rows
- vendor sets

### Rule components

A component row can pull values from:

- `customer_profile`
- `tax`
- `source_value`
- `vendor_min`
- `constant`
- `default`

Typical component fields:

- `componentKey`
- `label`
- `sourceKind`
- `sourceRef`
- `defaultValue`
- `multiplier`
- `sortOrder`
- `metadata`

### Vendor sets

Vendor sets are used for lowest-of style logic.

Typical fields:

- `selectionMode`
- `productFamily`
- `marketKey`
- `vendors`

Important notes:

- product family, market key, selection mode, and vendor keys must be valid
- invalid canonical keys will now be rejected by the backend

## Preview

Use `Run Preview` before generating outputs.

The preview shows:

- preview status
- active rule count
- source value count
- missing input warnings
- per-product output cards
- per-product trace details

What to look for:

- `Preview Status`
- warning messages under `missingInputs`
- whether each product family has expected base and total values
- whether the trace lines match the intended source and rule logic

If preview is incomplete:

1. confirm the customer profile is active for the pricing date
2. confirm the date has taxes for each product family
3. confirm at least one source snapshot for the date is `ready` or `locked`
4. confirm required source values exist for rule components

## Generate Price Run

Use the `Price Run` area to persist calculated outputs.

Buttons:

- `Generate Selected`
- `Generate All`

Current behavior:

- generation only persists complete runs
- customers with missing inputs are skipped
- rerunning the same customer and date now preserves history instead of overwriting the earlier output

The run summary shows:

- run date
- total output count
- incomplete count

## Generated Outputs

Use `Generated Outputs` to review persisted pricing records for the selected date.

You can filter by:

- all customers for the date
- selected customer only

Each generated output shows:

- customer
- status
- created timestamp
- totals by family
- persisted trace and source snapshot context

Use this area to confirm:

- the run was actually saved
- the generated values match the preview you expected
- historical reruns for the same date are preserved

## Common Errors

### Invalid canonical key

Cause:

- a field such as `marketKey`, `terminalKey`, `productFamily`, `sourceType`, or `vendorKey` does not match an allowed value

Fix:

- correct the value and save again

### No runnable source snapshot

Cause:

- the date only has `draft` source snapshots

Fix:

- create or update a snapshot so at least one snapshot for the date is `ready` or `locked`

### Missing source value for rule component

Cause:

- a rule component references a source value that does not exist for the selected date and keys

Fix:

- add the missing source value or correct the rule component reference

### Invalid extraRulesJson

Cause:

- the JSON in `extraRulesJson` is malformed

Fix:

- correct the JSON syntax and save again

## Current Limitations

This screen is usable for internal pricing workflow, but it is not yet the final customer-delivery system.

Not fully implemented yet:

- customer-facing export templates
- PDF/email/fax output generation
- full workbook-equivalent branded and unbranded branching
- complete automated test coverage
- fully guided dropdowns for every canonical key in the UI

## Related Docs

- [customer-pricing-handoff.md](C:/Users/deepa/source/repos/Petroleum/docs/customer-pricing-handoff.md)
- [customer-pricing-implementation-plan.md](C:/Users/deepa/source/repos/Petroleum/docs/customer-pricing-implementation-plan.md)
- [customer-pricing-phase1-spec.md](C:/Users/deepa/source/repos/Petroleum/docs/customer-pricing-phase1-spec.md)
- [customer-pricing-backlog.md](C:/Users/deepa/source/repos/Petroleum/docs/customer-pricing-backlog.md)
- [customer-pricing-schema-foundation.md](C:/Users/deepa/source/repos/Petroleum/docs/customer-pricing-schema-foundation.md)
