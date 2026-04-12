const { query } = require("./db");

const DEFAULT_DTN_BASE_URL = "https://api.dtn.com";
const DEFAULT_RANGE_DAYS = 30;
const TERMINALS = [
  ["benicia_terminal", "Benicia Terminal", "Benicia", 38.0494, -122.1232, { regular: 3.586, premium: 3.872, diesel: 3.423 }],
  ["san_francisco_terminal", "San Francisco Rack", "San Francisco", 37.7412, -122.3826, { regular: 3.618, premium: 3.904, diesel: 3.455 }],
  ["stockton_terminal", "Stockton Terminal", "Stockton", 37.938, -121.2874, { regular: 3.541, premium: 3.828, diesel: 3.395 }],
  ["sacramento_terminal", "Sacramento Terminal", "Sacramento", 38.495, -121.555, { regular: 3.558, premium: 3.844, diesel: 3.404 }],
  ["san_jose_terminal", "San Jose Terminal", "San Jose", 37.3697, -121.901, { regular: 3.604, premium: 3.889, diesel: 3.446 }]
].map(([terminalId, terminalName, city, latitude, longitude, rackBase]) => ({
  terminalId, terminalName, city, state: "CA", latitude, longitude, rackBase
}));
const PRODUCTS = [
  { key: "regular", label: "Regular 87 CARB", code: "reg_87_carb", min: 7600, max: 9100, tank: 10000 },
  { key: "premium", label: "Premium 91 CARB", code: "premium_91_carb", min: 5200, max: 7600, tank: 8000 },
  { key: "diesel", label: "CARB ULSD", code: "diesel_carb_ulsd", min: 6800, max: 8800, tank: 10000 }
];
const SUPPLIERS = ["Valero", "Chevron", "Shell", "Marathon"];
const CARRIERS = ["Western Rock Transport", "Golden State Tank Lines", "Peninsula Petroleum Logistics", "Delta Fuel Carriers"];
const DRIVERS = ["J. Martinez", "R. Nguyen", "S. Patel", "T. Hernandez", "D. Kim", "A. Singh"];

function getDtnConfig() {
  return {
    apiKey: String(process.env.DTN_API_KEY || "").trim(),
    baseUrl: String(process.env.DTN_BASE_URL || DEFAULT_DTN_BASE_URL).replace(/\/$/, ""),
    accountId: String(process.env.DTN_ACCOUNT_ID || "").trim(),
    siteId: String(process.env.DTN_SITE_ID || "").trim()
  };
}

