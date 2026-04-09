const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const packageMeta = require("../package.json");
const { authMiddleware, encodeToken } = require("./auth");
const { requireAuth, requireSiteAccess, requireRole } = require("./rbac");
const { registerClient, sendEvent, broadcast } = require("./events");
const { query, tx, initDb, hasDbConfig } = require("./db");
const { seedIfEmpty } = require("./seed");
const { encryptJson, decryptJson } = require("./secrets");
const {
  createCustomer,
  createCustomerContact,
  createPricingSource,
  createPricingSourceValues,
  createPricingRule,
  deleteCustomer,
  deleteCustomerContact,
  deletePricingRule,
  getCustomerDetail,
  getGeneratedCustomerPriceDetail,
  getLatestCustomerPricingProfile,
  getPricingSourceDetail,
  getPricingRuleDetail,
  listCustomers,
  listGeneratedCustomerPrices,
  listPricingRules,
  listPricingSources,
  listPricingTaxes,
  saveCustomerPricingProfile,
  savePricingRuleComponents,
  savePricingRuleVendorSets,
  updatePricingRule,
  savePricingTaxes,
  updateCustomerContact,
  updateCustomer
} = require("./pricing/repositories");
const { generateCustomerPricingRun, previewCustomerPricing } = require("./pricing/engine");

const app = express();
const port = Number(process.env.PORT || 4000);
const webBaseUrl = process.env.WEB_BASE_URL || "http://localhost:5173";

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(authMiddleware);

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

const alliedMetricStatusSet = new Set(["Complete", "Approved"]);
const alliedAbortStatusSet = new Set(["CustomerAbort"]);

function toNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeDateParam(value, fallback) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function alliedDefaultDateRange() {
  const end = new Date();
  const start = new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
  return {
    start: start.toISOString(),
    end: end.toISOString()
  };
}

function alliedTextCsv(value) {
  const normalized = value == null ? "" : String(value);
  return /[",\n]/.test(normalized) ? `"${normalized.replace(/"/g, "\"\"")}"` : normalized;
}

function alliedMaskedPan(first8, last4) {
  const head = String(first8 || "").trim();
  const tail = String(last4 || "").trim();
  if (!head && !tail) return "-";
  return `${head || "--------"}******${tail || "----"}`;
}

function alliedQuickPresetRange(preset) {
  const end = new Date();
  if (preset === "today") {
    const start = new Date(end);
    start.setHours(0, 0, 0, 0);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  if (preset === "7d") {
    return { start: new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString(), end: end.toISOString() };
  }
  if (preset === "30d") {
    return { start: new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString(), end: end.toISOString() };
  }
  return null;
}

function alliedNormalizeSort(sortBy, sortDir) {
  const allowed = new Set([
    "timestamp",
    "transaction_id",
    "fuel_position_id",
    "payment_type",
    "card_name",
    "card_type",
    "entry_method",
    "emv_tran_type",
    "emv_status",
    "emv_error_code",
    "tag_denial_reason",
    "fuel_quantity_gallons",
    "actual_sales_price",
    "total_amount",
    "auth_amount"
  ]);
  const key = allowed.has(sortBy) ? sortBy : "timestamp";
  const direction = String(sortDir || "").toLowerCase() === "asc" ? "ASC" : "DESC";
  return { key, direction };
}

function alliedLikelyTransactionType(row) {
  if (row.paymentType === "Preset") return "Preset Cash";
  if (row.entryMethod === "EmvContactless") return "Contactless Fuel";
  if (row.emvTranType === "PreAuth") return "Pre-Authorization";
  if (row.emvStatus === "CustomerAbort") return "Customer Abort";
  if (row.fallbackToMsr) return "Fallback Swipe";
  return "Card Fuel Sale";
}

function alliedDerivedChecks(row) {
  const total = toNumber(row.totalAmount, 0) || 0;
  const gallons = toNumber(row.fuelQuantityGallons, 0) || 0;
  const auth = toNumber(row.authAmount, 0);
  const authSaleDifference = auth == null ? null : Number((auth - total).toFixed(2));
  const checks = [];

  if (alliedMetricStatusSet.has(row.emvStatus) && total <= 0) checks.push("Complete transaction has non-positive total amount.");
  if (alliedMetricStatusSet.has(row.emvStatus) && gallons <= 0) checks.push("Complete fuel sale has non-positive gallons.");
  if (alliedAbortStatusSet.has(row.emvStatus) && (total > 0 || gallons > 0)) checks.push("Customer abort has positive dollars or gallons.");
  if (auth != null && auth < total) checks.push("Authorized amount is below captured sale amount.");
  if (alliedMetricStatusSet.has(row.emvStatus) && !row.fuelPositionId) checks.push("Completed fuel sale is missing fuel position.");
  if (row.first8 && !/^\d{8}$/.test(row.first8)) checks.push("PAN first8 is malformed.");
  if (row.last4 && !/^\d{4}$/.test(row.last4)) checks.push("PAN last4 is malformed.");
  if (row.expDate && !/^\d{2}\/\d{2}$/.test(row.expDate)) checks.push("Expiry format is malformed.");
  if (row.paymentType === "Preset" && row.cardName && row.cardName !== "Cash") checks.push("Preset cash transaction carries a non-cash card label.");

  return {
    authSaleDifference,
    internallyConsistent: checks.length === 0,
    checks
  };
}

function alliedBuildIssue(title, severity, reason, rows, extra = {}) {
  const relatedPumps = [...new Set(rows.map((row) => row.fuelPositionId).filter(Boolean))].slice(0, 5);
  const timestamps = rows.map((row) => new Date(row.timestamp).getTime()).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    id: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${severity}`,
    title,
    severity,
    reason,
    relatedPumps,
    relatedTimePeriod: timestamps.length ? {
      start: new Date(timestamps[0]).toISOString(),
      end: new Date(timestamps[timestamps.length - 1]).toISOString()
    } : null,
    count: rows.length,
    rateImpact: extra.rateImpact ?? null,
    filters: extra.filters || {},
    examples: rows.slice(0, 6).map((row) => ({
      transactionId: row.transactionId,
      timestamp: row.timestamp,
      fuelPositionId: row.fuelPositionId,
      emvStatus: row.emvStatus,
      emvErrorCode: row.emvErrorCode,
      tagDenialReason: row.tagDenialReason
    }))
  };
}

const EIA_API_BASE_URL = "https://api.eia.gov/v2/seriesid";
const EIA_SERIES_IDS = {
  wti: "PET.RWTC.D",
  brent: "PET.RBRTE.D",
  gasoline: "PET.EMM_EPM0_PTE_NUS_DPG.W",
  crudeStocks: "PET.WCESTUS1.W",
  gasolineStocks: "PET.WGTSTUS1.W",
  distillateStocks: "PET.WDISTUS1.W"
};

const EIA_RETAIL_REGIONS = [
  { key: "NUS", label: "U.S." },
  { key: "R10", label: "East Coast" },
  { key: "R20", label: "Midwest" },
  { key: "R30", label: "Gulf Coast" },
  { key: "R40", label: "Rocky Mountain" },
  { key: "R50", label: "West Coast" }
];

const OPIS_API_BASE_URL = process.env.OPIS_API_BASE_URL || "https://rackapi.opisnet.com/api/v1";
const OPIS_SPOT_API_BASE_URL = process.env.OPIS_SPOT_API_BASE_URL || "https://spotapi.opisnet.com/v1/api";
const OPIS_RACK_TIMING_PREFERENCE = (process.env.OPIS_RACK_TIMING_PREFERENCE || "10,11,12,13")
  .split(",")
  .map((value) => String(value || "").trim())
  .filter(Boolean);
const OPIS_RACK_TIMING_LABELS = {
  "10": "0645 ET",
  "11": "0730 ET",
  "12": "0900 ET",
  "13": "1100 ET"
};
const OPIS_TIMING_OPTIONS = [
  { value: "0", label: "Live" },
  { value: "1", label: "Closing" },
  { value: "2", label: "Contract" },
  { value: "3", label: "Calendar" }
];
const OPIS_FUEL_TYPE_OPTIONS = [
  { value: "all", label: "All Fuels" },
  { value: "gasoline", label: "Gasoline", opisValue: "1" },
  { value: "diesel", label: "Diesel", opisValue: "2" },
  { value: "biodiesel", label: "Biodiesel", opisValue: "5" }
];
const OPIS_METADATA_CACHE_TTL_MS = 30 * 60 * 1000;
const OPIS_RACK_SOURCE_LABEL = "OPIS Rack API First After 6AM ET";
const OPIS_SPOT_SOURCE_LABEL = "OPIS Spot API Latest Published Prompt Average";
const OPIS_RACK_VENDOR_KEYS = ["valero", "chevron", "shell", "psx", "tesoro", "marathon", "bp"];
const OPIS_RACK_PRODUCT_KEYS = ["reg_87_carb", "premium_91_carb", "diesel_carb_ulsd"];
const OPIS_SPOT_PRODUCT_CODES = {
  reg_87_carb: {
    productCode: "O1007NR",
    productName: "OPIS San Francisco CARB RFG Regular Gasoline Prompt Average",
    intradayProductCode: "O1007NR"
  },
  premium_91_carb: {
    productCode: "O1007NW",
    productName: "OPIS San Francisco CARB RFG Premium Gasoline Prompt Average",
    intradayProductCode: "O1007NW"
  },
  diesel_carb_ulsd: {
    productCode: "O1007G4",
    productName: "OPIS San Francisco CARB Diesel Prompt Average",
    intradayProductCode: "O1007G4"
  }
};
const OPIS_RACK_MARKETS = [
  { marketKey: "benicia", terminalKey: "benicia_terminal", aliases: ["BENICIA", "SAN FRANCISCO", "SANFRANCISCO"], rackCity: "San Francisco", spotMarket: "San Francisco" },
  { marketKey: "stockton", terminalKey: "stockton_terminal", aliases: ["STOCKTON"], rackCity: "Stockton", spotMarket: "San Francisco" },
  { marketKey: "sacramento", terminalKey: "sacramento_terminal", aliases: ["SACRAMENTO"], rackCity: "Sacramento", spotMarket: "San Francisco" },
  { marketKey: "san_jose", terminalKey: "san_jose_terminal", aliases: ["SAN JOSE", "SANJOSE"], rackCity: "San Jose", spotMarket: "San Francisco" }
];
let opisMetadataCache = {
  expiresAt: 0,
  value: null
};

function localCalendarDate(date = new Date(), timeZone = process.env.APP_TIME_ZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York") {
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
    return date.trim();
  }
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

function formatIsoDate(date) {
  return localCalendarDate(date);
}

function normalizeEiaApiKey(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return "";
  const candidates = raw.match(/[A-Za-z0-9]{24,}/g) || [];
  if (!candidates.length) return raw;
  return candidates[candidates.length - 1];
}

async function eiaApiKey(user) {
  const envApiKey = normalizeEiaApiKey(process.env.EIA_API_KEY || "");
  if (!user?.jobberId) {
    return envApiKey;
  }

  const result = await query(
    `SELECT encrypted_json AS "encryptedJson"
     FROM jobber_secrets
     WHERE jobber_id=$1 AND provider='eia'
     LIMIT 1`,
    [user.jobberId]
  );
  if (result.rowCount > 0) {
    try {
      const decrypted = decryptJson(result.rows[0].encryptedJson || {});
      const storedApiKey = normalizeEiaApiKey(decrypted.apiKey || "");
      if (storedApiKey) {
        return storedApiKey;
      }
    } catch (error) {
      if (envApiKey) {
        return envApiKey;
      }
      throw new Error("Saved EIA credentials could not be decrypted with the current app secret. Re-save the EIA key in Admin.");
    }
  }
  return envApiKey;
}

async function hasEiaApiKey(user) {
  return Boolean(await eiaApiKey(user));
}

function normalizeEiaPeriod(value) {
  const raw = String(value || "").trim();
  if (!raw) return raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  if (/^\d{4}$/.test(raw)) return `${raw}-01-01`;
  return raw.slice(0, 10);
}

async function fetchEiaSeries(seriesId, length = 400, user = null) {
  const apiKey = await eiaApiKey(user);
  if (!apiKey) {
    throw new Error("EIA_API_KEY is missing.");
  }

  const url = new URL(`${EIA_API_BASE_URL}/${encodeURIComponent(seriesId)}`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("out", "json");
  url.searchParams.set("length", String(length));
  url.searchParams.set("sort[0][column]", "period");
  url.searchParams.set("sort[0][direction]", "desc");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "PetroleumDashboard/1.0",
      accept: "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`EIA request failed (${response.status}) for ${url.toString()}`);
  }
  const payload = await response.json();
  const rows = payload?.response?.data || payload?.data || [];
  return rows
    .map((row) => {
      const numericValue = Number(String(row.value ?? row.price ?? row.quantity ?? "").replace(/,/g, ""));
      if (!Number.isFinite(numericValue)) return null;
      return {
        date: normalizeEiaPeriod(row.period),
        value: numericValue
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function latestPoints(points, limit) {
  return [...points]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-limit);
}

function benchmarkFromSeries({ key, label, unit, points }) {
  const sorted = latestPoints(points, 400);
  const current = sorted[sorted.length - 1];
  const prior = sorted[sorted.length - 2] || current;
  const priorWeek = sorted[Math.max(0, sorted.length - 6)] || prior;
  return {
    key,
    label,
    unit,
    current: current.value,
    dayAgo: prior.value,
    weekAgo: priorWeek.value,
    sparkline: latestPoints(points, 7).map((point) => point.value),
    historyAnchors: sorted.map((point) => ({ date: point.date, value: point.value }))
  };
}

function inventorySeriesFromPoints({ key, label, points }) {
  return {
    key,
    label,
    unit: "MMbbl",
    points: latestPoints(points, 60).map((point) => ({
      date: point.date,
      value: Number((point.value / 1000).toFixed(1))
    })),
    annotations: []
  };
}

function retailSeriesId(code, regionKey) {
  return `PET.${code}_${regionKey}_DPG.W`;
}

async function regionalRetailSnapshot({ key, label, code, user = null }) {
  const regionSeries = await Promise.all(
    EIA_RETAIL_REGIONS.map(async (region) => {
      const points = await fetchEiaSeries(retailSeriesId(code, region.key), 400, user);
      const snapshot = benchmarkFromSeries({
        key,
        label,
        unit: "USD/gal",
        points
      });
      return [region.key, {
        label: region.label,
        current: snapshot.current,
        dayAgo: snapshot.dayAgo,
        weekAgo: snapshot.weekAgo,
        sparkline: snapshot.sparkline,
        historyAnchors: latestPoints(points, 7).map((point) => ({ date: point.date, value: point.value }))
      }];
    })
  );

  const national = regionSeries.find(([regionKey]) => regionKey === "NUS");
  const nationalPoints = national?.[1]?.historyAnchors || [];
  return {
    ...(national ? {
      key,
      label,
      unit: "USD/gal",
      current: national[1].current,
      dayAgo: national[1].dayAgo,
      weekAgo: national[1].weekAgo,
      sparkline: national[1].sparkline,
      historyAnchors: nationalPoints
    } : {}),
    regionalSeries: Object.fromEntries(regionSeries),
    defaultRegion: "NUS"
  };
}

async function livePricingSnapshot(user = null) {
  const [
    wtiPoints,
    brentPoints,
    gasolinePoints,
    regularRetail,
    midgradeRetail,
    premiumRetail,
    dieselRetail,
    crudeStockPoints,
    gasolineStockPoints,
    distillateStockPoints
  ] = await Promise.all([
    fetchEiaSeries(EIA_SERIES_IDS.wti, 400, user),
    fetchEiaSeries(EIA_SERIES_IDS.brent, 400, user),
    fetchEiaSeries(EIA_SERIES_IDS.gasoline, 400, user),
    regionalRetailSnapshot({ key: "regular", label: "Regular Gasoline", code: "EMM_EPMR_PTE", user }),
    regionalRetailSnapshot({ key: "midgrade", label: "Midgrade Gasoline", code: "EMM_EPMM_PTE", user }),
    regionalRetailSnapshot({ key: "premium", label: "Premium Gasoline", code: "EMM_EPMP_PTE", user }),
    regionalRetailSnapshot({ key: "diesel", label: "Diesel", code: "EMD_EPD2D_PTE", user }),
    fetchEiaSeries(EIA_SERIES_IDS.crudeStocks, 120, user),
    fetchEiaSeries(EIA_SERIES_IDS.gasolineStocks, 120, user),
    fetchEiaSeries(EIA_SERIES_IDS.distillateStocks, 120, user)
  ]);

  return {
    lastUpdated: new Date().toISOString(),
    benchmarkSnapshots: [
        benchmarkFromSeries({ key: "wti", label: "WTI Crude", unit: "USD/bbl", points: wtiPoints }),
        benchmarkFromSeries({ key: "brent", label: "Brent Crude", unit: "USD/bbl", points: brentPoints }),
        benchmarkFromSeries({ key: "gasoline", label: "RBOB Gasoline", unit: "USD/gal", points: gasolinePoints }),
        regularRetail,
        midgradeRetail,
        premiumRetail,
        dieselRetail
      ],
    inventorySeries: [
      inventorySeriesFromPoints({ key: "crude", label: "Crude Stocks", points: crudeStockPoints }),
      inventorySeriesFromPoints({ key: "gasoline", label: "Gasoline Stocks", points: gasolineStockPoints }),
      inventorySeriesFromPoints({ key: "distillate", label: "Distillate Stocks", points: distillateStockPoints })
    ]
  };
}

async function opisCredentials(user) {
  const envCredentials = {
    username: process.env.OPIS_USERNAME || "",
    password: process.env.OPIS_PASSWORD || ""
  };
  if (!user?.jobberId) {
    return envCredentials;
  }

  const result = await query(
    `SELECT encrypted_json AS "encryptedJson"
     FROM jobber_secrets
     WHERE jobber_id=$1 AND provider='opis'
     LIMIT 1`,
    [user.jobberId]
  );
  if (result.rowCount > 0) {
    try {
      const decrypted = decryptJson(result.rows[0].encryptedJson || {});
      const username = String(decrypted.username || "");
      const password = String(decrypted.password || "");
      if (username && password) {
        return { username, password };
      }
    } catch (error) {
      if (envCredentials.username && envCredentials.password) {
        return envCredentials;
      }
      throw new Error("Saved OPIS credentials could not be decrypted with the current app secret. Re-save the OPIS credentials in Admin.");
    }
  }
  return envCredentials;
}

async function hasOpisCredentials(user) {
  const credentials = await opisCredentials(user);
  return Boolean(credentials.username && credentials.password);
}

async function opisAuthenticate(user) {
  const credentials = await opisCredentials(user);
  if (!credentials.username || !credentials.password) {
    throw new Error("OPIS credentials are missing. Set OPIS_USERNAME and OPIS_PASSWORD.");
  }

  const response = await fetch(`${OPIS_API_BASE_URL}/Authenticate`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(credentials)
  });

  if (!response.ok) {
    throw new Error(`OPIS auth failed with status ${response.status}`);
  }

  const payload = await response.json();
  const statusCode = Number(payload?.StatusCode ?? payload?.statusCode ?? 0);
  const token = payload?.Data ?? payload?.data ?? "";
  const errorMessage = payload?.ErrorMessage ?? payload?.errorMessage;
  if (statusCode !== 200 || !token) {
    throw new Error(errorMessage || "OPIS auth did not return a bearer token");
  }
  return token;
}

async function opisSpotAuthenticate(user) {
  const credentials = await opisCredentials(user);
  if (!credentials.username || !credentials.password) {
    throw new Error("OPIS credentials are missing. Set OPIS_USERNAME and OPIS_PASSWORD.");
  }

  const response = await fetch(`${OPIS_SPOT_API_BASE_URL}/Account/authenticate`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      userName: credentials.username,
      password: credentials.password
    })
  });

  if (!response.ok) {
    throw new Error(`OPIS spot auth failed with status ${response.status}`);
  }

  const payload = await response.json();
  const token = typeof payload === "string" ? payload : payload?.accessToken || payload?.token || "";
  if (!token) {
    throw new Error("OPIS spot auth did not return a bearer token");
  }
  return token;
}

async function opisRequestRaw(path, token, queryParams = {}) {
  const url = new URL(`${OPIS_API_BASE_URL}/${path}`);
  for (const [key, value] of Object.entries(queryParams)) {
    if (value == null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      Authorization: token
    }
  });

  if (!response.ok) {
    throw new Error(`OPIS request failed (${response.status}) for ${path}`);
  }

  return response.json();
}

async function opisSpotRequest(path, token, queryParams = {}) {
  const url = new URL(`${OPIS_SPOT_API_BASE_URL}/${path}`);
  for (const [key, value] of Object.entries(queryParams)) {
    if (value == null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      Authorization: `bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`OPIS spot request failed (${response.status}) for ${path}`);
  }

  return response.json();
}

