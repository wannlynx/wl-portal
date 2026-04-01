const crypto = require("crypto");
const { query, tx } = require("../db");

const PRODUCT_FAMILIES = new Set(["regular", "mid", "premium", "diesel"]);
const PRICING_BRANCHES = new Set(["branded", "unbranded", "spot", "rack"]);
const PRODUCT_KEYS = new Set([
  "reg_87_carb",
  "mid_89_carb",
  "premium_91_carb",
  "diesel_carb_ulsd",
  "diesel_red",
  "ethanol",
  "rin",
  "lcfs_gasoline",
  "lcfs_diesel",
  "ghg_gasoline",
  "ghg_diesel"
]);
const MARKET_KEYS = new Set(["san_francisco", "benicia", "sacramento", "san_jose", "stockton", "bay_area"]);
const TERMINAL_KEYS = new Set([
  "benicia_terminal",
  "stockton_terminal",
  "sacramento_terminal",
  "san_jose_terminal",
  "san_francisco_terminal"
]);
const VENDOR_KEYS = new Set(["valero", "psx", "tesoro", "marathon", "shell", "chevron", "bp"]);
const SOURCE_TYPES = new Set(["opis", "branded_zone", "branded_area", "tax", "manual_adjustment", "derived"]);
const SNAPSHOT_STATUSES = new Set(["draft", "ready", "locked", "superseded"]);
const RULE_SET_STATUSES = new Set(["draft", "active", "retired"]);
const GENERATED_PRICE_STATUSES = new Set(["generated", "reviewed", "exported", "sent", "failed"]);
const DELIVERY_METHODS = new Set(["email", "fax_email", "manual"]);
const VENDOR_SELECTION_MODES = new Set(["lowest", "highest", "first_available", "specific_vendor"]);
const COMPONENT_SOURCE_KINDS = new Set([
  "source_value",
  "tax",
  "tax_schedule",
  "customer_profile",
  "vendor_min",
  "constant",
  "default",
  "derived_component"
]);

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function pricingText(value, fallback = "") {
  return String(value == null ? fallback : value).trim();
}