function hasDtnConfig() { return Boolean(getDtnConfig().apiKey); }
function toDateString(v) { const d = v instanceof Date ? v : new Date(v); return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10); }
function normalizeDateInput(v, fallback) { return toDateString(v) || fallback; }
function toNumber(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function toNullableNumber(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function normalizeText(v, fallback = "") { return String(v == null ? fallback : v).trim(); }
function normalizeStatus(v) { return normalizeText(v, "unknown").toLowerCase(); }
function money(v) { return Number(toNumber(v, 0).toFixed(2)); }
function pseudo(seed) { const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); }
function dtnCsv(v) { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s; }
function listFilter(v) { return String(v || "").split(",").map((item) => normalizeText(item)).filter(Boolean); }
function includesFilter(values, target) { return !values.length || values.includes(normalizeText(target)); }
function defaultDateRange() {
  const end = new Date();
  const start = new Date(end.getTime() - (DEFAULT_RANGE_DAYS - 1) * 86400000);
  return { startDate: toDateString(start), endDate: toDateString(end) };
}

function normalizeEbolRecord(ebol) {
  const loadDate = ebol.loadDate || ebol.load_date || ebol.createdAt || ebol.created_at || null;
  const deliveryDate = ebol.deliveryDate || ebol.delivery_date || null;
  const createdAt = ebol.createdAt || ebol.created_at || loadDate || null;
  const updatedAt = ebol.updatedAt || ebol.updated_at || deliveryDate || createdAt || null;
  const gallonsFilled = toNumber(ebol.quantity ?? ebol.gallons ?? ebol.gallonsFilled, 0);
  const gallonsCorrected = toNumber(ebol.correctedQuantity ?? ebol.corrected_gallons ?? ebol.gallonsCorrected, gallonsFilled);
  const pricePerGallon = toNumber(ebol.price ?? ebol.pricePerGallon, 0);
  const totalCost = toNumber(ebol.totalPrice ?? ebol.total_cost ?? ebol.totalCost, pricePerGallon * gallonsCorrected);
  const truckingCost = toNumber(ebol.truckingCost ?? ebol.trucking_cost, 0);
  const taxAmount = toNumber(ebol.tax ?? ebol.taxAmount, 0);
  return {
    bolNumber: normalizeText(ebol.bolNumber || ebol.bol_number || ebol.reference || ebol.id || ""),
    bolId: normalizeText(ebol.id || ebol.bolId || ""),
    loadDate, deliveryDate, createdAt, updatedAt,
    supplier: normalizeText(ebol.supplier || ebol.supplierName || "Unknown supplier"),
    supplierId: normalizeText(ebol.supplierId || ""),
    productType: normalizeText(ebol.productType || ebol.product_type || ebol.productName || "Unknown product"),
    productName: normalizeText(ebol.productName || ebol.productType || "Unknown product"),
    productCode: normalizeText(ebol.productCode || ""),
    gallonsFilled, gallonsCorrected,
    tankLabel: normalizeText(ebol.tankLabel || ebol.tank_name || ""),
    startGaugeReading: toNullableNumber(ebol.startGaugeReading || ebol.start_gauge),
    endGaugeReading: toNullableNumber(ebol.endGaugeReading || ebol.end_gauge),
    tankCapacity: toNullableNumber(ebol.tankCapacity || ebol.tank_capacity),
    terminalId: normalizeText(ebol.terminalId || ebol.terminal_id || ""),
    terminalName: normalizeText(ebol.terminalName || ebol.terminal_name || "Unknown terminal"),
    terminalCity: normalizeText(ebol.terminalCity || ebol.terminal_city || ""),
    terminalState: normalizeText(ebol.terminalState || ebol.terminal_state || ""),
    terminalLocation: normalizeText(ebol.terminalLocation || ebol.location || ""),
    destinationSiteId: normalizeText(ebol.destinationSiteId || ebol.siteId || ""),
    destinationSiteCode: normalizeText(ebol.destinationSiteCode || ebol.siteCode || ""),
    destinationSiteName: normalizeText(ebol.destinationSiteName || ebol.siteName || ""),
    destinationAddress: normalizeText(ebol.destinationAddress || ""),
    destinationLat: toNullableNumber(ebol.destinationLat),
    destinationLon: toNullableNumber(ebol.destinationLon),
    pricePerGallon, totalCost: money(totalCost), truckingCost: money(truckingCost), taxAmount: money(taxAmount),
    totalWithFees: money(totalCost + truckingCost + taxAmount),
    currency: normalizeText(ebol.currency || "USD"),
    carrierName: normalizeText(ebol.carrierName || ebol.carrier || ""),
    carrierId: normalizeText(ebol.carrierId || ""),
    driverName: normalizeText(ebol.driverName || ebol.driver || ""),
    driverId: normalizeText(ebol.driverId || ""),
    vehicleNumber: normalizeText(ebol.vehicleNumber || ebol.truck_number || ""),
    status: normalizeStatus(ebol.status),
    trackingNumber: normalizeText(ebol.trackingNumber || ebol.tracking_number || ""),
    notes: normalizeText(ebol.notes || ebol.comments || ""),
    reference: normalizeText(ebol.reference || ebol.po_number || "")
  };
}

async function dtnRequest(path, queryParams = {}) {
  const config = getDtnConfig();
  if (!config.apiKey) {
    const error = new Error("DTN_API_KEY is missing. Configure DTN_API_KEY to enable eBOL data.");
    error.statusCode = 503;
    throw error;
  }
  const url = new URL(`${config.baseUrl}${path}`);
  Object.entries(queryParams).forEach(([k, v]) => v !== "" && v != null && url.searchParams.set(k, String(v)));
  const response = await fetch(url, { headers: { apikey: config.apiKey, Accept: "application/json", "Content-Type": "application/json" } });
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(text || `DTN request failed with status ${response.status}.`);
    error.statusCode = response.status >= 500 ? 502 : response.status;
    throw error;
  }
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

function radians(v) { return (v * Math.PI) / 180; }
function miles(aLat, aLon, bLat, bLon) {
  const r = 3958.8;
  const dLat = radians(bLat - aLat);
  const dLon = radians(bLon - aLon);
  const lat1 = radians(aLat);
  const lat2 = radians(bLat);
  const hav = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return r * (2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav)));
}

async function getCaliforniaSites() {
  const result = await query(
    `SELECT id, site_code AS "siteCode", name, address, postal_code AS "postalCode", region, lat, lon, timezone
     FROM sites
     WHERE region ILIKE '%California%' OR address ILIKE '%, CA%'
     ORDER BY site_code`,
    []
  );
  const sites = result.rows.map((row) => ({ ...row, lat: toNumber(row.lat, 37.7749), lon: toNumber(row.lon, -122.4194), tanks: [] }));
  const siteIds = sites.map((site) => site.id);
  if (!siteIds.length) return sites;
  const tankRows = await query(
    `SELECT site_id AS "siteId", label, product, capacity_liters AS "capacityLiters"
     FROM tanks
     WHERE site_id = ANY($1::text[])
     ORDER BY site_id, label`,
    [siteIds]
  );
  const tanksBySite = new Map();
  for (const row of tankRows.rows) {
    if (!tanksBySite.has(row.siteId)) tanksBySite.set(row.siteId, []);
    tanksBySite.get(row.siteId).push(row);
  }
  return sites.map((site) => ({ ...site, tanks: tanksBySite.get(site.id) || [] }));
}