async function opisRequest(path, token, queryParams = {}) {
  const payload = await opisRequestRaw(path, token, queryParams);
  const statusCode = Number(payload?.StatusCode ?? payload?.statusCode ?? 0);
  const errorMessage = payload?.ErrorMessage ?? payload?.errorMessage;
  if (statusCode !== 200) {
    throw new Error(errorMessage || `OPIS request failed for ${path}`);
  }
  return payload;
}

function averageOpisPrice(rows, fuelType) {
  const filtered = rows.filter((row) => !fuelType || String(row.FuelType).toLowerCase() === fuelType.toLowerCase());
  if (!filtered.length) return null;
  return Number((filtered.reduce((sum, row) => sum + Number(row.Price || 0), 0) / filtered.length).toFixed(2));
}

function normalizeOpisText(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ");
}

function opisSupplierPriceRows(payload) {
  return payload?.data?.supplierPrices
    || payload?.data?.SupplierPrices
    || payload?.Data?.supplierPrices
    || payload?.Data?.SupplierPrices
    || [];
}

function opisRackTimestamp(row) {
  const moveDate = row?.moveDate || row?.MoveDate;
  const effectiveDate = row?.effectiveDate || row?.EffectiveDate;
  const moveMs = moveDate ? Date.parse(moveDate) : Number.NaN;
  if (Number.isFinite(moveMs)) return moveMs;
  const effectiveMs = effectiveDate ? Date.parse(effectiveDate) : Number.NaN;
  return Number.isFinite(effectiveMs) ? effectiveMs : 0;
}

function mapOpisRackMarket(row) {
  const cityName = normalizeOpisText(row?.cityName || row?.CityName);
  return OPIS_RACK_MARKETS.find((market) => market.aliases.some((alias) => cityName.includes(alias))) || null;
}

function mapOpisRackVendor(row) {
  const supplierName = normalizeOpisText(row?.supplierName || row?.SupplierName);
  if (!supplierName) return null;
  if (supplierName.includes("VALERO")) return "valero";
  if (supplierName.includes("CHEVRON")) return "chevron";
  if (supplierName.includes("SHELL")) return "shell";
  if (supplierName.includes("PHILLIPS") || supplierName.includes("PHILLIP") || supplierName.includes("P66") || supplierName === "76") return "psx";
  if (supplierName.includes("TESORO") || supplierName.includes("ARCO")) return "tesoro";
  if (supplierName.includes("MARATHON")) return "marathon";
  if (supplierName.includes("BP")) return "bp";
  return null;
}

function mapOpisRackProduct(row) {
  const fuelType = normalizeOpisText(row?.fuelType || row?.FuelType);
  const productName = normalizeOpisText(row?.productName || row?.ProductName);
  const actualProduct = normalizeOpisText(row?.actualProduct || row?.ActualProduct);
  const octane = toNumber(row?.octane || row?.Octane);

  if (fuelType.includes("DIESEL") || fuelType.includes("DISTILLATE")) {
    return "diesel_carb_ulsd";
  }
  if (!fuelType.includes("GASOLINE")) {
    return null;
  }
  if (Number.isFinite(octane) && octane >= 90) {
    return "premium_91_carb";
  }
  if (Number.isFinite(octane) && octane >= 86 && octane < 90) {
    return "reg_87_carb";
  }
  if (productName.includes("PREM") || actualProduct.includes("PREM")) {
    return "premium_91_carb";
  }
  if (productName.includes("REG") || actualProduct.includes("REG") || productName.includes("UNL")) {
    return "reg_87_carb";
  }
  return null;
}

function buildOpisRackSourceValues(rows, pricingDate) {
  const grouped = new Map();
  for (const row of rows) {
    const market = mapOpisRackMarket(row);
    const vendorKey = mapOpisRackVendor(row);
    const productKey = mapOpisRackProduct(row);
    const rawPrice = toNumber(row?.price || row?.Price);
    if (!market || !vendorKey || !productKey || !Number.isFinite(rawPrice)) continue;

    const value = Number((rawPrice / 100).toFixed(4));
    const key = `${market.marketKey}|${productKey}|${vendorKey}`;
    const current = grouped.get(key);
    const next = {
      marketKey: market.marketKey,
      terminalKey: market.terminalKey,
      productKey,
      vendorKey,
      quoteCode: "OPIS_RACK_API",
      value,
      unit: "usd_gal",
      effectiveDate: pricingDate,
      metadata: {
        source: "opis_rack_api",
        supplierName: row?.supplierName || row?.SupplierName || "",
        cityName: row?.cityName || row?.CityName || "",
        productName: row?.productName || row?.ProductName || "",
        actualProduct: row?.actualProduct || row?.ActualProduct || "",
        octane: toNumber(row?.octane || row?.Octane),
        opisPrice: rawPrice,
        opisCurrencyUnit: row?.currencyUnit || row?.CurrencyUnit || "",
        effectiveDate: row?.effectiveDate || row?.EffectiveDate || null,
        moveDate: row?.moveDate || row?.MoveDate || null
      }
    };
    if (!current) {
      grouped.set(key, next);
      continue;
    }
    const currentTimestamp = opisRackTimestamp(current.metadata || {});
    const nextTimestamp = opisRackTimestamp(next.metadata || {});
    if (nextTimestamp > currentTimestamp || (nextTimestamp === currentTimestamp && next.value < current.value)) {
      grouped.set(key, next);
    }
  }
  return [...grouped.values()];
}

function opisSummaryRows(payload) {
  return payload?.data?.summaries
    || payload?.data?.Summaries
    || payload?.Data?.summaries
    || payload?.Data?.Summaries
    || [];
}

function buildOpisRackAverageValues(rows, pricingDate) {
  const values = [];
  for (const row of rows) {
    const market = mapOpisRackMarket(row);
    const productKey = mapOpisRackProduct(row);
    const rawPrice = toNumber(row?.price || row?.Price);
    if (!market || !productKey || !Number.isFinite(rawPrice)) continue;
    values.push({
      marketKey: market.marketKey,
      terminalKey: market.terminalKey,
      productKey,
      vendorKey: "",
      quoteCode: "OPIS_RACK_API_AVG",
      value: Number((rawPrice / 100).toFixed(4)),
      unit: "usd_gal",
      effectiveDate: pricingDate,
      metadata: {
        source: "opis_rack_api_summary",
        cityName: row?.cityName || row?.CityName || "",
        productName: row?.productName || row?.ProductName || "",
        actualProduct: row?.actualProduct || row?.ActualProduct || "",
        effectiveDate: row?.effectiveDate || row?.EffectiveDate || null,
        benchmarkTypeName: row?.benchmarkTypeName || row?.BenchmarkTypeName || "",
        benchmarkTimingType: row?.benchmarkTimingType || row?.BenchmarkTimingType || "",
        selectedTimingLabel: row?.benchmarkTimingType || row?.BenchmarkTimingType || ""
      }
    });
  }
  const deduped = new Map();
  for (const value of values) {
    const key = `${value.marketKey}|${value.productKey}`;
    if (!deduped.has(key)) deduped.set(key, value);
  }
  return [...deduped.values()];
}

function upsertEarliestRackValues(target, values) {
  for (const value of values) {
    const key = `${value.marketKey}|${value.productKey}|${value.vendorKey}`;
    if (!target.has(key)) {
      target.set(key, value);
    }
  }
}

function buildOpisSpotSourceValues(rows, pricingDate, options = {}) {
  const rowsByCode = new Map(rows.map((row) => [String(row?.ProductCode || "").trim().toUpperCase(), row]));
  const output = [];
  const sourceMode = String(options.sourceMode || "latest_prompt_average").trim().toLowerCase();
  const selectedTimingLabel = options.selectedTimingLabel || (sourceMode === "intraday" ? "Intraday Spot" : "Latest Published Spot");
  const sourceEndpoint = options.sourceEndpoint || (sourceMode === "intraday" ? "GET /api/SpotValues/Intraday" : "GET /api/SpotValues");
  const fetchedAt = options.fetchedAt || new Date().toISOString();
  for (const market of OPIS_RACK_MARKETS) {
    for (const [productKey, config] of Object.entries(OPIS_SPOT_PRODUCT_CODES)) {
      const row = rowsByCode.get((sourceMode === "intraday" ? (config.intradayProductCode || config.productCode) : config.productCode).toUpperCase());
      const rawValue = toNumber(row?.Value);
      if (!row || !Number.isFinite(rawValue)) continue;
      output.push({
        marketKey: market.marketKey,
        terminalKey: market.terminalKey,
        productKey,
        vendorKey: "",
        quoteCode: "OPIS_SPOT_API",
        value: Number((rawValue / 100).toFixed(4)),
        unit: "usd_gal",
        effectiveDate: row?.Date || pricingDate,
          metadata: {
            source: "opis_spot_api",
            sourceMode,
            sourceEndpoint,
            fetchedAt,
            associatedRackCity: market.rackCity || "",
            associatedSpotMarket: market.spotMarket || "",
            productCode: row?.ProductCode || (sourceMode === "intraday" ? (config.intradayProductCode || config.productCode) : config.productCode),
            product: row?.Product || "",
            geography: row?.Geography || "",
          valueType: row?.ValueType || "",
          terms: row?.Terms || "",
          unit: row?.Unit || "",
          longLabel: row?.LongLabel || config.productName,
          shortLabel: row?.ShortLabel || "",
          effectiveDate: row?.Date || pricingDate,
          selectedTimingLabel
        }
      });
    }
  }
  return output;
}

async function refreshOpisSpotPricingSources({ user, pricingDate }) {
  if (!user?.jobberId) {
    const error = new Error("No jobber selected");
    error.statusCode = 400;
    throw error;
  }
  if (!(await hasOpisCredentials(user))) {
    const error = new Error("OPIS credentials are missing. Set OPIS_USERNAME and OPIS_PASSWORD.");
    error.statusCode = 503;
    throw error;
  }

  const normalizedPricingDate = formatIsoDate(new Date(pricingDate || new Date()));
  const token = await opisSpotAuthenticate(user);
  const fetchedAt = new Date().toISOString();
  const promptAverageProductCodes = Object.values(OPIS_SPOT_PRODUCT_CODES).map((item) => item.productCode).join(",");
  const payload = await opisSpotRequest("SpotValues", token, {
    productCodes: promptAverageProductCodes,
    retrieveLatestData: "true",
    date: normalizedPricingDate,
    showMinimal: "false"
  });
  const values = buildOpisSpotSourceValues(Array.isArray(payload) ? payload : [], normalizedPricingDate, {
    sourceMode: "latest_prompt_average",
    selectedTimingLabel: "Latest Published Prompt Average",
    sourceEndpoint: "GET /api/SpotValues",
    fetchedAt
  });
  const notes = `OPIS latest published prompt averages for ${normalizedPricingDate}: ${promptAverageProductCodes}.`;
  if (!values.length) {
    const error = new Error(`OPIS Spot API returned no usable spot rows for ${normalizedPricingDate}.`);
    error.statusCode = 502;
    throw error;
  }

  const existingSnapshots = await listPricingSources(user.jobberId, { pricingDate: normalizedPricingDate });
  let spotSnapshot = existingSnapshots.find((snapshot) => snapshot.sourceLabel === OPIS_SPOT_SOURCE_LABEL) || null;
  if (!spotSnapshot) {
    spotSnapshot = await createPricingSource(user.jobberId, user.userId, {
      pricingDate: normalizedPricingDate,
      sourceType: "opis",
      sourceLabel: OPIS_SPOT_SOURCE_LABEL,
      status: "ready",
      receivedAt: new Date().toISOString(),
      notes: "Latest published OPIS prompt averages by product code."
    });
  }

  await query(
    `DELETE FROM pricing_source_values v
     USING pricing_source_snapshots s
     WHERE v.snapshot_id = s.id
       AND s.jobber_id = $1
       AND s.pricing_date = $2
       AND v.quote_code = 'OPIS_SPOT_API'
       AND v.product_key = ANY($3::text[])`,
    [user.jobberId, normalizedPricingDate, Object.keys(OPIS_SPOT_PRODUCT_CODES)]
  );

  await createPricingSourceValues(user.jobberId, spotSnapshot.id, values);
  await query(
    `UPDATE pricing_source_snapshots
     SET notes=$1
     WHERE id=$2`,
    [
      notes,
      spotSnapshot.id
    ]
  );
  return getPricingSourceDetail(user.jobberId, spotSnapshot.id);
}

async function refreshOpisRackPricingSources({ user, pricingDate }) {
  if (!user?.jobberId) {
    const error = new Error("No jobber selected");
    error.statusCode = 400;
    throw error;
  }
  if (!(await hasOpisCredentials(user))) {
    const error = new Error("OPIS credentials are missing. Set OPIS_USERNAME and OPIS_PASSWORD.");
    error.statusCode = 503;
    throw error;
  }

  const normalizedPricingDate = formatIsoDate(new Date(pricingDate || new Date()));
  const today = formatIsoDate(new Date());
  const token = await opisAuthenticate(user);
  const selectedValues = new Map();
  const selectedAverageValues = new Map();
  const timingsUsed = new Set();
  for (const timing of OPIS_RACK_TIMING_PREFERENCE) {
    const requestQuery = {
      timing,
      State: "CA",
      FuelTypes: "1,2",
      priceType: "2",
      reportType: "1",
      Branded: "U",
      includePremium: "true",
      ...(normalizedPricingDate === today ? {} : {
        HistoryStartDate: normalizedPricingDate,
        HistoryEndDate: normalizedPricingDate
      })
    };
    const [supplierPricesPayload, summaryPayload] = await Promise.all([
      opisRequestRaw("SupplierPrices", token, requestQuery),
      opisRequestRaw("Summary", token, requestQuery)
    ]);
    const valuesForTiming = buildOpisRackSourceValues(opisSupplierPriceRows(supplierPricesPayload), normalizedPricingDate);
    const averageValuesForTiming = buildOpisRackAverageValues(opisSummaryRows(summaryPayload), normalizedPricingDate);
    if (valuesForTiming.length) {
      upsertEarliestRackValues(selectedValues, valuesForTiming);
      timingsUsed.add(timing);
    }
    if (averageValuesForTiming.length) {
      for (const value of averageValuesForTiming) {
        const key = `${value.marketKey}|${value.productKey}`;
        if (!selectedAverageValues.has(key)) {
          selectedAverageValues.set(key, value);
        }
      }
      timingsUsed.add(timing);
    }
  }

  const values = [...selectedValues.values(), ...selectedAverageValues.values()];
  if (!values.length) {
    const error = new Error(`OPIS Rack API returned no usable rack supplier rows for ${normalizedPricingDate}.`);
    error.statusCode = 502;
    throw error;
  }

  const existingSnapshots = await listPricingSources(user.jobberId, { pricingDate: normalizedPricingDate });
  let rackSnapshot = existingSnapshots.find((snapshot) => snapshot.sourceLabel === OPIS_RACK_SOURCE_LABEL) || null;
  if (!rackSnapshot) {
    rackSnapshot = await createPricingSource(user.jobberId, user.userId, {
      pricingDate: normalizedPricingDate,
      sourceType: "opis",
      sourceLabel: OPIS_RACK_SOURCE_LABEL,
      status: "ready",
      receivedAt: new Date().toISOString(),
      notes: "Rack supplier rows refreshed from the first available OPIS Rack API snapshots after 6:00 AM ET."
    });
  }

  await query(
    `DELETE FROM pricing_source_values v
     USING pricing_source_snapshots s
     WHERE v.snapshot_id = s.id
       AND s.jobber_id = $1
       AND s.pricing_date = $2
       AND (
         (v.vendor_key = ANY($3::text[]) AND v.product_key = ANY($4::text[]))
         OR v.quote_code = 'OPIS_RACK_API_AVG'
       )`,
    [user.jobberId, normalizedPricingDate, OPIS_RACK_VENDOR_KEYS, OPIS_RACK_PRODUCT_KEYS]
  );

  await createPricingSourceValues(user.jobberId, rackSnapshot.id, values);
  await query(
    `UPDATE pricing_source_snapshots
     SET notes=$1
     WHERE id=$2`,
    [
      `Rack supplier rows refreshed from the first available OPIS Rack API snapshots after 6:00 AM ET. Timings used: ${[...timingsUsed].map((timing) => OPIS_RACK_TIMING_LABELS[timing] || timing).join(", ") || "none"}.`,
      rackSnapshot.id
    ]
  );
  return getPricingSourceDetail(user.jobberId, rackSnapshot.id);
}

function averageMappedOpisPrice(rows, fuelType) {
  const filtered = rows.filter((row) => !fuelType || String(row.fuelType).toLowerCase() === fuelType.toLowerCase());
  if (!filtered.length) return null;
  return Number((filtered.reduce((sum, row) => sum + Number(row.price || 0), 0) / filtered.length).toFixed(2));
}

function mapOpisRow(row) {
  return {
    cityId: row.CityID,
    cityName: row.CityName,
    stateAbbr: row.StateAbbr,
    stateName: row.StateName,
    countryName: row.CountryName,
    productId: row.ProductID,
    productName: row.ProductName,
    fuelType: row.FuelType,
    branded: row.Branded,
    grossNet: row.GrossNet,
    price: Number(row.Price || 0),
    currencyUnit: row.CurrencyUnit,
    effectiveDate: row.EffectiveDate,
    benchmarkTypeName: row.BenchmarkTypeName,
    benchmarkTimingType: row.BenchmarkTimingType
  };
}

function groupOpisStateAverages(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = row.stateAbbr;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(row);
  }
  return [...grouped.entries()]
    .map(([stateAbbr, stateRows]) => ({
      stateAbbr,
      averagePrice: averageMappedOpisPrice(stateRows),
      gasolineAverage: averageMappedOpisPrice(stateRows, "Gasoline"),
      dieselAverage: averageMappedOpisPrice(stateRows, "Distillate"),
      rowCount: stateRows.length
    }))
    .filter((item) => item.averagePrice != null)
    .sort((a, b) => b.averagePrice - a.averagePrice)
    .slice(0, 10);
}

function groupOpisProductAverages(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.productName}__${row.fuelType}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(row);
  }
  return [...grouped.entries()]
    .map(([key, productRows]) => {
      const [productName, fuelType] = key.split("__");
      return {
        productName,
        fuelType,
        averagePrice: averageMappedOpisPrice(productRows),
        rowCount: productRows.length
      };
    })
    .filter((item) => item.averagePrice != null)
    .sort((a, b) => b.rowCount - a.rowCount || b.averagePrice - a.averagePrice)
    .slice(0, 8);
}

