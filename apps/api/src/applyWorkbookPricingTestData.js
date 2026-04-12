require("./loadEnv");
const crypto = require("crypto");
const fs = require("fs");
const { query, tx, initDb } = require("./db");

const DEFAULT_WORKBOOK_PATH = "C:\\Users\\deepa\\Downloads\\Updated CostCalculator_.xlsx";
const WORKBOOK_PATH = process.env.PRICING_WORKBOOK_PATH || DEFAULT_WORKBOOK_PATH;

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function centsToDollars(value) {
  return Number((value / 100).toFixed(4));
}

function localCalendarDate(date = new Date(), timeZone = process.env.APP_TIME_ZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

// Values below are derived from the workbook sections in Updated CostCalculator_.xlsx.
// The script uses hard-coded extracted values, so the workbook file itself is not required at runtime.
// PRICING_WORKBOOK_PATH is only used for operator visibility in logs and notes.
//
// - RIN / Ethanol quote ids: USARNC / SFR799
// - Market adders row 33
// - Contract-minus table rows 51-54
const MARKET_CONFIGS = [
  { marketKey: "benicia", terminalKey: "benicia_terminal", label: "Benicia", distributionLabel: "Fairfield UNB", gasFreight: 0.05, dieselFreight: 0.1, gasSalesTaxRate: 0.08375, dieselSalesTaxRate: 0.13, adder: 0.005, dieselAdder: 0.012, contractMinus: { regular: -4, mid: -4, premium: -4, diesel: -2 } },
  { marketKey: "stockton", terminalKey: "stockton_terminal", label: "Stockton", distributionLabel: "Stockton", gasFreight: 0.07, dieselFreight: 0.1, gasSalesTaxRate: 0.08875, dieselSalesTaxRate: 0.13, adder: 0.011, dieselAdder: -0.01, contractMinus: { regular: -3, mid: -3, premium: -3, diesel: -1 } },
  { marketKey: "sacramento", terminalKey: "sacramento_terminal", label: "Sacramento", distributionLabel: "Sacramento UNB", gasFreight: 0.05, dieselFreight: 0.1, gasSalesTaxRate: 0.08375, dieselSalesTaxRate: 0.13, adder: 0.02, dieselAdder: 0, contractMinus: { regular: -3, mid: -3, premium: -3, diesel: 0 } },
  { marketKey: "san_jose", terminalKey: "san_jose_terminal", label: "San Jose", distributionLabel: "San Jose UNB", gasFreight: 0.07, dieselFreight: 0.1, gasSalesTaxRate: 0.08875, dieselSalesTaxRate: 0.13, adder: 0.02, dieselAdder: 0, contractMinus: { regular: -2.5, mid: -2.75, premium: -3, diesel: 0 } }
];

async function ensureWorkbookCustomer(client, jobberId, pricingDate, market) {
  const name = `Workbook Test ${market.label}`;
  const existing = await client.query(`SELECT id FROM customers WHERE jobber_id=$1 AND name=$2 LIMIT 1`, [jobberId, name]);
  const customerId = existing.rowCount ? existing.rows[0].id : id("customer");
  const now = new Date().toISOString();
  if (existing.rowCount) {
    await client.query(
      `UPDATE customers SET terminal_key=$1, updated_at=$2 WHERE id=$3`,
      [market.terminalKey, now, customerId]
    );
  } else {
    await client.query(
      `INSERT INTO customers(
        id, jobber_id, name, address_line1, address_line2, city, state, postal_code, terminal_key, status, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [customerId, jobberId, name, "Workbook Lane", "", market.label, "CA", "00000", market.terminalKey, "active", now, now]
    );
  }

  const profileCheck = await client.query(
    `SELECT id FROM customer_pricing_profiles WHERE customer_id=$1 AND effective_start=$2 LIMIT 1`,
    [customerId, pricingDate]
  );
  const profileId = profileCheck.rowCount ? profileCheck.rows[0].id : id("customer-profile");
  const profileRules = {
    branch: "unbranded",
    marketKey: market.marketKey,
    terminalKey: market.terminalKey,
    distributionLabel: market.distributionLabel,
    gasPrepay: 0.075,
    dieselPrepay: 0.385,
    gasFedExcise: 0.184,
    gasStateExcise: 0.612,
    dieselFedExcise: 0.244,
    dieselStateExcise: 0.466,
    gasSalesTaxRate: market.gasSalesTaxRate,
    dieselSalesTaxRate: market.dieselSalesTaxRate,
    storageFee: 0.02,
    gasRetailMargin: 0.15,
    dieselRetailMargin: 0.15
  };
  if (profileCheck.rowCount) {
    await client.query(
      `UPDATE customer_pricing_profiles
       SET freight_cost_gas=$1, freight_cost_diesel=$2, rack_margin_gas=$3, rack_margin_diesel=$4,
           discount_regular=$5, discount_mid=$6, discount_premium=$7, discount_diesel=$8,
           rules_json=$9::jsonb, updated_at=$10
       WHERE id=$11`,
      [market.gasFreight, market.dieselFreight, 0.15, 0.15, 0, 0, 0, 0, JSON.stringify(profileRules), now, profileId]
    );
  } else {
    await client.query(
      `INSERT INTO customer_pricing_profiles(
        id, customer_id, effective_start, effective_end, freight_miles, freight_cost_gas, freight_cost_diesel,
        rack_margin_gas, rack_margin_diesel, discount_regular, discount_mid, discount_premium, discount_diesel,
        output_template_id, rules_json, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17)`,
      [profileId, customerId, pricingDate, null, 42, market.gasFreight, market.dieselFreight, 0.15, 0.15, 0, 0, 0, 0, null, JSON.stringify(profileRules), now, now]
    );
  }
}

async function ensureWorkbookSnapshot(client, jobberId, pricingDate, userId) {
  const existing = await client.query(
    `SELECT id FROM pricing_source_snapshots WHERE jobber_id=$1 AND pricing_date=$2 AND source_label=$3 LIMIT 1`,
    [jobberId, pricingDate, "Workbook Test Data"]
  );
  const snapshotId = existing.rowCount ? existing.rows[0].id : id("pricing-source");
  const now = new Date().toISOString();
  if (!existing.rowCount) {
    await client.query(
      `INSERT INTO pricing_source_snapshots(
        id, jobber_id, pricing_date, source_type, source_label, status, received_at, created_at, created_by, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [snapshotId, jobberId, pricingDate, "manual_adjustment", "Workbook Test Data", "published", now, now, userId, `Derived from ${WORKBOOK_PATH}`]
    );
  }
  await client.query(`DELETE FROM pricing_source_values WHERE snapshot_id=$1`, [snapshotId]);

  const sharedValues = [
    { marketKey: "san_francisco", terminalKey: "san_francisco_terminal", productKey: "rin", vendorKey: "", quoteCode: "USARNC", value: 0.92 },
    { marketKey: "san_francisco", terminalKey: "san_francisco_terminal", productKey: "ethanol", vendorKey: "", quoteCode: "SFR799", value: 2.12 }
  ];

  const allValues = [...sharedValues];
  for (const market of MARKET_CONFIGS) {
    allValues.push(
      { marketKey: market.marketKey, terminalKey: market.terminalKey, productKey: "reg_87_carb", vendorKey: "", quoteCode: "SPOT_ADDER", value: market.adder },
      { marketKey: market.marketKey, terminalKey: market.terminalKey, productKey: "premium_91_carb", vendorKey: "", quoteCode: "SPOT_ADDER", value: market.adder },
      { marketKey: market.marketKey, terminalKey: market.terminalKey, productKey: "diesel_carb_ulsd", vendorKey: "", quoteCode: "DIESEL_ADDER", value: market.dieselAdder },
      { marketKey: market.marketKey, terminalKey: market.terminalKey, productKey: "reg_87_carb", vendorKey: "", quoteCode: "CONTRACT_MINUS", value: centsToDollars(market.contractMinus.regular) },
      { marketKey: market.marketKey, terminalKey: market.terminalKey, productKey: "mid_89_carb", vendorKey: "", quoteCode: "CONTRACT_MINUS", value: centsToDollars(market.contractMinus.mid) },
      { marketKey: market.marketKey, terminalKey: market.terminalKey, productKey: "premium_91_carb", vendorKey: "", quoteCode: "CONTRACT_MINUS", value: centsToDollars(market.contractMinus.premium) },
      { marketKey: market.marketKey, terminalKey: market.terminalKey, productKey: "diesel_carb_ulsd", vendorKey: "", quoteCode: "CONTRACT_MINUS", value: centsToDollars(market.contractMinus.diesel) }
    );
  }
  for (const entry of allValues) {
    await client.query(
      `INSERT INTO pricing_source_values(
        id, snapshot_id, market_key, terminal_key, product_key, vendor_key, quote_code, value, unit, effective_date, metadata_json, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)`,
      [id("pricing-source-value"), snapshotId, entry.marketKey, entry.terminalKey, entry.productKey, entry.vendorKey, entry.quoteCode, entry.value, "usd_gal", pricingDate, JSON.stringify({ workbookSource: true }), now]
    );
  }
}

async function ensureTaxes(client, jobberId, pricingDate, userId) {
  const now = new Date().toISOString();
  const rows = [
    { productFamily: "regular", taxName: "gas_tax", value: 0.55 },
    { productFamily: "mid", taxName: "gas_tax", value: 0.55 },
    { productFamily: "premium", taxName: "gas_tax", value: 0.55 },
    { productFamily: "diesel", taxName: "diesel_tax", value: 0.63 }
  ];
  for (const row of rows) {
    const existing = await client.query(
      `SELECT id FROM pricing_tax_schedules WHERE jobber_id=$1 AND product_family=$2 AND tax_name=$3 AND effective_start=$4 LIMIT 1`,
      [jobberId, row.productFamily, row.taxName, pricingDate]
    );
    if (existing.rowCount) {
      await client.query(`UPDATE pricing_tax_schedules SET value=$1, unit='usd_gal' WHERE id=$2`, [row.value, existing.rows[0].id]);
    } else {
      await client.query(
        `INSERT INTO pricing_tax_schedules(
          id, jobber_id, product_family, tax_name, value, unit, effective_start, effective_end, created_at, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id("pricing-tax"), jobberId, row.productFamily, row.taxName, row.value, "usd_gal", pricingDate, null, now, userId]
      );
    }
  }
}

async function ensureRules(client, jobberId, pricingDate) {
  const now = new Date().toISOString();
  const definitions = [
    ["regular", "reg_87_carb", "discountRegular", "freightCostGas", "rackMarginGas", "gas_tax", "marketKey=$profile.marketKey|terminalKey=$profile.terminalKey|productKey=reg_87_carb|quoteCode=OPIS_SPOT_API"],
    ["mid", "mid_89_carb", "discountMid", "freightCostGas", "rackMarginGas", "gas_tax"],
    ["premium", "premium_91_carb", "discountPremium", "freightCostGas", "rackMarginGas", "gas_tax", "marketKey=$profile.marketKey|terminalKey=$profile.terminalKey|productKey=premium_91_carb|quoteCode=OPIS_SPOT_API"],
    ["diesel", "diesel_carb_ulsd", "discountDiesel", "freightCostDiesel", "rackMarginDiesel", "diesel_tax", "marketKey=$profile.marketKey|terminalKey=$profile.terminalKey|productKey=diesel_carb_ulsd|quoteCode=OPIS_SPOT_API"]
  ];
  for (const [family, productKey, discountField, freightField, marginField, taxName, spotSourceRef = ""] of definitions) {
    const existing = await client.query(
      `SELECT id
       FROM pricing_rule_sets
       WHERE jobber_id=$1
         AND name=$2
         AND effective_start=$3
       LIMIT 1`,
      [jobberId, `Workbook ${family} rule`, pricingDate]
    );
    const ruleSetId = existing.rowCount ? existing.rows[0].id : id("pricing-rule");
    if (existing.rowCount) {
      await client.query(
        `UPDATE pricing_rule_sets
         SET product_family=$1, effective_start=$2, effective_end=$3, status='active', version_label='workbook-v1', notes=$4, updated_at=$5
         WHERE id=$6`,
        [family, pricingDate, null, `Workbook-derived test data from ${WORKBOOK_PATH}`, now, ruleSetId]
      );
      await client.query(`DELETE FROM pricing_rule_components WHERE rule_set_id=$1`, [ruleSetId]);
      await client.query(`DELETE FROM pricing_rule_vendor_sets WHERE rule_set_id=$1`, [ruleSetId]);
    } else {
      await client.query(
        `INSERT INTO pricing_rule_sets(
          id, jobber_id, name, product_family, effective_start, effective_end, status, version_label, notes, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [ruleSetId, jobberId, `Workbook ${family} rule`, family, pricingDate, null, "active", "workbook-v1", `Workbook-derived test data from ${WORKBOOK_PATH}`, now, now]
      );
    }
    const components = [
      spotSourceRef
        ? ["basis_choice", "Spot or Rack", "spot_or_rack_best", "", null, 1, { spotSourceRef, marketKey: "$profile.marketKey", terminalKey: "$profile.terminalKey", productKey }]
        : ["ub_low", "Lowest Rack", "vendor_min", "", null, 1, { marketKey: "$profile.marketKey", terminalKey: "$profile.terminalKey", productKey }],
      ["contract_minus", "Contract Minus", "source_value", `marketKey=$profile.marketKey|productKey=${productKey}|quoteCode=CONTRACT_MINUS`, null, 1, {}],
      ["freight", "Freight", "customer_profile", freightField, null, 1, {}],
      ["margin", "Rack Margin", "customer_profile", marginField, null, 1, {}],
      ["tax", "Tax", "tax", taxName, null, 1, {}],
      ["discount", "Discount", "customer_profile", discountField, null, -1, {}]
    ];
    let sortOrder = 0;
    for (const component of components) {
      sortOrder += 1;
      await client.query(
        `INSERT INTO pricing_rule_components(
          id, rule_set_id, component_key, label, source_kind, source_ref, default_value, multiplier, sort_order, is_editable, metadata_json
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
        [id("pricing-rule-component"), ruleSetId, component[0], component[1], component[2], component[3], component[4], component[5], sortOrder, true, JSON.stringify(component[6])]
      );
    }
    await client.query(
      `INSERT INTO pricing_rule_vendor_sets(
        id, rule_set_id, selection_mode, product_family, market_key, vendors_json
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [id("pricing-rule-vendor-set"), ruleSetId, "lowest", family, "", JSON.stringify(["valero", "chevron", "shell"])]
    );
  }
}

async function applyWorkbookPricingTestData() {
  await initDb();
  const pricingDate = process.env.PRICING_DATE || localCalendarDate();
  const workbookPresent = fs.existsSync(WORKBOOK_PATH);
  const jobbers = await query(`SELECT id FROM jobbers ORDER BY created_at ASC`);
  if (!jobbers.rowCount) {
    throw new Error("No jobbers found. Seed the base demo data before applying workbook pricing test data.");
  }
  await tx(async (client) => {
    for (const [index, jobber] of jobbers.rows.entries()) {
      const userId = index === 0 ? "user-ca-admin" : "user-nca-admin";
      for (const market of MARKET_CONFIGS) {
        await ensureWorkbookCustomer(client, jobber.id, pricingDate, market);
      }
      await ensureWorkbookSnapshot(client, jobber.id, pricingDate, userId);
      await ensureTaxes(client, jobber.id, pricingDate, userId);
      await ensureRules(client, jobber.id, pricingDate);
    }
  });
  console.log(`Applied workbook pricing test data for ${jobbers.rowCount} jobber(s) on ${pricingDate}. Workbook present=${workbookPresent}`);
}

if (require.main === module) {
  applyWorkbookPricingTestData()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { applyWorkbookPricingTestData };
