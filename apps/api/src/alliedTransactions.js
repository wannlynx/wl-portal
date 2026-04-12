const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const configPath = path.join(__dirname, "alliedTransactionConfig.json");
const sampleSiteConfigPath = path.join(__dirname, "../../../data/sample_site_config.yaml");
const alliedConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));

function hashString(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRng(seedValue) {
  let state = hashString(seedValue) || 1;
  return function rng() {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, items) {
  return items[Math.floor(rng() * items.length)];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundGallons(value) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function weightedPick(rng, items) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  let cursor = rng() * totalWeight;
  for (const item of items) {
    cursor -= item.weight;
    if (cursor <= 0) return item;
  }
  return items[items.length - 1];
}

function shuffle(rng, values) {
  const next = [...values];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function countByRatios(total, ratios) {
  const keys = Object.keys(ratios);
  const baseCounts = {};
  let assigned = 0;
  const fractions = [];

  for (const key of keys) {
    const exact = total * ratios[key];
    const whole = Math.floor(exact);
    baseCounts[key] = whole;
    assigned += whole;
    fractions.push({ key, remainder: exact - whole });
  }

  fractions.sort((a, b) => b.remainder - a.remainder);
  for (let index = 0; assigned < total; index = (index + 1) % fractions.length) {
    baseCounts[fractions[index].key] += 1;
    assigned += 1;
  }

  return baseCounts;
}

function toIso(date) {
  return new Date(date).toISOString();
}

function resolveTimezone(site) {
  if (site.timezone) return site.timezone;

  const stateMatch = String(site.address || "").match(/\b([A-Z]{2})\b(?:\s+\d{5}(?:-\d{4})?)?$/);
  const stateCode = stateMatch?.[1] || null;
  if (stateCode && alliedConfig.timezoneDefaults[stateCode]) {
    return alliedConfig.timezoneDefaults[stateCode];
  }

  return alliedConfig.timezoneDefaults.default;
}

function timezoneOffsetHours(timezone) {
  if (timezone === "America/Los_Angeles") return -7;
  if (timezone === "America/Denver") return -6;
  if (timezone === "America/Chicago") return -5;
  if (timezone === "America/Phoenix") return -7;
  return -4;
}

function localHourFor(date, timezone) {
  const shifted = new Date(date.getTime() + timezoneOffsetHours(timezone) * 60 * 60 * 1000);
  return shifted.getUTCHours();
}

function randomBetween(rng, min, max) {
  return min + (max - min) * rng();
}

function chance(rng, threshold) {
  return rng() < threshold;
}

function sampleTimestamp(rng, startDate, endDate, timezone) {
  const spanMs = endDate.getTime() - startDate.getTime();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const candidate = new Date(startDate.getTime() + rng() * spanMs);
    const localHour = localHourFor(candidate, timezone);
    const daytimeWeight =
      localHour >= 6 && localHour < 9 ? 0.7 :
      localHour >= 9 && localHour < 18 ? 1 :
      localHour >= 18 && localHour < 22 ? 0.55 :
      0.12;
    if (rng() <= daytimeWeight) return candidate;
  }
  return new Date(startDate.getTime() + rng() * spanMs);
}

function productProfileCandidates(site) {
  const products = Array.isArray(site.products) ? site.products : [];
  const hasDiesel = products.some((product) => /diesel/i.test(product));
  const base = [
    {
      description: "Regular Unleaded",
      ...alliedConfig.productProfiles["Regular Unleaded"]
    },
    {
      description: "Premium Unleaded",
      ...alliedConfig.productProfiles["Premium Unleaded"]
    }
  ];

  if (hasDiesel || products.length === 0) {
    base.push({
      description: "Diesel #2",
      ...alliedConfig.productProfiles["Diesel #2"]
    });
  }

  return base;
}

function buildFuelPositions(site) {
  if (Array.isArray(site.fuelPositions) && site.fuelPositions.length > 0) {
    return site.fuelPositions.map((value) => String(value));
  }

  const pumpCount = clamp(Number(site.pumpCount || 0), 0, 99);
  const positions = [];
  const effectivePumpCount = pumpCount > 0 ? pumpCount : 4;
  for (let pump = 1; pump <= effectivePumpCount; pump += 1) {
    positions.push(String(pump * 2 - 1), String(pump * 2));
  }
  return positions;
}

function regionPriceBump(site) {
  const timezone = resolveTimezone(site);
  if (timezone === "America/Los_Angeles") return 0.45;
  if (timezone === "America/Denver") return 0.22;
  if (timezone === "America/Chicago") return 0.12;
  return 0;
}

function buildPrice(rng, site, fuelProfile) {
  const [min, max] = fuelProfile.priceRange;
  return roundCurrency(randomBetween(rng, min, max) + regionPriceBump(site));
}

function buildTransactionId(siteId, index, timestamp) {
  const stamp = timestamp.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `AFC-${siteId.replace(/[^A-Za-z0-9]/g, "").slice(-12)}-${stamp}-${String(index + 1).padStart(4, "0")}`;
}

function buildCardSpec(rng, family) {
  const specs = {
    visa: [
      { card_name: "Visa Credit", card_type: "Visa", first8: "41234567" },
      { card_name: "Visa Business", card_type: "Visa", first8: "42561234" }
    ],
    mastercard: [
      { card_name: "Mastercard Credit", card_type: "Mastercard", first8: "54561234" },
      { card_name: "Mastercard Business", card_type: "Mastercard", first8: "55223344" }
    ],
    wex: [
      { card_name: "WEX Fleet One", card_type: "WEX", first8: "69004612" },
      { card_name: "Wright Express Fleet", card_type: "WEX", first8: "69005518" }
    ],
    voyager: [
      { card_name: "Voyager Fleet", card_type: "Voyager", first8: "70884512" }
    ]
  };

  const chosen = pick(rng, specs[family]);
  return {
    ...chosen,
    last4: String(Math.floor(randomBetween(rng, 1000, 9999.999))).padStart(4, "0"),
    exp_date: `${String(Math.floor(randomBetween(rng, 1, 12.999))).padStart(2, "0")}/${String(Math.floor(randomBetween(rng, 26, 31.999))).padStart(2, "0")}`
  };
}

function buildCard(rng, fuelDescription) {
  const fleetWeight = /diesel/i.test(fuelDescription) ? 0.55 : 0.18;
  const cardFamily = weightedPick(rng, [
    { value: "visa", weight: 0.42 - Math.min(fleetWeight, 0.2) },
    { value: "mastercard", weight: 0.3 - Math.min(fleetWeight, 0.08) },
    { value: "wex", weight: 0.2 + fleetWeight },
    { value: "voyager", weight: 0.08 + fleetWeight / 2 }
  ]).value;

  return buildCardSpec(rng, cardFamily);
}

function buildBaseRecord(site, index, timestamp, timezone, fuelPositionId) {
  return {
    account_origin: "Forecourt",
    actual_sales_price: null,
    auth_amount: null,
    card_name: null,
    card_type: null,
    emv_error_code: null,
    emv_status: null,
    emv_tran_type: null,
    entry_method: null,
    exp_date: null,
    fallback_to_msr: false,
    first8: null,
    fuel_description: null,
    fuel_position_id: fuelPositionId,
    fuel_quantity_gallons: 0,
    last4: null,
    payment_type: null,
    store_id: site.id,
    tag_denial_reason: "None",
    timestamp: toIso(timestamp),
    timezone,
    total_amount: 0,
    transaction_id: buildTransactionId(site.id, index, timestamp)
  };
}

function buildCompletedSale(rng, site, index, timestamp, fuelPositionId, options = {}) {
  const timezone = resolveTimezone(site);
  const record = buildBaseRecord(site, index, timestamp, timezone, fuelPositionId);
  const fuelProfile = weightedPick(rng, productProfileCandidates(site));
  const price = buildPrice(rng, site, fuelProfile);
  const gallons = roundGallons(randomBetween(rng, fuelProfile.gallonRange[0], fuelProfile.gallonRange[1]));
  const total = roundCurrency(gallons * price);
  const authBuffer = options.authGapMultiplier != null
    ? options.authGapMultiplier
    : /diesel/i.test(fuelProfile.description)
      ? randomBetween(rng, 1.12, 1.45)
      : randomBetween(rng, 1.05, 1.22);
  const card = buildCard(rng, fuelProfile.description);
  const isContactless = !!options.contactless;

  record.actual_sales_price = price;
  record.auth_amount = roundCurrency(Math.max(total, total * authBuffer));
  record.card_name = card.card_name;
  record.card_type = card.card_type;
  record.emv_status = options.emvStatus || "Complete";
  record.emv_tran_type = isContactless ? "ContactlessSale" : "FuelSale";
  record.entry_method = isContactless ? "EmvContactless" : "EmvQuickChip";
  record.exp_date = card.exp_date;
  record.first8 = card.first8;
  record.fuel_description = fuelProfile.description;
  record.fuel_quantity_gallons = gallons;
  record.last4 = card.last4;
  record.payment_type = "EmvChip";
  record.total_amount = total;

  if (options.accountOrigin) record.account_origin = options.accountOrigin;
  if (options.emvErrorCode) record.emv_error_code = options.emvErrorCode;
  if (options.fallbackToMsr) {
    record.fallback_to_msr = true;
    record.entry_method = "MSR";
    record.emv_tran_type = "FallbackSale";
  }
  if (options.overrideFuelDescription) {
    record.fuel_description = options.overrideFuelDescription;
  }
  if (options.overrideGallons != null) {
    record.fuel_quantity_gallons = roundGallons(options.overrideGallons);
    record.total_amount = roundCurrency(record.fuel_quantity_gallons * record.actual_sales_price);
  }
  if (options.overrideTotal != null) {
    record.total_amount = roundCurrency(options.overrideTotal);
  }
  if (options.overrideAuth != null) {
    record.auth_amount = roundCurrency(options.overrideAuth);
  }
  if (options.overrideTagDenialReason) {
    record.tag_denial_reason = options.overrideTagDenialReason;
  }

  return record;
}

function buildAbortRecord(rng, site, index, timestamp, fuelPositionId, options = {}) {
  const timezone = resolveTimezone(site);
  const record = buildBaseRecord(site, index, timestamp, timezone, fuelPositionId);
  const contactless = !!options.contactless;
  const partialFuel = chance(rng, options.partialRate ?? 0.15);
  const fuelProfile = weightedPick(rng, productProfileCandidates(site));
  const price = buildPrice(rng, site, fuelProfile);

  record.account_origin = "Forecourt";
  record.card_name = contactless ? "Visa Credit" : "Mastercard Credit";
  record.card_type = contactless ? "Visa" : "Mastercard";
  record.emv_status = "CustomerAbort";
  record.emv_tran_type = contactless ? "ContactlessSale" : "FuelSale";
  record.entry_method = contactless ? "EmvContactless" : "EmvQuickChip";
  record.exp_date = "09/28";
  record.first8 = contactless ? "41234567" : "54561234";
  record.last4 = String(Math.floor(randomBetween(rng, 1000, 9999.999))).padStart(4, "0");
  record.payment_type = "EmvChip";
  record.tag_denial_reason = "UserAbort";
  record.auth_amount = chance(rng, 0.55) ? roundCurrency(randomBetween(rng, 75, 175)) : null;

  if (partialFuel) {
    const gallons = roundGallons(randomBetween(rng, 0.3, 2.4));
    record.actual_sales_price = price;
    record.fuel_description = fuelProfile.description;
    record.fuel_quantity_gallons = gallons;
    record.total_amount = options.forceZeroTotal ? 0 : roundCurrency(gallons * price);
    record.emv_error_code = options.emvErrorCode || "A13";
  } else {
    record.total_amount = 0;
    record.emv_error_code = options.emvErrorCode || null;
  }

  return record;
}

function buildPresetCashRecord(rng, site, index, timestamp, fuelPositionId) {
  const timezone = resolveTimezone(site);
  const record = buildBaseRecord(site, index, timestamp, timezone, fuelPositionId);
  const fuelProfile = weightedPick(rng, productProfileCandidates(site));
  const price = buildPrice(rng, site, fuelProfile);
  const presetAmount = pick(rng, [20, 25, 30, 40, 50, 60, 75, 100]);
  const gallons = roundGallons((presetAmount - randomBetween(rng, 0, 2.25)) / price);
  const total = roundCurrency(gallons * price);

  record.account_origin = "POSPreset";
  record.actual_sales_price = price;
  record.auth_amount = presetAmount;
  record.card_name = "Cash";
  record.card_type = "Cash";
  record.fuel_description = fuelProfile.description;
  record.fuel_quantity_gallons = gallons;
  record.payment_type = "Preset";
  record.total_amount = total;

  return record;
}

function buildFallbackRecord(rng, site, index, timestamp, fuelPositionId) {
  const errorCode = pick(rng, ["55", "A05", "C31", "91"]);
  const record = buildCompletedSale(rng, site, index, timestamp, fuelPositionId, {
    fallbackToMsr: true,
    emvErrorCode: errorCode,
    accountOrigin: "Fallback"
  });

  record.tag_denial_reason = pick(rng, ["FallbackRequired", "None", "ChipReadError"]);
  if (record.tag_denial_reason !== "None") {
    record.emv_status = "Complete";
  }
  return record;
}

function buildEdgeCaseRecord(rng, site, index, timestamp, fuelPositionId) {
  const edgeType = pick(rng, [
    "tiny_fill",
    "large_fleet_fill",
    "suspicious_complete",
    "auth_gap",
    "zero_abort",
    "contactless_abort"
  ]);

  if (edgeType === "tiny_fill") {
    return buildCompletedSale(rng, site, index, timestamp, fuelPositionId, {
      overrideGallons: randomBetween(rng, 0.35, 1.25),
      authGapMultiplier: randomBetween(rng, 1.15, 1.45)
    });
  }

  if (edgeType === "large_fleet_fill") {
    return buildCompletedSale(rng, site, index, timestamp, fuelPositionId, {
      accountOrigin: "Fleet",
      overrideFuelDescription: "Diesel #2",
      overrideGallons: randomBetween(rng, 48, 90),
      authGapMultiplier: randomBetween(rng, 1.2, 1.55)
    });
  }

  if (edgeType === "suspicious_complete") {
    const record = buildCompletedSale(rng, site, index, timestamp, fuelPositionId, {
      emvErrorCode: pick(rng, ["Z9", "A01"]),
      overrideTagDenialReason: "None"
    });
    record.auth_amount = roundCurrency(Math.max(record.total_amount - 4.25, 1));
    return record;
  }

  if (edgeType === "auth_gap") {
    return buildCompletedSale(rng, site, index, timestamp, fuelPositionId, {
      authGapMultiplier: randomBetween(rng, 1.4, 1.8)
    });
  }

  if (edgeType === "contactless_abort") {
    return buildAbortRecord(rng, site, index, timestamp, fuelPositionId, {
      contactless: true,
      partialRate: 0.05,
      forceZeroTotal: true,
      emvErrorCode: "CTLS-ABORT"
    });
  }

  return buildAbortRecord(rng, site, index, timestamp, fuelPositionId, {
    partialRate: 0,
    forceZeroTotal: true
  });
}

function buildRecordsForSite(site, options = {}) {
  const seed = options.seed ?? alliedConfig.seed;
  const timezone = resolveTimezone(site);
  const startDate = new Date(options.startDate || Date.now() - alliedConfig.dateWindowDays * 24 * 60 * 60 * 1000);
  const endDate = new Date(options.endDate || Date.now());
  const totalRecords = options.recordsPerSite ?? alliedConfig.recordsPerSite;
  const counts = countByRatios(totalRecords, options.mix || alliedConfig.mix);
  const fuelPositions = buildFuelPositions(site);
  const positionRng = createRng(`${seed}:${site.id}:positions`);
  const timestampRng = createRng(`${seed}:${site.id}:timestamps`);
  const categoryRng = createRng(`${seed}:${site.id}:categories`);
  const records = [];

  const builders = [
    ...Array.from({ length: counts.successfulEmv }, () => "successfulEmv"),
    ...Array.from({ length: counts.contactlessEmv }, () => "contactlessEmv"),
    ...Array.from({ length: counts.customerAbort }, () => "customerAbort"),
    ...Array.from({ length: counts.fallbackAnomaly }, () => "fallbackAnomaly"),
    ...Array.from({ length: counts.presetCash }, () => "presetCash"),
    ...Array.from({ length: counts.edgeCase }, () => "edgeCase")
  ];

  const shuffledBuilders = shuffle(categoryRng, builders);
  for (let index = 0; index < shuffledBuilders.length; index += 1) {
    const type = shuffledBuilders[index];
    const fuelPositionId = pick(positionRng, fuelPositions);
    const timestamp = sampleTimestamp(timestampRng, startDate, endDate, timezone);
    let record;

    if (type === "successfulEmv") {
      record = buildCompletedSale(createRng(`${seed}:${site.id}:${index}`), site, index, timestamp, fuelPositionId);
    } else if (type === "contactlessEmv") {
      record = buildCompletedSale(createRng(`${seed}:${site.id}:${index}`), site, index, timestamp, fuelPositionId, {
        contactless: true
      });
    } else if (type === "customerAbort") {
      record = buildAbortRecord(createRng(`${seed}:${site.id}:${index}`), site, index, timestamp, fuelPositionId);
    } else if (type === "fallbackAnomaly") {
      record = buildFallbackRecord(createRng(`${seed}:${site.id}:${index}`), site, index, timestamp, fuelPositionId);
    } else if (type === "presetCash") {
      record = buildPresetCashRecord(createRng(`${seed}:${site.id}:${index}`), site, index, timestamp, fuelPositionId);
    } else {
      record = buildEdgeCaseRecord(createRng(`${seed}:${site.id}:${index}`), site, index, timestamp, fuelPositionId);
    }

    if (record.payment_type === "Preset") {
      record.emv_status = null;
      record.emv_tran_type = null;
      record.entry_method = null;
      record.emv_error_code = null;
      record.fallback_to_msr = false;
      record.first8 = null;
      record.last4 = null;
      record.exp_date = null;
      record.tag_denial_reason = "None";
    }

    if (record.emv_status === "Complete" && record.total_amount > 0 && record.actual_sales_price != null) {
      record.total_amount = roundCurrency(record.total_amount);
      if (record.payment_type === "EmvChip" && record.auth_amount == null) {
        record.auth_amount = roundCurrency(record.total_amount);
      }
    }

    records.push(record);
  }

  return records.sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));
}