function describeOpisMarket({ currentRows, timingComparison, selectedFuelType, state }) {
  const highest = [...currentRows].sort((a, b) => b.price - a.price)[0] || null;
  const lowest = [...currentRows].sort((a, b) => a.price - b.price)[0] || null;
  const live = timingComparison.find((item) => item.timing === "0");
  const closing = timingComparison.find((item) => item.timing === "1");
  const contract = timingComparison.find((item) => item.timing === "2");
  const gasolineAverage = averageMappedOpisPrice(currentRows, "Gasoline");
  const dieselAverage = averageMappedOpisPrice(currentRows, "Distillate");
  const spread = gasolineAverage != null && dieselAverage != null ? Number((dieselAverage - gasolineAverage).toFixed(2)) : null;
  const liveVsClosing = live?.averagePrice != null && closing?.averagePrice != null
    ? Number((live.averagePrice - closing.averagePrice).toFixed(2))
    : null;
  const marketLabel = state === "ALL" ? "the subscribed market set" : state;
  const fuelLabel = selectedFuelType === "all" ? "all fuels" : selectedFuelType;

  const summary = [
    `OPIS returned ${currentRows.length.toLocaleString("en-US")} rows for ${fuelLabel} across ${marketLabel}.`,
    highest && lowest
      ? `The current returned spread runs from ${lowest.cityName}, ${lowest.stateAbbr} at ${lowest.price.toFixed(2)} ${lowest.currencyUnit} up to ${highest.cityName}, ${highest.stateAbbr} at ${highest.price.toFixed(2)} ${highest.currencyUnit}.`
      : "The returned market set is too narrow to describe a high-low spread.",
    spread == null
      ? "Only one major fuel family is present in the current filter, so no gasoline-versus-diesel spread is shown."
      : spread > 0
        ? `Diesel is averaging ${spread.toFixed(2)} USCPG above gasoline in the current OPIS selection.`
        : `Gasoline is averaging ${Math.abs(spread).toFixed(2)} USCPG above diesel in the current OPIS selection.`
  ];

  const outlook = [
    liveVsClosing == null
      ? "Timing comparisons are limited for this selection, so the page emphasizes current cross-market structure instead of intraday direction."
      : liveVsClosing > 0
        ? `Live pricing is ${liveVsClosing.toFixed(2)} USCPG above the closing snapshot, which points to a firmer near-term rack tone.`
        : liveVsClosing < 0
          ? `Live pricing is ${Math.abs(liveVsClosing).toFixed(2)} USCPG below the closing snapshot, which suggests the current rack tone is easing versus the prior close.`
          : "Live and closing pricing are effectively flat, suggesting a steady rack tone versus the prior close.",
    contract?.averagePrice != null && live?.averagePrice != null
      ? `Contract timing sits ${Math.abs(live.averagePrice - contract.averagePrice).toFixed(2)} USCPG ${live.averagePrice >= contract.averagePrice ? "below" : "above"} live pricing, giving buyers a quick read on how prompt rack pricing compares with indexed contract levels.`
      : "Contract timing was not available in a way that changes the read materially for this view."
  ];

  return { summary, outlook };
}

async function opisMetadata(token) {
  if (opisMetadataCache.value && opisMetadataCache.expiresAt > Date.now()) {
    return opisMetadataCache.value;
  }

  const [countries, cities, products, benchmarkTypes] = await Promise.all([
    opisRequest("Country", token),
    opisRequest("City", token),
    opisRequest("Product", token),
    opisRequest("BenchmarkType", token)
  ]);

  const stateOptions = [...new Map(
    (cities?.Data?.Cities || [])
      .map((city) => [city.StateAbbr, { value: city.StateAbbr, label: city.StateName }])
  ).values()].sort((a, b) => a.label.localeCompare(b.label));

  const value = {
    countries: countries?.Data?.Countries || [],
    cities: cities?.Data?.Cities || [],
    products: products?.Data?.Products || [],
    benchmarkTypes: benchmarkTypes?.Data?.BenchmarkTypes || [],
    stateOptions: [
      { value: "ALL", label: "All States" },
      ...stateOptions
    ]
  };

  opisMetadataCache = {
    value,
    expiresAt: Date.now() + OPIS_METADATA_CACHE_TTL_MS
  };
  return value;
}

async function opisMarketSnapshot({ timing = "0", state = "ALL", fuelType = "all", user = null }) {
  const token = await opisAuthenticate(user);
  const metadata = await opisMetadata(token);
  const selectedFuelType = OPIS_FUEL_TYPE_OPTIONS.find((option) => option.value === fuelType)?.opisValue || "";
  const requestedState = state === "ALL" ? "" : state;
  const [summary, ...timingPayloads] = await Promise.all([
    opisRequest("Summary", token, {
      timing,
      State: requestedState,
      FuelTypes: selectedFuelType
    }),
    ...OPIS_TIMING_OPTIONS.filter((option) => option.value !== timing).map((option) =>
      opisRequest("Summary", token, {
        timing: option.value,
        State: requestedState,
        FuelTypes: selectedFuelType
      }).catch(() => null)
    )
  ]);

  const rows = summary?.Data?.Summaries || [];
  const mappedRows = rows.map(mapOpisRow);
  const sortedRows = [...mappedRows].sort((a, b) => b.price - a.price);
  const uniqueStates = new Set(mappedRows.map((row) => row.stateAbbr));
  const uniqueCities = new Set(mappedRows.map((row) => `${row.stateAbbr}-${row.cityId}`));
  const effectiveDate = mappedRows[0]?.effectiveDate || null;
  const timingComparison = [
    { value: timing, payload: summary },
    ...OPIS_TIMING_OPTIONS.filter((option) => option.value !== timing).map((option, index) => ({
      value: option.value,
      payload: timingPayloads[index]
    }))
  ]
    .map(({ value, payload }) => {
      const timingRows = (payload?.Data?.Summaries || []).map(mapOpisRow);
      return {
        timing: value,
        label: OPIS_TIMING_OPTIONS.find((option) => option.value === value)?.label || value,
        averagePrice: averageMappedOpisPrice(timingRows),
        gasolineAverage: averageMappedOpisPrice(timingRows, "Gasoline"),
        dieselAverage: averageMappedOpisPrice(timingRows, "Distillate"),
        rowCount: timingRows.length
      };
    })
    .filter((item) => item.rowCount > 0);
  const timingSnapshots = [
    { value: timing, payload: summary },
    ...OPIS_TIMING_OPTIONS.filter((option) => option.value !== timing).map((option, index) => ({
      value: option.value,
      payload: timingPayloads[index]
    }))
  ]
    .map(({ value, payload }) => ({
      timing: value,
      label: OPIS_TIMING_OPTIONS.find((option) => option.value === value)?.label || value,
      rows: (payload?.Data?.Summaries || []).map(mapOpisRow)
    }))
    .filter((item) => item.rows.length > 0);
  const commentary = describeOpisMarket({
    currentRows: mappedRows,
    timingComparison,
    selectedFuelType: fuelType,
    state
  });

  return {
    lastUpdated: new Date().toISOString(),
    appliedFilters: {
      timing,
      state,
      fuelType
    },
    filterOptions: {
      timing: OPIS_TIMING_OPTIONS,
      states: metadata.stateOptions,
      fuelTypes: OPIS_FUEL_TYPE_OPTIONS.map(({ value, label }) => ({ value, label }))
    },
    coverage: {
      countries: metadata.countries.length,
      cities: metadata.cities.length,
      products: metadata.products.length,
      benchmarkTypes: metadata.benchmarkTypes.length
    },
    metrics: {
      rowCount: mappedRows.length,
      stateCount: uniqueStates.size,
      cityCount: uniqueCities.size,
      averagePrice: averageOpisPrice(rows),
      gasolineAverage: averageOpisPrice(rows, "Gasoline"),
      dieselAverage: averageOpisPrice(rows, "Distillate"),
      biodieselAverage: averageOpisPrice(rows, "Biodiesel"),
      effectiveDate
    },
    highlights: {
      highest: sortedRows.slice(0, 5),
      lowest: [...sortedRows].reverse().slice(0, 5)
    },
    charts: {
      timingComparison,
      stateAverages: groupOpisStateAverages(mappedRows),
      productAverages: groupOpisProductAverages(mappedRows)
    },
    timingSnapshots,
    commentary,
    rows: mappedRows,
    notes: [
      `Showing ${mappedRows.length} OPIS rack summary rows for ${state === "ALL" ? "all subscribed states" : state}.`,
      `${OPIS_TIMING_OPTIONS.find((option) => option.value === timing)?.label || "Selected"} timing is active.`,
      "Prices are returned in the source unit from OPIS. Most U.S. rows are in US cents per gallon."
    ]
  };
}

function id(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

const oauthProviders = {
  google: {
    key: "google",
    label: "Google",
    clientId: process.env.OAUTH_GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.OAUTH_GOOGLE_CLIENT_SECRET || "",
    callbackUrl: process.env.OAUTH_GOOGLE_CALLBACK_URL || "",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email profile"
  }
};

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function parseBase64UrlJson(value) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch (_error) {
    return null;
  }
}

function providerConfig(name) {
  const provider = oauthProviders[name];
  if (!provider) return null;
  if (!provider.clientId || !provider.clientSecret || !provider.callbackUrl) return null;
  return provider;
}

function publicProviderInfo(name) {
  const provider = oauthProviders[name];
  return {
    key: provider.key,
    label: provider.label,
    enabled: !!providerConfig(name)
  };
}

function oauthState(provider, redirectTo) {
  return base64UrlJson({
    provider,
    redirectTo: redirectTo || `${webBaseUrl}/auth/callback`,
    nonce: crypto.randomBytes(12).toString("hex"),
    ts: Date.now()
  });
}

function appendParams(target, params, hash = false) {
  const url = new URL(target);
  const search = hash ? new URLSearchParams(url.hash.replace(/^#/, "")) : url.searchParams;
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    search.set(key, String(value));
  }
  if (hash) {
    url.hash = search.toString();
  }
  return url.toString();
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

function redirectWithError(res, redirectTo, error) {
  res.redirect(appendParams(redirectTo || `${webBaseUrl}/auth/callback`, { error }, true));
}

async function exchangeCodeForTokens(provider, code) {
  const body = new URLSearchParams({
    code,
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    redirect_uri: provider.callbackUrl,
    grant_type: "authorization_code"
  });
  const response = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OAuth token exchange failed: ${detail}`);
  }
  return response.json();
}

async function fetchUserInfo(provider, accessToken) {
  const response = await fetch(provider.userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OAuth userinfo fetch failed: ${detail}`);
  }
  return response.json();
}

function emailDomain(email) {
  const parts = String(email || "").toLowerCase().split("@");
  return parts.length === 2 ? parts[1] : "";
}

async function membershipsForUser(userId) {
  const membershipResult = await query(
    `SELECT
      ujr.jobber_id AS "jobberId",
      ujr.role,
      ujr.is_default AS "isDefault",
      j.name AS "jobberName",
      j.slug AS "jobberSlug"
     FROM user_jobber_roles ujr
     JOIN jobbers j ON j.id = ujr.jobber_id
     WHERE ujr.user_id=$1
     ORDER BY ujr.is_default DESC, j.name ASC`,
    [userId]
  );
  return membershipResult.rows;
}

function defaultMembership(memberships) {
  if (!memberships.length) return null;
  return memberships.find((membership) => membership.isDefault) || memberships[0];
}

async function currentJobberForUser(user) {
  if (!user?.jobberId) return null;
  const result = await query(
    `SELECT
      id,
      org_id AS "orgId",
      name,
      slug,
      oauth_domain AS "oauthDomain",
      logo_url AS "logoUrl",
      tank_limits_json AS "tankLimits",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
     FROM jobbers
     WHERE id=$1`,
    [user.jobberId]
  );
  return result.rows[0] || null;
}

async function sitesForJobber(jobberId) {
  const siteRows = await query(
    `SELECT
      id,
      site_code AS "siteCode",
      name,
      address,
      region
     FROM sites
     WHERE jobber_id=$1
     ORDER BY site_code`,
    [jobberId]
  );
  return siteRows.rows;
}

async function usersForJobber(jobberId) {
  const [userRows, assignmentRows] = await Promise.all([
    query(
      `SELECT
        u.id,
        u.name,
        u.email,
        ujr.role,
        ujr.is_default AS "isDefault"
       FROM user_jobber_roles ujr
       JOIN users u ON u.id = ujr.user_id
       WHERE ujr.jobber_id=$1
       ORDER BY ujr.role, u.name`,
      [jobberId]
    ),
    query(
      `SELECT usa.user_id AS "userId", usa.site_id AS "siteId"
       FROM user_site_assignments usa
       JOIN user_jobber_roles ujr ON ujr.user_id = usa.user_id
       WHERE ujr.jobber_id=$1`,
      [jobberId]
    )
  ]);

  const siteIdsByUser = new Map();
  for (const row of assignmentRows.rows) {
    if (!siteIdsByUser.has(row.userId)) siteIdsByUser.set(row.userId, []);
    siteIdsByUser.get(row.userId).push(row.siteId);
  }

  return userRows.rows.map((row) => ({
    ...row,
    siteIds: siteIdsByUser.get(row.id) || []
  }));
}

async function allJobbers() {
  const result = await query(
    `SELECT
      id,
      org_id AS "orgId",
      name,
      slug,
      oauth_domain AS "oauthDomain",
      logo_url AS "logoUrl",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
     FROM jobbers
     ORDER BY name`
  );
  return result.rows;
}

async function allSitesWithJobbers() {
  const result = await query(
    `SELECT
      s.id,
      s.jobber_id AS "jobberId",
      j.name AS "jobberName",
      s.site_code AS "siteCode",
      s.name,
      s.address,
      s.region
     FROM sites s
     JOIN jobbers j ON j.id = s.jobber_id
     ORDER BY j.name, s.site_code`
  );
  return result.rows;
}

async function allManagedUsers() {
  const [userRows, assignmentRows] = await Promise.all([
    query(
      `SELECT
        u.id,
        u.name,
        u.email,
        u.role AS "systemRole",
        ujr.jobber_id AS "jobberId",
        j.name AS "jobberName",
        ujr.role,
        ujr.is_default AS "isDefault"
       FROM users u
       LEFT JOIN user_jobber_roles ujr ON ujr.user_id = u.id
       LEFT JOIN jobbers j ON j.id = ujr.jobber_id
       WHERE u.role <> 'system_manager'
       ORDER BY COALESCE(j.name, ''), u.name`
    ),
    query(`SELECT user_id AS "userId", site_id AS "siteId" FROM user_site_assignments`)
  ]);

  const siteIdsByUser = new Map();
  for (const row of assignmentRows.rows) {
    if (!siteIdsByUser.has(row.userId)) siteIdsByUser.set(row.userId, []);
    siteIdsByUser.get(row.userId).push(row.siteId);
  }

  return userRows.rows.map((row) => ({
    ...row,
    siteIds: siteIdsByUser.get(row.id) || []
  }));
}

async function managementOverviewForJobber(jobberId) {
  const [jobber, sites, users] = await Promise.all([
    currentJobberForUser({ jobberId }),
    sitesForJobber(jobberId),
    usersForJobber(jobberId)
  ]);
  return { jobber, sites, users };
}

