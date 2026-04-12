require("./loadEnv");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { initDb, tx, query } = require("./db");
const { replaceTransactionsForSites } = require("./alliedTransactions");

const root = path.resolve(__dirname, "../../../");
const siteYamlPath = path.join(root, "data", "sample_site_config.yaml");
const layoutPath = path.join(root, "data", "sample_layout.json");
const inventoryCsvPath = path.join(root, "data", "daily_inventory_report_2026-03-06_0401.csv");
const reportBaseMs = new Date("2026-03-06T04:01:00-05:00").getTime();
const fiveMinutesMs = 5 * 60 * 1000;
const importedHistoryDays = 5;
const importedHistoryPoints = importedHistoryDays * 24 * 12;
const weekdayWeightTotal = 122.96;

const tankReportTemplates = [
  { secondsAgo: 0, alertType: "Fuel Tank Refilled", alertTypeId: 19003, reportedState: "NONE", severity: "info", state: "cleared" },
  { secondsAgo: 3, alertType: "Low Fuel Tank", alertTypeId: 19000, reportedState: "SET", severity: "warn", state: "raised" },
  { secondsAgo: 4, alertType: "Water in Fuel Tank", alertTypeId: 19004, reportedState: "SET", severity: "critical", state: "raised" },
  { secondsAgo: 23, alertType: "Fuel Tank Refilled", alertTypeId: 19003, reportedState: "NONE", severity: "info", state: "cleared" },
  { secondsAgo: 25, alertType: "Fuel Tank Refilled", alertTypeId: 19003, reportedState: "NONE", severity: "info", state: "cleared" },
  { secondsAgo: 25.5, alertType: "Invalid Fuel Level", alertTypeId: 19108, reportedState: "SET", severity: "warn", state: "raised" },
  { secondsAgo: 27.5, alertType: "Tank High Water Warning", alertTypeId: 19110, reportedState: "SET", severity: "warn", state: "raised" },
  { secondsAgo: 27.8, alertType: "Tank Probe Out", alertTypeId: 19109, reportedState: "SET", severity: "critical", state: "raised" },
  { secondsAgo: 28.1, alertType: "Tank High Water Alarm", alertTypeId: 19103, reportedState: "SET", severity: "critical", state: "raised" },
  { secondsAgo: 28.8, alertType: "Fuel Tank Refilled", alertTypeId: 19003, reportedState: "NONE", severity: "info", state: "cleared" },
  { secondsAgo: 29.1, alertType: "Low Fuel Tank", alertTypeId: 19000, reportedState: "SET", severity: "warn", state: "raised" },
  { secondsAgo: 30.2, alertType: "Fuel Tank Refilled", alertTypeId: 19003, reportedState: "NONE", severity: "info", state: "cleared" },
  { secondsAgo: 31.7, alertType: "Low Fuel Tank", alertTypeId: 19000, reportedState: "SET", severity: "warn", state: "raised" },
  { secondsAgo: 31.8, alertType: "Fuel Tank Refilled", alertTypeId: 19003, reportedState: "NONE", severity: "info", state: "cleared" },
  { secondsAgo: 32.6, alertType: "Cold Temperature Warning", alertTypeId: 19127, reportedState: "CLR", severity: "warn", state: "cleared" },
  { secondsAgo: 32.7, alertType: "Fuel Tank Refilled", alertTypeId: 19003, reportedState: "NONE", severity: "info", state: "cleared" },
  { secondsAgo: 32.8, alertType: "Fuel Tank Refilled", alertTypeId: 19003, reportedState: "NONE", severity: "info", state: "cleared" },
  { secondsAgo: 33.2, alertType: "Fuel Tank Refilled", alertTypeId: 19003, reportedState: "NONE", severity: "info", state: "cleared" },
  { secondsAgo: 34.3, alertType: "Fuel Tank Refilled", alertTypeId: 19003, reportedState: "NONE", severity: "info", state: "cleared" },
  { secondsAgo: 34.4, alertType: "Fuel Tank Refilled", alertTypeId: 19003, reportedState: "NONE", severity: "info", state: "cleared" }
];

function parseSampleFiles() {
  const siteYaml = fs.readFileSync(siteYamlPath, "utf8");
  const layoutJson = fs.readFileSync(layoutPath, "utf8");
  return {
    config: yaml.load(siteYaml),
    layout: JSON.parse(layoutJson)
  };
}