function closestTerminal(site) {
  let match = TERMINALS[0];
  let best = Infinity;
  for (const terminal of TERMINALS) {
    const distance = miles(site.lat, site.lon, terminal.latitude, terminal.longitude);
    if (distance < best) {
      match = terminal;
      best = distance;
    }
  }
  return { terminal: match, distance: best };
}

function demoTerminalDetails() {
  return TERMINALS.map((t) => ({
    terminalId: t.terminalId,
    terminalName: t.terminalName,
    address: `${t.city}, CA`,
    city: t.city,
    state: "CA",
    postalCode: "",
    country: "USA",
    latitude: t.latitude,
    longitude: t.longitude,
    status: t.terminalId === "san_francisco_terminal" ? "limited" : "open",
    phone: "800-555-0100",
    lastUpdated: new Date().toISOString(),
    prices: PRODUCTS.map((p) => ({ product: p.label, pricePerGallon: Number(t.rackBase[p.key].toFixed(4)), currency: "USD", updatedAt: new Date().toISOString() }))
  }));
}

function demoStatus(index, random) {
  if (index % 11 === 0) return "reconciled";
  if (index % 7 === 0) return "pending";
  if (index % 13 === 0 && random > 0.7) return "received";
  return "approved";
}

function makeDemoRecord(site, terminalInfo, siteIndex, recordIndex, dayOffset) {
  const product = PRODUCTS[(siteIndex + recordIndex) % PRODUCTS.length];
  const random = pseudo((siteIndex + 1) * 100 + recordIndex);
  const supplier = SUPPLIERS[(siteIndex + recordIndex) % SUPPLIERS.length];
  const gallonsFilled = Math.round((product.min + random * (product.max - product.min)) * 10) / 10;
  const gallonsCorrected = Math.round((gallonsFilled - (8 + random * 18)) * 10) / 10;
  const supplierAdjust = { Valero: 0, Chevron: 0.014, Shell: 0.022, Marathon: 0.01 }[supplier] || 0;
  const freight = 0.082 + terminalInfo.distance * 0.0014 + random * 0.024;
  const pricePerGallon = Number((terminalInfo.terminal.rackBase[product.key] + supplierAdjust + freight).toFixed(4));
  const totalCost = money(gallonsCorrected * pricePerGallon);
  const truckingCost = money(terminalInfo.distance * 4.25 + 165 + random * 75);
  const taxAmount = money(product.key === "diesel" ? gallonsCorrected * 0.078 : gallonsCorrected * 0.064);
  const loadDate = new Date(Date.now() - dayOffset * 86400000 - (siteIndex * 37 + recordIndex * 53) * 60000);
  const deliveryDate = new Date(loadDate.getTime() + (75 + terminalInfo.distance * 1.6) * 60000);
  const matchingTanks = site.tanks.filter((tank) => String(tank.product || "").toLowerCase().includes(product.key === "diesel" ? "diesel" : product.key));
  const selectedTank = matchingTanks[recordIndex % Math.max(1, matchingTanks.length)] || site.tanks[recordIndex % Math.max(1, site.tanks.length)] || null;
  const startGaugeReading = Math.round((((selectedTank?.capacityLiters || product.tank) * (0.14 + random * 0.18))) * 10) / 10;
  const tankCapacity = toNumber(selectedTank?.capacityLiters, product.tank);
  return normalizeEbolRecord({
    bolNumber: `BOL-${site.siteCode}-${toDateString(loadDate).replace(/-/g, "")}-${String(recordIndex + 1).padStart(2, "0")}`,
    bolId: `${site.id}-${recordIndex + 1}`,
    loadDate: loadDate.toISOString(),
    deliveryDate: deliveryDate.toISOString(),
    createdAt: new Date(loadDate.getTime() + 600000).toISOString(),
    updatedAt: new Date(deliveryDate.getTime() + 1800000).toISOString(),
    supplier,
    supplierId: supplier.toLowerCase(),
    productType: product.key,
    productName: product.label,
    productCode: product.code,
    gallonsFilled,
    gallonsCorrected,
    startGaugeReading,
    endGaugeReading: Math.min(tankCapacity, Math.round((startGaugeReading + gallonsCorrected) * 10) / 10),
    tankCapacity,
    tankLabel: selectedTank?.label || `${product.label} Tank`,
    terminalId: terminalInfo.terminal.terminalId,
    terminalName: terminalInfo.terminal.terminalName,
    terminalCity: terminalInfo.terminal.city,
    terminalState: "CA",
    terminalLocation: `${terminalInfo.terminal.city}, CA`,
    destinationSiteId: site.id,
    destinationSiteCode: site.siteCode,
    destinationSiteName: site.name,
    destinationAddress: site.address,
    destinationLat: site.lat,
    destinationLon: site.lon,
    pricePerGallon,
    totalCost,
    truckingCost,
    taxAmount,
    totalWithFees: money(totalCost + truckingCost + taxAmount),
    currency: "USD",
    carrierName: CARRIERS[(siteIndex + recordIndex * 2) % CARRIERS.length],
    carrierId: `carrier-${siteIndex}-${recordIndex}`,
    driverName: DRIVERS[(siteIndex + recordIndex * 3) % DRIVERS.length],
    driverId: `driver-${siteIndex}-${recordIndex}`,
    vehicleNumber: `TK-${String(110 + siteIndex).padStart(3, "0")}`,
    status: demoStatus(recordIndex, random),
    trackingNumber: `TRK-${site.siteCode}-${String(recordIndex + 1).padStart(3, "0")}`,
    notes: `Demo load for California site ${site.siteCode} into ${selectedTank?.label || product.label} from ${terminalInfo.terminal.terminalName}.`,
    reference: `SITE-${site.siteCode}`
  });
}