function requireJobberAdmin(req, res, next) {
  if (req.user.role === "system_manager") {
    return next();
  }
  if (req.user.jobberRole !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  return next();
}

function normalizeManagedRole(value) {
  return value === "admin" || value === "manager" ? value : "";
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "jobber";
}

async function ensureManagedUserInJobber(jobberId, userId) {
  const result = await query(
    `SELECT
      u.id,
      u.name,
      u.email,
      ujr.role,
      ujr.is_default AS "isDefault"
     FROM users u
     JOIN user_jobber_roles ujr ON ujr.user_id = u.id
     WHERE ujr.jobber_id=$1 AND u.id=$2`,
    [jobberId, userId]
  );
  return result.rows[0] || null;
}

async function managementOverviewForUser(user) {
  if (user.role === "system_manager") {
    const [jobbers, sites, users] = await Promise.all([
      allJobbers(),
      allSitesWithJobbers(),
      allManagedUsers()
    ]);
    return {
      scope: "system",
      jobbers,
      sites,
      users
    };
  }

  const scoped = await managementOverviewForJobber(user.jobberId);
  return {
    scope: "jobber",
    jobbers: scoped.jobber ? [scoped.jobber] : [],
    sites: scoped.sites,
    users: scoped.users,
    jobber: scoped.jobber
  };
}

async function findJobberByEmailDomain(email) {
  const domain = emailDomain(email);
  if (!domain) return null;
  const result = await query(
    `SELECT id, org_id AS "orgId", name, slug, oauth_domain AS "oauthDomain"
     FROM jobbers
     WHERE LOWER(oauth_domain)=$1
     LIMIT 1`,
    [domain]
  );
  return result.rows[0] || null;
}

async function siteIdsForUser(user) {
  if (user.role === "system_manager") {
    const all = await query("SELECT id FROM sites");
    return all.rows.map((r) => r.id);
  }
  if (user.jobberRole === "admin") {
    const all = await query(`SELECT id FROM sites WHERE jobber_id=$1`, [user.jobberId]);
    return all.rows.map((r) => r.id);
  }
  if (user.role === "manager") {
    const all = await query("SELECT id FROM sites");
    return all.rows.map((r) => r.id);
  }
  return user.siteIds || [];
}

async function ensureSitePermission(user, siteId) {
  const ids = await siteIdsForUser(user);
  return ids.includes(siteId);
}

async function alliedFilterOptionsForSite(siteId) {
  const result = await query(
    `SELECT
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT fuel_position_id), '') AS "fuelPositions",
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT payment_type), '') AS "paymentTypes",
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT card_type), '') AS "cardTypes",
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT card_name), '') AS "cardNames",
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT emv_status), '') AS "emvStatuses",
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT entry_method), '') AS "entryMethods",
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT emv_tran_type), '') AS "emvTranTypes",
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT tag_denial_reason), '') AS "denialReasons"
     FROM allied_transactions
     WHERE store_id=$1`,
    [siteId]
  );
  return result.rows[0] || {
    fuelPositions: [],
    paymentTypes: [],
    cardTypes: [],
    cardNames: [],
    emvStatuses: [],
    entryMethods: [],
    emvTranTypes: [],
    denialReasons: []
  };
}

function alliedFilterSql(queryParams, siteId) {
  const presetRange = alliedQuickPresetRange(queryParams.preset);
  const defaults = alliedDefaultDateRange();
  const dateStart = normalizeDateParam(queryParams.from || presetRange?.start, defaults.start);
  const dateEnd = normalizeDateParam(queryParams.to || presetRange?.end, defaults.end);
  const conditions = ["store_id = $1", "\"timestamp\" >= $2", "\"timestamp\" <= $3"];
  const params = [siteId, dateStart, dateEnd];
  let index = 4;

  const addTextFilter = (column, value) => {
    if (!value) return;
    conditions.push(`${column} = $${index++}`);
    params.push(value);
  };

  addTextFilter("fuel_position_id", queryParams.fuelPositionId || queryParams.pumpId);
  addTextFilter("payment_type", queryParams.paymentType);
  addTextFilter("card_type", queryParams.cardType);
  addTextFilter("card_name", queryParams.cardName || queryParams.cardBrand);
  addTextFilter("emv_status", queryParams.emvStatus);
  addTextFilter("entry_method", queryParams.entryMethod);
  addTextFilter("emv_tran_type", queryParams.emvTranType);
  addTextFilter("tag_denial_reason", queryParams.denialReason);

  const amountMin = toNumber(queryParams.amountMin);
  const amountMax = toNumber(queryParams.amountMax);
  const gallonsMin = toNumber(queryParams.gallonsMin);
  const gallonsMax = toNumber(queryParams.gallonsMax);
  if (amountMin != null) {
    conditions.push(`COALESCE(total_amount, 0) >= $${index++}`);
    params.push(amountMin);
  }
  if (amountMax != null) {
    conditions.push(`COALESCE(total_amount, 0) <= $${index++}`);
    params.push(amountMax);
  }
  if (gallonsMin != null) {
    conditions.push(`COALESCE(fuel_quantity_gallons, 0) >= $${index++}`);
    params.push(gallonsMin);
  }
  if (gallonsMax != null) {
    conditions.push(`COALESCE(fuel_quantity_gallons, 0) <= $${index++}`);
    params.push(gallonsMax);
  }

  return {
    whereClause: conditions.join(" AND "),
    params,
    range: { from: dateStart, to: dateEnd }
  };
}

function alliedPortfolioFilterSql(queryParams, siteIds) {
  const presetRange = alliedQuickPresetRange(queryParams.preset);
  const defaults = alliedDefaultDateRange();
  const dateStart = normalizeDateParam(queryParams.from || presetRange?.start, defaults.start);
  const dateEnd = normalizeDateParam(queryParams.to || presetRange?.end, defaults.end);
  const conditions = ["store_id = ANY($1::text[])", "\"timestamp\" >= $2", "\"timestamp\" <= $3"];
  const params = [siteIds, dateStart, dateEnd];
  let index = 4;

  if (queryParams.siteId) {
    conditions.push(`store_id = $${index++}`);
    params.push(queryParams.siteId);
  }

  const addTextFilter = (column, value) => {
    if (!value) return;
    conditions.push(`${column} = $${index++}`);
    params.push(value);
  };

  addTextFilter("fuel_position_id", queryParams.fuelPositionId || queryParams.pumpId);
  addTextFilter("payment_type", queryParams.paymentType);
  addTextFilter("card_type", queryParams.cardType);
  addTextFilter("card_name", queryParams.cardName || queryParams.cardBrand);
  addTextFilter("emv_status", queryParams.emvStatus);
  addTextFilter("entry_method", queryParams.entryMethod);
  addTextFilter("emv_tran_type", queryParams.emvTranType);
  addTextFilter("tag_denial_reason", queryParams.denialReason);

  const amountMin = toNumber(queryParams.amountMin);
  const amountMax = toNumber(queryParams.amountMax);
  if (amountMin != null) {
    conditions.push(`COALESCE(total_amount, 0) >= $${index++}`);
    params.push(amountMin);
  }
  if (amountMax != null) {
    conditions.push(`COALESCE(total_amount, 0) <= $${index++}`);
    params.push(amountMax);
  }

  return {
    whereClause: conditions.join(" AND "),
    params,
    range: { from: dateStart, to: dateEnd }
  };
}

function alliedRowFromDb(row) {
  const normalized = {
    id: row.id || `${row.storeId || row.siteId}:${row.transactionId}`,
    siteId: row.siteId,
    transactionId: row.transactionId,
    accountOrigin: row.accountOrigin,
    actualSalesPrice: toNumber(row.actualSalesPrice, 0),
    authAmount: toNumber(row.authAmount, null),
    cardName: row.cardName || "",
    cardType: row.cardType || "",
    emvErrorCode: row.emvErrorCode || "",
    emvStatus: row.emvStatus || "",
    emvTranType: row.emvTranType || "",
    entryMethod: row.entryMethod || "",
    expDate: row.expDate || "",
    fallbackToMsr: !!row.fallbackToMsr,
    first8: row.first8 || "",
    fuelDescription: row.fuelDescription || "",
    fuelPositionId: row.fuelPositionId || "",
    fuelQuantityGallons: toNumber(row.fuelQuantityGallons, 0),
    last4: row.last4 || "",
    paymentType: row.paymentType || "",
    storeId: row.storeId || "",
    tagDenialReason: row.tagDenialReason || "",
    timestamp: row.timestamp,
    timezone: row.timezone || "America/New_York",
    totalAmount: toNumber(row.totalAmount, 0)
  };
  const derived = alliedDerivedChecks(normalized);
  return {
    ...normalized,
    maskedPan: alliedMaskedPan(normalized.first8, normalized.last4),
    likelyTransactionType: alliedLikelyTransactionType(normalized),
    flagged: !derived.internallyConsistent,
    derivedChecks: derived
  };
}

function alliedSeriesByDay(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = String(row.timestamp).slice(0, 10);
    if (!grouped.has(key)) {
      grouped.set(key, {
        date: key,
        transactions: 0,
        sales: 0,
        gallons: 0,
        completed: 0,
        aborts: 0,
        contactless: 0,
        chip: 0,
        preset: 0,
        issues: 0
      });
    }
    const bucket = grouped.get(key);
    bucket.transactions += 1;
    bucket.sales += toNumber(row.totalAmount, 0) || 0;
    bucket.gallons += toNumber(row.fuelQuantityGallons, 0) || 0;
    if (alliedMetricStatusSet.has(row.emvStatus)) bucket.completed += 1;
    if (alliedAbortStatusSet.has(row.emvStatus)) bucket.aborts += 1;
    if (row.entryMethod === "EmvContactless") bucket.contactless += 1;
    if (String(row.entryMethod).includes("Chip") || String(row.entryMethod).includes("Emv")) bucket.chip += 1;
    if (row.paymentType === "Preset") bucket.preset += 1;
    if (row.flagged) bucket.issues += 1;
  }
  return [...grouped.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((bucket) => ({
      ...bucket,
      sales: Number(bucket.sales.toFixed(2)),
      gallons: Number(bucket.gallons.toFixed(3)),
      completionRate: bucket.transactions ? Number((bucket.completed / bucket.transactions).toFixed(4)) : 0,
      abortRate: bucket.transactions ? Number((bucket.aborts / bucket.transactions).toFixed(4)) : 0,
      issueRate: bucket.transactions ? Number((bucket.issues / bucket.transactions).toFixed(4)) : 0,
      contactlessRate: bucket.transactions ? Number((bucket.contactless / bucket.transactions).toFixed(4)) : 0,
      chipRate: bucket.transactions ? Number((bucket.chip / bucket.transactions).toFixed(4)) : 0,
      averageTicket: bucket.completed ? Number((bucket.sales / bucket.completed).toFixed(2)) : 0
    }));
}

function alliedDistribution(rows, key) {
  const grouped = new Map();
  for (const row of rows) {
    const label = String(row[key] || "Unknown").trim() || "Unknown";
    if (!grouped.has(label)) grouped.set(label, { label, count: 0, sales: 0, gallons: 0 });
    const bucket = grouped.get(label);
    bucket.count += 1;
    bucket.sales += toNumber(row.totalAmount, 0) || 0;
    bucket.gallons += toNumber(row.fuelQuantityGallons, 0) || 0;
  }
  return [...grouped.values()]
    .map((bucket) => ({
      ...bucket,
      sales: Number(bucket.sales.toFixed(2)),
      gallons: Number(bucket.gallons.toFixed(3))
    }))
    .sort((a, b) => b.count - a.count || b.sales - a.sales);
}

function alliedPumpHealth(rows) {
  return alliedDistribution(rows, "fuelPositionId")
    .filter((bucket) => bucket.label !== "Unknown")
    .map((bucket) => {
      const pumpRows = rows.filter((row) => row.fuelPositionId === bucket.label);
      const aborts = pumpRows.filter((row) => alliedAbortStatusSet.has(row.emvStatus)).length;
      const completes = pumpRows.filter((row) => alliedMetricStatusSet.has(row.emvStatus)).length;
      return {
        fuelPositionId: bucket.label,
        transactions: bucket.count,
        aborts,
        completionRate: bucket.count ? Number((completes / bucket.count).toFixed(4)) : 0,
        sales: bucket.sales,
        gallons: bucket.gallons,
        flaggedCount: pumpRows.filter((row) => row.flagged).length
      };
    })
    .sort((a, b) => b.gallons - a.gallons || b.transactions - a.transactions);
}

function alliedCompareWindows(series, accessor) {
  if (series.length < 2) return null;
  const trailing = series.slice(-7);
  const prior = series.slice(-14, -7);
  if (!prior.length) return null;
  const currentValue = trailing.reduce((sum, item) => sum + accessor(item), 0);
  const priorValue = prior.reduce((sum, item) => sum + accessor(item), 0);
  const delta = currentValue - priorValue;
  const deltaPct = priorValue === 0 ? null : Number((delta / priorValue).toFixed(4));
  return { currentValue, priorValue, delta, deltaPct };
}

function alliedIssues(rows, series) {
  const issues = [];
  const highAbortRows = rows.filter((row) => alliedAbortStatusSet.has(row.emvStatus));
  const highAbortRate = rows.length ? highAbortRows.length / rows.length : 0;
  if (highAbortRate >= 0.12 && highAbortRows.length >= 5) {
    issues.push(alliedBuildIssue(
      "High abort rate",
      highAbortRate >= 0.2 ? "critical" : "warn",
      `Abort rate is ${(highAbortRate * 100).toFixed(1)}% in the current filter.`,
      highAbortRows,
      { rateImpact: Number(highAbortRate.toFixed(4)), filters: { emvStatus: "CustomerAbort" } }
    ));
  }

  const abortCompare = alliedCompareWindows(series, (item) => item.aborts);
  if (abortCompare && abortCompare.delta > 4 && (abortCompare.deltaPct || 0) >= 0.25) {
    issues.push(alliedBuildIssue(
      "Rising abort rate week over week",
      abortCompare.deltaPct >= 0.6 ? "critical" : "warn",
      `Aborts increased by ${abortCompare.delta} versus the prior 7-day window.`,
      highAbortRows.slice(-Math.max(6, abortCompare.delta)),
      { rateImpact: abortCompare.deltaPct, filters: { emvStatus: "CustomerAbort", preset: "7d" } }
    ));
  }

  const zeroDollarRows = rows.filter((row) => alliedMetricStatusSet.has(row.emvStatus) && (toNumber(row.totalAmount, 0) || 0) <= 0);
  if (zeroDollarRows.length >= 3) {
    issues.push(alliedBuildIssue(
      "Abnormal zero-dollar completed transactions",
      "critical",
      `${zeroDollarRows.length} completed transactions have non-positive totals.`,
      zeroDollarRows,
      { filters: { minFlaggedOnly: "true" } }
    ));
  }

  const pumpBuckets = alliedPumpHealth(rows);
  if (pumpBuckets.length) {
    const worstPump = [...pumpBuckets].sort((a, b) => b.aborts - a.aborts || a.completionRate - b.completionRate)[0];
    if (worstPump && worstPump.aborts >= 4 && worstPump.transactions ? worstPump.aborts / worstPump.transactions >= 0.25 : false) {
      issues.push(alliedBuildIssue(
        "Pump-specific issue concentration",
        worstPump.aborts >= 8 ? "critical" : "warn",
        `${worstPump.fuelPositionId} accounts for ${worstPump.aborts} aborts with ${(worstPump.completionRate * 100).toFixed(1)}% completion.`,
        rows.filter((row) => row.fuelPositionId === worstPump.fuelPositionId),
        { filters: { fuelPositionId: worstPump.fuelPositionId } }
      ));
    }
  }

  const emvSpikeBuckets = alliedDistribution(rows.filter((row) => row.emvErrorCode), "emvErrorCode");
  if (emvSpikeBuckets[0] && emvSpikeBuckets[0].count >= 5) {
    issues.push(alliedBuildIssue(
      "Unusual EMV error code spike",
      emvSpikeBuckets[0].count >= 10 ? "critical" : "warn",
      `${emvSpikeBuckets[0].label} appeared ${emvSpikeBuckets[0].count} times in the current range.`,
      rows.filter((row) => row.emvErrorCode === emvSpikeBuckets[0].label),
      { filters: { emvStatus: "Declined" } }
    ));
  }

  const authMismatchRows = rows.filter((row) => row.authAmount != null && row.authAmount < row.totalAmount);
  if (authMismatchRows.length >= 3) {
    issues.push(alliedBuildIssue(
      "Suspicious auth-to-sale mismatches",
      "critical",
      `${authMismatchRows.length} records have auth amounts below final total amount.`,
      authMismatchRows,
      { filters: { minFlaggedOnly: "true" } }
    ));
  }

  const repeatAbortPumps = pumpBuckets.filter((pump) => pump.aborts >= 3);
  if (repeatAbortPumps[0]) {
    issues.push(alliedBuildIssue(
      "Repeated customer aborts on the same pump",
      repeatAbortPumps[0].aborts >= 6 ? "critical" : "warn",
      `${repeatAbortPumps[0].fuelPositionId} shows repeated customer aborts.`,
      rows.filter((row) => row.fuelPositionId === repeatAbortPumps[0].fuelPositionId && alliedAbortStatusSet.has(row.emvStatus)),
      { filters: { fuelPositionId: repeatAbortPumps[0].fuelPositionId, emvStatus: "CustomerAbort" } }
    ));
  }

  const fallbackRows = rows.filter((row) => row.fallbackToMsr || String(row.entryMethod).toLowerCase().includes("fallback"));
  if (fallbackRows.length >= 4) {
    issues.push(alliedBuildIssue(
      "Fallback spike",
      fallbackRows.length >= 8 ? "critical" : "warn",
      `${fallbackRows.length} fallback transactions were detected.`,
      fallbackRows,
      { filters: { entryMethod: "FallbackMSR" } }
    ));
  }

  const outlierRows = rows.filter((row) => (toNumber(row.fuelQuantityGallons, 0) || 0) > 35 || (toNumber(row.totalAmount, 0) || 0) > 175);
  if (outlierRows.length >= 3) {
    issues.push(alliedBuildIssue(
      "Outlier gallons or dollar amounts",
      "warn",
      `${outlierRows.length} transactions are outside expected gallons or dollar ranges.`,
      outlierRows,
      { filters: { amountMin: "150" } }
    ));
  }

  const malformedRows = rows.filter((row) => !row.derivedChecks.internallyConsistent);
  if (malformedRows.length >= 3) {
    issues.push(alliedBuildIssue(
      "Missing or malformed fields",
      "critical",
      `${malformedRows.length} transactions failed validation checks.`,
      malformedRows,
      { filters: { minFlaggedOnly: "true" } }
    ));
  }

  return issues.slice(0, 10);
}

async function alliedRowsForFilters(siteId, queryParams) {
  const { whereClause, params, range } = alliedFilterSql(queryParams, siteId);
  const flaggedOnly = queryParams.minFlaggedOnly === "true";
  const flaggedClause = flaggedOnly
    ? ` AND (
        (emv_status IN ('Complete','Approved') AND COALESCE(total_amount, 0) <= 0)
        OR (emv_status IN ('Complete','Approved') AND COALESCE(fuel_quantity_gallons, 0) <= 0)
        OR (emv_status = 'CustomerAbort' AND (COALESCE(total_amount, 0) > 0 OR COALESCE(fuel_quantity_gallons, 0) > 0))
        OR (auth_amount IS NOT NULL AND total_amount IS NOT NULL AND auth_amount < total_amount)
        OR (emv_status IN ('Complete','Approved') AND COALESCE(fuel_position_id, '') = '')
        OR (COALESCE(first8, '') <> '' AND first8 !~ '^[0-9]{8}$')
        OR (COALESCE(last4, '') <> '' AND last4 !~ '^[0-9]{4}$')
        OR (COALESCE(exp_date, '') <> '' AND exp_date !~ '^[0-9]{2}/[0-9]{2}$')
      )`
    : "";
  const result = await query(
    `SELECT
      store_id || ':' || transaction_id AS id,
      store_id AS "siteId",
      transaction_id AS "transactionId",
      account_origin AS "accountOrigin",
      actual_sales_price AS "actualSalesPrice",
      auth_amount AS "authAmount",
      card_name AS "cardName",
      card_type AS "cardType",
      emv_error_code AS "emvErrorCode",
      emv_status AS "emvStatus",
      emv_tran_type AS "emvTranType",
      entry_method AS "entryMethod",
      exp_date AS "expDate",
      fallback_to_msr AS "fallbackToMsr",
      first8,
      fuel_description AS "fuelDescription",
      fuel_position_id AS "fuelPositionId",
      fuel_quantity_gallons AS "fuelQuantityGallons",
      last4,
      payment_type AS "paymentType",
      store_id AS "storeId",
      tag_denial_reason AS "tagDenialReason",
      "timestamp",
      timezone,
      total_amount AS "totalAmount"
     FROM allied_transactions
     WHERE ${whereClause}${flaggedClause}
     ORDER BY "timestamp" DESC
     LIMIT 5000`,
    params
  );
  return {
    rows: result.rows.map(alliedRowFromDb),
    range
  };
}

async function alliedRowsForVisibleSites(siteIds, queryParams) {
  const { whereClause, params, range } = alliedPortfolioFilterSql(queryParams, siteIds);
  const result = await query(
    `SELECT
      store_id || ':' || transaction_id AS id,
      store_id AS "siteId",
      transaction_id AS "transactionId",
      account_origin AS "accountOrigin",
      actual_sales_price AS "actualSalesPrice",
      auth_amount AS "authAmount",
      card_name AS "cardName",
      card_type AS "cardType",
      emv_error_code AS "emvErrorCode",
      emv_status AS "emvStatus",
      emv_tran_type AS "emvTranType",
      entry_method AS "entryMethod",
      exp_date AS "expDate",
      fallback_to_msr AS "fallbackToMsr",
      first8,
      fuel_description AS "fuelDescription",
      fuel_position_id AS "fuelPositionId",
      fuel_quantity_gallons AS "fuelQuantityGallons",
      last4,
      payment_type AS "paymentType",
      store_id AS "storeId",
      tag_denial_reason AS "tagDenialReason",
      "timestamp",
      timezone,
      total_amount AS "totalAmount"
     FROM allied_transactions
     WHERE ${whereClause}
     ORDER BY "timestamp" DESC
     LIMIT 20000`,
    params
  );
  return {
    rows: result.rows.map(alliedRowFromDb),
    range
  };
}

async function hydrateUserWithSites(userId) {
  const userResult = await query(
    `SELECT
      id,
      org_id AS "orgId",
      email,
      name,
      role,
      oauth_provider AS "oauthProvider",
      oauth_subject AS "oauthSubject",
      last_login_at AS "lastLoginAt"
     FROM users
     WHERE id=$1`,
    [userId]
  );
  if (userResult.rowCount === 0) return null;
  const sitesResult = await query(
    "SELECT site_id AS \"siteId\" FROM user_site_assignments WHERE user_id=$1",
    [userId]
  );
  const memberships = await membershipsForUser(userId);
  const selectedMembership = defaultMembership(memberships);
  return {
    ...userResult.rows[0],
    jobberId: selectedMembership?.jobberId || null,
    jobberRole: selectedMembership?.role || null,
    jobberMemberships: memberships,
    siteIds: sitesResult.rows.map((r) => r.siteId)
  };
}

async function authPayloadForUser(userId) {
  const user = await hydrateUserWithSites(userId);
  if (!user) return null;
  return {
    token: encodeToken({
      userId: user.id,
      role: user.role,
      orgId: user.orgId,
      jobberId: user.jobberId,
      jobberRole: user.jobberRole,
      jobberMemberships: user.jobberMemberships,
      siteIds: user.siteIds
    }),
    user
  };
}

async function provisionOauthUser({ providerKey, profile }) {
  const oauthSubject = String(profile.sub || "").trim();
  const email = String(profile.email || "").trim().toLowerCase();
  if (!oauthSubject || !email) {
    throw new Error("OAuth profile is missing subject or email");
  }

  const existingBySubject = await query(
    `SELECT id
     FROM users
     WHERE oauth_provider=$1 AND oauth_subject=$2`,
    [providerKey, oauthSubject]
  );
  if (existingBySubject.rowCount > 0) {
    const userId = existingBySubject.rows[0].id;
    await query(
      `UPDATE users
       SET email=$1, name=$2, last_login_at=$3
       WHERE id=$4`,
      [email, profile.name || email, new Date().toISOString(), userId]
    );
    return userId;
  }

  const existingByEmail = await query(
    `SELECT id
     FROM users
     WHERE LOWER(email)=$1
     LIMIT 1`,
    [email]
  );
  if (existingByEmail.rowCount > 0) {
    const userId = existingByEmail.rows[0].id;
    await query(
      `UPDATE users
       SET oauth_provider=$1, oauth_subject=$2, name=$3, last_login_at=$4
       WHERE id=$5`,
      [providerKey, oauthSubject, profile.name || email, new Date().toISOString(), userId]
    );
    return userId;
  }

  const matchedJobber = await findJobberByEmailDomain(email);
  if (!matchedJobber) {
    throw new Error("No jobber is configured for this email domain");
  }

  const userId = id("user");
  const now = new Date().toISOString();
  const defaultPassword = crypto.randomBytes(24).toString("hex");

  await tx(async (client) => {
    await client.query(
      `INSERT INTO users(
        id, org_id, email, name, role, password, oauth_provider, oauth_subject, last_login_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        userId,
        matchedJobber.orgId,
        email,
        profile.name || email,
        "operator",
        defaultPassword,
        providerKey,
        oauthSubject,
        now
      ]
    );
    await client.query(
      `INSERT INTO user_jobber_roles(user_id, jobber_id, role, is_default, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [userId, matchedJobber.id, "manager", true, now, now]
    );
  });

  return userId;
}

async function summariesForSiteIds(ids) {
  if (!ids.length) return [];

  const sites = await query(
    `SELECT
      id,
      jobber_id AS "jobberId",
      site_code AS "siteCode",
      name,
      address,
      postal_code AS "postalCode",
      region,
      lat,
      lon
    FROM sites
    WHERE id = ANY($1::text[])
    ORDER BY site_code`,
    [ids]
  );

  const alerts = await query(
    `SELECT
      site_id AS "siteId",
      COUNT(*) FILTER (WHERE state='raised' AND severity='critical')::int AS "criticalCount",
      COUNT(*) FILTER (WHERE state='raised' AND severity='warn')::int AS "warnCount"
    FROM alarm_events
    WHERE site_id = ANY($1::text[])
    GROUP BY site_id`,
    [ids]
  );

  const connectivity = await query(
    `SELECT
      p.site_id AS "siteId",
      COUNT(ps.id)::int AS "pumpSidesExpected",
      COUNT(ps.id) FILTER (WHERE cs.status='connected')::int AS "pumpSidesConnected"
    FROM pumps p
    JOIN pump_sides ps ON ps.pump_id = p.id
    LEFT JOIN connection_status cs
      ON cs.target_id = ps.id AND cs.kind='pump_side'
    WHERE p.site_id = ANY($1::text[])
    GROUP BY p.site_id`,
    [ids]
  );

  const atg = await query(
    `SELECT site_id AS "siteId", MAX(last_seen_at) AS "atgLastSeenAt"
     FROM connection_status
     WHERE kind='atg' AND site_id = ANY($1::text[])
     GROUP BY site_id`,
    [ids]
  );

  const alertsBySite = new Map(alerts.rows.map((r) => [r.siteId, r]));
  const connBySite = new Map(connectivity.rows.map((r) => [r.siteId, r]));
  const atgBySite = new Map(atg.rows.map((r) => [r.siteId, r]));

  return sites.rows.map((site) => ({
    ...site,
    criticalCount: alertsBySite.get(site.id)?.criticalCount || 0,
    warnCount: alertsBySite.get(site.id)?.warnCount || 0,
    pumpSidesConnected: connBySite.get(site.id)?.pumpSidesConnected || 0,
    pumpSidesExpected: connBySite.get(site.id)?.pumpSidesExpected || 0,
    atgLastSeenAt: atgBySite.get(site.id)?.atgLastSeenAt || null
  }));
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "petroleum-api",
    dbConfigured: hasDbConfig(),
    apiVersion: packageMeta.version || "0.0.0",
    apiReleaseDate: packageMeta.releaseDate || "Not recorded",
    apiReleaseDateTime: packageMeta.releaseDateTime || "Not recorded"
  });
});

