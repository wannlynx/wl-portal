# Price Tables User Guide

This guide supersedes the older technical draft in `docs/user-guide-price-tables.md`.

`Price Tables` is the portal workspace for maintaining customer pricing. Use it to keep customer information up to date, enter the day's pricing inputs, preview the results, and review saved output history.

Current page:

- `http://localhost:5173/price-tables`

This guide is written for portal users. It reflects the current local `Price Tables` screen and the demo data shown on `March 31, 2026`.

## Quick Start

Use this order for the cleanest daily routine:

1. Open `Price Tables`.
2. Confirm the `Pricing Date` at the top right.
3. Select the customer you want to work on.
4. Update the customer record and pricing profile if needed.
5. Update customer contacts if needed.
6. Open `Inputs` to review taxes and source snapshots for the day.
7. Open `Run Preview` to confirm prices look right.
8. Generate prices for one customer or for all customers.
9. Review the saved history and output detail before sending anything out.

## Page Overview

The page is designed as one workflow. The top area lets you choose the pricing date and customer. The lower workspace changes depending on the view you choose.

![Price Tables overview](images/price-tables-guide/01-overview.png)

## Customer And Pricing Profile

Use the left side of the page to choose a customer or create a new one. After you select a customer, update the address and status fields, then save the record. Below that, use the pricing profile area for pricing-specific settings such as freight, margins, discounts, branch, market, and terminal.

![Customer and pricing profile](images/price-tables-guide/02-customer-profile.png)

Tips:

- Save the customer record after changing name, address, terminal, or status.
- Save the pricing profile after changing pricing fields.
- Only change advanced fields if your team already has a standard for them.

## Contacts

Use the `Contacts` area to maintain the people who receive pricing messages. Add a row, enter the contact details, choose the delivery method shown on screen, and then save.

![Contacts section](images/price-tables-guide/03-contacts.png)

Use this section when:

- a new customer contact needs to be added
- a primary contact changes
- a delivery address for email or fax-through-email changes

## Preview

Select the customer, then click `Run Preview` near the top of the page. The preview area shows whether the customer is ready, how many active rules were used, how many source values were found, and the calculated prices for each fuel type.

![Preview results](images/price-tables-guide/04-preview-ready.png)

Before moving on, confirm:

- the preview status is ready
- each fuel type shows the price you expect
- nothing looks blank or obviously out of date

Current basis behavior:

- `Spot Basis` comes from the latest available OPIS Spot API average for the mapped product.
- `Rack Basis` comes from the first available OPIS Rack API snapshot after `6:00 AM ET`.
- If either live input is missing, the preview shows the missing-input problem instead of silently using an old workbook/demo value.

## Price Run And Daily History

The `Price Run` panel is where you save prices for the selected day. Use `Generate Selected` when you are working on one customer, or `Generate All` when the day's setup is complete for everyone.

![Price run and history](images/price-tables-guide/05-history-and-run-review.png)

Use the history list to confirm:

- the run was created for the correct date
- the saved totals look reasonable
- there are no missing or incomplete results

For the current workflow, only three fuel products are used in output review:

- `REG 87`
- `PRE 91`
- `Diesel`

When you open output detail:

- `Spot Basis` and `Derived Spot` reflect the live OPIS Spot API value path.
- `Rack Basis` and `Derived Rack` reflect the first available post-`6:00 AM ET` OPIS Rack API path.
- The trace should show when the live source was observed so you can confirm the basis timing.

## Rules, Components, And Vendor Sets

Open the workspace view picker and choose `Rules` when you need to review or update pricing logic. This screen is typically used by the person who maintains the company's pricing setup, not by every daily user.

![Rules workspace](images/price-tables-guide/06-rules.png)

Use this area when:

- a formula changes
- a rule must be activated or retired
- a vendor list used in pricing must be updated

If your company's rules are already in place, you can usually leave this section alone during normal daily work.

## Taxes, Source Snapshots, And Source Values

Choose `Inputs` in the workspace view picker to maintain the day's pricing inputs. This is where you review taxes and the daily source snapshot entries used for pricing.

![Inputs, taxes, and source snapshots](images/price-tables-guide/07-inputs-taxes-sources.png)

Use this view to:

- review or update tax rows for the pricing date
- create a new source snapshot for the day
- add or correct source rows before running preview

## Source Snapshot Detail

In the same `Inputs` view, the lower section shows the currently selected source snapshot in detail. Use it to confirm that the correct market, terminal, product, vendor, quote, and value rows were loaded for the day.

![Source snapshot detail](images/price-tables-guide/08-source-snapshot-detail.png)

This is the best place to check the actual rows behind the day's pricing.

## Source Rows For The Selected Customer

Choose `OPIS Report` in the workspace view picker to see the filtered source rows for the customer's selected terminal. This is useful when you want to confirm that the customer is pulling from the expected daily source data.

![Filtered source rows](images/price-tables-guide/09-opis-report.png)

Use this view when:

- you want to confirm the rows tied to the customer's terminal
- you need to compare source entries before rerunning preview

## Generated Outputs And Output Detail

Choose `Output Log` in the workspace view picker to review saved output detail for the selected day. This view shows the chosen output record, the saved totals, and the detail behind that generated result.

![Generated output log](images/price-tables-guide/10-generated-outputs-log.png)

Use this view to confirm:

- the correct customer record was saved
- the saved output matches the totals you expected
- the record you plan to use is the right one

## If Something Looks Wrong

Start with these checks:

1. Make sure the `Pricing Date` is correct.
2. Make sure you selected the correct customer.
3. Review `Inputs` to confirm taxes and source snapshots are present for that date.
4. Run `Preview` again after making corrections.
5. Review `Output Log` after generating to make sure the saved result matches what you expected.

## Current Scope

`Price Tables` currently supports the pricing workflow inside the portal: customer setup, daily inputs, preview, generation, and saved history review. Customer-facing export templates and final delivery formats are still a later step, so use the saved portal output as your review point for now.