async function fetchDemoRecords(filters = {}) {
  const defaults = defaultDateRange();
  const startDate = normalizeDateInput(filters.startDate, defaults.startDate);
  const endDate = normalizeDateInput(filters.endDate, defaults.endDate);
  const statuses = listFilter(filters.status).map((item) => normalizeStatus(item));
  const terminalIds = listFilter(filters.terminalId);
  const supplierIds = listFilter(filters.supplierId);
  const siteIds = listFilter(filters.siteId);
  const startMs = new Date(`${startDate}T00:00:00-08:00`).getTime();
  const endMs = new Date(`${endDate}T23:59:59-08:00`).getTime();
  const sites = await getCaliforniaSites();
  const records = [];
  for (let siteIndex = 0; siteIndex < sites.length; siteIndex += 1) {
    const terminalInfo = closestTerminal(sites[siteIndex]);
    const loadsPerSite = 4 + (siteIndex % 3);
    for (let recordIndex = 0; recordIndex < loadsPerSite; recordIndex += 1) {
      const record = makeDemoRecord(sites[siteIndex], terminalInfo, siteIndex, recordIndex, (siteIndex * 2 + recordIndex * 5) % DEFAULT_RANGE_DAYS);
      const loadMs = new Date(record.loadDate || record.createdAt).getTime();
      if (loadMs < startMs || loadMs > endMs) continue;
      records.push(record);
    }
  }
  return records.filter((record) => {
    if (statuses.length && !statuses.includes(record.status)) return false;
    if (!includesFilter(terminalIds, record.terminalId)) return false;
    if (!includesFilter(supplierIds, record.supplier)) return false;
    if (siteIds.length && !siteIds.includes(record.destinationSiteId) && !siteIds.includes(record.destinationSiteCode)) return false;
    return true;
  });
}

async function fetchEbolRecords(filters = {}) {
  if (!hasDtnConfig()) return fetchDemoRecords(filters);
  const defaults = defaultDateRange();
  const config = getDtnConfig();
  const statuses = listFilter(filters.status).map((item) => normalizeStatus(item));
  const terminalIds = listFilter(filters.terminalId);
  const supplierIds = listFilter(filters.supplierId);
  const siteIds = listFilter(filters.siteId);
  const payload = await dtnRequest("/fuel-admin/ebols", {
    startDate: normalizeDateInput(filters.startDate, defaults.startDate),
    endDate: normalizeDateInput(filters.endDate, defaults.endDate),
    status: statuses.length === 1 ? statuses[0] : "",
    terminalId: terminalIds.length === 1 ? terminalIds[0] : "",
    supplierId: supplierIds.length === 1 ? supplierIds[0] : "",
    limit: filters.limit || 1000,
    siteId: siteIds.length === 1 ? siteIds[0] : config.siteId || "",
    accountId: filters.accountId || config.accountId || ""
  });
  return (payload?.ebols || payload?.data || []).map(normalizeEbolRecord).filter((record) => {
    if (statuses.length && !statuses.includes(record.status)) return false;
    if (!includesFilter(terminalIds, record.terminalId)) return false;
    if (!includesFilter(supplierIds, record.supplier)) return false;
    if (siteIds.length && !siteIds.includes(record.destinationSiteId) && !siteIds.includes(record.destinationSiteCode)) return false;
    return true;
  });
}