app.get(
  "/market/pricing",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!(await hasEiaApiKey(req.user))) {
      return res.status(503).json({
        error: "EIA_API_KEY is missing. Set EIA_API_KEY to enable live EIA pricing."
      });
    }
    const snapshot = await livePricingSnapshot(req.user);
    res.json(snapshot);
  })
);

app.get(
  "/market/opis",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!(await hasOpisCredentials(req.user))) {
      return res.status(503).json({
        error: "OPIS credentials are missing. Set OPIS_USERNAME and OPIS_PASSWORD."
      });
    }
    const snapshot = await opisMarketSnapshot({
      timing: String(req.query.timing || "0"),
      state: String(req.query.state || "ALL"),
      fuelType: String(req.query.fuelType || "all"),
      user: req.user
    });
    res.json(snapshot);
  })
);

app.get(
  "/market/opis/raw",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!(await hasOpisCredentials(req.user))) {
      return res.status(503).json({
        error: "OPIS credentials are missing. Set OPIS_USERNAME and OPIS_PASSWORD."
      });
    }

    const token = await opisAuthenticate(req.user);
    const timing = String(req.query.timing || "0");
    const requestedState = String(req.query.state || "ALL") === "ALL" ? "" : String(req.query.state || "ALL");
    const fuelTypes = OPIS_FUEL_TYPE_OPTIONS.find((option) => option.value === String(req.query.fuelType || "all"))?.opisValue || "";
    const [supplierPricesPayload, summariesPayload] = await Promise.all([
      opisRequestRaw("SupplierPrices", token, {
        timing,
        State: requestedState,
        FuelTypes: fuelTypes,
        priceType: "2",
        reportType: "1"
      }),
      opisRequestRaw("Summary", token, {
        timing,
        State: requestedState,
        FuelTypes: fuelTypes,
        priceType: "2",
        reportType: "1"
      }).catch(() => null)
    ]);

    res.json({
      ...(supplierPricesPayload || {}),
      data: {
        ...(supplierPricesPayload?.data || supplierPricesPayload?.Data || {}),
        summaries: summariesPayload?.data?.summaries ?? summariesPayload?.data?.Summaries ?? summariesPayload?.Data?.summaries ?? summariesPayload?.Data?.Summaries ?? []
      },
      Data: {
        ...(supplierPricesPayload?.Data || supplierPricesPayload?.data || {}),
        Summaries: summariesPayload?.Data?.Summaries ?? summariesPayload?.Data?.summaries ?? summariesPayload?.data?.Summaries ?? summariesPayload?.data?.summaries ?? []
      }
    });
  })
);

app.get(
  "/sites/:id/pricing-configs",
  requireAuth,
  requireSiteAccess,
  asyncHandler(async (req, res) => {
    const result = await query(
      `SELECT
        pricing_key AS "pricingKey",
        formula_id AS "formulaId",
        fuel_type AS "fuelType",
        product_name AS "productName",
        market_label AS "marketLabel",
        config_json AS "config",
        updated_at AS "updatedAt",
        updated_by AS "updatedBy"
       FROM site_pricing_configs
       WHERE site_id=$1
       ORDER BY pricing_key`,
      [req.params.id]
    );
    res.json(result.rows);
  })
);

app.put(
  "/sites/:id/pricing-configs",
  requireAuth,
  requireSiteAccess,
  asyncHandler(async (req, res) => {
    const siteId = req.params.id;
    const body = req.body || {};
    const pricingKey = String(body.pricingKey || "").trim();
    const formulaId = String(body.formulaId || "").trim();
    const productName = String(body.productName || "").trim();
    const marketLabel = String(body.marketLabel || "").trim();
    const config = body.config && typeof body.config === "object" ? body.config : null;

    if (!pricingKey || !formulaId || !productName || !marketLabel || !config) {
      return res.status(400).json({ error: "Missing pricing config fields" });
    }

    const now = new Date().toISOString();
    const result = await query(
      `INSERT INTO site_pricing_configs(
        site_id, pricing_key, formula_id, product_name, market_label, config_json, updated_at, updated_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (site_id, pricing_key)
      DO UPDATE SET
        formula_id=EXCLUDED.formula_id,
        product_name=EXCLUDED.product_name,
        market_label=EXCLUDED.market_label,
        config_json=EXCLUDED.config_json,
        updated_at=EXCLUDED.updated_at,
        updated_by=EXCLUDED.updated_by
      RETURNING
        pricing_key AS "pricingKey",
        formula_id AS "formulaId",
        product_name AS "productName",
        market_label AS "marketLabel",
        config_json AS "config",
        updated_at AS "updatedAt",
        updated_by AS "updatedBy"`,
      [siteId, pricingKey, formulaId, productName, marketLabel, JSON.stringify(config), now, req.user.userId]
    );
    res.json(result.rows[0]);
  })
);

app.get(
  "/jobber/pricing-configs",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const result = await query(
      `SELECT
        pricing_key AS "pricingKey",
        formula_id AS "formulaId",
        fuel_type AS "fuelType",
        product_name AS "productName",
        market_label AS "marketLabel",
        config_json AS "config",
        updated_at AS "updatedAt",
        updated_by AS "updatedBy"
       FROM jobber_pricing_configs
       WHERE jobber_id=$1
       ORDER BY pricing_key`,
      [req.user.jobberId]
    );
    res.json(result.rows);
  })
);

app.put(
  "/jobber/pricing-configs",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const body = req.body || {};
    const pricingKey = String(body.pricingKey || "").trim();
    const formulaId = String(body.formulaId || "").trim();
    const fuelType = String(body.fuelType || "").trim();
    const productName = String(body.productName || "").trim();
    const marketLabel = String(body.marketLabel || "").trim();
    const config = body.config && typeof body.config === "object" ? body.config : null;

    if (!pricingKey || !formulaId || !fuelType || !productName || !marketLabel || !config) {
      return res.status(400).json({ error: "Missing pricing config fields" });
    }

    const now = new Date().toISOString();
    const result = await query(
      `INSERT INTO jobber_pricing_configs(
        jobber_id, pricing_key, formula_id, fuel_type, product_name, market_label, config_json, updated_at, updated_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (jobber_id, pricing_key)
      DO UPDATE SET
        formula_id=EXCLUDED.formula_id,
        fuel_type=EXCLUDED.fuel_type,
        product_name=EXCLUDED.product_name,
        market_label=EXCLUDED.market_label,
        config_json=EXCLUDED.config_json,
        updated_at=EXCLUDED.updated_at,
        updated_by=EXCLUDED.updated_by
      RETURNING
        pricing_key AS "pricingKey",
        formula_id AS "formulaId",
        fuel_type AS "fuelType",
        product_name AS "productName",
        market_label AS "marketLabel",
        config_json AS "config",
        updated_at AS "updatedAt",
        updated_by AS "updatedBy"`,
      [req.user.jobberId, pricingKey, formulaId, fuelType, productName, marketLabel, JSON.stringify(config), now, req.user.userId]
    );
    res.json(result.rows[0]);
  })
);

app.get(
  "/jobber/opis-credentials",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const result = await query(
      `SELECT updated_at AS "updatedAt", updated_by AS "updatedBy"
       FROM jobber_secrets
       WHERE jobber_id=$1 AND provider='opis'
       LIMIT 1`,
      [req.user.jobberId]
    );
    if (result.rowCount === 0) {
      return res.json({ configured: false });
    }
    res.json({
      configured: true,
      updatedAt: result.rows[0].updatedAt,
      updatedBy: result.rows[0].updatedBy
    });
  })
);

app.put(
  "/jobber/opis-credentials",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "").trim();
    if (!username || !password) {
      return res.status(400).json({ error: "username and password are required" });
    }
    const now = new Date().toISOString();
    const encrypted = encryptJson({ username, password });
    const result = await query(
      `INSERT INTO jobber_secrets(jobber_id, provider, encrypted_json, updated_at, updated_by)
       VALUES ($1,'opis',$2,$3,$4)
       ON CONFLICT (jobber_id, provider)
       DO UPDATE SET
         encrypted_json=EXCLUDED.encrypted_json,
         updated_at=EXCLUDED.updated_at,
         updated_by=EXCLUDED.updated_by
       RETURNING updated_at AS "updatedAt", updated_by AS "updatedBy"`,
      [req.user.jobberId, JSON.stringify(encrypted), now, req.user.userId]
    );
    res.json({
      configured: true,
      updatedAt: result.rows[0].updatedAt,
      updatedBy: result.rows[0].updatedBy
    });
  })
);

app.get(
  "/jobber/eia-credentials",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const result = await query(
      `SELECT updated_at AS "updatedAt", updated_by AS "updatedBy"
       FROM jobber_secrets
       WHERE jobber_id=$1 AND provider='eia'
       LIMIT 1`,
      [req.user.jobberId]
    );
    if (result.rowCount === 0) {
      return res.json({ configured: false });
    }
    res.json({
      configured: true,
      updatedAt: result.rows[0].updatedAt,
      updatedBy: result.rows[0].updatedBy
    });
  })
);

app.put(
  "/jobber/eia-credentials",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const apiKey = normalizeEiaApiKey(req.body?.apiKey || "");
    if (!apiKey) {
      return res.status(400).json({ error: "apiKey is required" });
    }
    const now = new Date().toISOString();
    const encrypted = encryptJson({ apiKey });
    const result = await query(
      `INSERT INTO jobber_secrets(jobber_id, provider, encrypted_json, updated_at, updated_by)
       VALUES ($1,'eia',$2,$3,$4)
       ON CONFLICT (jobber_id, provider)
       DO UPDATE SET
         encrypted_json=EXCLUDED.encrypted_json,
         updated_at=EXCLUDED.updated_at,
         updated_by=EXCLUDED.updated_by
       RETURNING updated_at AS "updatedAt", updated_by AS "updatedBy"`,
      [req.user.jobberId, JSON.stringify(encrypted), now, req.user.userId]
    );
    res.json({
      configured: true,
      updatedAt: result.rows[0].updatedAt,
      updatedBy: result.rows[0].updatedBy
    });
  })
);

app.get("/auth/oauth/providers", (_req, res) => {
  res.json(Object.keys(oauthProviders).map(publicProviderInfo));
});

app.get(
  "/auth/oauth/:provider/start",
  asyncHandler(async (req, res) => {
    const provider = providerConfig(req.params.provider);
    if (!provider) {
      return res.status(400).json({ error: "OAuth provider is not configured" });
    }
    const authorizeUrl = new URL(provider.authorizeUrl);
    authorizeUrl.searchParams.set("client_id", provider.clientId);
    authorizeUrl.searchParams.set("redirect_uri", provider.callbackUrl);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", provider.scope);
    authorizeUrl.searchParams.set("access_type", "offline");
    authorizeUrl.searchParams.set("prompt", "select_account");
    authorizeUrl.searchParams.set("state", oauthState(provider.key, req.query.redirectTo));
    res.redirect(authorizeUrl.toString());
  })
);

app.get(
  "/auth/oauth/:provider/callback",
  asyncHandler(async (req, res) => {
    const provider = providerConfig(req.params.provider);
    const state = parseBase64UrlJson(req.query.state);
    const redirectTo = state?.redirectTo || `${webBaseUrl}/auth/callback`;

    if (!provider || state?.provider !== req.params.provider) {
      return redirectWithError(res, redirectTo, "oauth_provider_mismatch");
    }
    if (!req.query.code) {
      return redirectWithError(res, redirectTo, req.query.error || "oauth_code_missing");
    }
    if (typeof state.ts !== "number" || Date.now() - state.ts > 10 * 60 * 1000) {
      return redirectWithError(res, redirectTo, "oauth_state_expired");
    }

    try {
      const tokens = await exchangeCodeForTokens(provider, req.query.code);
      const profile = await fetchUserInfo(provider, tokens.access_token);
      const userId = await provisionOauthUser({ providerKey: provider.key, profile });
      const authData = await authPayloadForUser(userId);
      if (!authData) {
        return redirectWithError(res, redirectTo, "oauth_user_not_found");
      }
      res.redirect(
        appendParams(
          redirectTo,
          {
            token: authData.token,
            provider: provider.key
          },
          true
        )
      );
    } catch (error) {
      console.error("OAuth callback failed:", error.message);
      return redirectWithError(res, redirectTo, "oauth_login_failed");
    }
  })
);

app.post(
  "/auth/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    const userResult = await query(
      `SELECT
        id,
        org_id AS "orgId",
        email,
        name,
        role,
        oauth_provider AS "oauthProvider",
        oauth_subject AS "oauthSubject",
        last_login_at AS "lastLoginAt"
       FROM users
       WHERE email=$1 AND password=$2`,
      [email, password]
    );
    if (userResult.rowCount === 0) return res.status(401).json({ error: "Invalid credentials" });
    const user = userResult.rows[0];
    const siteRows = await query("SELECT site_id AS \"siteId\" FROM user_site_assignments WHERE user_id=$1", [
      user.id
    ]);
    const memberships = await membershipsForUser(user.id);
    const selectedMembership = defaultMembership(memberships);
    const siteIds = siteRows.rows.map((r) => r.siteId);
    await query("UPDATE users SET last_login_at=$1 WHERE id=$2", [new Date().toISOString(), user.id]);
    res.json({
      token: encodeToken({
        userId: user.id,
        role: user.role,
        orgId: user.orgId,
        jobberId: selectedMembership?.jobberId || null,
        jobberRole: selectedMembership?.role || null,
        jobberMemberships: memberships,
        siteIds
      }),
      user: {
        ...user,
        jobberId: selectedMembership?.jobberId || null,
        jobberRole: selectedMembership?.role || null,
        jobberMemberships: memberships,
        siteIds
      }
    });
  })
);

app.get(
  "/auth/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await hydrateUserWithSites(req.user.userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  })
);

app.get(
  "/jobber",
  requireAuth,
  asyncHandler(async (req, res) => {
    const jobber = await currentJobberForUser(req.user);
    if (!jobber) return res.status(404).json({ error: "Jobber not found" });
    res.json(jobber);
  })
);

app.patch(
  "/jobber",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const body = req.body || {};
    const current = await currentJobberForUser(req.user);
    if (!current) return res.status(404).json({ error: "Jobber not found" });

    await query(
      `UPDATE jobbers
       SET name=$1, logo_url=$2, tank_limits_json=$3, updated_at=$4
       WHERE id=$4`,
      [
        body.name?.trim() || current.name,
        typeof body.logoUrl === "string" ? body.logoUrl.trim() : current.logoUrl,
        body.tankLimits && typeof body.tankLimits === "object" ? JSON.stringify(body.tankLimits) : JSON.stringify(current.tankLimits || {}),
        new Date().toISOString(),
        req.user.jobberId
      ]
    );

    const updated = await currentJobberForUser(req.user);
    res.json(updated);
  })
);

app.get(
  "/customers",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    res.json(await listCustomers(req.user.jobberId));
  })
);