function isoFrom(baseMs, secondsAgo) {
  return new Date(baseMs - Math.round(secondsAgo * 1000)).toISOString();
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function inferProduct(label) {
  const value = normalizeWhitespace(label).toUpperCase();
  if (!value) return "Unknown";
  if (value.includes("DEF")) return "DEF";
  if (value.includes("DIESEL")) return "Diesel";
  if (value.includes("PREMIUM") || value.includes("SUPREME") || value.includes("91")) return "Premium";
  if (value.includes("REGULAR") || value.includes("UNLEADED") || value.includes("87")) return "Regular";
  return "Unknown";
}

function parseNumber(value) {
  const parsed = Number(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function pseudoRandom(seed) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function timezoneOffsetHours(timezone) {
  return timezone === "America/Los_Angeles" ? -8 : -5;
}

function localTimeParts(readMs, timezone) {
  const local = new Date(readMs + timezoneOffsetHours(timezone) * 60 * 60 * 1000);
  return {
    hour: local.getUTCHours(),
    dayOfWeek: local.getUTCDay()
  };
}

function demandWeightForHour(hour) {
  if (hour >= 10 && hour < 16) return 1;
  if (hour >= 7 && hour < 10) return 0.45;
  if (hour >= 16 && hour < 19) return 0.65;
  if (hour >= 19 && hour < 22) return 0.18;
  if (hour >= 5 && hour < 7) return 0.08;
  return 0.03;
}

function dayDemandFactor(dayOfWeek) {
  return dayOfWeek === 0 || dayOfWeek === 6 ? 0.74 : 1;
}

function isRefillWindow(hour) {
  return (hour >= 5 && hour < 8) || (hour >= 18 && hour < 21);
}

function productDemandFactor(product) {
  if (product === "Diesel") return 0.88;
  if (product === "Premium") return 0.84;
  if (product === "Regular") return 1.06;
  return 0.92;
}
const importedSiteLocations = {
  "101 Santa Cruz Gas & Shop": { address: "Santa Cruz, CA", postalCode: "95060", region: "California", lat: 36.9741, lon: -122.0308 },
  "103 Woodside Gas & Shop": { address: "Woodside, CA", postalCode: "94062", region: "California", lat: 37.4299, lon: -122.2539 },
  "104 San Mateo Gas & Shop": { address: "San Mateo, CA", postalCode: "94401", region: "California", lat: 37.5630, lon: -122.3255 },
  "105 Capitol Gas & Shop": { address: "San Jose, CA", postalCode: "95127", region: "California", lat: 37.3661, lon: -121.8150 },
  "107 Mckee Gas & Shop": { address: "San Jose, CA", postalCode: "95127", region: "California", lat: 37.3661, lon: -121.8150 },
  "108 San Anselmo Gas & Shop": { address: "San Anselmo, CA", postalCode: "94960", region: "California", lat: 37.9746, lon: -122.5616 },
  "110 Auburn Gas & Shop": { address: "Auburn, CA", postalCode: "95603", region: "California", lat: 38.8966, lon: -121.0769 },
  "111 Livermore Gas & Shop": { address: "Livermore, CA", postalCode: "94550", region: "California", lat: 37.6819, lon: -121.7680 },
  "112 Vallejo Gas & Shop": { address: "Vallejo, CA", postalCode: "94590", region: "California", lat: 38.1041, lon: -122.2566 },
  "114 Davis Arco": { address: "Davis, CA", postalCode: "95616", region: "California", lat: 38.5449, lon: -121.7405 },
  "116 San Mateo Chevron": { address: "San Mateo, CA", postalCode: "94401", region: "California", lat: 37.5630, lon: -122.3255 },
  "117 19th Ave Gas & Shop": { address: "San Francisco, CA", postalCode: "94116", region: "California", lat: 37.7531, lon: -122.4760 },
  "118 Rodeo Chevron": { address: "Rodeo, CA", postalCode: "94572", region: "California", lat: 38.0338, lon: -122.2666 },
  "119 Auburn Chevron": { address: "Auburn, CA", postalCode: "95603", region: "California", lat: 38.8966, lon: -121.0769 },
  "120 Ripon Gas & Shop": { address: "Ripon, CA", postalCode: "95366", region: "California", lat: 37.7416, lon: -121.1244 },
  "121 Mckee 2 Gas & Shop": { address: "San Jose, CA", postalCode: "95127", region: "California", lat: 37.3661, lon: -121.8150 },
  "201 Mission Gas & Shop": { address: "Fremont, CA", postalCode: "94539", region: "California", lat: 37.5483, lon: -121.9886 },
  "205 Jefferson Gas & Shop": { address: "Redwood City, CA", postalCode: "94063", region: "California", lat: 37.4852, lon: -122.2364 },
  "207 Petaluma Gas Club LLC": { address: "Petaluma, CA", postalCode: "94952", region: "California", lat: 38.2324, lon: -122.6367 },
  "209 Dixon Gas Club LLC": { address: "Dixon, CA", postalCode: "95620", region: "California", lat: 38.4455, lon: -121.8233 },
  "301 Morgan Hill Gas & Shop": { address: "Morgan Hill, CA", postalCode: "95037", region: "California", lat: 37.1305, lon: -121.6544 },
  "302 Auto City Food Mart": { address: "Fremont, CA", postalCode: "94538", region: "California", lat: 37.5483, lon: -121.9886 },
  "308 Mckee Gas Stop": { address: "San Jose, CA", postalCode: "95127", region: "California", lat: 37.3661, lon: -121.8150 }
};

function parseInventoryCsv() {
  const csv = fs.readFileSync(inventoryCsvPath, "utf8").trim();
  const lines = csv.split(/\r?\n/);
  const header = lines.shift();
  if (!header) return [];

  return lines
    .map((line) => {
      const parts = line.split(",");
      return {
        facilityName: normalizeWhitespace(parts[0]),
        atgTankLabel: normalizeWhitespace(parts[1]),
        tankCapacity: parseNumber(parts[2]),
        ullage: parseNumber(parts[3]),
        safeUllage: parseNumber(parts[4]),
        volume: parseNumber(parts[5])
      };
    })
    .filter(
      (row) =>
        row.facilityName &&
        row.atgTankLabel &&
        row.tankCapacity != null &&
        row.volume != null
    );
}

function buildImportedSites(csvRows) {
  const grouped = new Map();

  for (const row of csvRows) {
    if (!grouped.has(row.facilityName)) grouped.set(row.facilityName, []);
    grouped.get(row.facilityName).push(row);
  }

  return Array.from(grouped.entries())
    .map(([facilityName, rows], facilityIndex) => {
      const codeMatch = facilityName.match(/^(\d+)/);
      const siteCode = codeMatch ? codeMatch[1] : `9${String(facilityIndex + 1).padStart(3, "0")}`;
      const name = normalizeWhitespace(facilityName.replace(/^(\d+)\s*/, "")) || facilityName;
      const tanks = rows.map((row, tankIndex) => ({
        atgTankId: String(tankIndex + 1).padStart(2, "0"),
        label: row.atgTankLabel,
        product: inferProduct(row.atgTankLabel),
        capacityLiters: row.tankCapacity,
        importedReading: row
      }));

      const location = importedSiteLocations[facilityName] || {
        address: "San Francisco Bay Area, CA",
        postalCode: "94103",
        region: "California"
      };

      return {
        kind: "imported",
        siteCode,
        name,
        facilityName,
        address: location.address,
        postalCode: location.postalCode,
        region: location.region,
        lat: location.lat || 37.7749,
        lon: location.lon || -122.4194,
        timezone: "America/Los_Angeles",
        atgHost: `imported-atg-${siteCode}`,
        atgPort: 10001,
        atgPollIntervalSec: 300,
        tanks,
        pumps: [],
        seedAlerts: false,
        layout: {
          siteId: siteCode,
          version: 1,
          northUp: true,
          gridSize: 20,
          objects: []
        }
      };
    })
    .sort((a, b) => Number(a.siteCode) - Number(b.siteCode));
}

async function seedCustomerPricingData(client, { jobberId, userId, now, pricingDate, marketKey, terminalKey, customerName }) {
  const customerId = id("customer");
  const profileId = id("customer-profile");
  const snapshotId = id("pricing-source");
  const gasTaxId = id("pricing-tax");
  const dieselTaxId = id("pricing-tax");

  await client.query(
    `INSERT INTO customers(
      id, jobber_id, name, address_line1, address_line2, city, state, postal_code, terminal_key, status, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      customerId,
      jobberId,
      customerName,
      "100 Demo Way",
      "",
      "San Francisco",
      "CA",
      "94103",
      terminalKey,
      "active",
      now,
      now
    ]
  );

  await client.query(
    `INSERT INTO customer_pricing_profiles(
      id, customer_id, effective_start, effective_end, freight_miles, freight_cost_gas, freight_cost_diesel,
      rack_margin_gas, rack_margin_diesel, discount_regular, discount_mid, discount_premium, discount_diesel,
      output_template_id, rules_json, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17)`,
    [
      profileId,
      customerId,
      pricingDate,
      null,
      42,
      0.12,
      0.18,
      0.22,
      0.28,
      0.03,
      0.04,
      0.05,
      0.02,
      null,
      JSON.stringify({
        branch: "unbranded",
        marketKey,
        terminalKey
      }),
      now,
      now
    ]
  );

  await client.query(
    `INSERT INTO pricing_source_snapshots(
      id, jobber_id, pricing_date, source_type, source_label, status, received_at, created_at, created_by, notes
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      snapshotId,
      jobberId,
      pricingDate,
      "opis",
      "Demo OPIS Snapshot",
      "published",
      now,
      now,
      userId,
      "Seeded customer pricing source values"
    ]
  );

  const sourceValues = [];

  for (const entry of sourceValues) {
    await client.query(
      `INSERT INTO pricing_source_values(
        id, snapshot_id, market_key, terminal_key, product_key, vendor_key, quote_code, value, unit, effective_date, metadata_json, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)`,
      [
        id("pricing-source-value"),
        snapshotId,
        entry.marketKey,
        entry.terminalKey,
        entry.productKey,
        entry.vendorKey,
        entry.quoteCode,
        entry.value,
        entry.unit,
        pricingDate,
        JSON.stringify({ sourceValueKey: entry.quoteCode }),
        now
      ]
    );
  }

  await client.query(
    `INSERT INTO pricing_tax_schedules(
      id, jobber_id, product_family, tax_name, value, unit, effective_start, effective_end, created_at, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [gasTaxId, jobberId, "regular", "gas_tax", 0.55, "usd_gal", pricingDate, null, now, userId]
  );
  await client.query(
    `INSERT INTO pricing_tax_schedules(
      id, jobber_id, product_family, tax_name, value, unit, effective_start, effective_end, created_at, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id("pricing-tax"), jobberId, "mid", "gas_tax", 0.55, "usd_gal", pricingDate, null, now, userId]
  );
  await client.query(
    `INSERT INTO pricing_tax_schedules(
      id, jobber_id, product_family, tax_name, value, unit, effective_start, effective_end, created_at, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id("pricing-tax"), jobberId, "premium", "gas_tax", 0.55, "usd_gal", pricingDate, null, now, userId]
  );
  await client.query(
    `INSERT INTO pricing_tax_schedules(
      id, jobber_id, product_family, tax_name, value, unit, effective_start, effective_end, created_at, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [dieselTaxId, jobberId, "diesel", "diesel_tax", 0.63, "usd_gal", pricingDate, null, now, userId]
  );

  const ruleDefinitions = [
    {
      productFamily: "regular",
      productKey: "reg_87_carb",
      components: [
        ["basis_choice", "Spot or Rack", "spot_or_rack_best", "", null, 1, { spotSourceRef: "marketKey=$profile.marketKey|terminalKey=$profile.terminalKey|productKey=reg_87_carb|quoteCode=OPIS_SPOT_API", marketKey, terminalKey, productKey: "reg_87_carb" }],
        ["freight", "Freight Gas", "customer_profile", "freightCostGas", null, 1, {}],
        ["margin", "Rack Margin Gas", "customer_profile", "rackMarginGas", null, 1, {}],
        ["tax", "Gas Tax", "tax", "gas_tax", null, 1, {}],
        ["discount", "Regular Discount", "customer_profile", "discountRegular", null, -1, {}]
      ],
      vendors: ["valero", "chevron", "shell"]
    },
    {
      productFamily: "mid",
      productKey: "mid_89_carb",
      components: [
        ["rack_base", "Lowest Rack", "vendor_min", "", null, 1, { marketKey, productKey: "mid_89_carb" }],
        ["freight", "Freight Gas", "customer_profile", "freightCostGas", null, 1, {}],
        ["margin", "Rack Margin Gas", "customer_profile", "rackMarginGas", null, 1, {}],
        ["tax", "Gas Tax", "tax", "gas_tax", null, 1, {}],
        ["discount", "Mid Discount", "customer_profile", "discountMid", null, -1, {}]
      ],
      vendors: ["valero", "chevron"]
    },
    {
      productFamily: "premium",
      productKey: "premium_91_carb",
      components: [
        ["basis_choice", "Spot or Rack", "spot_or_rack_best", "", null, 1, { spotSourceRef: "marketKey=$profile.marketKey|terminalKey=$profile.terminalKey|productKey=premium_91_carb|quoteCode=OPIS_SPOT_API", marketKey, terminalKey, productKey: "premium_91_carb" }],
        ["freight", "Freight Gas", "customer_profile", "freightCostGas", null, 1, {}],
        ["margin", "Rack Margin Gas", "customer_profile", "rackMarginGas", null, 1, {}],
        ["tax", "Gas Tax", "tax", "gas_tax", null, 1, {}],
        ["discount", "Premium Discount", "customer_profile", "discountPremium", null, -1, {}]
      ],
      vendors: ["valero", "shell"]
    },
    {
      productFamily: "diesel",
      productKey: "diesel_carb_ulsd",
      components: [
        ["basis_choice", "Spot or Rack", "spot_or_rack_best", "", null, 1, { spotSourceRef: "marketKey=$profile.marketKey|terminalKey=$profile.terminalKey|productKey=diesel_carb_ulsd|quoteCode=OPIS_SPOT_API", marketKey, terminalKey, productKey: "diesel_carb_ulsd" }],
        ["freight", "Freight Diesel", "customer_profile", "freightCostDiesel", null, 1, {}],
        ["margin", "Rack Margin Diesel", "customer_profile", "rackMarginDiesel", null, 1, {}],
        ["tax", "Diesel Tax", "tax", "diesel_tax", null, 1, {}],
        ["discount", "Diesel Discount", "customer_profile", "discountDiesel", null, -1, {}]
      ],
      vendors: ["valero", "chevron"]
    }
  ];

  for (const definition of ruleDefinitions) {
    const ruleSetId = id("pricing-rule");
    await client.query(
      `INSERT INTO pricing_rule_sets(
        id, jobber_id, name, product_family, effective_start, effective_end, status, version_label, notes, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        ruleSetId,
        jobberId,
        `${definition.productFamily.toUpperCase()} Demo Rule`,
        definition.productFamily,
        pricingDate,
        null,
        "active",
        "seed-v1",
        "Seeded baseline rule for pricing preview",
        now,
        now
      ]
    );

    let sortOrder = 0;
    for (const component of definition.components) {
      sortOrder += 1;
      await client.query(
        `INSERT INTO pricing_rule_components(
          id, rule_set_id, component_key, label, source_kind, source_ref, default_value, multiplier, sort_order, is_editable, metadata_json
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
        [
          id("pricing-rule-component"),
          ruleSetId,
          component[0],
          component[1],
          component[2],
          component[3],
          component[4],
          component[5],
          sortOrder,
          true,
          JSON.stringify(component[6] || {})
        ]
      );
    }

    await client.query(
      `INSERT INTO pricing_rule_vendor_sets(
        id, rule_set_id, selection_mode, product_family, market_key, vendors_json
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        id("pricing-rule-vendor-set"),
        ruleSetId,
        "lowest",
        definition.productFamily,
        marketKey,
        JSON.stringify(definition.vendors)
      ]
    );
  }
}

function buildConfiguredSites(config, layout) {
  return (config.sites || []).map((site) => ({
    kind: "configured",
    siteCode: site.site_code,
    name: site.name,
    facilityName: site.name,
    address: site.address || "",
    postalCode: site.postal_code || site.zip || "",
    region: site.region || "",
    lat: Number(site.lat || 0),
    lon: Number(site.lon || 0),
    timezone: "America/New_York",
    atgHost: site.integrations?.atg_host || "",
    atgPort: Number(site.integrations?.atg_port || 10001),
    atgPollIntervalSec: Number(site.integrations?.atg_poll_interval_sec || config.defaults?.atg?.poll_interval_sec || 60),
    tanks: (site.tanks || []).map((tank) => ({
      atgTankId: tank.atg_tank_id,
      label: tank.label,
      product: tank.product,
      capacityLiters: Number(tank.capacity_liters || 0)
    })),
    pumps: site.pumps || [],
    seedAlerts: true,
    layout:
      site.site_code === String(layout.siteId)
        ? layout
        : { ...layout, siteId: site.site_code, objects: layout.objects.filter((object) => object.type !== "pump") }
  }));
}

function isCaliforniaSite(site) {
  const region = String(site.region || "").toLowerCase();
  const address = String(site.address || "").toLowerCase();
  return region.includes("california") || address.includes(", ca");
}

function alliedBusinessTimestamp(baseMs, dayOffset, transactionIndex, timezone) {
  const hourBlocks = [6, 7, 8, 9, 11, 12, 14, 16, 17, 18, 19, 20];
  const hour = hourBlocks[(transactionIndex + dayOffset) % hourBlocks.length];
  const minute = (transactionIndex * 7 + dayOffset * 11) % 60;
  const second = (transactionIndex * 13 + dayOffset * 5) % 60;
  const offset = timezone === "America/Los_Angeles" ? "-08:00" : "-05:00";
  const anchor = new Date(baseMs + dayOffset * 24 * 60 * 60 * 1000);
  const localDate = anchor.toISOString().slice(0, 10);
  return new Date(`${localDate}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}${offset}`).toISOString();
}

function buildAlliedTransactionsForSite({ siteId, siteCode, timezone, pumpCount, dayCount = 35, rowsPerDay = 24 }) {
  const accountOrigins = ["Allied Fuel Controller", "Allied POS", "Allied Pay"];
  const paymentTypes = ["Credit", "Debit", "PresetCash", "Fleet"];
  const cardCatalog = [
    { cardName: "Visa", cardType: "Credit" },
    { cardName: "Mastercard", cardType: "Credit" },
    { cardName: "Discover", cardType: "Credit" },
    { cardName: "Amex", cardType: "Credit" },
    { cardName: "Fleet One", cardType: "Fleet" },
    { cardName: "WEX", cardType: "Fleet" },
    { cardName: "Cash", cardType: "Cash" }
  ];
  const completeStatuses = ["Complete", "Approved", "Complete"];
  const abortStatuses = ["CustomerAbort", "CustomerAbort", "Declined"];
  const entryMethods = ["EmvQuickChip", "EmvContactless", "ChipInsert", "Magstripe", "ManualEntry"];
  const emvTranTypes = ["FuelSale", "PreAuth", "Completion", "ContactlessFuel"];
  const denialReasons = ["Insufficient Funds", "EMV Fallback", "Issuer Unavailable", "Expired Card", "Do Not Honor", ""];
  const baseMs = new Date("2026-02-24T00:00:00Z").getTime();
  const rows = [];

  for (let dayOffset = 0; dayOffset < dayCount; dayOffset += 1) {
    for (let index = 0; index < rowsPerDay; index += 1) {
      const ordinal = dayOffset * rowsPerDay + index;
      const businessTs = alliedBusinessTimestamp(baseMs, dayOffset, index, timezone);
      const pumpNumber = ((ordinal % Math.max(pumpCount, 1)) + 1);
      const fuelPositionId = `FP-${String(pumpNumber).padStart(2, "0")}`;
      const card = cardCatalog[ordinal % cardCatalog.length];
      const paymentType = card.cardName === "Cash" ? "PresetCash" : paymentTypes[ordinal % paymentTypes.length];
      const suspiciousPump = pumpNumber === Math.min(3, Math.max(pumpCount, 1));
      const weekend = [0, 6].includes(new Date(businessTs).getUTCDay());
      const forceAbort = suspiciousPump && (dayOffset % 6 === 2 || dayOffset % 6 === 3) && index % 4 === 0;
      const forceFallback = suspiciousPump && dayOffset % 9 === 4 && index % 3 === 1;
      const forceZeroDollar = dayOffset % 13 === 8 && index % 8 === 2;
      const forceOutlier = dayOffset % 11 === 5 && index % 9 === 0;
      const malformedPan = dayOffset % 17 === 6 && index % 10 === 3;
      const status = forceAbort ? abortStatuses[(ordinal + 1) % abortStatuses.length] : completeStatuses[ordinal % completeStatuses.length];
      const entryMethod = forceFallback ? "FallbackMSR" : entryMethods[ordinal % entryMethods.length];
      const gallonsBase = paymentType === "PresetCash" ? 7 + (ordinal % 8) : 9 + (ordinal % 10);
      const gallons = forceAbort ? (index % 3 === 0 ? 1.2 : 0) : forceOutlier ? 42 + (ordinal % 7) : gallonsBase + (weekend ? -1.2 : 0.8);
      const salesPrice = Number((3.24 + ((ordinal + pumpNumber) % 17) * 0.03).toFixed(3));
      const computedTotal = Number((Math.max(gallons, 0) * salesPrice).toFixed(2));
      const totalAmount = forceAbort ? (index % 5 === 0 ? Number((computedTotal * 0.5).toFixed(2)) : 0) : forceZeroDollar ? 0 : computedTotal;
      const authAmount = forceAbort ? Number((computedTotal + 8).toFixed(2)) : Number((Math.max(totalAmount + (ordinal % 2 === 0 ? 5 : 0), totalAmount - (forceOutlier ? 8 : 0))).toFixed(2));
      const emvStatus = status === "Complete" || status === "Approved"
        ? (forceFallback ? "FallbackApproved" : entryMethod === "EmvContactless" ? "ContactlessApproved" : "Approved")
        : (forceFallback ? "FallbackRequired" : "Declined");
      const denialReason = status === "CustomerAbort"
        ? "Customer Cancelled"
        : status === "Declined"
          ? denialReasons[(ordinal + 2) % denialReasons.length] || "Issuer Unavailable"
          : forceFallback
            ? "Fallback Required"
            : "";
      const expMonth = String(((ordinal % 12) + 1)).padStart(2, "0");
      const expYear = String(26 + (ordinal % 4));
      const first8 = malformedPan ? "12AB567" : String(40000000 + (ordinal % 999999)).padStart(8, "0");
      const last4 = malformedPan ? "9X2" : String(1000 + (ordinal % 9000));

      rows.push({
        id: `allied-${siteId}-${ordinal + 1}`,
        siteId,
        transactionId: `${siteCode}-${String(dayOffset + 1).padStart(2, "0")}-${String(index + 1).padStart(4, "0")}`,
        accountOrigin: accountOrigins[ordinal % accountOrigins.length],
        actualSalesPrice: salesPrice,
        authAmount,
        cardName: card.cardName,
        cardType: card.cardType,
        emvErrorCode: forceFallback ? "FALLBACK_90" : status === "Declined" ? `D${String((ordinal % 9) + 1).padStart(2, "0")}` : "",
        emvStatus,
        emvTranType: emvTranTypes[ordinal % emvTranTypes.length],
        entryMethod,
        expDate: malformedPan ? "1/2" : `${expMonth}/${expYear}`,
        fallbackToMsr: forceFallback,
        first8,
        fuelDescription: ordinal % 5 === 0 ? "Regular Unleaded" : ordinal % 5 === 1 ? "Midgrade" : ordinal % 5 === 2 ? "Premium" : ordinal % 5 === 3 ? "Diesel" : "Regular Unleaded",
        fuelPositionId: status === "Complete" && dayOffset % 19 === 7 && index % 12 === 2 ? "" : fuelPositionId,
        fuelQuantityGallons: Number(gallons.toFixed(3)),
        last4,
        paymentType,
        storeId: siteCode,
        tagDenialReason: denialReason,
        timestamp: businessTs,
        timezone,
        totalAmount,
        rawJson: {
          scenario: [
            forceAbort ? "abort" : null,
            forceFallback ? "fallback" : null,
            forceZeroDollar ? "zero-dollar" : null,
            forceOutlier ? "outlier" : null,
            malformedPan ? "malformed-pan" : null
          ].filter(Boolean)
        }
      });
    }
  }

  return rows;
}

function buildImportedHistoryPoints(siteIndex, tankIndex, site, tank) {
  const reading = tank.importedReading;
  const capacity = Number(tank.capacityLiters || 0);
  const baseVolume = Number(reading.volume || capacity * 0.72);
  const baseSafeUllage = Number(reading.safeUllage || Math.max(0, capacity * 0.2));
  const seed = siteIndex * 101 + tankIndex * 37 + capacity;
  const activity = 0.7 + pseudoRandom(seed + 11) * 1.25;
  const dailyDemand = capacity * (0.09 + pseudoRandom(seed + 17) * 0.14) * activity * productDemandFactor(tank.product);
  const refillThreshold = capacity * (0.16 + pseudoRandom(seed + 23) * 0.07);
  const refillTarget = capacity * (0.79 + pseudoRandom(seed + 29) * 0.05);
  const initialFillFraction = Math.min(
    0.9,
    Math.max(0.52, baseVolume / Math.max(capacity, 1) + (pseudoRandom(seed + 31) - 0.5) * 0.18)
  );
  let currentVolume = Number((capacity * initialFillFraction).toFixed(2));
  const points = [];

  for (let index = 0; index < importedHistoryPoints; index += 1) {
    const readMs = reportBaseMs - (importedHistoryPoints - index - 1) * fiveMinutesMs;
    const { hour, dayOfWeek } = localTimeParts(readMs, site.timezone);
    const workloadWeight = demandWeightForHour(hour);
    const workloadFactor = dayDemandFactor(dayOfWeek);
    const intervalVariation = 0.94 + pseudoRandom(seed + index * 17) * 0.12;
    const drainVolume = Number(
      ((dailyDemand * workloadWeight * workloadFactor * intervalVariation) / weekdayWeightTotal).toFixed(2)
    );
    let volume = Math.max(0, Number((currentVolume - drainVolume).toFixed(2)));
    let event = "drawdown";

    if (volume <= refillThreshold && isRefillWindow(hour)) {
      volume = Number(refillTarget.toFixed(2));
      event = "delivery";
    }

    currentVolume = volume;
    const ullage = Number((capacity - volume).toFixed(2));
    const fuelHeightMm = Number(((volume / Math.max(capacity, 1)) * 1600).toFixed(2));
    const waterHeightMm = tank.product === "Diesel"
      ? Number((6 + Math.abs(Math.sin((seed + index) * 0.41)) * 4).toFixed(2))
      : Number((10 + Math.abs(Math.sin((seed + index) * 0.41)) * 14).toFixed(2));
    const tempC = Number((12 + Math.sin((seed + index) * 0.37) * 6 + (hour >= 11 && hour <= 16 ? 3 : 0)).toFixed(1));

    points.push({
      readAt: new Date(readMs).toISOString(),
      volume,
      ullage,
      safeUllage: Number(baseSafeUllage.toFixed(2)),
      tankCapacity: capacity,
      fuelHeightMm,
      waterHeightMm,
      tempC,
      event,
      drainVolume,
      activity: Number(activity.toFixed(2))
    });
  }

  return points;
}

function tankMessage(alertType, tank) {
  return `${alertType} on Tank ${tank.atgTankId} (${tank.label})`;
}

async function seedDatabase() {
  const { config, layout } = parseSampleFiles();
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const orgId = "org-demo";
  const californiaJobberId = "jobber-california";
  const nonCaliforniaJobberId = "jobber-non-california";
  const configuredSites = buildConfiguredSites(config, layout);
  const importedSites = buildImportedSites(parseInventoryCsv());
  const allSites = [...configuredSites, ...importedSites];
  const seededSiteMeta = [];

  await initDb();
  await tx(async (client) => {
    await client.query("DELETE FROM user_site_assignments");
    await client.query("DELETE FROM user_jobber_roles");
    await client.query("DELETE FROM allied_transactions");
    await client.query("DELETE FROM alarm_events");
    await client.query("DELETE FROM pricing_export_jobs");
    await client.query("DELETE FROM generated_customer_prices");
    await client.query("DELETE FROM pricing_export_templates");
    await client.query("DELETE FROM pricing_rule_vendor_sets");
    await client.query("DELETE FROM pricing_rule_components");
    await client.query("DELETE FROM pricing_rule_sets");
    await client.query("DELETE FROM pricing_tax_schedules");
    await client.query("DELETE FROM pricing_source_values");
    await client.query("DELETE FROM pricing_source_snapshots");
    await client.query("DELETE FROM customer_pricing_profiles");
    await client.query("DELETE FROM customer_contacts");
    await client.query("DELETE FROM customers");
    await client.query("DELETE FROM atg_inventory_readings");
    await client.query("DELETE FROM tank_measurements");
    await client.query("DELETE FROM connection_status");
    await client.query("DELETE FROM forecourt_layouts");
    await client.query("DELETE FROM pump_sides");
    await client.query("DELETE FROM pumps");
    await client.query("DELETE FROM tanks");
    await client.query("DELETE FROM site_integrations");
    await client.query("DELETE FROM sites");
    await client.query("DELETE FROM audit_log");
    await client.query("DELETE FROM users");
    await client.query("DELETE FROM jobbers");
    await client.query("DELETE FROM orgs");

    await client.query("INSERT INTO orgs(id, name) VALUES ($1, $2)", [orgId, config.org?.name || "Demo Org"]);
    const jobbers = [
      [californiaJobberId, orgId, "California Jobber", "california-jobber", "california.demo", "", now, now],
      [nonCaliforniaJobberId, orgId, "Non-California Jobber", "non-california-jobber", "noncal.demo", "", now, now]
    ];
    for (const jobber of jobbers) {
      await client.query(
        `INSERT INTO jobbers(id, org_id, name, slug, oauth_domain, logo_url, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        jobber
      );
    }

    const users = [
      ["user-system-manager", orgId, "system.manager@demo.com", "System Manager", "system_manager", "demo123"],
      ["user-manager", orgId, "manager@demo.com", "Demo Manager", "manager", "demo123"],
      ["user-tech", orgId, "tech@demo.com", "Demo Tech", "service_tech", "demo123"],
      ["user-operator", orgId, "operator@demo.com", "Demo Operator", "operator", "demo123"],
      ["user-ca-admin", orgId, "admin.ca@demo.com", "California Admin", "operator", "demo123"],
      ["user-ca-manager", orgId, "manager.ca@demo.com", "California Manager", "operator", "demo123"],
      ["user-nca-admin", orgId, "admin.nonca@demo.com", "Non-California Admin", "operator", "demo123"],
      ["user-nca-manager", orgId, "manager.nonca@demo.com", "Non-California Manager", "operator", "demo123"]
    ];

    for (const row of users) {
      await client.query(
        "INSERT INTO users(id, org_id, email, name, role, password) VALUES ($1,$2,$3,$4,$5,$6)",
        row
      );
    }

    const memberships = [
      ["user-manager", californiaJobberId, "admin", true, now, now],
      ["user-tech", californiaJobberId, "manager", false, now, now],
      ["user-operator", californiaJobberId, "manager", false, now, now],
      ["user-ca-admin", californiaJobberId, "admin", true, now, now],
      ["user-ca-manager", californiaJobberId, "manager", true, now, now],
      ["user-nca-admin", nonCaliforniaJobberId, "admin", true, now, now],
      ["user-nca-manager", nonCaliforniaJobberId, "manager", true, now, now]
    ];

    for (const membership of memberships) {
      await client.query(
        `INSERT INTO user_jobber_roles(user_id, jobber_id, role, is_default, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        membership
      );
    }

    const pricingDate = now.slice(0, 10);
    await seedCustomerPricingData(client, {
      jobberId: californiaJobberId,
      userId: "user-ca-admin",
      now,
      pricingDate,
      marketKey: "san_francisco",
      terminalKey: "san_francisco_terminal",
      customerName: "Acme Fueling SF"
    });
    await seedCustomerPricingData(client, {
      jobberId: nonCaliforniaJobberId,
      userId: "user-nca-admin",
      now,
      pricingDate,
      marketKey: "stockton",
      terminalKey: "stockton_terminal",
      customerName: "Central Valley Fuel"
    });

    for (let siteIndex = 0; siteIndex < allSites.length; siteIndex += 1) {
      const site = allSites[siteIndex];
      const siteId = `site-${site.siteCode}`;
      const jobberId = isCaliforniaSite(site) ? californiaJobberId : nonCaliforniaJobberId;
      seededSiteMeta.push({ siteId, site, jobberId });

      await client.query(
        `INSERT INTO sites(
          id, org_id, jobber_id, site_code, name, address, postal_code, region, lat, lon, timezone, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          siteId,
          orgId,
          jobberId,
          site.siteCode,
          site.name,
          site.address,
          site.postalCode,
          site.region,
          site.lat,
          site.lon,
          site.timezone,
          now,
          now
        ]
      );

      await client.query(
        `INSERT INTO site_integrations(
          site_id, atg_host, atg_port, atg_poll_interval_sec, atg_timeout_sec, atg_retries, atg_stale_sec,
          pump_timeout_sec, pump_keepalive_enabled, pump_reconnect_enabled, pump_stale_sec
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          siteId,
          site.atgHost,
          site.atgPort,
          site.atgPollIntervalSec,
          Number(config.defaults?.atg?.timeout_sec || 5),
          Number(config.defaults?.atg?.retries || 3),
          Number(config.defaults?.atg?.stale_sec || 180),
          Number(config.defaults?.pump_side?.timeout_sec || 5),
          !!config.defaults?.pump_side?.keepalive,
          !!config.defaults?.pump_side?.reconnect,
          Number(config.defaults?.pump_side?.stale_sec || 180)
        ]
      );

      for (let tankIndex = 0; tankIndex < site.tanks.length; tankIndex += 1) {
        const tank = site.tanks[tankIndex];
        const tankKey = site.kind === "imported" ? slugify(tank.label) : tank.atgTankId;
        const tankId = `tank-${site.siteCode}-${tankKey}`;

        await client.query(
          `INSERT INTO tanks(id, site_id, atg_tank_id, label, product, capacity_liters, active)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tankId, siteId, tank.atgTankId, tank.label, tank.product, Number(tank.capacityLiters || 0), true]
        );

        if (site.kind === "imported") {
          const points = buildImportedHistoryPoints(siteIndex, tankIndex, site, tank);
          for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
            const point = points[pointIndex];
            const rawPayload = JSON.stringify({
              source: "inventory-report-import",
              facilityName: site.facilityName,
              atgTankLabel: tank.label,
              tankCapacity: point.tankCapacity,
              ullage: point.ullage,
              safeUllage: point.safeUllage,
              volume: point.volume,
              event: point.event,
              drawdownLiters: point.drainVolume,
              demandProfile: point.activity
            });

            await client.query(
              `INSERT INTO atg_inventory_readings(
                id, site_id, tank_id, facility_name, atg_tank_label, read_at, tank_capacity, ullage,
                safe_ullage, volume, raw_payload, created_at
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
              [
                `atg-${tankId}-${pointIndex + 1}`,
                siteId,
                tankId,
                site.facilityName,
                tank.label,
                point.readAt,
                point.tankCapacity,
                point.ullage,
                point.safeUllage,
                point.volume,
                rawPayload,
                point.readAt
              ]
            );

            await client.query(
              `INSERT INTO tank_measurements(
                id, site_id, tank_id, ts, fuel_volume_l, fuel_height_mm, water_height_mm, temp_c, ullage_l, raw_payload
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
              [
                `tm-${tankId}-${pointIndex + 1}`,
                siteId,
                tankId,
                point.readAt,
                point.volume,
                point.fuelHeightMm,
                point.waterHeightMm,
                point.tempC,
                point.ullage,
                rawPayload
              ]
            );
          }
        } else {
          const capacity = Number(tank.capacityLiters || 0);
          const fuelVolume = Math.round(capacity * (0.48 + Math.random() * 0.32));
          const waterHeight = tank.product === "Diesel" ? 8 : 18 + Math.round(Math.random() * 14);
          const fuelHeight = 980 + Math.round(Math.random() * 420);
          const tempC = Number((10 + Math.random() * 12).toFixed(1));

          await client.query(
            `INSERT INTO tank_measurements(
              id, site_id, tank_id, ts, fuel_volume_l, fuel_height_mm, water_height_mm, temp_c, ullage_l, raw_payload
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              `tm-${tankId}`,
              siteId,
              tankId,
              now,
              fuelVolume,
              fuelHeight,
              waterHeight,
              tempC,
              Math.max(0, capacity - fuelVolume),
              JSON.stringify({ source: "seed", tankLabel: tank.label, product: tank.product })
            ]
          );
        }
      }

      for (const pump of site.pumps) {
        const pumpId = `pump-${site.siteCode}-${pump.pump_number}`;
        await client.query(
          `INSERT INTO pumps(id, site_id, pump_number, label, active) VALUES ($1,$2,$3,$4,$5)`,
          [pumpId, siteId, Number(pump.pump_number), pump.label, true]
        );
        for (const side of ["A", "B"]) {
          const sideCfg = pump.sides?.[side] || {};
          const sideId = `ps-${pumpId}-${side.toLowerCase()}`;
          await client.query(
            `INSERT INTO pump_sides(id, pump_id, side, ip, port, active) VALUES ($1,$2,$3,$4,$5,$6)`,
            [sideId, pumpId, side, sideCfg.ip || "", Number(sideCfg.port || 5201), true]
          );
          await client.query(
            `INSERT INTO connection_status(id, site_id, kind, target_id, status, last_seen_at, details_json)
             VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
            [`conn-${sideId}`, siteId, "pump_side", sideId, "connected", now, "{}"]
          );
        }
      }

      await client.query(
        `INSERT INTO connection_status(id, site_id, kind, target_id, status, last_seen_at, details_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [
          `conn-atg-${siteId}`,
          siteId,
          "atg",
          null,
          "connected",
          site.kind === "imported" ? new Date(reportBaseMs).toISOString() : now,
          "{}"
        ]
      );

      await client.query(
        `INSERT INTO forecourt_layouts(id, site_id, version, name, json, created_by, created_at, is_active)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
        [
          `layout-${siteId}-v1`,
          siteId,
          1,
          site.kind === "imported" ? "Imported Layout" : "Initial Layout",
          JSON.stringify(site.layout),
          "user-manager",
          now,
          true
        ]
      );
    }

    if (seededSiteMeta.length > 0) {
      const firstCaliforniaSite = seededSiteMeta.find((entry) => entry.jobberId === californiaJobberId);
      await client.query(
        "INSERT INTO user_site_assignments(user_id, site_id) VALUES ($1,$2)",
        ["user-operator", firstCaliforniaSite?.siteId || seededSiteMeta[0].siteId]
      );
      for (const entry of seededSiteMeta) {
        if (entry.jobberId === californiaJobberId) {
          await client.query(
            "INSERT INTO user_site_assignments(user_id, site_id) VALUES ($1,$2)",
            ["user-tech", entry.siteId]
          );
          await client.query(
            "INSERT INTO user_site_assignments(user_id, site_id) VALUES ($1,$2)",
            ["user-ca-manager", entry.siteId]
          );
        } else {
          await client.query(
            "INSERT INTO user_site_assignments(user_id, site_id) VALUES ($1,$2)",
            ["user-nca-manager", entry.siteId]
          );
        }
      }
    }

    for (const entry of seededSiteMeta.filter((item) => item.site.seedAlerts)) {
      const { siteId, site } = entry;
      const siteOffset = seededSiteMeta.findIndex((item) => item.siteId === siteId) * 120;
      const firstPump = await client.query(
        "SELECT id FROM pumps WHERE site_id=$1 ORDER BY pump_number LIMIT 1",
        [siteId]
      );
      const tankRows = await client.query(
        `SELECT id, atg_tank_id AS "atgTankId", label, product
         FROM tanks WHERE site_id=$1 ORDER BY atg_tank_id`,
        [siteId]
      );

      if (firstPump.rowCount > 0) {
        await client.query(
          `INSERT INTO alarm_events(
            id, site_id, source_type, tank_id, pump_id, side, component, severity, state, event_at,
            alert_type, alert_type_id, reported_state, code, message, raw_payload, raised_at,
            cleared_at, ack_at, ack_by, assigned_to, created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
          [
            `alert-pump-${siteId}`,
            siteId,
            "PumpSide",
            null,
            firstPump.rows[0].id,
            "A",
            "cardreader",
            "warn",
            "raised",
            isoFrom(nowMs, 40 + siteOffset),
            "Card Reader Timeout",
            20401,
            "SET",
            "CR-204",
            "Card reader timeout",
            JSON.stringify({ source: "seed", category: "pump", side: "A" }),
            isoFrom(nowMs, 40 + siteOffset),
            null,
            null,
            null,
            null,
            isoFrom(nowMs, 40 + siteOffset)
          ]
        );
      }

      for (let index = 0; index < tankReportTemplates.length; index += 1) {
        if (tankRows.rows.length === 0) break;
        const template = tankReportTemplates[index];
        const tank = tankRows.rows[index % tankRows.rows.length];
        const eventAt = isoFrom(nowMs, template.secondsAgo + siteOffset);
        const raisedAt = template.state === "raised" ? eventAt : null;
        const clearedAt = template.state === "cleared" ? eventAt : null;

        await client.query(
          `INSERT INTO alarm_events(
            id, site_id, source_type, tank_id, pump_id, side, component, severity, state, event_at,
            alert_type, alert_type_id, reported_state, code, message, raw_payload, raised_at,
            cleared_at, ack_at, ack_by, assigned_to, created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
          [
            `alert-tank-${siteId}-${index + 1}`,
            siteId,
            "ATG",
            tank.id,
            null,
            null,
            "atg",
            template.severity,
            template.state,
            eventAt,
            template.alertType,
            template.alertTypeId,
            template.reportedState,
            `ATG-${template.alertTypeId}`,
            tankMessage(template.alertType, tank),
            JSON.stringify({
              source: "seed",
              report: "tank-alert-history",
              tankId: tank.atgTankId,
              tankLabel: tank.label,
              product: tank.product,
              alertType: template.alertType,
              alertTypeId: template.alertTypeId,
              reportedState: template.reportedState
            }),
            raisedAt,
            clearedAt,
            null,
            null,
            null,
            eventAt
          ]
        );
      }
    }

    for (const entry of seededSiteMeta) {
      const alliedRows = buildAlliedTransactionsForSite({
        siteId: entry.siteId,
        siteCode: entry.site.siteCode,
        timezone: entry.site.timezone,
        pumpCount: Math.max((entry.site.pumps || []).length, 4)
      });

      for (const row of alliedRows) {
        await client.query(
          `INSERT INTO allied_transactions(
            id, site_id, transaction_id, account_origin, actual_sales_price, auth_amount, card_name, card_type,
            emv_error_code, emv_status, emv_tran_type, entry_method, exp_date, fallback_to_msr, first8,
            fuel_description, fuel_position_id, fuel_quantity_gallons, last4, payment_type, store_id,
            tag_denial_reason, timestamp, timezone, total_amount, raw_json, created_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,
            $9,$10,$11,$12,$13,$14,$15,
            $16,$17,$18,$19,$20,$21,
            $22,$23,$24,$25,$26::jsonb,$27
          )`,
          [
            row.id,
            row.siteId,
            row.transactionId,
            row.accountOrigin,
            row.actualSalesPrice,
            row.authAmount,
            row.cardName,
            row.cardType,
            row.emvErrorCode,
            row.emvStatus,
            row.emvTranType,
            row.entryMethod,
            row.expDate,
            row.fallbackToMsr,
            row.first8,
            row.fuelDescription,
            row.fuelPositionId,
            row.fuelQuantityGallons,
            row.last4,
            row.paymentType,
            row.storeId,
            row.tagDenialReason,
            row.timestamp,
            row.timezone,
            row.totalAmount,
            JSON.stringify(row.rawJson || {}),
            row.timestamp
          ]
        );
      }
    }

    await replaceTransactionsForSites(
      client,
      seededSiteMeta.map((entry) => ({
        id: entry.siteId,
        address: entry.site.address,
        timezone: entry.site.timezone,
        pumpCount: Array.isArray(entry.site.pumps) ? entry.site.pumps.length : 0,
        fuelPositions:
          Array.isArray(entry.site.pumps) && entry.site.pumps.length > 0
            ? entry.site.pumps.flatMap((pump) => [
                String(Number(pump.pump_number) * 2 - 1),
                String(Number(pump.pump_number) * 2)
              ])
            : [],
        products: Array.isArray(entry.site.tanks) ? entry.site.tanks.map((tank) => tank.product) : []
      })),
      {}
    );
  });
}

async function seedIfEmpty() {
  await initDb();
  const result = await query("SELECT COUNT(*)::int AS count FROM users");
  if (result.rows[0].count === 0) {
    await seedDatabase();
    return true;
  }
  return false;
}

if (require.main === module) {
  seedDatabase()
    .then(() => {
      console.log("Seed complete.");
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { seedDatabase, seedIfEmpty };