function buildDemoStatusHistory(record) {
  const loadMs = new Date(record.loadDate || record.createdAt).getTime();
  const history = [{ status: "received", at: new Date(loadMs + 18 * 60000).toISOString(), by: "Terminal Intake", note: `Lift confirmed for site ${record.destinationSiteCode}` }];
  if (["pending", "approved", "reconciled"].includes(record.status)) history.push({ status: "pending", at: new Date(loadMs + 62 * 60000).toISOString(), by: "Dispatch Review", note: "Waiting on delivered gallons and terminal confirmation." });
  if (["approved", "reconciled"].includes(record.status)) history.push({ status: "approved", at: new Date(loadMs + 2.7 * 3600000).toISOString(), by: "Fuel Accounting", note: "Matched against terminal ticket, trucking fee, and delivery receipt." });
  if (record.status === "reconciled") history.push({ status: "reconciled", at: new Date(loadMs + 20 * 3600000).toISOString(), by: "Month-End Close", note: "Closed into monthly supplier and terminal reconciliation." });
  return history;
}

async function fetchEbolStatus(bolNumber, filters = {}) {
  if (!hasDtnConfig()) {
    const record = (await fetchDemoRecords(filters)).find((item) => item.bolNumber === bolNumber);
    if (!record) {
      const error = new Error("eBOL not found");
      error.statusCode = 404;
      throw error;
    }
    const history = buildDemoStatusHistory(record);
    return {
      bolNumber,
      currentStatus: record.status,
      receivedAt: history.find((item) => item.status === "received")?.at || null,
      approvedAt: history.find((item) => item.status === "approved")?.at || null,
      reconciledAt: history.find((item) => item.status === "reconciled")?.at || null,
      rejectedAt: null,
      approvedBy: history.find((item) => item.status === "approved")?.by || "",
      rejectionReason: "",
      lastUpdated: history[history.length - 1]?.at || record.updatedAt || record.deliveryDate,
      statusHistory: history
    };
  }
  const config = getDtnConfig();
  const payload = await dtnRequest(`/fuel-admin/ebols/${encodeURIComponent(bolNumber)}/status`, { siteId: config.siteId || "" });
  return {
    bolNumber,
    currentStatus: normalizeStatus(payload?.status || payload?.currentStatus),
    receivedAt: payload?.receivedAt || null,
    approvedAt: payload?.approvedAt || null,
    reconciledAt: payload?.reconciledAt || payload?.reconciliedAt || null,
    rejectedAt: payload?.rejectedAt || null,
    approvedBy: normalizeText(payload?.approvedBy || ""),
    rejectionReason: normalizeText(payload?.rejectionReason || ""),
    lastUpdated: payload?.lastUpdated || null,
    statusHistory: Array.isArray(payload?.statusHistory) ? payload.statusHistory.map((item) => ({ status: normalizeStatus(item.status || item.state), at: item.at || item.timestamp || item.updatedAt || null, by: normalizeText(item.by || item.user || ""), note: normalizeText(item.note || item.reason || "") })) : []
  };
}

async function fetchTerminalPricing(terminalId) {
  if (!hasDtnConfig()) return demoTerminalDetails().find((item) => item.terminalId === terminalId) || null;
  const payload = await dtnRequest("/energy/racks/prices", { terminal: terminalId, products: "diesel,gasoline,biodiesel,ethanol" });
  const prices = Array.isArray(payload?.prices) ? payload.prices : Array.isArray(payload?.data?.prices) ? payload.data.prices : [];
  return {
    terminalId,
    terminalName: normalizeText(payload?.terminalName || payload?.name || payload?.terminal?.name || terminalId),
    address: normalizeText(payload?.address || payload?.terminal?.address || ""),
    city: normalizeText(payload?.city || payload?.terminal?.city || ""),
    state: normalizeText(payload?.state || payload?.terminal?.state || ""),
    postalCode: normalizeText(payload?.postalCode || payload?.terminal?.postalCode || ""),
    country: normalizeText(payload?.country || "USA"),
    latitude: toNullableNumber(payload?.latitude || payload?.terminal?.latitude),
    longitude: toNullableNumber(payload?.longitude || payload?.terminal?.longitude),
    status: normalizeText(payload?.status || payload?.terminal?.status || "unknown"),
    phone: normalizeText(payload?.phone || payload?.terminal?.phone || ""),
    lastUpdated: payload?.updatedAt || payload?.lastUpdated || new Date().toISOString(),
    prices: prices.map((item) => ({ product: normalizeText(item.product || item.productName || item.code || "Unknown"), pricePerGallon: toNumber(item.pricePerGallon ?? item.price ?? item.value, 0), currency: normalizeText(item.currency || "USD"), updatedAt: item.updatedAt || item.timestamp || payload?.updatedAt || new Date().toISOString() }))
  };
}