app.post(
  "/customers",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const created = await createCustomer(req.user.jobberId, req.body || {});
    res.status(201).json(created);
  })
);

app.get(
  "/customers/:id",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const customer = await getCustomerDetail(req.user.jobberId, req.params.id);
    if (!customer) return res.status(404).json({ error: "Customer not found" });
    res.json(customer);
  })
);

app.patch(
  "/customers/:id",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const updated = await updateCustomer(req.user.jobberId, req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: "Customer not found" });
    res.json(updated);
  })
);

app.delete(
  "/customers/:id",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const deleted = await deleteCustomer(req.user.jobberId, req.params.id);
    if (deleted === undefined) return res.status(404).json({ error: "Customer not found" });
    res.json({ ok: true });
  })
);

app.get(
  "/customers/:id/pricing-profile",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const profile = await getLatestCustomerPricingProfile(req.user.jobberId, req.params.id);
    if (profile === undefined) return res.status(404).json({ error: "Customer not found" });
    res.json(profile);
  })
);

app.put(
  "/customers/:id/pricing-profile",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const saved = await saveCustomerPricingProfile(req.user.jobberId, req.params.id, req.body || {});
    if (saved === undefined) return res.status(404).json({ error: "Customer not found" });
    res.json(saved);
  })
);

app.post(
  "/customers/:id/contacts",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const created = await createCustomerContact(req.user.jobberId, req.params.id, req.body || {});
    if (created === undefined) return res.status(404).json({ error: "Customer not found" });
    res.status(201).json(created);
  })
);

app.patch(
  "/customers/:id/contacts/:contactId",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const updated = await updateCustomerContact(req.user.jobberId, req.params.id, req.params.contactId, req.body || {});
    if (updated === undefined) return res.status(404).json({ error: "Customer not found" });
    if (updated === null) return res.status(404).json({ error: "Customer contact not found" });
    res.json(updated);
  })
);

app.delete(
  "/customers/:id/contacts/:contactId",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const deleted = await deleteCustomerContact(req.user.jobberId, req.params.id, req.params.contactId);
    if (deleted === undefined) return res.status(404).json({ error: "Customer not found" });
    if (!deleted) return res.status(404).json({ error: "Customer contact not found" });
    res.json({ ok: true });
  })
);

app.get(
  "/pricing/sources",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    res.json(
      await listPricingSources(req.user.jobberId, {
        pricingDate: req.query.pricingDate,
        sourceType: req.query.sourceType
      })
    );
  })
);

app.post(
  "/pricing/sources",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const created = await createPricingSource(req.user.jobberId, req.user.userId, req.body || {});
    res.status(201).json(created);
  })
);

app.get(
  "/pricing/sources/:id",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const snapshot = await getPricingSourceDetail(req.user.jobberId, req.params.id);
    if (!snapshot) return res.status(404).json({ error: "Pricing source not found" });
    res.json(snapshot);
  })
);

app.post(
  "/pricing/sources/:id/values",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const payloadValues = Array.isArray(req.body?.values) ? req.body.values : Array.isArray(req.body) ? req.body : null;
    const saved = await createPricingSourceValues(req.user.jobberId, req.params.id, payloadValues);
    if (saved === undefined) return res.status(404).json({ error: "Pricing source not found" });
    res.status(201).json(saved);
  })
);

app.get(
  "/pricing/taxes",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    res.json(
      await listPricingTaxes(req.user.jobberId, {
        productFamily: req.query.productFamily,
        effectiveDate: req.query.effectiveDate
      })
    );
  })
);

app.put(
  "/pricing/taxes",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const schedules = Array.isArray(req.body?.schedules) ? req.body.schedules : [req.body || {}];
    res.json(await savePricingTaxes(req.user.jobberId, req.user.userId, schedules));
  })
);

app.get(
  "/pricing/rules",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    res.json(
      await listPricingRules(req.user.jobberId, {
        productFamily: req.query.productFamily,
        status: req.query.status,
        effectiveDate: req.query.effectiveDate
      })
    );
  })
);

app.post(
  "/pricing/rules",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const created = await createPricingRule(req.user.jobberId, req.body || {});
    res.status(201).json(created);
  })
);

app.get(
  "/pricing/rules/:id",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const rule = await getPricingRuleDetail(req.user.jobberId, req.params.id);
    if (!rule) return res.status(404).json({ error: "Pricing rule not found" });
    res.json(rule);
  })
);

app.patch(
  "/pricing/rules/:id",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const updated = await updatePricingRule(req.user.jobberId, req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: "Pricing rule not found" });
    res.json(updated);
  })
);

app.delete(
  "/pricing/rules/:id",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const deleted = await deletePricingRule(req.user.jobberId, req.params.id);
    if (!deleted) return res.status(404).json({ error: "Pricing rule not found" });
    res.status(204).end();
  })
);

app.put(
  "/pricing/rules/:id/components",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const components = Array.isArray(req.body?.components) ? req.body.components : [];
    const saved = await savePricingRuleComponents(req.user.jobberId, req.params.id, components);
    if (saved === undefined) return res.status(404).json({ error: "Pricing rule not found" });
    res.json(saved);
  })
);

app.put(
  "/pricing/rules/:id/vendor-sets",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const vendorSets = Array.isArray(req.body?.vendorSets) ? req.body.vendorSets : [];
    const saved = await savePricingRuleVendorSets(req.user.jobberId, req.params.id, vendorSets);
    if (saved === undefined) return res.status(404).json({ error: "Pricing rule not found" });
    res.json(saved);
  })
);

app.post(
  "/pricing/runs/preview",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const customerId = pricingText(req.body?.customerId);
    if (!customerId) return res.status(400).json({ error: "customerId is required" });
    await refreshOpisSpotPricingSources({
      user: req.user,
      pricingDate: req.body?.pricingDate
    });
    await refreshOpisRackPricingSources({
      user: req.user,
      pricingDate: req.body?.pricingDate
    });
    const preview = await previewCustomerPricing({
      jobberId: req.user.jobberId,
      customerId,
      pricingDate: req.body?.pricingDate
    });
    if (!preview.customer) return res.status(404).json({ error: "Customer not found" });
    res.json(preview);
  })
);

app.post(
  "/pricing/runs",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const customerId = pricingText(req.body?.customerId) || null;
    await refreshOpisSpotPricingSources({
      user: req.user,
      pricingDate: req.body?.pricingDate
    });
    await refreshOpisRackPricingSources({
      user: req.user,
      pricingDate: req.body?.pricingDate
    });
    const result = await generateCustomerPricingRun({
      jobberId: req.user.jobberId,
      userId: req.user.userId,
      customerId,
      pricingDate: req.body?.pricingDate
    });
    if (customerId && result.outputs.length === 0 && result.incompleteCount === 0) {
      return res.status(404).json({ error: "Customer not found" });
    }
    res.json(result);
  })
);

app.get(
  "/pricing/runs/:date",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const pricingDate = pricingNullableDate(req.params.date);
    if (!pricingDate) return res.status(400).json({ error: "Valid pricing date is required" });
    const outputs = await listGeneratedCustomerPrices(req.user.jobberId, {
      pricingDate,
      customerId: req.query?.customerId,
      status: req.query?.status,
      limit: req.query?.limit
    });
    res.json({
      pricingDate,
      total: outputs.length,
      generatedCount: outputs.filter((item) => item.status !== "incomplete").length,
      incompleteCount: outputs.filter((item) => item.status === "incomplete").length,
      outputs
    });
  })
);

app.get(
  "/pricing/outputs",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    res.json(await listGeneratedCustomerPrices(req.user.jobberId, {
      pricingDate: req.query?.pricingDate,
      customerId: req.query?.customerId,
      status: req.query?.status,
      limit: req.query?.limit
    }));
  })
);

app.get(
  "/pricing/outputs/:id",
  requireAuth,
  requireRole("manager"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const output = await getGeneratedCustomerPriceDetail(req.user.jobberId, req.params.id);
    if (!output) return res.status(404).json({ error: "Generated output not found" });
    res.json(output);
  })
);

app.get(
  "/management/overview",
  requireAuth,
  requireJobberAdmin,
  asyncHandler(async (req, res) => {
    const overview = await managementOverviewForUser(req.user);
    if (overview.scope === "jobber" && !overview.jobber) return res.status(404).json({ error: "Jobber not found" });
    res.json(overview);
  })
);

app.post(
  "/management/users",
  requireAuth,
  requireJobberAdmin,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const role = normalizeManagedRole(body.role);
    const targetJobberId = req.user.role === "system_manager" ? String(body.jobberId || "").trim() : req.user.jobberId;
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim();
    const password = String(body.password || "").trim();
    const siteIds = Array.isArray(body.siteIds) ? [...new Set(body.siteIds.map(String))] : [];

    if (!name || !email || !password || !role || !targetJobberId) {
      return res.status(400).json({ error: "name, email, password, role, and jobberId are required" });
    }

    const allowedSites = await sitesForJobber(targetJobberId);
    const allowedSiteIds = new Set(allowedSites.map((site) => site.id));
    if (siteIds.some((siteId) => !allowedSiteIds.has(siteId))) {
      return res.status(400).json({ error: "One or more site assignments are outside this jobber" });
    }

    const existingEmail = await query(
      `SELECT id FROM users WHERE LOWER(email)=$1 LIMIT 1`,
      [email]
    );
    if (existingEmail.rowCount > 0) {
      return res.status(400).json({ error: "A user with that email already exists" });
    }

    const userId = id("user");
    const now = new Date().toISOString();

    await tx(async (client) => {
      await client.query(
        `INSERT INTO users(id, org_id, email, name, role, password, last_login_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [userId, req.user.orgId, email, name, "operator", password, null]
      );
      await client.query(
        `INSERT INTO user_jobber_roles(user_id, jobber_id, role, is_default, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [userId, targetJobberId, role, true, now, now]
      );
      for (const siteId of siteIds) {
        await client.query(
          `INSERT INTO user_site_assignments(user_id, site_id) VALUES ($1,$2)`,
          [userId, siteId]
        );
      }
    });

    const overview = await managementOverviewForUser(req.user);
    res.status(201).json(overview);
  })
);

app.patch(
  "/management/users/:id",
  requireAuth,
  requireJobberAdmin,
  asyncHandler(async (req, res) => {
    const currentMemberships = await membershipsForUser(req.params.id);
    const currentMembership = defaultMembership(currentMemberships);
    if (!currentMembership) return res.status(404).json({ error: "Managed user not found" });
    if (req.user.role !== "system_manager" && currentMembership.jobberId !== req.user.jobberId) {
      return res.status(404).json({ error: "Managed user not found" });
    }

    const managedUser = req.user.role === "system_manager"
      ? (await allManagedUsers()).find((user) => user.id === req.params.id)
      : await ensureManagedUserInJobber(req.user.jobberId, req.params.id);
    if (!managedUser) return res.status(404).json({ error: "Managed user not found" });

    const body = req.body || {};
    const role = body.role == null ? managedUser.role : normalizeManagedRole(body.role);
    const targetJobberId = req.user.role === "system_manager"
      ? String(body.jobberId || currentMembership.jobberId || "").trim()
      : req.user.jobberId;
    const email = body.email == null ? managedUser.email : String(body.email).trim().toLowerCase();
    const name = body.name == null ? managedUser.name : String(body.name).trim();
    const password = body.password == null ? "" : String(body.password).trim();
    const siteIds = Array.isArray(body.siteIds) ? [...new Set(body.siteIds.map(String))] : null;

    if (!name || !email || !role || !targetJobberId) {
      return res.status(400).json({ error: "name, email, role, and jobberId are required" });
    }

    const existingEmail = await query(
      `SELECT id FROM users WHERE LOWER(email)=$1 AND id<>$2 LIMIT 1`,
      [email, req.params.id]
    );
    if (existingEmail.rowCount > 0) {
      return res.status(400).json({ error: "A user with that email already exists" });
    }

    const allowedSites = await sitesForJobber(targetJobberId);
    const allowedSiteIds = new Set(allowedSites.map((site) => site.id));
    if (siteIds && siteIds.some((siteId) => !allowedSiteIds.has(siteId))) {
      return res.status(400).json({ error: "One or more site assignments are outside this jobber" });
    }

    await tx(async (client) => {
      if (password) {
        await client.query(
          `UPDATE users SET name=$1, email=$2, password=$3 WHERE id=$4`,
          [name, email, password, req.params.id]
        );
      } else {
        await client.query(
          `UPDATE users SET name=$1, email=$2 WHERE id=$3`,
          [name, email, req.params.id]
        );
      }

      await client.query(
        `UPDATE user_jobber_roles
         SET jobber_id=$1, role=$2, updated_at=$3
         WHERE user_id=$4 AND jobber_id=$5`,
        [targetJobberId, role, new Date().toISOString(), req.params.id, currentMembership.jobberId]
      );

      if (siteIds) {
        await client.query(`DELETE FROM user_site_assignments WHERE user_id=$1`, [req.params.id]);
        for (const siteId of siteIds) {
          await client.query(
            `INSERT INTO user_site_assignments(user_id, site_id) VALUES ($1,$2)`,
            [req.params.id, siteId]
          );
        }
      }
    });

    const overview = await managementOverviewForUser(req.user);
    res.json(overview);
  })
);

app.delete(
  "/management/users/:id",
  requireAuth,
  requireJobberAdmin,
  asyncHandler(async (req, res) => {
    const currentMemberships = await membershipsForUser(req.params.id);
    const currentMembership = defaultMembership(currentMemberships);
    if (!currentMembership) return res.status(404).json({ error: "Managed user not found" });
    if (req.user.role !== "system_manager" && currentMembership.jobberId !== req.user.jobberId) {
      return res.status(404).json({ error: "Managed user not found" });
    }
    if (req.user.userId === req.params.id) {
      return res.status(400).json({ error: "You cannot delete your own account" });
    }

    await tx(async (client) => {
      await client.query(`DELETE FROM user_site_assignments WHERE user_id=$1`, [req.params.id]);
      await client.query(`DELETE FROM user_jobber_roles WHERE user_id=$1`, [req.params.id]);
      await client.query(`DELETE FROM users WHERE id=$1`, [req.params.id]);
    });

    const overview = await managementOverviewForUser(req.user);
    res.json(overview);
  })
);