function pricingNullableDate(value) {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function toNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function invalidValueError(field, value, allowedValues) {
  const error = new Error(`${field} must be one of: ${allowedValues.join(", ")}. Received: ${value || "(blank)"}`);
  error.statusCode = 400;
  return error;
}

function assertAllowedValue(field, value, allowedSet) {
  const normalized = pricingText(value);
  if (!normalized) return "";
  if (!allowedSet.has(normalized)) {
    throw invalidValueError(field, normalized, [...allowedSet]);
  }
  return normalized;
}

function assertOptionalAllowedValue(field, value, allowedSet) {
  if (value == null || String(value).trim() === "") return "";
  return assertAllowedValue(field, value, allowedSet);
}

function validateProfileRules(rules) {
  const nextRules = rules && typeof rules === "object" ? { ...rules } : {};
  if (Object.prototype.hasOwnProperty.call(nextRules, "branch")) {
    nextRules.branch = assertAllowedValue("rules.branch", nextRules.branch, PRICING_BRANCHES);
  }
  if (Object.prototype.hasOwnProperty.call(nextRules, "marketKey")) {
    nextRules.marketKey = assertOptionalAllowedValue("rules.marketKey", nextRules.marketKey, MARKET_KEYS);
  }
  if (Object.prototype.hasOwnProperty.call(nextRules, "terminalKey")) {
    nextRules.terminalKey = assertOptionalAllowedValue("rules.terminalKey", nextRules.terminalKey, TERMINAL_KEYS);
  }
  return nextRules;
}

function customerRow(row) {
  return {
    id: row.id,
    jobberId: row.jobberId,
    name: row.name,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    terminalKey: row.terminalKey,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function customerContactRow(row) {
  return {
    id: row.id,
    customerId: row.customerId,
    name: row.name,
    email: row.email,
    phone: row.phone,
    faxEmail: row.faxEmail,
    isPrimary: row.isPrimary,
    deliveryMethod: row.deliveryMethod,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function customerPricingProfileRow(row) {
  return {
    id: row.id,
    customerId: row.customerId,
    effectiveStart: row.effectiveStart,
    effectiveEnd: row.effectiveEnd,
    freightMiles: row.freightMiles,
    freightCostGas: row.freightCostGas,
    freightCostDiesel: row.freightCostDiesel,
    rackMarginGas: row.rackMarginGas,
    rackMarginDiesel: row.rackMarginDiesel,
    discountRegular: row.discountRegular,
    discountMid: row.discountMid,
    discountPremium: row.discountPremium,
    discountDiesel: row.discountDiesel,
    outputTemplateId: row.outputTemplateId,
    rules: row.rules || {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function pricingSourceSnapshotRow(row) {
  return {
    id: row.id,
    jobberId: row.jobberId,
    pricingDate: row.pricingDate,
    sourceType: row.sourceType,
    sourceLabel: row.sourceLabel,
    status: row.status,
    receivedAt: row.receivedAt,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    notes: row.notes
  };
}

function pricingSourceValueRow(row) {
  return {
    id: row.id,
    snapshotId: row.snapshotId,
    marketKey: row.marketKey,
    terminalKey: row.terminalKey,
    productKey: row.productKey,
    vendorKey: row.vendorKey,
    quoteCode: row.quoteCode,
    value: row.value,
    unit: row.unit,
    effectiveDate: row.effectiveDate,
    metadata: row.metadata || {},
    createdAt: row.createdAt
  };
}

function pricingTaxScheduleRow(row) {
  return {
    id: row.id,
    jobberId: row.jobberId,
    productFamily: row.productFamily,
    taxName: row.taxName,
    value: row.value,
    unit: row.unit,
    effectiveStart: row.effectiveStart,
    effectiveEnd: row.effectiveEnd,
    createdAt: row.createdAt,
    createdBy: row.createdBy
  };
}

function pricingRuleSetRow(row) {
  return {
    id: row.id,
    jobberId: row.jobberId,
    name: row.name,
    productFamily: row.productFamily,
    effectiveStart: row.effectiveStart,
    effectiveEnd: row.effectiveEnd,
    status: row.status,
    versionLabel: row.versionLabel,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function pricingRuleComponentRow(row) {
  return {
    id: row.id,
    ruleSetId: row.ruleSetId,
    componentKey: row.componentKey,
    label: row.label,
    sourceKind: row.sourceKind,
    sourceRef: row.sourceRef,
    defaultValue: row.defaultValue,
    multiplier: row.multiplier,
    sortOrder: row.sortOrder,
    isEditable: row.isEditable,
    metadata: row.metadata || {}
  };
}

function pricingRuleVendorSetRow(row) {
  return {
    id: row.id,
    ruleSetId: row.ruleSetId,
    selectionMode: row.selectionMode,
    productFamily: row.productFamily,
    marketKey: row.marketKey,
    vendors: Array.isArray(row.vendors) ? row.vendors : []
  };
}

function generatedCustomerPriceRow(row) {
  return {
    id: row.id,
    jobberId: row.jobberId,
    customerId: row.customerId,
    customerName: row.customerName,
    pricingDate: row.pricingDate,
    ruleSetId: row.ruleSetId,
    ruleSetName: row.ruleSetName,
    sourceSnapshotGroup: row.sourceSnapshotGroup || {},
    regularBase: row.regularBase,
    midBase: row.midBase,
    premiumBase: row.premiumBase,
    dieselBase: row.dieselBase,
    regularTotal: row.regularTotal,
    midTotal: row.midTotal,
    premiumTotal: row.premiumTotal,
    dieselTotal: row.dieselTotal,
    detail: row.detail || {},
    status: row.status,
    createdAt: row.createdAt,
    createdBy: row.createdBy
  };
}

async function getCustomerOwnedByJobber(jobberId, customerId) {
  const result = await query(
    `SELECT
      id,
      jobber_id AS "jobberId",
      name,
      address_line1 AS "addressLine1",
      address_line2 AS "addressLine2",
      city,
      state,
      postal_code AS "postalCode",
      terminal_key AS "terminalKey",
      status,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
     FROM customers
     WHERE id=$1 AND jobber_id=$2
     LIMIT 1`,
    [customerId, jobberId]
  );
  return result.rowCount ? customerRow(result.rows[0]) : null;
}

async function listCustomers(jobberId) {
  const result = await query(
    `SELECT
      id,
      jobber_id AS "jobberId",
      name,
      address_line1 AS "addressLine1",
      address_line2 AS "addressLine2",
      city,
      state,
      postal_code AS "postalCode",
      terminal_key AS "terminalKey",
      status,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
     FROM customers
     WHERE jobber_id=$1
     ORDER BY name ASC`,
    [jobberId]
  );
  return result.rows.map(customerRow);
}

async function createCustomer(jobberId, input) {
  const name = pricingText(input.name);
  const terminalKey = assertOptionalAllowedValue("terminalKey", input.terminalKey, TERMINAL_KEYS);
  if (!name) {
    const error = new Error("name is required");
    error.statusCode = 400;
    throw error;
  }
  const now = new Date().toISOString();
  const customerId = id("customer");
  await query(
    `INSERT INTO customers(
      id, jobber_id, name, address_line1, address_line2, city, state, postal_code, terminal_key, status, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      customerId,
      jobberId,
      name,
      pricingText(input.addressLine1),
      pricingText(input.addressLine2),
      pricingText(input.city),
      pricingText(input.state),
      pricingText(input.postalCode),
      terminalKey,
      pricingText(input.status, "active") || "active",
      now,
      now
    ]
  );
  return getCustomerOwnedByJobber(jobberId, customerId);
}

async function listCustomerContacts(customerId) {
  const result = await query(
    `SELECT
      id,
      customer_id AS "customerId",
      name,
      email,
      phone,
      fax_email AS "faxEmail",
      is_primary AS "isPrimary",
      delivery_method AS "deliveryMethod",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
     FROM customer_contacts
     WHERE customer_id=$1
     ORDER BY is_primary DESC, name ASC`,
    [customerId]
  );
  return result.rows.map(customerContactRow);
}

async function createCustomerContact(jobberId, customerId, input) {
  const customer = await getCustomerOwnedByJobber(jobberId, customerId);
  if (!customer) return undefined;
  const name = pricingText(input.name);
  if (!name) {
    const error = new Error("name is required");
    error.statusCode = 400;
    throw error;
  }
  const now = new Date().toISOString();
  const contactId = id("customer-contact");
  const deliveryMethod = assertAllowedValue("deliveryMethod", pricingText(input.deliveryMethod, "email") || "email", DELIVERY_METHODS);
  await query(
    `INSERT INTO customer_contacts(
      id, customer_id, name, email, phone, fax_email, is_primary, delivery_method, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      contactId,
      customerId,
      name,
      pricingText(input.email),
      pricingText(input.phone),
      pricingText(input.faxEmail),
      !!input.isPrimary,
      deliveryMethod,
      now,
      now
    ]
  );
  const saved = await query(
    `SELECT
      id,
      customer_id AS "customerId",
      name,
      email,
      phone,
      fax_email AS "faxEmail",
      is_primary AS "isPrimary",
      delivery_method AS "deliveryMethod",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
     FROM customer_contacts
     WHERE id=$1`,
    [contactId]
  );
  return customerContactRow(saved.rows[0]);
}

async function updateCustomerContact(jobberId, customerId, contactId, input) {
  const customer = await getCustomerOwnedByJobber(jobberId, customerId);
  if (!customer) return undefined;
  const existing = await query(
    `SELECT
      id,
      customer_id AS "customerId",
      name,
      email,
      phone,
      fax_email AS "faxEmail",
      is_primary AS "isPrimary",
      delivery_method AS "deliveryMethod",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
     FROM customer_contacts
     WHERE id=$1 AND customer_id=$2
     LIMIT 1`,
    [contactId, customerId]
  );
  if (existing.rowCount === 0) return null;
  const current = existing.rows[0];
  const nextName = input.name == null ? current.name : pricingText(input.name);
  if (!nextName) {
    const error = new Error("name is required");
    error.statusCode = 400;
    throw error;
  }
  const deliveryMethod = input.deliveryMethod == null
    ? current.deliveryMethod
    : assertAllowedValue("deliveryMethod", pricingText(input.deliveryMethod, current.deliveryMethod), DELIVERY_METHODS);
  await query(
    `UPDATE customer_contacts
     SET
      name=$1,
      email=$2,
      phone=$3,
      fax_email=$4,
      is_primary=$5,
      delivery_method=$6,
      updated_at=$7
     WHERE id=$8`,
    [
      nextName,
      input.email == null ? current.email : pricingText(input.email),
      input.phone == null ? current.phone : pricingText(input.phone),
      input.faxEmail == null ? current.faxEmail : pricingText(input.faxEmail),
      input.isPrimary == null ? current.isPrimary : !!input.isPrimary,
      deliveryMethod,
      new Date().toISOString(),
      contactId
    ]
  );
  const saved = await query(
    `SELECT
      id,
      customer_id AS "customerId",
      name,
      email,
      phone,
      fax_email AS "faxEmail",
      is_primary AS "isPrimary",
      delivery_method AS "deliveryMethod",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
     FROM customer_contacts
     WHERE id=$1`,
    [contactId]
  );
  return customerContactRow(saved.rows[0]);
}

async function deleteCustomerContact(jobberId, customerId, contactId) {
  const customer = await getCustomerOwnedByJobber(jobberId, customerId);
  if (!customer) return undefined;
  const result = await query(`DELETE FROM customer_contacts WHERE id=$1 AND customer_id=$2`, [contactId, customerId]);
  return result.rowCount > 0;
}

async function getCustomerDetail(jobberId, customerId) {
  const customer = await getCustomerOwnedByJobber(jobberId, customerId);
  if (!customer) return null;
  const contacts = await listCustomerContacts(customerId);
  return { ...customer, contacts };
}

async function updateCustomer(jobberId, customerId, input) {
  const current = await getCustomerOwnedByJobber(jobberId, customerId);
  if (!current) return null;
  const nextName = input.name == null ? current.name : pricingText(input.name);
  if (!nextName) {
    const error = new Error("name is required");
    error.statusCode = 400;
    throw error;
  }
  const terminalKey = input.terminalKey == null
    ? current.terminalKey
    : assertOptionalAllowedValue("terminalKey", input.terminalKey, TERMINAL_KEYS);
  await query(
    `UPDATE customers
     SET
      name=$1,
      address_line1=$2,
      address_line2=$3,
      city=$4,
      state=$5,
      postal_code=$6,
      terminal_key=$7,
      status=$8,
      updated_at=$9
     WHERE id=$10`,
    [
      nextName,
      input.addressLine1 == null ? current.addressLine1 : pricingText(input.addressLine1),
      input.addressLine2 == null ? current.addressLine2 : pricingText(input.addressLine2),
      input.city == null ? current.city : pricingText(input.city),
      input.state == null ? current.state : pricingText(input.state),
      input.postalCode == null ? current.postalCode : pricingText(input.postalCode),
      terminalKey,
      input.status == null ? current.status : pricingText(input.status, current.status),
      new Date().toISOString(),
      customerId
    ]
  );
  return getCustomerOwnedByJobber(jobberId, customerId);
}

async function getLatestCustomerPricingProfile(jobberId, customerId) {
  const customer = await getCustomerOwnedByJobber(jobberId, customerId);
  if (!customer) return undefined;
  const profile = await query(
    `SELECT
      id,
      customer_id AS "customerId",
      effective_start AS "effectiveStart",
      effective_end AS "effectiveEnd",
      freight_miles AS "freightMiles",
      freight_cost_gas AS "freightCostGas",
      freight_cost_diesel AS "freightCostDiesel",
      rack_margin_gas AS "rackMarginGas",
      rack_margin_diesel AS "rackMarginDiesel",
      discount_regular AS "discountRegular",
      discount_mid AS "discountMid",
      discount_premium AS "discountPremium",
      discount_diesel AS "discountDiesel",
      output_template_id AS "outputTemplateId",
      rules_json AS "rules",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
     FROM customer_pricing_profiles
     WHERE customer_id=$1
     ORDER BY effective_start DESC
     LIMIT 1`,
    [customerId]
  );
  if (profile.rowCount === 0) return null;
  return customerPricingProfileRow(profile.rows[0]);
}

async function getCustomerPricingProfileForDate(jobberId, customerId, pricingDate) {
  const customer = await getCustomerOwnedByJobber(jobberId, customerId);
  if (!customer) return undefined;
  const effectiveDate = pricingNullableDate(pricingDate);
  if (!effectiveDate) return null;
  const profile = await query(
    `SELECT
      id,
      customer_id AS "customerId",
      effective_start AS "effectiveStart",
      effective_end AS "effectiveEnd",
      freight_miles AS "freightMiles",
      freight_cost_gas AS "freightCostGas",
      freight_cost_diesel AS "freightCostDiesel",
      rack_margin_gas AS "rackMarginGas",
      rack_margin_diesel AS "rackMarginDiesel",
      discount_regular AS "discountRegular",
      discount_mid AS "discountMid",
      discount_premium AS "discountPremium",
      discount_diesel AS "discountDiesel",
      output_template_id AS "outputTemplateId",
      rules_json AS "rules",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
     FROM customer_pricing_profiles
     WHERE customer_id=$1
       AND effective_start <= $2
       AND (effective_end IS NULL OR effective_end >= $2)
     ORDER BY effective_start DESC
     LIMIT 1`,
    [customerId, effectiveDate]
  );
  if (profile.rowCount === 0) return null;
  return customerPricingProfileRow(profile.rows[0]);
}

async function saveCustomerPricingProfile(jobberId, customerId, input) {
  const customer = await getCustomerOwnedByJobber(jobberId, customerId);
  if (!customer) return undefined;
  const effectiveStart = pricingNullableDate(input.effectiveStart) || new Date().toISOString().slice(0, 10);
  const effectiveEnd = pricingNullableDate(input.effectiveEnd);
  const existing = await query(
    `SELECT id
     FROM customer_pricing_profiles
     WHERE customer_id=$1 AND effective_start=$2
     LIMIT 1`,
    [customerId, effectiveStart]
  );
  const now = new Date().toISOString();
  const profileId = existing.rowCount ? existing.rows[0].id : id("customer-profile");
  const rules = validateProfileRules(input.rules);
  if (existing.rowCount) {
    await query(
      `UPDATE customer_pricing_profiles
       SET
        effective_end=$1,
        freight_miles=$2,
        freight_cost_gas=$3,
        freight_cost_diesel=$4,
        rack_margin_gas=$5,
        rack_margin_diesel=$6,
        discount_regular=$7,
        discount_mid=$8,
        discount_premium=$9,
        discount_diesel=$10,
        output_template_id=$11,
        rules_json=$12::jsonb,
        updated_at=$13
       WHERE id=$14`,
      [
        effectiveEnd,
        toNumber(input.freightMiles),
        toNumber(input.freightCostGas),
        toNumber(input.freightCostDiesel),
        toNumber(input.rackMarginGas),
        toNumber(input.rackMarginDiesel),
        toNumber(input.discountRegular),
        toNumber(input.discountMid),
        toNumber(input.discountPremium),
        toNumber(input.discountDiesel),
        pricingText(input.outputTemplateId),
        JSON.stringify(rules),
        now,
        profileId
      ]
    );
  } else {
    await query(
      `INSERT INTO customer_pricing_profiles(
        id, customer_id, effective_start, effective_end, freight_miles, freight_cost_gas, freight_cost_diesel,
        rack_margin_gas, rack_margin_diesel, discount_regular, discount_mid, discount_premium, discount_diesel,
        output_template_id, rules_json, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17)`,
      [
        profileId,
        customerId,
        effectiveStart,
        effectiveEnd,
        toNumber(input.freightMiles),
        toNumber(input.freightCostGas),
        toNumber(input.freightCostDiesel),
        toNumber(input.rackMarginGas),
        toNumber(input.rackMarginDiesel),
        toNumber(input.discountRegular),
        toNumber(input.discountMid),
        toNumber(input.discountPremium),
        toNumber(input.discountDiesel),
        pricingText(input.outputTemplateId),
        JSON.stringify(rules),
        now,
        now
      ]
    );
  }
  return query(
    `SELECT
      id,
      customer_id AS "customerId",
      effective_start AS "effectiveStart",
      effective_end AS "effectiveEnd",
      freight_miles AS "freightMiles",
      freight_cost_gas AS "freightCostGas",
      freight_cost_diesel AS "freightCostDiesel",
      rack_margin_gas AS "rackMarginGas",
      rack_margin_diesel AS "rackMarginDiesel",
      discount_regular AS "discountRegular",
      discount_mid AS "discountMid",
      discount_premium AS "discountPremium",
      discount_diesel AS "discountDiesel",
      output_template_id AS "outputTemplateId",
      rules_json AS "rules",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
     FROM customer_pricing_profiles
     WHERE id=$1`,
    [profileId]
  ).then((result) => customerPricingProfileRow(result.rows[0]));
}

async function listPricingSources(jobberId, filters = {}) {
  const params = [jobberId];
  const conditions = [`jobber_id=$1`];
  const pricingDate = pricingNullableDate(filters.pricingDate);
  if (pricingDate) {
    params.push(pricingDate);
    conditions.push(`pricing_date=$${params.length}`);
  }
  if (filters.sourceType) {
    params.push(pricingText(filters.sourceType));
    conditions.push(`source_type=$${params.length}`);
  }
  const result = await query(
    `SELECT
      id,
      jobber_id AS "jobberId",
      pricing_date AS "pricingDate",
      source_type AS "sourceType",
      source_label AS "sourceLabel",
      status,
      received_at AS "receivedAt",
      created_at AS "createdAt",
      created_by AS "createdBy",
      notes
     FROM pricing_source_snapshots
     WHERE ${conditions.join(" AND ")}
     ORDER BY pricing_date DESC, created_at DESC`,
    params
  );
  return result.rows.map(pricingSourceSnapshotRow);
}

async function createPricingSource(jobberId, userId, input) {
  const pricingDate = pricingNullableDate(input.pricingDate);
  const sourceType = assertAllowedValue("sourceType", input.sourceType, SOURCE_TYPES);
  const status = assertAllowedValue("status", pricingText(input.status, "draft") || "draft", SNAPSHOT_STATUSES);
  if (!pricingDate || !sourceType) {
    const error = new Error("pricingDate and sourceType are required");
    error.statusCode = 400;
    throw error;
  }
  const snapshotId = id("pricing-source");
  const now = new Date().toISOString();
  await query(
    `INSERT INTO pricing_source_snapshots(
      id, jobber_id, pricing_date, source_type, source_label, status, received_at, created_at, created_by, notes
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      snapshotId,
      jobberId,
      pricingDate,
      sourceType,
      pricingText(input.sourceLabel),
      status,
      input.receivedAt ? new Date(input.receivedAt).toISOString() : null,
      now,
      userId,
      pricingText(input.notes)
    ]
  );
  return getPricingSourceDetail(jobberId, snapshotId);
}

async function getPricingSourceDetail(jobberId, snapshotId) {
  const snapshotResult = await query(
    `SELECT
      id,
      jobber_id AS "jobberId",
      pricing_date AS "pricingDate",
      source_type AS "sourceType",
      source_label AS "sourceLabel",
      status,
      received_at AS "receivedAt",
      created_at AS "createdAt",
      created_by AS "createdBy",
      notes
     FROM pricing_source_snapshots
     WHERE id=$1 AND jobber_id=$2
     LIMIT 1`,
    [snapshotId, jobberId]
  );
  if (snapshotResult.rowCount === 0) return null;
  const valuesResult = await query(
    `SELECT
      id,
      snapshot_id AS "snapshotId",
      market_key AS "marketKey",
      terminal_key AS "terminalKey",
      product_key AS "productKey",
      vendor_key AS "vendorKey",
      quote_code AS "quoteCode",
      value,
      unit,
      effective_date AS "effectiveDate",
      metadata_json AS "metadata",
      created_at AS "createdAt"
     FROM pricing_source_values
     WHERE snapshot_id=$1
     ORDER BY market_key ASC, terminal_key ASC, product_key ASC, vendor_key ASC, quote_code ASC, created_at ASC`,
    [snapshotId]
  );
  return {
    ...pricingSourceSnapshotRow(snapshotResult.rows[0]),
    values: valuesResult.rows.map(pricingSourceValueRow)
  };
}

async function listPricingSourceSnapshotsForDate(jobberId, pricingDate) {
  return listPricingSources(jobberId, { pricingDate });
}

async function getLatestPricingSourceSnapshotDate(jobberId, pricingDate) {
  const effectiveDate = pricingNullableDate(pricingDate);
  if (!effectiveDate) return null;
  const result = await query(
    `SELECT MAX(pricing_date) AS "pricingDate"
     FROM pricing_source_snapshots
     WHERE jobber_id=$1 AND pricing_date <= $2`,
    [jobberId, effectiveDate]
  );
  return result.rows[0]?.pricingDate || null;
}

async function listPricingSourceSnapshotsForDateOrLatest(jobberId, pricingDate) {
  const effectiveDate = pricingNullableDate(pricingDate);
  if (!effectiveDate) {
    return {
      requestedPricingDate: null,
      resolvedPricingDate: null,
      usedFallbackDate: false,
      snapshots: []
    };
  }
  const exactSnapshots = await listPricingSourceSnapshotsForDate(jobberId, effectiveDate);
  if (exactSnapshots.length) {
    return {
      requestedPricingDate: effectiveDate,
      resolvedPricingDate: effectiveDate,
      usedFallbackDate: false,
      snapshots: exactSnapshots
    };
  }
  const fallbackDate = await getLatestPricingSourceSnapshotDate(jobberId, effectiveDate);
  if (!fallbackDate) {
    return {
      requestedPricingDate: effectiveDate,
      resolvedPricingDate: null,
      usedFallbackDate: false,
      snapshots: []
    };
  }
  return {
    requestedPricingDate: effectiveDate,
    resolvedPricingDate: fallbackDate,
    usedFallbackDate: fallbackDate !== effectiveDate,
    snapshots: await listPricingSourceSnapshotsForDate(jobberId, fallbackDate)
  };
}

async function createPricingSourceValues(jobberId, snapshotId, values) {
  const snapshot = await query(
    `SELECT id
     FROM pricing_source_snapshots
     WHERE id=$1 AND jobber_id=$2
     LIMIT 1`,
    [snapshotId, jobberId]
  );
  if (snapshot.rowCount === 0) return undefined;
  if (!Array.isArray(values) || values.length === 0) {
    const error = new Error("values array is required");
    error.statusCode = 400;
    throw error;
  }
  const now = new Date().toISOString();
  const insertedIds = [];
  await tx(async (client) => {
    for (const entry of values) {
      const valueId = id("pricing-source-value");
      const metadata = entry?.metadata && typeof entry.metadata === "object" ? entry.metadata : {};
      const marketKey = assertOptionalAllowedValue("marketKey", entry?.marketKey, MARKET_KEYS);
      const terminalKey = assertOptionalAllowedValue("terminalKey", entry?.terminalKey, TERMINAL_KEYS);
      const productKey = assertOptionalAllowedValue("productKey", entry?.productKey, PRODUCT_KEYS);
      const vendorKey = assertOptionalAllowedValue("vendorKey", entry?.vendorKey, VENDOR_KEYS);
      await client.query(
        `INSERT INTO pricing_source_values(
          id, snapshot_id, market_key, terminal_key, product_key, vendor_key, quote_code, value, unit, effective_date, metadata_json, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)`,
        [
          valueId,
          snapshotId,
          marketKey,
          terminalKey,
          productKey,
          vendorKey,
          pricingText(entry?.quoteCode),
          toNumber(entry?.value),
          pricingText(entry?.unit),
          pricingNullableDate(entry?.effectiveDate),
          JSON.stringify(metadata),
          now
        ]
      );
      insertedIds.push(valueId);
    }
  });
  const saved = await query(
    `SELECT
      id,
      snapshot_id AS "snapshotId",
      market_key AS "marketKey",
      terminal_key AS "terminalKey",
      product_key AS "productKey",
      vendor_key AS "vendorKey",
      quote_code AS "quoteCode",
      value,
      unit,
      effective_date AS "effectiveDate",
      metadata_json AS "metadata",
      created_at AS "createdAt"
     FROM pricing_source_values
     WHERE id = ANY($1::text[])
     ORDER BY created_at ASC, id ASC`,
    [insertedIds]
  );
  return saved.rows.map(pricingSourceValueRow);
}

async function listPricingTaxes(jobberId, filters = {}) {
  const params = [jobberId];
  const conditions = [`jobber_id=$1`];
  if (filters.productFamily) {
    params.push(pricingText(filters.productFamily));
    conditions.push(`product_family=$${params.length}`);
  }
  const effectiveDate = pricingNullableDate(filters.effectiveDate);
  if (effectiveDate) {
    params.push(effectiveDate);
    conditions.push(`effective_start <= $${params.length}`);
    params.push(effectiveDate);
    conditions.push(`(effective_end IS NULL OR effective_end >= $${params.length})`);
  }
  const result = await query(
    `SELECT
      id,
      jobber_id AS "jobberId",
      product_family AS "productFamily",
      tax_name AS "taxName",
      value,
      unit,
      effective_start AS "effectiveStart",
      effective_end AS "effectiveEnd",
      created_at AS "createdAt",
      created_by AS "createdBy"
     FROM pricing_tax_schedules
     WHERE ${conditions.join(" AND ")}
     ORDER BY effective_start DESC, product_family ASC, tax_name ASC`,
    params
  );
  return result.rows.map(pricingTaxScheduleRow);
}

async function savePricingTaxes(jobberId, userId, schedules) {
  const list = Array.isArray(schedules) ? schedules : [schedules || {}];
  if (list.length === 0) {
    const error = new Error("At least one tax schedule is required");
    error.statusCode = 400;
    throw error;
  }
  for (const entry of list) {
    const productFamily = assertAllowedValue("productFamily", entry?.productFamily, PRODUCT_FAMILIES);
    const taxName = pricingText(entry?.taxName);
    const effectiveStart = pricingNullableDate(entry?.effectiveStart);
    const value = toNumber(entry?.value);
    if (!productFamily || !taxName || !effectiveStart || value == null) {
      const error = new Error("productFamily, taxName, effectiveStart, and value are required");
      error.statusCode = 400;
      throw error;
    }
  }
  const savedIds = [];
  const now = new Date().toISOString();
  await tx(async (client) => {
    for (const entry of list) {
      const productFamily = assertAllowedValue("productFamily", entry?.productFamily, PRODUCT_FAMILIES);
      const taxName = pricingText(entry?.taxName);
      const effectiveStart = pricingNullableDate(entry?.effectiveStart);
      const value = toNumber(entry?.value);
      const existing = await client.query(
        `SELECT id
         FROM pricing_tax_schedules
         WHERE jobber_id=$1 AND product_family=$2 AND tax_name=$3 AND effective_start=$4
         LIMIT 1`,
        [jobberId, productFamily, taxName, effectiveStart]
      );
      const recordId = existing.rowCount ? existing.rows[0].id : id("pricing-tax");
      if (existing.rowCount) {
        await client.query(
          `UPDATE pricing_tax_schedules
           SET value=$1, unit=$2, effective_end=$3
           WHERE id=$4`,
          [value, pricingText(entry?.unit), pricingNullableDate(entry?.effectiveEnd), recordId]
        );
      } else {
        await client.query(
          `INSERT INTO pricing_tax_schedules(
            id, jobber_id, product_family, tax_name, value, unit, effective_start, effective_end, created_at, created_by
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            recordId,
            jobberId,
            productFamily,
            taxName,
            value,
            pricingText(entry?.unit),
            effectiveStart,
            pricingNullableDate(entry?.effectiveEnd),
            now,
            userId
          ]
        );
      }
      savedIds.push(recordId);
    }
  });
  const saved = await query(
    `SELECT
      id,
      jobber_id AS "jobberId",
      product_family AS "productFamily",
      tax_name AS "taxName",
      value,
      unit,
      effective_start AS "effectiveStart",
      effective_end AS "effectiveEnd",
      created_at AS "createdAt",
      created_by AS "createdBy"
     FROM pricing_tax_schedules
     WHERE id = ANY($1::text[])
     ORDER BY effective_start DESC, product_family ASC, tax_name ASC`,
    [savedIds]
  );
  return saved.rows.map(pricingTaxScheduleRow);
}

async function listPricingSourceValuesForSnapshots(snapshotIds) {
  if (!Array.isArray(snapshotIds) || snapshotIds.length === 0) return [];
  const result = await query(
    `SELECT
      id,
      snapshot_id AS "snapshotId",
      market_key AS "marketKey",
      terminal_key AS "terminalKey",
      product_key AS "productKey",
      vendor_key AS "vendorKey",
      quote_code AS "quoteCode",
      value,
      unit,
      effective_date AS "effectiveDate",
      metadata_json AS "metadata",
      created_at AS "createdAt"
     FROM pricing_source_values
     WHERE snapshot_id = ANY($1::text[])
     ORDER BY snapshot_id ASC, market_key ASC, terminal_key ASC, product_key ASC, vendor_key ASC, quote_code ASC, created_at ASC`,
    [snapshotIds]
  );
  return result.rows.map(pricingSourceValueRow);
}

async function getPricingSourceValuesForDate(jobberId, pricingDate) {
  const snapshots = await listPricingSourceSnapshotsForDate(jobberId, pricingDate);
  if (!snapshots.length) return [];
  return listPricingSourceValuesForSnapshots(snapshots.map((snapshot) => snapshot.id));
}

async function listPricingRules(jobberId, filters = {}) {
  const params = [jobberId];
  const conditions = [`jobber_id=$1`];
  if (filters.productFamily) {
    params.push(pricingText(filters.productFamily));
    conditions.push(`product_family=$${params.length}`);
  }
  if (filters.status) {
    params.push(pricingText(filters.status));
    conditions.push(`status=$${params.length}`);
  }
  const effectiveDate = pricingNullableDate(filters.effectiveDate);
  if (effectiveDate) {
    params.push(effectiveDate);
    conditions.push(`effective_start <= $${params.length}`);
    params.push(effectiveDate);
    conditions.push(`(effective_end IS NULL OR effective_end >= $${params.length})`);
  }
  const result = await query(
    `SELECT
      id,
      jobber_id AS "jobberId",
      name,
      product_family AS "productFamily",
      effective_start AS "effectiveStart",
      effective_end AS "effectiveEnd",
      status,
      version_label AS "versionLabel",
      notes,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
     FROM pricing_rule_sets
     WHERE ${conditions.join(" AND ")}
     ORDER BY product_family ASC, effective_start DESC, updated_at DESC`,
    params
  );
  return result.rows.map(pricingRuleSetRow);
}

async function getPricingRuleOwnedByJobber(jobberId, ruleSetId) {
  const result = await query(
    `SELECT
      id,
      jobber_id AS "jobberId",
      name,
      product_family AS "productFamily",
      effective_start AS "effectiveStart",
      effective_end AS "effectiveEnd",
      status,
      version_label AS "versionLabel",
      notes,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
     FROM pricing_rule_sets
     WHERE id=$1 AND jobber_id=$2
     LIMIT 1`,
    [ruleSetId, jobberId]
  );
  return result.rowCount ? pricingRuleSetRow(result.rows[0]) : null;
}

async function listPricingRuleComponents(ruleSetId) {
  const result = await query(
    `SELECT
      id,
      rule_set_id AS "ruleSetId",
      component_key AS "componentKey",
      label,
      source_kind AS "sourceKind",
      source_ref AS "sourceRef",
      default_value AS "defaultValue",
      multiplier AS "multiplier",
      sort_order AS "sortOrder",
      is_editable AS "isEditable",
      metadata_json AS "metadata"
     FROM pricing_rule_components
     WHERE rule_set_id=$1
     ORDER BY sort_order ASC, component_key ASC`,
    [ruleSetId]
  );
  return result.rows.map(pricingRuleComponentRow);
}

async function listPricingRuleVendorSets(ruleSetId) {
  const result = await query(
    `SELECT
      id,
      rule_set_id AS "ruleSetId",
      selection_mode AS "selectionMode",
      product_family AS "productFamily",
      market_key AS "marketKey",
      vendors_json AS "vendors"
     FROM pricing_rule_vendor_sets
     WHERE rule_set_id=$1
     ORDER BY product_family ASC, market_key ASC, selection_mode ASC`,
    [ruleSetId]
  );
  return result.rows.map(pricingRuleVendorSetRow);
}

async function getPricingRuleDetail(jobberId, ruleSetId) {
  const ruleSet = await getPricingRuleOwnedByJobber(jobberId, ruleSetId);
  if (!ruleSet) return null;
  const [components, vendorSets] = await Promise.all([
    listPricingRuleComponents(ruleSetId),
    listPricingRuleVendorSets(ruleSetId)
  ]);
  return {
    ...ruleSet,
    components,
    vendorSets
  };
}

async function createPricingRule(jobberId, input) {
  const name = pricingText(input.name);
  const productFamily = assertAllowedValue("productFamily", input.productFamily, PRODUCT_FAMILIES);
  const effectiveStart = pricingNullableDate(input.effectiveStart) || new Date().toISOString().slice(0, 10);
  const status = assertAllowedValue("status", pricingText(input.status, "draft") || "draft", RULE_SET_STATUSES);
  if (!name || !productFamily) {
    const error = new Error("name and productFamily are required");
    error.statusCode = 400;
    throw error;
  }
  const ruleSetId = id("pricing-rule");
  const now = new Date().toISOString();
  await query(
    `INSERT INTO pricing_rule_sets(
      id, jobber_id, name, product_family, effective_start, effective_end, status, version_label, notes, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      ruleSetId,
      jobberId,
      name,
      productFamily,
      effectiveStart,
      pricingNullableDate(input.effectiveEnd),
      status,
      pricingText(input.versionLabel),
      pricingText(input.notes),
      now,
      now
    ]
  );
  return getPricingRuleDetail(jobberId, ruleSetId);
}

async function updatePricingRule(jobberId, ruleSetId, input) {
  const current = await getPricingRuleOwnedByJobber(jobberId, ruleSetId);
  if (!current) return null;
  const nextName = input.name == null ? current.name : pricingText(input.name);
  const nextFamily = input.productFamily == null ? current.productFamily : assertAllowedValue("productFamily", input.productFamily, PRODUCT_FAMILIES);
  if (!nextName || !nextFamily) {
    const error = new Error("name and productFamily are required");
    error.statusCode = 400;
    throw error;
  }
  await query(
    `UPDATE pricing_rule_sets
     SET
      name=$1,
      product_family=$2,
      effective_start=$3,
      effective_end=$4,
      status=$5,
      version_label=$6,
      notes=$7,
      updated_at=$8
     WHERE id=$9`,
    [
      nextName,
      nextFamily,
      input.effectiveStart == null ? current.effectiveStart : pricingNullableDate(input.effectiveStart),
      input.effectiveEnd == null ? current.effectiveEnd : pricingNullableDate(input.effectiveEnd),
      input.status == null ? current.status : assertAllowedValue("status", pricingText(input.status, current.status), RULE_SET_STATUSES),
      input.versionLabel == null ? current.versionLabel : pricingText(input.versionLabel),
      input.notes == null ? current.notes : pricingText(input.notes),
      new Date().toISOString(),
      ruleSetId
    ]
  );
  return getPricingRuleDetail(jobberId, ruleSetId);
}

async function savePricingRuleComponents(jobberId, ruleSetId, components) {
  const ruleSet = await getPricingRuleOwnedByJobber(jobberId, ruleSetId);
  if (!ruleSet) return undefined;
  const list = Array.isArray(components) ? components : [];
  for (const entry of list) {
    const sourceKind = pricingText(entry?.sourceKind);
    if (!pricingText(entry?.componentKey) || !pricingText(entry?.label) || !sourceKind) {
      const error = new Error("componentKey, label, and sourceKind are required for every component");
      error.statusCode = 400;
      throw error;
    }
    assertAllowedValue("sourceKind", sourceKind, COMPONENT_SOURCE_KINDS);
  }
  await tx(async (client) => {
    await client.query(`DELETE FROM pricing_rule_components WHERE rule_set_id=$1`, [ruleSetId]);
    let sortOrder = 0;
    for (const entry of list) {
      sortOrder += 1;
      await client.query(
        `INSERT INTO pricing_rule_components(
          id, rule_set_id, component_key, label, source_kind, source_ref, default_value, multiplier, sort_order, is_editable, metadata_json
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
        [
          id("pricing-rule-component"),
          ruleSetId,
          pricingText(entry.componentKey),
          pricingText(entry.label),
          assertAllowedValue("sourceKind", entry.sourceKind, COMPONENT_SOURCE_KINDS),
          pricingText(entry.sourceRef),
          toNumber(entry.defaultValue),
          toNumber(entry.multiplier, 1),
          entry.sortOrder == null ? sortOrder : Number(entry.sortOrder) || sortOrder,
          entry.isEditable == null ? true : !!entry.isEditable,
          JSON.stringify(entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {})
        ]
      );
    }
    await client.query(`UPDATE pricing_rule_sets SET updated_at=$1 WHERE id=$2`, [new Date().toISOString(), ruleSetId]);
  });
  return getPricingRuleDetail(jobberId, ruleSetId);
}

async function savePricingRuleVendorSets(jobberId, ruleSetId, vendorSets) {
  const ruleSet = await getPricingRuleOwnedByJobber(jobberId, ruleSetId);
  if (!ruleSet) return undefined;
  const list = Array.isArray(vendorSets) ? vendorSets : [];
  for (const entry of list) {
    const selectionMode = pricingText(entry?.selectionMode);
    if (!selectionMode) {
      const error = new Error("selectionMode is required for every vendor set");
      error.statusCode = 400;
      throw error;
    }
    assertAllowedValue("selectionMode", selectionMode, VENDOR_SELECTION_MODES);
    assertAllowedValue("productFamily", pricingText(entry?.productFamily, ruleSet.productFamily) || ruleSet.productFamily, PRODUCT_FAMILIES);
    assertOptionalAllowedValue("marketKey", entry?.marketKey, MARKET_KEYS);
    for (const vendor of Array.isArray(entry?.vendors) ? entry.vendors : []) {
      assertAllowedValue("vendorKey", vendor, VENDOR_KEYS);
    }
  }
  await tx(async (client) => {
    await client.query(`DELETE FROM pricing_rule_vendor_sets WHERE rule_set_id=$1`, [ruleSetId]);
    for (const entry of list) {
      await client.query(
        `INSERT INTO pricing_rule_vendor_sets(
          id, rule_set_id, selection_mode, product_family, market_key, vendors_json
        ) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [
          id("pricing-rule-vendor-set"),
          ruleSetId,
          assertAllowedValue("selectionMode", entry.selectionMode, VENDOR_SELECTION_MODES),
          assertAllowedValue("productFamily", pricingText(entry.productFamily, ruleSet.productFamily) || ruleSet.productFamily, PRODUCT_FAMILIES),
          assertOptionalAllowedValue("marketKey", entry.marketKey, MARKET_KEYS),
          JSON.stringify((Array.isArray(entry.vendors) ? entry.vendors : []).map((vendor) => assertAllowedValue("vendorKey", vendor, VENDOR_KEYS)))
        ]
      );
    }
    await client.query(`UPDATE pricing_rule_sets SET updated_at=$1 WHERE id=$2`, [new Date().toISOString(), ruleSetId]);
  });
  return getPricingRuleDetail(jobberId, ruleSetId);
}

async function getActivePricingRuleForFamily(jobberId, productFamily, pricingDate) {
  const effectiveDate = pricingNullableDate(pricingDate);
  if (!effectiveDate || !productFamily) return null;
  const result = await query(
    `SELECT
      id,
      jobber_id AS "jobberId",
      name,
      product_family AS "productFamily",
      effective_start AS "effectiveStart",
      effective_end AS "effectiveEnd",
      status,
      version_label AS "versionLabel",
      notes,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
     FROM pricing_rule_sets
     WHERE jobber_id=$1
       AND product_family=$2
       AND status='active'
       AND effective_start <= $3
       AND (effective_end IS NULL OR effective_end >= $3)
     ORDER BY effective_start DESC, updated_at DESC
     LIMIT 1`,
    [jobberId, productFamily, effectiveDate]
  );
  if (result.rowCount === 0) return null;
  return getPricingRuleDetail(jobberId, result.rows[0].id);
}

async function saveGeneratedCustomerPrice(jobberId, userId, input) {
  const customerId = pricingText(input.customerId);
  const pricingDate = pricingNullableDate(input.pricingDate);
  if (!customerId || !pricingDate) {
    const error = new Error("customerId and pricingDate are required");
    error.statusCode = 400;
    throw error;
  }

  const customer = await getCustomerOwnedByJobber(jobberId, customerId);
  if (!customer) return undefined;

  const outputByFamily = new Map(
    (Array.isArray(input.outputs) ? input.outputs : []).map((item) => [pricingText(item.productFamily), item])
  );
  const detail = input.detail && typeof input.detail === "object" ? input.detail : {};
  const sourceSnapshotGroup = input.sourceSnapshotGroup && typeof input.sourceSnapshotGroup === "object"
    ? input.sourceSnapshotGroup
    : {};
  const now = new Date().toISOString();
  const recordId = id("generated-price");

  const status = assertAllowedValue("status", pricingText(input.status, "generated") || "generated", GENERATED_PRICE_STATUSES);
  await tx(async (client) => {
    await client.query(
      `INSERT INTO generated_customer_prices(
        id, jobber_id, customer_id, pricing_date, rule_set_id, source_snapshot_group_json,
        regular_base, mid_base, premium_base, diesel_base,
        regular_total, mid_total, premium_total, diesel_total,
        detail_json, status, created_at, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18)`,
      [
        recordId,
        jobberId,
        customerId,
        pricingDate,
        pricingText(input.ruleSetId) || null,
        JSON.stringify(sourceSnapshotGroup),
        toNumber(outputByFamily.get("regular")?.basePrice),
        toNumber(outputByFamily.get("mid")?.basePrice),
        toNumber(outputByFamily.get("premium")?.basePrice),
        toNumber(outputByFamily.get("diesel")?.basePrice),
        toNumber(outputByFamily.get("regular")?.totalPrice),
        toNumber(outputByFamily.get("mid")?.totalPrice),
        toNumber(outputByFamily.get("premium")?.totalPrice),
        toNumber(outputByFamily.get("diesel")?.totalPrice),
        JSON.stringify(detail),
        status,
        now,
        userId
      ]
    );
  });

  return getGeneratedCustomerPriceDetail(jobberId, recordId);
}

async function listGeneratedCustomerPrices(jobberId, filters = {}) {
  const params = [jobberId];
  const conditions = [`g.jobber_id=$1`];

  const pricingDate = pricingNullableDate(filters.pricingDate);
  if (pricingDate) {
    params.push(pricingDate);
    conditions.push(`g.pricing_date=$${params.length}`);
  }

  const customerId = pricingText(filters.customerId);
  if (customerId) {
    params.push(customerId);
    conditions.push(`g.customer_id=$${params.length}`);
  }

  const status = pricingText(filters.status);
  if (status) {
    params.push(status);
    conditions.push(`g.status=$${params.length}`);
  }

  const limit = Math.min(200, Math.max(1, Number(filters.limit) || 100));
  const result = await query(
    `SELECT
      g.id,
      g.jobber_id AS "jobberId",
      g.customer_id AS "customerId",
      c.name AS "customerName",
      g.pricing_date AS "pricingDate",
      g.rule_set_id AS "ruleSetId",
      r.name AS "ruleSetName",
      g.source_snapshot_group_json AS "sourceSnapshotGroup",
      g.regular_base AS "regularBase",
      g.mid_base AS "midBase",
      g.premium_base AS "premiumBase",
      g.diesel_base AS "dieselBase",
      g.regular_total AS "regularTotal",
      g.mid_total AS "midTotal",
      g.premium_total AS "premiumTotal",
      g.diesel_total AS "dieselTotal",
      g.detail_json AS detail,
      g.status,
      g.created_at AS "createdAt",
      g.created_by AS "createdBy"
     FROM generated_customer_prices g
     JOIN customers c ON c.id = g.customer_id
     LEFT JOIN pricing_rule_sets r ON r.id = g.rule_set_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY g.pricing_date DESC, g.created_at DESC, c.name ASC
     LIMIT ${limit}`,
    params
  );
  return result.rows.map(generatedCustomerPriceRow);
}

async function getGeneratedCustomerPriceDetail(jobberId, generatedPriceId) {
  const result = await query(
    `SELECT
      g.id,
      g.jobber_id AS "jobberId",
      g.customer_id AS "customerId",
      c.name AS "customerName",
      g.pricing_date AS "pricingDate",
      g.rule_set_id AS "ruleSetId",
      r.name AS "ruleSetName",
      g.source_snapshot_group_json AS "sourceSnapshotGroup",
      g.regular_base AS "regularBase",
      g.mid_base AS "midBase",
      g.premium_base AS "premiumBase",
      g.diesel_base AS "dieselBase",
      g.regular_total AS "regularTotal",
      g.mid_total AS "midTotal",
      g.premium_total AS "premiumTotal",
      g.diesel_total AS "dieselTotal",
      g.detail_json AS detail,
      g.status,
      g.created_at AS "createdAt",
      g.created_by AS "createdBy"
     FROM generated_customer_prices g
     JOIN customers c ON c.id = g.customer_id
     LEFT JOIN pricing_rule_sets r ON r.id = g.rule_set_id
     WHERE g.id=$1 AND g.jobber_id=$2
     LIMIT 1`,
    [generatedPriceId, jobberId]
  );
  return result.rowCount ? generatedCustomerPriceRow(result.rows[0]) : null;
}

module.exports = {
  createCustomer,
  createCustomerContact,
  createPricingSource,
  createPricingSourceValues,
  createPricingRule,
  deleteCustomerContact,
  getCustomerDetail,
  getCustomerPricingProfileForDate,
  getLatestCustomerPricingProfile,
  getActivePricingRuleForFamily,
  getPricingSourceDetail,
  getPricingSourceValuesForDate,
  getPricingRuleDetail,
  getCustomerOwnedByJobber,
  getGeneratedCustomerPriceDetail,
  listCustomerContacts,
  listCustomers,
  listGeneratedCustomerPrices,
  listPricingSourceSnapshotsForDateOrLatest,
  listPricingSourceSnapshotsForDate,
  listPricingSourceValuesForSnapshots,
  listPricingSources,
  listPricingTaxes,
  listPricingRules,
  pricingNullableDate,
  saveGeneratedCustomerPrice,
  saveCustomerPricingProfile,
  savePricingRuleComponents,
  savePricingRuleVendorSets,
  savePricingTaxes,
  updateCustomerContact,
  updatePricingRule,
  updateCustomer
};