function aggregateByStatus(records) {
  const buckets = new Map();
  for (const record of records) {
    const status = record.status || "unknown";
    if (!buckets.has(status)) buckets.set(status, { status, count: 0, gallons: 0, totalCost: 0 });
    const bucket = buckets.get(status);
    bucket.count += 1;
    bucket.gallons += record.gallonsCorrected;
    bucket.totalCost += record.totalWithFees;
  }
  return [...buckets.values()].map((item) => ({ ...item, gallons: Number(item.gallons.toFixed(2)), totalCost: money(item.totalCost) })).sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));
}

function aggregateBySupplier(records) {
  const buckets = new Map();
  for (const record of records) {
    const key = record.supplier || "Unknown supplier";
    if (!buckets.has(key)) buckets.set(key, { supplier: key, loads: 0, gallons: 0, totalCost: 0, truckingCost: 0 });
    const bucket = buckets.get(key);
    bucket.loads += 1;
    bucket.gallons += record.gallonsCorrected;
    bucket.totalCost += record.totalCost;
    bucket.truckingCost += record.truckingCost;
  }
  return [...buckets.values()].map((item) => ({ ...item, gallons: Number(item.gallons.toFixed(2)), totalCost: money(item.totalCost), truckingCost: money(item.truckingCost), avgPricePerGallon: item.gallons > 0 ? Number((item.totalCost / item.gallons).toFixed(4)) : 0 })).sort((a, b) => b.totalCost - a.totalCost || b.loads - a.loads);
}

function aggregateByDay(records) {
  const buckets = new Map();
  for (const record of records) {
    const date = toDateString(record.loadDate || record.createdAt) || "unknown";
    if (!buckets.has(date)) buckets.set(date, { date, loads: 0, gallons: 0, totalCost: 0, truckingCost: 0 });
    const bucket = buckets.get(date);
    bucket.loads += 1;
    bucket.gallons += record.gallonsCorrected;
    bucket.totalCost += record.totalCost;
    bucket.truckingCost += record.truckingCost;
  }
  return [...buckets.values()].map((item) => ({ ...item, gallons: Number(item.gallons.toFixed(2)), totalCost: money(item.totalCost), truckingCost: money(item.truckingCost) })).sort((a, b) => a.date.localeCompare(b.date));
}

function aggregateByMonth(records) {
  const buckets = new Map();
  for (const record of records) {
    const month = (toDateString(record.loadDate || record.createdAt) || "unknown").slice(0, 7);
    if (!buckets.has(month)) buckets.set(month, { month, loads: 0, gallons: 0, totalCost: 0, truckingCost: 0 });
    const bucket = buckets.get(month);
    bucket.loads += 1;
    bucket.gallons += record.gallonsCorrected;
    bucket.totalCost += record.totalCost;
    bucket.truckingCost += record.truckingCost;
  }
  return [...buckets.values()].map((item) => ({ ...item, gallons: Number(item.gallons.toFixed(2)), totalCost: money(item.totalCost), truckingCost: money(item.truckingCost) })).sort((a, b) => a.month.localeCompare(b.month));
}

function buildTerminalSummaries(records, terminalDetails) {
  const buckets = new Map();
  for (const record of records) {
    const key = record.terminalId || record.terminalName;
    if (!buckets.has(key)) buckets.set(key, { terminalId: record.terminalId, terminalName: record.terminalName, city: record.terminalCity, state: record.terminalState, loads: 0, gallons: 0, totalCost: 0 });
    const bucket = buckets.get(key);
    bucket.loads += 1;
    bucket.gallons += record.gallonsCorrected;
    bucket.totalCost += record.totalCost;
  }
  const detailsById = new Map(terminalDetails.map((item) => [item.terminalId, item]));
  return [...buckets.values()].map((item) => {
    const live = item.terminalId ? detailsById.get(item.terminalId) : null;
    return { ...item, gallons: Number(item.gallons.toFixed(2)), totalCost: money(item.totalCost), avgPricePerGallon: item.gallons > 0 ? Number((item.totalCost / item.gallons).toFixed(4)) : 0, address: live?.address || "", postalCode: live?.postalCode || "", country: live?.country || "USA", latitude: live?.latitude ?? null, longitude: live?.longitude ?? null, terminalStatus: live?.status || "unknown", livePrices: live?.prices || [] };
  }).sort((a, b) => b.totalCost - a.totalCost || b.loads - a.loads);
}