app.post(
  "/management/jobbers",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.role !== "system_manager") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const body = req.body || {};
    const jobberName = String(body.jobberName || "").trim();
    const oauthDomain = String(body.oauthDomain || "").trim().toLowerCase();
    const adminName = String(body.adminName || "").trim();
    const adminEmail = String(body.adminEmail || "").trim().toLowerCase();
    const adminPassword = String(body.adminPassword || "").trim();
    const logoUrl = String(body.logoUrl || "").trim();

    if (!jobberName || !adminName || !adminEmail || !adminPassword) {
      return res.status(400).json({ error: "jobberName, adminName, adminEmail, and adminPassword are required" });
    }

    const jobberId = id("jobber");
    const slug = slugify(jobberName);
    const adminUserId = id("user");
    const now = new Date().toISOString();

    const existingSlug = await query(`SELECT id FROM jobbers WHERE slug=$1 LIMIT 1`, [slug]);
    if (existingSlug.rowCount > 0) {
      return res.status(400).json({ error: "A jobber with a matching name already exists" });
    }

    const existingEmail = await query(`SELECT id FROM users WHERE LOWER(email)=$1 LIMIT 1`, [adminEmail]);
    if (existingEmail.rowCount > 0) {
      return res.status(400).json({ error: "A user with that email already exists" });
    }

    await tx(async (client) => {
      await client.query(
        `INSERT INTO jobbers(id, org_id, name, slug, oauth_domain, logo_url, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [jobberId, req.user.orgId, jobberName, slug, oauthDomain, logoUrl, now, now]
      );
      await client.query(
        `INSERT INTO users(id, org_id, email, name, role, password, last_login_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [adminUserId, req.user.orgId, adminEmail, adminName, "operator", adminPassword, null]
      );
      await client.query(
        `INSERT INTO user_jobber_roles(user_id, jobber_id, role, is_default, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [adminUserId, jobberId, "admin", true, now, now]
      );
    });

    const overview = await managementOverviewForUser(req.user);
    res.status(201).json(overview);
  })
);

app.get(
  "/sites",
  requireAuth,
  asyncHandler(async (req, res) => {
    const ids = await siteIdsForUser(req.user);
    const summaries = await summariesForSiteIds(ids);
    res.json(summaries);
  })
);

app.get(
  "/sites/:id",
  requireAuth,
  requireSiteAccess,
  asyncHandler(async (req, res) => {
    const summaries = await summariesForSiteIds([req.params.id]);
    if (!summaries.length) return res.status(404).json({ error: "Site not found" });

    const integration = await query(
      `SELECT
        site_id AS "siteId",
        atg_host AS "atgHost",
        atg_port AS "atgPort",
        atg_poll_interval_sec AS "atgPollIntervalSec",
        atg_timeout_sec AS "atgTimeoutSec",
        atg_retries AS "atgRetries",
        atg_stale_sec AS "atgStaleSec",
        pump_timeout_sec AS "pumpTimeoutSec",
        pump_keepalive_enabled AS "pumpKeepaliveEnabled",
        pump_reconnect_enabled AS "pumpReconnectEnabled",
        pump_stale_sec AS "pumpStaleSec"
       FROM site_integrations WHERE site_id=$1`,
      [req.params.id]
    );
    const tanks = await query(
      `SELECT
        id, site_id AS "siteId", atg_tank_id AS "atgTankId", label, product,
        capacity_liters AS "capacityLiters", active
      FROM tanks WHERE site_id=$1 ORDER BY atg_tank_id`,
      [req.params.id]
    );
    const pumps = await query(
      `SELECT id, site_id AS "siteId", pump_number AS "pumpNumber", label, active
       FROM pumps WHERE site_id=$1 ORDER BY pump_number`,
      [req.params.id]
    );

    res.json({
      ...summaries[0],
      integration: integration.rows[0] || null,
      tanks: tanks.rows,
      pumps: pumps.rows
    });
  })
);

app.post(
  "/sites",
  requireAuth,
  requireRole("manager", "service_tech"),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    if (!body.siteCode || !body.name) {
      return res.status(400).json({ error: "siteCode and name are required" });
    }
    const siteId = `site-${body.siteCode}`;
    const now = new Date().toISOString();

    const exists = await query("SELECT id FROM sites WHERE id=$1", [siteId]);
    if (exists.rowCount > 0) return res.status(400).json({ error: "Site already exists" });

    await query(
      `INSERT INTO sites(
        id, org_id, jobber_id, site_code, name, address, postal_code, region, lat, lon, timezone, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        siteId,
        req.user.orgId,
        req.user.jobberId,
        body.siteCode,
        body.name,
        body.address || "",
        body.postalCode || "",
        body.region || "",
        Number(body.lat || 0),
        Number(body.lon || 0),
        body.timezone || "America/New_York",
        now,
        now
      ]
    );

    await query(
      `INSERT INTO site_integrations(
        site_id, atg_host, atg_port, atg_poll_interval_sec, atg_timeout_sec, atg_retries, atg_stale_sec,
        pump_timeout_sec, pump_keepalive_enabled, pump_reconnect_enabled, pump_stale_sec
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [siteId, "", 10001, 60, 5, 3, 180, 5, true, true, 180]
    );

    await query(
      `INSERT INTO audit_log(
        id, org_id, user_id, site_id, entity_type, entity_id, action, before_json, after_json, reason, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`,
      [
        id("audit"),
        req.user.orgId,
        req.user.userId,
        siteId,
        "site",
        siteId,
        "create",
        null,
        JSON.stringify({ siteCode: body.siteCode, name: body.name }),
        body.reason || "",
        now
      ]
    );

    const created = await query(
      `SELECT id, site_code AS "siteCode", name, address, postal_code AS "postalCode", region, lat, lon
       FROM sites WHERE id=$1`,
      [siteId]
    );
    res.status(201).json(created.rows[0]);
  })
);

app.patch(
  "/sites/:id",
  requireAuth,
  requireSiteAccess,
  requireRole("manager", "service_tech"),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const now = new Date().toISOString();
    const current = await query(
      `SELECT id, name, address, postal_code AS "postalCode", region, lat, lon FROM sites WHERE id=$1`,
      [req.params.id]
    );
    if (current.rowCount === 0) return res.status(404).json({ error: "Site not found" });
    const before = current.rows[0];
    await query(
      `UPDATE sites SET
        name=$1, address=$2, postal_code=$3, region=$4, lat=$5, lon=$6, updated_at=$7
       WHERE id=$8`,
      [
        body.name ?? before.name,
        body.address ?? before.address,
        body.postalCode ?? before.postalCode,
        body.region ?? before.region,
        body.lat ?? before.lat,
        body.lon ?? before.lon,
        now,
        req.params.id
      ]
    );
    await query(
      `INSERT INTO audit_log(
        id, org_id, user_id, site_id, entity_type, entity_id, action, before_json, after_json, reason, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)`,
      [
        id("audit"),
        req.user.orgId,
        req.user.userId,
        req.params.id,
        "site",
        req.params.id,
        "update",
        JSON.stringify(before),
        JSON.stringify({
          name: body.name ?? before.name,
          address: body.address ?? before.address,
          postalCode: body.postalCode ?? before.postalCode,
          region: body.region ?? before.region,
          lat: body.lat ?? before.lat,
          lon: body.lon ?? before.lon
        }),
        body.reason || "",
        now
      ]
    );
    const updated = await query(
      `SELECT id, site_code AS "siteCode", name, address, postal_code AS "postalCode", region, lat, lon
       FROM sites WHERE id=$1`,
      [req.params.id]
    );
    res.json(updated.rows[0]);
  })
);

app.delete(
  "/sites/:id",
  requireAuth,
  requireSiteAccess,
  requireRole("manager", "service_tech"),
  asyncHandler(async (req, res) => {
    const current = await query(
      `SELECT id, site_code AS "siteCode", name FROM sites WHERE id=$1`,
      [req.params.id]
    );
    if (current.rowCount === 0) return res.status(404).json({ error: "Site not found" });

    await query("DELETE FROM user_site_assignments WHERE site_id=$1", [req.params.id]);
    await query("DELETE FROM sites WHERE id=$1", [req.params.id]);

    await query(
      `INSERT INTO audit_log(
        id, org_id, user_id, site_id, entity_type, entity_id, action, before_json, after_json, reason, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`,
      [
        id("audit"),
        req.user.orgId,
        req.user.userId,
        req.params.id,
        "site",
        req.params.id,
        "delete",
        JSON.stringify(current.rows[0]),
        null,
        "",
        new Date().toISOString()
      ]
    );

    res.json({ ok: true, deletedSiteId: req.params.id });
  })
);

app.get(
  "/sites/:id/integrations",
  requireAuth,
  requireSiteAccess,
  asyncHandler(async (req, res) => {
    const integration = await query(
      `SELECT
        site_id AS "siteId", atg_host AS "atgHost", atg_port AS "atgPort",
        atg_poll_interval_sec AS "atgPollIntervalSec", atg_timeout_sec AS "atgTimeoutSec",
        atg_retries AS "atgRetries", atg_stale_sec AS "atgStaleSec",
        pump_timeout_sec AS "pumpTimeoutSec", pump_keepalive_enabled AS "pumpKeepaliveEnabled",
        pump_reconnect_enabled AS "pumpReconnectEnabled", pump_stale_sec AS "pumpStaleSec"
       FROM site_integrations WHERE site_id=$1`,
      [req.params.id]
    );
    res.json(integration.rows[0] || null);
  })
);

app.patch(
  "/sites/:id/integrations",
  requireAuth,
  requireSiteAccess,
  requireRole("manager", "service_tech"),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const now = new Date().toISOString();
    const current = await query(
      `SELECT * FROM site_integrations WHERE site_id=$1`,
      [req.params.id]
    );
    if (current.rowCount === 0) return res.status(404).json({ error: "Integration not found" });
    const c = current.rows[0];
    await query(
      `UPDATE site_integrations SET
        atg_host=$1, atg_port=$2, atg_poll_interval_sec=$3, atg_timeout_sec=$4, atg_retries=$5,
        atg_stale_sec=$6, pump_timeout_sec=$7, pump_keepalive_enabled=$8,
        pump_reconnect_enabled=$9, pump_stale_sec=$10
      WHERE site_id=$11`,
      [
        body.atgHost ?? c.atg_host,
        body.atgPort ?? c.atg_port,
        body.atgPollIntervalSec ?? c.atg_poll_interval_sec,
        body.atgTimeoutSec ?? c.atg_timeout_sec,
        body.atgRetries ?? c.atg_retries,
        body.atgStaleSec ?? c.atg_stale_sec,
        body.pumpTimeoutSec ?? c.pump_timeout_sec,
        body.pumpKeepaliveEnabled ?? c.pump_keepalive_enabled,
        body.pumpReconnectEnabled ?? c.pump_reconnect_enabled,
        body.pumpStaleSec ?? c.pump_stale_sec,
        req.params.id
      ]
    );
    await query(
      `INSERT INTO audit_log(
        id, org_id, user_id, site_id, entity_type, entity_id, action, before_json, after_json, reason, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)`,
      [
        id("audit"),
        req.user.orgId,
        req.user.userId,
        req.params.id,
        "site_integrations",
        req.params.id,
        "update",
        JSON.stringify(c),
        JSON.stringify(body),
        body.reason || "",
        now
      ]
    );
    const updated = await query(
      `SELECT
        site_id AS "siteId", atg_host AS "atgHost", atg_port AS "atgPort",
        atg_poll_interval_sec AS "atgPollIntervalSec", atg_timeout_sec AS "atgTimeoutSec",
        atg_retries AS "atgRetries", atg_stale_sec AS "atgStaleSec",
        pump_timeout_sec AS "pumpTimeoutSec", pump_keepalive_enabled AS "pumpKeepaliveEnabled",
        pump_reconnect_enabled AS "pumpReconnectEnabled", pump_stale_sec AS "pumpStaleSec"
       FROM site_integrations WHERE site_id=$1`,
      [req.params.id]
    );
    res.json(updated.rows[0]);
  })
);

app.get(
  "/sites/:id/pumps",
  requireAuth,
  requireSiteAccess,
  asyncHandler(async (req, res) => {
    const pumps = await query(
      `SELECT id, site_id AS "siteId", pump_number AS "pumpNumber", label, active
       FROM pumps WHERE site_id=$1 ORDER BY pump_number`,
      [req.params.id]
    );
    const sides = await query(
      `SELECT id, pump_id AS "pumpId", side, ip, port, active
       FROM pump_sides WHERE pump_id = ANY($1::text[])`,
      [pumps.rows.map((p) => p.id)]
    );
    const sidesByPump = new Map();
    for (const side of sides.rows) {
      if (!sidesByPump.has(side.pumpId)) sidesByPump.set(side.pumpId, []);
      sidesByPump.get(side.pumpId).push(side);
    }
    res.json(pumps.rows.map((p) => ({ ...p, sides: sidesByPump.get(p.id) || [] })));
  })
);

app.post(
  "/sites/:id/pumps",
  requireAuth,
  requireSiteAccess,
  requireRole("manager", "service_tech"),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    if (body.pumpNumber == null || !body.label) {
      return res.status(400).json({ error: "pumpNumber and label are required" });
    }
    const now = new Date().toISOString();
    const pumpId = `pump-${req.params.id}-${body.pumpNumber}`;
    const exists = await query("SELECT id FROM pumps WHERE id=$1", [pumpId]);
    if (exists.rowCount > 0) return res.status(400).json({ error: "Pump already exists" });

    await query(
      `INSERT INTO pumps(id, site_id, pump_number, label, active) VALUES ($1,$2,$3,$4,$5)`,
      [pumpId, req.params.id, Number(body.pumpNumber), body.label, true]
    );
    for (const side of ["A", "B"]) {
      const cfg = body.sides?.[side] || {};
      await query(
        `INSERT INTO pump_sides(id, pump_id, side, ip, port, active) VALUES ($1,$2,$3,$4,$5,$6)`,
        [`ps-${pumpId}-${side.toLowerCase()}`, pumpId, side, cfg.ip || "", Number(cfg.port || 5201), true]
      );
    }

    await query(
      `INSERT INTO audit_log(
        id, org_id, user_id, site_id, entity_type, entity_id, action, before_json, after_json, reason, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`,
      [
        id("audit"),
        req.user.orgId,
        req.user.userId,
        req.params.id,
        "pump",
        pumpId,
        "create",
        null,
        JSON.stringify({ pumpNumber: body.pumpNumber, label: body.label }),
        body.reason || "",
        now
      ]
    );

    const created = await query(
      `SELECT id, site_id AS "siteId", pump_number AS "pumpNumber", label, active
       FROM pumps WHERE id=$1`,
      [pumpId]
    );
    res.status(201).json(created.rows[0]);
  })
);

app.patch(
  "/pumps/:id",
  requireAuth,
  requireRole("manager", "service_tech"),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const current = await query(
      `SELECT id, site_id AS "siteId", pump_number AS "pumpNumber", label, active
       FROM pumps WHERE id=$1`,
      [req.params.id]
    );
    if (current.rowCount === 0) return res.status(404).json({ error: "Pump not found" });
    const pump = current.rows[0];
    const allowed = await ensureSitePermission(req.user, pump.siteId);
    if (!allowed) return res.status(403).json({ error: "Forbidden" });

    await query(
      `UPDATE pumps SET pump_number=$1, label=$2, active=$3 WHERE id=$4`,
      [
        body.pumpNumber ?? pump.pumpNumber,
        body.label ?? pump.label,
        body.active ?? pump.active,
        req.params.id
      ]
    );

    for (const side of ["A", "B"]) {
      if (!body.sides?.[side]) continue;
      const existing = await query(
        `SELECT id FROM pump_sides WHERE pump_id=$1 AND side=$2`,
        [req.params.id, side]
      );
      if (existing.rowCount > 0) {
        await query(
          `UPDATE pump_sides SET ip=$1, port=$2 WHERE id=$3`,
          [body.sides[side].ip || "", Number(body.sides[side].port || 5201), existing.rows[0].id]
        );
      } else {
        await query(
          `INSERT INTO pump_sides(id, pump_id, side, ip, port, active) VALUES ($1,$2,$3,$4,$5,$6)`,
          [id("ps"), req.params.id, side, body.sides[side].ip || "", Number(body.sides[side].port || 5201), true]
        );
      }
    }

    const updated = await query(
      `SELECT id, site_id AS "siteId", pump_number AS "pumpNumber", label, active
       FROM pumps WHERE id=$1`,
      [req.params.id]
    );
    res.json(updated.rows[0]);
  })
);

app.delete(
  "/pumps/:id",
  requireAuth,
  requireRole("manager", "service_tech"),
  asyncHandler(async (req, res) => {
    const current = await query(
      `SELECT id, site_id AS "siteId" FROM pumps WHERE id=$1`,
      [req.params.id]
    );
    if (current.rowCount === 0) return res.status(404).json({ error: "Pump not found" });
    const allowed = await ensureSitePermission(req.user, current.rows[0].siteId);
    if (!allowed) return res.status(403).json({ error: "Forbidden" });

    await query("DELETE FROM pumps WHERE id=$1", [req.params.id]);
    res.json({ ok: true, deletedPumpId: req.params.id });
  })
);

app.get(
  "/sites/:id/tanks",
  requireAuth,
  requireSiteAccess,
  asyncHandler(async (req, res) => {
    const tanks = await query(
      `SELECT id, site_id AS "siteId", atg_tank_id AS "atgTankId", label, product,
              capacity_liters AS "capacityLiters", active
       FROM tanks WHERE site_id=$1 ORDER BY atg_tank_id`,
      [req.params.id]
    );
    res.json(tanks.rows);
  })
);

app.post(
  "/sites/:id/tanks",
  requireAuth,
  requireSiteAccess,
  requireRole("manager", "service_tech"),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    if (!body.atgTankId || !body.label || !body.product) {
      return res.status(400).json({ error: "atgTankId, label, product are required" });
    }
    const tankId = `tank-${req.params.id}-${body.atgTankId}`;
    await query(
      `INSERT INTO tanks(id, site_id, atg_tank_id, label, product, capacity_liters, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tankId, req.params.id, body.atgTankId, body.label, body.product, Number(body.capacityLiters || 0), true]
    );
    const created = await query(
      `SELECT id, site_id AS "siteId", atg_tank_id AS "atgTankId", label, product,
              capacity_liters AS "capacityLiters", active
       FROM tanks WHERE id=$1`,
      [tankId]
    );
    res.status(201).json(created.rows[0]);
  })
);

app.patch(
  "/tanks/:id",
  requireAuth,
  requireRole("manager", "service_tech"),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const current = await query(
      `SELECT id, site_id AS "siteId", atg_tank_id AS "atgTankId", label, product,
              capacity_liters AS "capacityLiters", active
       FROM tanks WHERE id=$1`,
      [req.params.id]
    );
    if (current.rowCount === 0) return res.status(404).json({ error: "Tank not found" });
    const tank = current.rows[0];
    const allowed = await ensureSitePermission(req.user, tank.siteId);
    if (!allowed) return res.status(403).json({ error: "Forbidden" });

    await query(
      `UPDATE tanks SET atg_tank_id=$1, label=$2, product=$3, capacity_liters=$4, active=$5 WHERE id=$6`,
      [
        body.atgTankId ?? tank.atgTankId,
        body.label ?? tank.label,
        body.product ?? tank.product,
        body.capacityLiters ?? tank.capacityLiters,
        body.active ?? tank.active,
        req.params.id
      ]
    );
    const updated = await query(
      `SELECT id, site_id AS "siteId", atg_tank_id AS "atgTankId", label, product,
              capacity_liters AS "capacityLiters", active
       FROM tanks WHERE id=$1`,
      [req.params.id]
    );
    res.json(updated.rows[0]);
  })
);

app.delete(
  "/tanks/:id",
  requireAuth,
  requireRole("manager", "service_tech"),
  asyncHandler(async (req, res) => {
    const current = await query(
      `SELECT id, site_id AS "siteId" FROM tanks WHERE id=$1`,
      [req.params.id]
    );
    if (current.rowCount === 0) return res.status(404).json({ error: "Tank not found" });
    const allowed = await ensureSitePermission(req.user, current.rows[0].siteId);
    if (!allowed) return res.status(403).json({ error: "Forbidden" });

    await query("DELETE FROM tanks WHERE id=$1", [req.params.id]);
    res.json({ ok: true, deletedTankId: req.params.id });
  })
);

app.get(
  "/sites/:id/layout",
  requireAuth,
  requireSiteAccess,
  asyncHandler(async (req, res) => {
    const layout = await query(
      `SELECT
         id, site_id AS "siteId", version, name, json, created_by AS "createdBy",
         created_at AS "createdAt", is_active AS "isActive"
       FROM forecourt_layouts
       WHERE site_id=$1 AND is_active=TRUE`,
      [req.params.id]
    );
    if (layout.rowCount === 0) return res.status(404).json({ error: "Layout not found" });
    res.json(layout.rows[0]);
  })
);

app.post(
  "/sites/:id/layout",
  requireAuth,
  requireSiteAccess,
  requireRole("manager", "service_tech"),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    if (!body.json) return res.status(400).json({ error: "json is required" });
    const now = new Date().toISOString();
    const maxVersion = await query(
      `SELECT COALESCE(MAX(version), 0)::int AS version FROM forecourt_layouts WHERE site_id=$1`,
      [req.params.id]
    );
    const nextVersion = maxVersion.rows[0].version + 1;
    const layoutId = `layout-${req.params.id}-v${nextVersion}`;
    await query(`UPDATE forecourt_layouts SET is_active=FALSE WHERE site_id=$1`, [req.params.id]);
    await query(
      `INSERT INTO forecourt_layouts(id, site_id, version, name, json, created_by, created_at, is_active)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
      [
        layoutId,
        req.params.id,
        nextVersion,
        body.name || `Layout v${nextVersion}`,
        JSON.stringify(body.json),
        req.user.userId,
        now,
        true
      ]
    );
    const created = await query(
      `SELECT
         id, site_id AS "siteId", version, name, json, created_by AS "createdBy",
         created_at AS "createdAt", is_active AS "isActive"
       FROM forecourt_layouts WHERE id=$1`,
      [layoutId]
    );
    res.status(201).json(created.rows[0]);
  })
);

app.get(
  "/sites/:id/allied-transactions/summary",
  requireAuth,
  requireSiteAccess,
  asyncHandler(async (req, res) => {
    const [siteResult, filterOptions, alliedData] = await Promise.all([
      query(
        `SELECT id, site_code AS "siteCode", name, timezone
         FROM sites
         WHERE id=$1`,
        [req.params.id]
      ),
      alliedFilterOptionsForSite(req.params.id),
      alliedRowsForFilters(req.params.id, req.query)
    ]);

    if (siteResult.rowCount === 0) {
      return res.status(404).json({ error: "Site not found" });
    }

    const rows = alliedData.rows;
    const completedRows = rows.filter((row) => alliedMetricStatusSet.has(row.emvStatus));
    const abortRows = rows.filter((row) => alliedAbortStatusSet.has(row.emvStatus));
    const contactlessRows = rows.filter((row) => row.entryMethod === "EmvContactless");
    const emvRows = rows.filter((row) => String(row.entryMethod).startsWith("Emv") || String(row.entryMethod).includes("Chip"));
    const presetCashRows = rows.filter((row) => row.paymentType === "Preset");
    const flaggedRows = rows.filter((row) => row.flagged);
    const sales = completedRows.reduce((sum, row) => sum + (toNumber(row.totalAmount, 0) || 0), 0);
    const gallons = completedRows.reduce((sum, row) => sum + (toNumber(row.fuelQuantityGallons, 0) || 0), 0);
    const cardMix = alliedDistribution(rows, "cardName");
    const denialMix = alliedDistribution(rows.filter((row) => row.tagDenialReason), "tagDenialReason");
    const seriesByDay = alliedSeriesByDay(rows);
    const issues = alliedIssues(rows, seriesByDay);
    const pumpHealth = alliedPumpHealth(rows);
    const ticketCompare = alliedCompareWindows(seriesByDay, (item) => item.averageTicket);
    const transactionCompare = alliedCompareWindows(seriesByDay, (item) => item.transactions);

    res.json({
      site: siteResult.rows[0],
      range: alliedData.range,
      filterOptions,
      kpis: {
        totalTransactions: rows.length,
        totalSales: Number(sales.toFixed(2)),
        totalGallons: Number(gallons.toFixed(3)),
        averageTicket: completedRows.length ? Number((sales / completedRows.length).toFixed(2)) : 0,
        averageGallonsPerSale: completedRows.length ? Number((gallons / completedRows.length).toFixed(3)) : 0,
        completionRate: rows.length ? Number((completedRows.length / rows.length).toFixed(4)) : 0,
        customerAbortRate: rows.length ? Number((abortRows.length / rows.length).toFixed(4)) : 0,
        contactlessShare: rows.length ? Number((contactlessRows.length / rows.length).toFixed(4)) : 0,
        emvShare: rows.length ? Number((emvRows.length / rows.length).toFixed(4)) : 0,
        presetCashCount: presetCashRows.length,
        presetCashShare: rows.length ? Number((presetCashRows.length / rows.length).toFixed(4)) : 0,
        topCardBrand: cardMix[0] || null,
        topDenialReason: denialMix[0] || null,
        suspiciousFlaggedCount: flaggedRows.length
      },
      trendComparisons: {
        transactions: transactionCompare,
        averageTicket: ticketCompare,
        aborts: alliedCompareWindows(seriesByDay, (item) => item.aborts),
        issues: alliedCompareWindows(seriesByDay, (item) => item.issues)
      },
      trends: {
        byDay: seriesByDay,
        paymentTypeMix: alliedDistribution(rows, "paymentType").slice(0, 8),
        cardTypeMix: alliedDistribution(rows, "cardType").slice(0, 8),
        cardBrandMix: cardMix.slice(0, 8),
        emvStatusDistribution: alliedDistribution(rows, "emvStatus").slice(0, 8),
        entryMethodDistribution: alliedDistribution(rows, "entryMethod").slice(0, 8),
        denialReasonDistribution: denialMix.slice(0, 8),
        topPumpsByVolume: [...pumpHealth].sort((a, b) => b.gallons - a.gallons).slice(0, 10),
        topPumpsByCount: [...pumpHealth].sort((a, b) => b.transactions - a.transactions).slice(0, 10)
      },
      issues,
      pumpHealth
    });
  })
);

app.get(
  "/sites/:id/allied-transactions",
  requireAuth,
  requireSiteAccess,
  asyncHandler(async (req, res) => {
    const { whereClause, params, range } = alliedFilterSql(req.query, req.params.id);
    const sort = alliedNormalizeSort(req.query.sortBy, req.query.sortDir);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(10, Number(req.query.pageSize) || 25));
    const offset = (page - 1) * pageSize;
    const flaggedOnly = req.query.minFlaggedOnly === "true";
    const flaggedClause = flaggedOnly
      ? ` AND (
          (emv_status IN ('Complete','Approved') AND COALESCE(total_amount, 0) <= 0)
          OR (emv_status IN ('Complete','Approved') AND COALESCE(fuel_quantity_gallons, 0) <= 0)
          OR (emv_status = 'CustomerAbort' AND (COALESCE(total_amount, 0) > 0 OR COALESCE(fuel_quantity_gallons, 0) > 0))
          OR (auth_amount IS NOT NULL AND total_amount IS NOT NULL AND auth_amount < total_amount)
          OR (emv_status IN ('Complete','Approved') AND COALESCE(fuel_position_id, '') = '')
          OR (COALESCE(first8, '') <> '' AND first8 !~ '^[0-9]{8}$')
          OR (COALESCE(last4, '') <> '' AND last4 !~ '^[0-9]{4}$')
          OR (COALESCE(exp_date, '') <> '' AND exp_date !~ '^[0-9]{2}/[0-9]{2}$')
        )`
      : "";

    const [countResult, rowsResult] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS count
         FROM allied_transactions
         WHERE ${whereClause}${flaggedClause}`,
        params
      ),
      query(
        `SELECT
          store_id || ':' || transaction_id AS id,
          store_id AS "siteId",
          transaction_id AS "transactionId",
          account_origin AS "accountOrigin",
          actual_sales_price AS "actualSalesPrice",
          auth_amount AS "authAmount",
          card_name AS "cardName",
          card_type AS "cardType",
          emv_error_code AS "emvErrorCode",
          emv_status AS "emvStatus",
          emv_tran_type AS "emvTranType",
          entry_method AS "entryMethod",
          exp_date AS "expDate",
          fallback_to_msr AS "fallbackToMsr",
          first8,
          fuel_description AS "fuelDescription",
          fuel_position_id AS "fuelPositionId",
          fuel_quantity_gallons AS "fuelQuantityGallons",
          last4,
          payment_type AS "paymentType",
          store_id AS "storeId",
          tag_denial_reason AS "tagDenialReason",
          "timestamp",
          timezone,
          total_amount AS "totalAmount"
         FROM allied_transactions
         WHERE ${whereClause}${flaggedClause}
         ORDER BY ${sort.key} ${sort.direction}, "timestamp" DESC
         LIMIT ${pageSize} OFFSET ${offset}`,
        params
      )
    ]);

    res.json({
      range,
      page,
      pageSize,
      total: countResult.rows[0]?.count || 0,
      rows: rowsResult.rows.map(alliedRowFromDb)
    });
  })
);