function buildSiteProfilesFromRows(siteRows) {
  return siteRows.map((row) => ({
    id: row.id,
    timezone: row.timezone || null,
    address: row.address || "",
    pumpCount: Number(row.pump_count || 0),
    products: Array.isArray(row.products) ? row.products.filter(Boolean) : []
  }));
}

async function fetchSiteProfiles(db, siteIds = []) {
  const params = [];
  let whereClause = "";
  if (siteIds.length > 0) {
    params.push(siteIds);
    whereClause = "WHERE s.id = ANY($1)";
  }

  const result = await db.query(
    `
      SELECT
        s.id,
        s.address,
        s.timezone,
        COUNT(DISTINCT p.id)::int AS pump_count,
        COALESCE(
          ARRAY_AGG(DISTINCT t.product ORDER BY t.product)
            FILTER (WHERE t.product IS NOT NULL),
          ARRAY[]::text[]
        ) AS products
      FROM sites s
      LEFT JOIN pumps p ON p.site_id = s.id
      LEFT JOIN tanks t ON t.site_id = s.id
      ${whereClause}
      GROUP BY s.id, s.address, s.timezone
      ORDER BY s.id
    `,
    params
  );

  return buildSiteProfilesFromRows(result.rows);
}

async function replaceTransactionsForSites(db, siteProfiles, options = {}) {
  const startDate = new Date(options.startDate || Date.now() - alliedConfig.dateWindowDays * 24 * 60 * 60 * 1000);
  const endDate = new Date(options.endDate || Date.now());
  const siteIds = siteProfiles.map((site) => site.id);

  if (siteIds.length === 0) return [];

  await db.query(
    `DELETE FROM allied_transactions
     WHERE store_id = ANY($1)
       AND "timestamp" >= $2
       AND "timestamp" <= $3`,
    [siteIds, startDate.toISOString(), endDate.toISOString()]
  );

  const generated = [];
  for (const site of siteProfiles) {
    const rows = buildRecordsForSite(site, options);
    generated.push(...rows);
    for (const row of rows) {
      const persisted = {
        ...row,
        id: `${row.store_id}:${row.transaction_id}`,
        site_id: row.store_id,
        account_origin: row.account_origin ?? "",
        card_name: row.card_name ?? "",
        card_type: row.card_type ?? "",
        emv_error_code: row.emv_error_code ?? "",
        emv_status: row.emv_status ?? "",
        emv_tran_type: row.emv_tran_type ?? "",
        entry_method: row.entry_method ?? "",
        exp_date: row.exp_date ?? "",
        first8: row.first8 ?? "",
        fuel_description: row.fuel_description ?? "",
        fuel_position_id: row.fuel_position_id ?? "",
        last4: row.last4 ?? "",
        payment_type: row.payment_type ?? "",
        tag_denial_reason: row.tag_denial_reason ?? "",
        raw_json: row,
        created_at: new Date().toISOString()
      };
      await db.query(
        `INSERT INTO allied_transactions(
          id, site_id, store_id, transaction_id, account_origin, actual_sales_price, auth_amount,
          card_name, card_type, emv_error_code, emv_status, emv_tran_type,
          entry_method, exp_date, fallback_to_msr, first8, fuel_description,
          fuel_position_id, fuel_quantity_gallons, last4, payment_type,
          tag_denial_reason, "timestamp", "timezone", total_amount, raw_json, created_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,
          $8,$9,$10,$11,$12,
          $13,$14,$15,$16,$17,
          $18,$19,$20,$21,
          $22,$23,$24,$25,$26,$27
        )`,
        [
          persisted.id,
          persisted.site_id,
          persisted.store_id,
          persisted.transaction_id,
          persisted.account_origin,
          persisted.actual_sales_price,
          persisted.auth_amount,
          persisted.card_name,
          persisted.card_type,
          persisted.emv_error_code,
          persisted.emv_status,
          persisted.emv_tran_type,
          persisted.entry_method,
          persisted.exp_date,
          persisted.fallback_to_msr,
          persisted.first8,
          persisted.fuel_description,
          persisted.fuel_position_id,
          persisted.fuel_quantity_gallons,
          persisted.last4,
          persisted.payment_type,
          persisted.tag_denial_reason,
          persisted.timestamp,
          persisted.timezone,
          persisted.total_amount,
          JSON.stringify(persisted.raw_json),
          persisted.created_at
        ]
      );
    }
  }

  return generated;
}

function loadSampleSiteProfiles() {
  const yamlText = fs.readFileSync(sampleSiteConfigPath, "utf8");
  const parsed = yaml.load(yamlText);
  return (parsed.sites || []).map((site) => ({
    id: `site-${site.site_code}`,
    address: site.address || "",
    timezone: resolveTimezone({ address: site.address || "", timezone: site.timezone || null }),
    pumpCount: Array.isArray(site.pumps) ? site.pumps.length : 0,
    fuelPositions: Array.isArray(site.pumps)
      ? site.pumps.flatMap((pump) => [String(Number(pump.pump_number) * 2 - 1), String(Number(pump.pump_number) * 2)])
      : [],
    products: Array.isArray(site.tanks) ? site.tanks.map((tank) => tank.product) : []
  }));
}

module.exports = {
  alliedConfig,
  buildRecordsForSite,
  buildSiteProfilesFromRows,
  fetchSiteProfiles,
  loadSampleSiteProfiles,
  replaceTransactionsForSites,
  resolveTimezone
};