function buildSiteSummaries(records) {
  const buckets = new Map();
  for (const record of records) {
    const key = record.destinationSiteId || record.destinationSiteCode || record.destinationSiteName;
    if (!buckets.has(key)) buckets.set(key, { siteId: record.destinationSiteId, siteCode: record.destinationSiteCode, siteName: record.destinationSiteName, address: record.destinationAddress, lat: record.destinationLat, lon: record.destinationLon, loads: 0, gallons: 0, totalCost: 0, pendingCount: 0, productMix: new Set(), tankLabels: new Set() });
    const bucket = buckets.get(key);
    bucket.loads += 1;
    bucket.gallons += record.gallonsCorrected;
    bucket.totalCost += record.totalCost;
    if (record.status === "pending" || record.status === "received") bucket.pendingCount += 1;
    if (record.productName) bucket.productMix.add(record.productName);
    if (record.tankLabel) bucket.tankLabels.add(record.tankLabel);
  }
  return [...buckets.values()].map((item) => ({ ...item, gallons: Number(item.gallons.toFixed(2)), totalCost: money(item.totalCost), productMix: [...item.productMix], tankLabels: [...item.tankLabels] })).sort((a, b) => b.loads - a.loads || a.siteCode.localeCompare(b.siteCode));
}

function buildMonthlyComparisons(monthlySeries, terminalSummaries, supplierSummaries) {
  const currentMonth = monthlySeries[monthlySeries.length - 1] || null;
  const priorMonth = monthlySeries[monthlySeries.length - 2] || null;
  return {
    period: currentMonth?.month || "",
    currentMonth,
    priorMonth,
    topTerminals: terminalSummaries.slice(0, 4).map((item) => ({ label: item.terminalName, value: item.totalCost, gallons: item.gallons })),
    topSuppliers: supplierSummaries.slice(0, 4).map((item) => ({ label: item.supplier, value: item.totalCost, gallons: item.gallons }))
  };
}

function buildFillExceptions(records) {
  return records
    .map((record) => {
      const shortLoadGallons = Number((record.gallonsFilled - record.gallonsCorrected).toFixed(1));
      const truckingRate = record.gallonsCorrected > 0 ? Number((record.truckingCost / record.gallonsCorrected).toFixed(4)) : 0;
      const reasons = [];
      if (record.status === "pending" || record.status === "received") reasons.push("Awaiting approval workflow completion");
      if (shortLoadGallons >= 18) reasons.push(`Short load variance ${shortLoadGallons} gal`);
      if (truckingRate >= 0.05) reasons.push(`High trucking rate ${truckingRate}/gal`);
      if (!reasons.length) return null;
      return {
        bolNumber: record.bolNumber,
        siteCode: record.destinationSiteCode,
        siteName: record.destinationSiteName,
        terminalName: record.terminalName,
        supplier: record.supplier,
        tankLabel: record.tankLabel || "",
        status: record.status,
        shortLoadGallons,
        truckingRate,
        reasons
      };
    })
    .filter(Boolean)
    .slice(0, 12);
}

function buildPriceComparison(terminalDetails, records) {
  const rows = [];
  const supplierMap = new Map();
  for (const record of records) {
    const key = `${record.productType}::${record.supplier}`;
    if (!supplierMap.has(key)) supplierMap.set(key, { product: record.productType, supplier: record.supplier, loads: 0, gallons: 0, totalCost: 0 });
    const bucket = supplierMap.get(key);
    bucket.loads += 1;
    bucket.gallons += record.gallonsCorrected;
    bucket.totalCost += record.totalCost;
  }
  for (const detail of terminalDetails) for (const price of detail.prices || []) rows.push({ type: "terminal", product: price.product, supplier: detail.terminalName, location: [detail.city, detail.state].filter(Boolean).join(", "), referencePrice: Number(price.pricePerGallon.toFixed(4)), updatedAt: price.updatedAt, terminalId: detail.terminalId });
  for (const item of supplierMap.values()) rows.push({ type: "supplier", product: item.product, supplier: item.supplier, location: "", referencePrice: item.gallons > 0 ? Number((item.totalCost / item.gallons).toFixed(4)) : 0, updatedAt: null, loads: item.loads });
  return rows.sort((a, b) => a.product.localeCompare(b.product) || a.referencePrice - b.referencePrice);
}