app.get(
  "/sites/:id/allied-transactions/export",
  requireAuth,
  requireSiteAccess,
  asyncHandler(async (req, res) => {
    const { rows } = await alliedRowsForFilters(req.params.id, req.query);
    const headers = [
      "timestamp",
      "transaction_id",
      "store_id",
      "fuel_position_id",
      "payment_type",
      "card_name",
      "card_type",
      "entry_method",
      "emv_tran_type",
      "emv_status",
      "emv_error_code",
      "tag_denial_reason",
      "fuel_quantity_gallons",
      "actual_sales_price",
      "total_amount",
      "auth_amount",
      "masked_pan",
      "flagged",
      "likely_transaction_type"
    ];
    const lines = [
      headers.join(","),
      ...rows.map((row) => [
        row.timestamp,
        row.transactionId,
        row.storeId,
        row.fuelPositionId,
        row.paymentType,
        row.cardName,
        row.cardType,
        row.entryMethod,
        row.emvTranType,
        row.emvStatus,
        row.emvErrorCode,
        row.tagDenialReason,
        row.fuelQuantityGallons,
        row.actualSalesPrice,
        row.totalAmount,
        row.authAmount,
        row.maskedPan,
        row.flagged,
        row.likelyTransactionType
      ].map(alliedTextCsv).join(","))
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"allied-transactions-${req.params.id}.csv\"`);
    res.send(lines.join("\n"));
  })
);

app.get(
  "/allied-transactions/portfolio-summary",
  requireAuth,
  asyncHandler(async (req, res) => {
    const visibleSiteIds = await siteIdsForUser(req.user);
    if (!visibleSiteIds.length) {
      return res.json({
        range: alliedDefaultDateRange(),
        kpis: {
          visibleSites: 0,
          sitesWithTransactions: 0,
          totalTransactions: 0,
          totalSales: 0,
          totalGallons: 0,
          completionRate: 0,
          abortRate: 0,
          flaggedRate: 0
        },
        trends: { byDay: [] },
        siteSummaries: []
      });
    }

    const [rowsPayload, visibleSites] = await Promise.all([
      alliedRowsForVisibleSites(visibleSiteIds, req.query),
      query(
        `SELECT id, site_code AS "siteCode", name, region
         FROM sites
         WHERE id = ANY($1::text[])
         ORDER BY site_code`,
        [visibleSiteIds]
      )
    ]);

    const rows = rowsPayload.rows;
    const bySite = new Map();
    for (const site of visibleSites.rows) {
      bySite.set(site.id, {
        siteId: site.id,
        siteCode: site.siteCode,
        siteName: site.name,
        region: site.region,
        totalTransactions: 0,
        totalSales: 0,
        totalGallons: 0,
        completedCount: 0,
        abortCount: 0,
        flaggedCount: 0,
        topDenialReason: null,
        topCardBrand: null
      });
    }

    for (const row of rows) {
      const bucket = bySite.get(row.storeId);
      if (!bucket) continue;
      bucket.totalTransactions += 1;
      bucket.totalSales += toNumber(row.totalAmount, 0) || 0;
      bucket.totalGallons += toNumber(row.fuelQuantityGallons, 0) || 0;
      if (alliedMetricStatusSet.has(row.emvStatus)) bucket.completedCount += 1;
      if (alliedAbortStatusSet.has(row.emvStatus)) bucket.abortCount += 1;
      if (row.flagged) bucket.flaggedCount += 1;
    }

    for (const bucket of bySite.values()) {
      const siteRows = rows.filter((row) => row.storeId === bucket.siteId);
      const denialMix = alliedDistribution(siteRows.filter((row) => row.tagDenialReason), "tagDenialReason");
      const cardMix = alliedDistribution(siteRows, "cardName");
      bucket.totalSales = Number(bucket.totalSales.toFixed(2));
      bucket.totalGallons = Number(bucket.totalGallons.toFixed(3));
      bucket.averageTicket = bucket.completedCount ? Number((bucket.totalSales / bucket.completedCount).toFixed(2)) : 0;
      bucket.completionRate = bucket.totalTransactions ? Number((bucket.completedCount / bucket.totalTransactions).toFixed(4)) : 0;
      bucket.abortRate = bucket.totalTransactions ? Number((bucket.abortCount / bucket.totalTransactions).toFixed(4)) : 0;
      bucket.flaggedRate = bucket.totalTransactions ? Number((bucket.flaggedCount / bucket.totalTransactions).toFixed(4)) : 0;
      bucket.topDenialReason = denialMix[0]?.label || "None";
      bucket.topCardBrand = cardMix[0]?.label || "-";
    }

    const siteSummaries = [...bySite.values()].sort((a, b) => b.totalSales - a.totalSales || b.totalTransactions - a.totalTransactions);
    const completedRows = rows.filter((row) => alliedMetricStatusSet.has(row.emvStatus));
    const abortRows = rows.filter((row) => alliedAbortStatusSet.has(row.emvStatus));
    const flaggedRows = rows.filter((row) => row.flagged);
    const totalSales = completedRows.reduce((sum, row) => sum + (toNumber(row.totalAmount, 0) || 0), 0);
    const totalGallons = completedRows.reduce((sum, row) => sum + (toNumber(row.fuelQuantityGallons, 0) || 0), 0);

    res.json({
      range: rowsPayload.range,
      kpis: {
        visibleSites: visibleSiteIds.length,
        sitesWithTransactions: siteSummaries.filter((site) => site.totalTransactions > 0).length,
        totalTransactions: rows.length,
        totalSales: Number(totalSales.toFixed(2)),
        totalGallons: Number(totalGallons.toFixed(3)),
        completionRate: rows.length ? Number((completedRows.length / rows.length).toFixed(4)) : 0,
        abortRate: rows.length ? Number((abortRows.length / rows.length).toFixed(4)) : 0,
        flaggedRate: rows.length ? Number((flaggedRows.length / rows.length).toFixed(4)) : 0
      },
      trends: {
        byDay: alliedSeriesByDay(rows)
      },
      siteSummaries
    });
  })
);

app.get(
  "/alerts",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { siteId, state, severity, component, pumpId, side } = req.query;
    const userSiteIds = await siteIdsForUser(req.user);
    if (!userSiteIds.length) return res.json([]);

    const conditions = ["site_id = ANY($1::text[])"];
    const params = [userSiteIds];
    let i = 2;
    if (siteId) {
      conditions.push(`site_id = $${i++}`);
      params.push(siteId);
    }
    if (state) {
      conditions.push(`state = $${i++}`);
      params.push(state);
    }
    if (severity) {
      conditions.push(`severity = $${i++}`);
      params.push(severity);
    }
    if (component) {
      conditions.push(`component = $${i++}`);
      params.push(component);
    }
    if (pumpId) {
      conditions.push(`pump_id = $${i++}`);
      params.push(pumpId);
    }
    if (side) {
      conditions.push(`side = $${i++}`);
      params.push(side);
    }

    const result = await query(
      `SELECT
        id, site_id AS "siteId", source_type AS "sourceType", tank_id AS "tankId", pump_id AS "pumpId",
        side, component, severity, state, event_at AS "eventAt", alert_type AS "alertType",
        alert_type_id AS "alertTypeId", reported_state AS "reportedState", code, message, raw_payload AS "rawPayload",
        raised_at AS "raisedAt", cleared_at AS "clearedAt", ack_at AS "ackAt",
        ack_by AS "ackBy", assigned_to AS "assignedTo", created_at AS "createdAt"
       FROM alarm_events
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT 500`,
      params
    );
    res.json(result.rows);
  })
);

app.post(
  "/alerts/:id/ack",
  requireAuth,
  asyncHandler(async (req, res) => {
    const now = new Date().toISOString();
    const userSiteIds = await siteIdsForUser(req.user);
    const target = await query("SELECT id, site_id AS \"siteId\" FROM alarm_events WHERE id=$1", [
      req.params.id
    ]);
    if (target.rowCount === 0) return res.status(404).json({ error: "Alert not found" });
    if (!userSiteIds.includes(target.rows[0].siteId)) return res.status(403).json({ error: "Forbidden" });

    const updated = await query(
      `UPDATE alarm_events
       SET state='acknowledged', ack_at=$1, ack_by=$2
       WHERE id=$3
       RETURNING
         id, site_id AS "siteId", source_type AS "sourceType", tank_id AS "tankId", pump_id AS "pumpId",
         side, component, severity, state, event_at AS "eventAt", alert_type AS "alertType",
         alert_type_id AS "alertTypeId", reported_state AS "reportedState", code, message, raw_payload AS "rawPayload",
         raised_at AS "raisedAt", cleared_at AS "clearedAt", ack_at AS "ackAt",
         ack_by AS "ackBy", assigned_to AS "assignedTo", created_at AS "createdAt"`,
      [now, req.user.userId, req.params.id]
    );
    res.json(updated.rows[0]);
  })
);

app.get(
  "/history/tanks",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { siteId, tankId, from, to, limit } = req.query;
    const userSiteIds = await siteIdsForUser(req.user);
    if (!userSiteIds.length) return res.json([]);
    const conditions = ["site_id = ANY($1::text[])"];
    const params = [userSiteIds];
    let i = 2;
    if (siteId) {
      conditions.push(`site_id = $${i++}`);
      params.push(siteId);
    }
    if (tankId) {
      conditions.push(`tank_id = $${i++}`);
      params.push(tankId);
    }
    if (from) {
      conditions.push(`ts >= $${i++}`);
      params.push(from);
    }
    if (to) {
      conditions.push(`ts <= $${i++}`);
      params.push(to);
    }
    const rowLimit = Math.min(10000, Math.max(100, Number(limit) || (tankId ? 2500 : 6000)));
    const rows = await query(
      `SELECT
         id, site_id AS "siteId", tank_id AS "tankId", ts, fuel_volume_l AS "fuelVolumeL",
         fuel_height_mm AS "fuelHeightMm", water_height_mm AS "waterHeightMm",
         temp_c AS "tempC", ullage_l AS "ullageL", raw_payload AS "rawPayload"
       FROM tank_measurements
       WHERE ${conditions.join(" AND ")}
       ORDER BY ts DESC
       LIMIT ${rowLimit}`,
      params
    );
    res.json(rows.rows);
  })
);


app.get(
  "/tank-information",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { siteId, tankId, product, from, to, refillOnly, limit } = req.query;
    const userSiteIds = await siteIdsForUser(req.user);
    if (!userSiteIds.length) return res.json([]);

    const conditions = ["r.site_id = ANY($1::text[])"];
    const params = [userSiteIds];
    let i = 2;

    if (siteId) {
      conditions.push(`r.site_id = $${i++}`);
      params.push(siteId);
    }
    if (tankId) {
      conditions.push(`r.tank_id = $${i++}`);
      params.push(tankId);
    }
    if (product) {
      conditions.push(`t.product = $${i++}`);
      params.push(product);
    }
    if (from) {
      conditions.push(`r.read_at >= $${i++}`);
      params.push(from);
    }
    if (to) {
      conditions.push(`r.read_at <= $${i++}`);
      params.push(to);
    }
    if (refillOnly === "true") {
      conditions.push("COALESCE(r.raw_payload::jsonb->>'event', 'drawdown') = 'delivery'");
    }

    const rowLimit = Math.min(10000, Math.max(100, Number(limit) || (tankId ? 2500 : 6000)));
    const result = await query(
      `WITH filtered AS (
        SELECT
          r.id,
          r.site_id AS "siteId",
          r.tank_id AS "tankId",
          s.site_code AS "siteCode",
          s.name AS "siteName",
          r.facility_name AS "facilityName",
          t.atg_tank_id AS "atgTankId",
          t.label AS "tankLabel",
          t.product,
          r.read_at AS "readAt",
          r.tank_capacity AS "tankCapacity",
          r.ullage,
          r.safe_ullage AS "safeUllage",
          r.volume,
          r.raw_payload AS "rawPayload"
        FROM atg_inventory_readings r
        JOIN sites s ON s.id = r.site_id
        JOIN tanks t ON t.id = r.tank_id
        WHERE ${conditions.join(" AND ")}
      ), ranked AS (
        SELECT
          filtered.*,
          LAG(volume) OVER (PARTITION BY "tankId" ORDER BY "readAt") AS "previousVolume"
        FROM filtered
      )
      SELECT
        id,
        "siteId",
        "tankId",
        "siteCode",
        "siteName",
        "facilityName",
        "atgTankId",
        "tankLabel",
        product,
        "readAt",
        "tankCapacity",
        ullage,
        "safeUllage",
        volume,
        ROUND((CASE WHEN "tankCapacity" > 0 THEN (volume / "tankCapacity") * 100 ELSE 0 END)::numeric, 1) AS "fillPercent",
        ROUND((volume - COALESCE("previousVolume", volume))::numeric, 2) AS "deltaVolume",
        COALESCE("rawPayload"::jsonb->>'event', 'drawdown') AS "eventType"
      FROM ranked
      ORDER BY "readAt" DESC
      LIMIT ${rowLimit}`,
      params
    );

    res.json(result.rows);
  })
);
app.get("/events", requireAuth, (req, res) => {
  const channels = (req.query.channels || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    Connection: "keep-alive",
    "Cache-Control": "no-cache"
  });
  res.write("\n");
  const cleanup = registerClient(res, channels);
  sendEvent(res, "connected", { ok: true, ts: new Date().toISOString() });
  req.on("close", cleanup);
});

app.get(
  "/audit",
  requireAuth,
  requireRole("manager", "service_tech"),
  asyncHandler(async (_req, res) => {
    const rowLimit = Math.min(10000, Math.max(100, Number(limit) || (tankId ? 2500 : 6000)));
    const rows = await query(
      `SELECT
        id, org_id AS "orgId", user_id AS "userId", site_id AS "siteId",
        entity_type AS "entityType", entity_id AS "entityId", action,
        before_json AS "beforeJson", after_json AS "afterJson", reason, created_at AS "createdAt"
       FROM audit_log ORDER BY created_at DESC LIMIT 300`
    );
    res.json(rows.rows);
  })
);

async function runSimulatorTick() {
  const now = new Date().toISOString();
  const sites = await query("SELECT id FROM sites");
  for (const site of sites.rows) {
    broadcast("site:update", {
      channel: `site:${site.id}:alerts`,
      siteId: site.id,
      ts: now
    });
  }
}

app.use((error, _req, res, _next) => {
  console.error(error);
  const statusCode = Number(error?.statusCode) || 500;
  res.status(statusCode).json({
    error: statusCode >= 500 ? "Internal server error" : error.message,
    detail: error.message
  });
});

async function start() {
  let dbReady = false;
  if (!hasDbConfig()) {
    console.error(
      "Postgres connection is missing. Set DATABASE_URL or PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE."
    );
  } else {
    await initDb();
    const seeded = await seedIfEmpty();
    if (seeded) {
      console.log("Database was empty; sample seed data inserted.");
    }
    dbReady = true;
  }

  if (dbReady) {
    setInterval(() => {
      runSimulatorTick().catch((error) => console.error("Simulator tick error:", error.message));
    }, 5000);
  }

  app.listen(port, () => {
    console.log(`petroleum-api listening on ${port} (dbReady=${dbReady})`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});