function buildSummary(records, terminalSummaries, supplierSummaries, statusSummaries, siteSummaries) {
  const totalGallons = records.reduce((sum, item) => sum + item.gallonsCorrected, 0);
  const totalCost = records.reduce((sum, item) => sum + item.totalCost, 0);
  const totalTruckingCost = records.reduce((sum, item) => sum + item.truckingCost, 0);
  return {
    totalLoads: records.length,
    totalGallons: Number(totalGallons.toFixed(2)),
    totalCost: money(totalCost),
    totalTruckingCost: money(totalTruckingCost),
    averagePricePerGallon: totalGallons > 0 ? Number((totalCost / totalGallons).toFixed(4)) : 0,
    averageCostPerLoad: records.length > 0 ? money(totalCost / records.length) : 0,
    uniqueTerminals: terminalSummaries.length,
    uniqueSuppliers: supplierSummaries.length,
    uniqueSites: siteSummaries.length,
    pendingCount: statusSummaries.find((item) => item.status === "pending")?.count || 0,
    approvedCount: statusSummaries.find((item) => item.status === "approved")?.count || 0
  };
}

async function getEbolOverview(filters = {}) {
  const defaults = defaultDateRange();
  const startDate = normalizeDateInput(filters.startDate, defaults.startDate);
  const endDate = normalizeDateInput(filters.endDate, defaults.endDate);
  let records = await fetchEbolRecords({ startDate, endDate, status: filters.status || "", terminalId: filters.terminalId || "", supplierId: filters.supplierId || "", siteId: filters.siteId || "", limit: filters.limit || 1000 });
  if (String(filters.exceptionsOnly || "") === "true") {
    const exceptionIds = new Set(buildFillExceptions(records).map((item) => item.bolNumber));
    records = records.filter((record) => exceptionIds.has(record.bolNumber));
  }
  const terminalIds = [...new Set(records.map((item) => item.terminalId).filter(Boolean))].slice(0, 12);
  const terminalDetails = (await Promise.all(terminalIds.map(async (terminalId) => {
    try { return await fetchTerminalPricing(terminalId); } catch { return null; }
  }))).filter(Boolean);
  const statusSummaries = aggregateByStatus(records);
  const supplierSummaries = aggregateBySupplier(records);
  const terminalSummaries = buildTerminalSummaries(records, terminalDetails);
  const siteSummaries = buildSiteSummaries(records);
  const monthlySeries = aggregateByMonth(records);
  return {
    configured: hasDtnConfig(),
    sourceMode: hasDtnConfig() ? "live_dtn" : "demo_sites",
    range: { startDate, endDate },
    summary: buildSummary(records, terminalSummaries, supplierSummaries, statusSummaries, siteSummaries),
    statusSummaries,
    supplierSummaries,
    terminalSummaries,
    siteSummaries,
    dailySeries: aggregateByDay(records),
    monthlySeries,
    fillExceptions: buildFillExceptions(records),
    monthlyComparisons: buildMonthlyComparisons(monthlySeries, terminalSummaries, supplierSummaries),
    priceComparison: buildPriceComparison(terminalDetails, records),
    records: [...records].sort((a, b) => String(b.loadDate || b.createdAt).localeCompare(String(a.loadDate || a.createdAt))),
    filterOptions: {
      statuses: [...new Set(records.map((item) => item.status).filter(Boolean))].sort(),
      suppliers: supplierSummaries.map((item) => item.supplier),
      terminals: terminalSummaries.map((item) => ({ value: item.terminalId || item.terminalName, label: [item.terminalName, item.city, item.state].filter(Boolean).join(" | ") })),
      sites: siteSummaries.map((item) => ({ value: item.siteId || item.siteCode, label: `${item.siteCode} | ${item.siteName}` }))
    }
  };
}

function buildEbolCsv(records) {
  const headers = ["bol_number", "site_code", "site_name", "load_date", "delivery_date", "status", "product_type", "supplier", "terminal_name", "terminal_city", "terminal_state", "tank_label", "gallons_filled", "gallons_corrected", "start_gauge_reading", "end_gauge_reading", "tank_capacity", "price_per_gallon", "total_cost", "trucking_cost", "tax_amount", "total_with_fees", "carrier_name", "driver_name", "vehicle_number", "tracking_number"];
  return [headers.join(","), ...records.map((item) => [item.bolNumber, item.destinationSiteCode, item.destinationSiteName, item.loadDate, item.deliveryDate, item.status, item.productType, item.supplier, item.terminalName, item.terminalCity, item.terminalState, item.tankLabel, item.gallonsFilled, item.gallonsCorrected, item.startGaugeReading, item.endGaugeReading, item.tankCapacity, item.pricePerGallon, item.totalCost, item.truckingCost, item.taxAmount, item.totalWithFees, item.carrierName, item.driverName, item.vehicleNumber, item.trackingNumber].map(dtnCsv).join(","))].join("\n");
}

module.exports = { defaultDateRange, hasDtnConfig, getEbolOverview, fetchEbolStatus, buildEbolCsv };
