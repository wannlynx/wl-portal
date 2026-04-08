import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

const PRODUCT_FAMILIES = ["regular", "mid", "premium", "diesel"];
const VISIBLE_PRODUCT_FAMILIES = ["regular", "premium", "diesel"];
const CUSTOMER_STATUS_OPTIONS = [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }];
const PRICING_BRANCH_OPTIONS = [{ value: "unbranded", label: "Unbranded" }, { value: "branded", label: "Branded" }, { value: "spot", label: "Spot" }, { value: "rack", label: "Rack" }];
const MARKET_KEY_OPTIONS = [{ value: "san_francisco", label: "San Francisco" }, { value: "benicia", label: "Benicia (San Francisco rack)" }, { value: "sacramento", label: "Sacramento" }, { value: "san_jose", label: "San Jose" }, { value: "stockton", label: "Stockton" }, { value: "bay_area", label: "Bay Area" }];
const TERMINAL_KEY_OPTIONS = [{ value: "benicia_terminal", label: "Benicia / San Francisco" }, { value: "stockton_terminal", label: "Stockton" }, { value: "sacramento_terminal", label: "Sacramento" }, { value: "san_jose_terminal", label: "San Jose" }, { value: "san_francisco_terminal", label: "San Francisco" }];
const PRODUCT_KEY_OPTIONS = [{ value: "reg_87_carb", label: "87 CARB" }, { value: "mid_89_carb", label: "89 CARB" }, { value: "premium_91_carb", label: "91 CARB" }, { value: "diesel_carb_ulsd", label: "CARB ULSD" }, { value: "diesel_red", label: "Red Diesel" }, { value: "ethanol", label: "Ethanol" }, { value: "rin", label: "RIN" }, { value: "lcfs_gasoline", label: "LCFS Gasoline" }, { value: "lcfs_diesel", label: "LCFS Diesel" }, { value: "ghg_gasoline", label: "GHG Gasoline" }, { value: "ghg_diesel", label: "GHG Diesel" }];
const VENDOR_KEY_OPTIONS = [{ value: "valero", label: "Valero" }, { value: "psx", label: "Phillips 66" }, { value: "tesoro", label: "Tesoro" }, { value: "marathon", label: "Marathon" }, { value: "shell", label: "Shell" }, { value: "chevron", label: "Chevron" }, { value: "bp", label: "BP" }];
const SOURCE_TYPE_OPTIONS = [{ value: "opis", label: "OPIS" }, { value: "branded_zone", label: "Branded Zone" }, { value: "branded_area", label: "Branded Area" }, { value: "tax", label: "Tax" }, { value: "manual_adjustment", label: "Manual Adjustment" }, { value: "derived", label: "Derived" }];
const SNAPSHOT_STATUS_OPTIONS = [{ value: "draft", label: "Draft" }, { value: "ready", label: "Ready" }, { value: "locked", label: "Locked" }, { value: "superseded", label: "Superseded" }];
const RULE_STATUS_OPTIONS = [{ value: "draft", label: "Draft" }, { value: "active", label: "Active" }, { value: "retired", label: "Retired" }];
const DELIVERY_METHOD_OPTIONS = [{ value: "email", label: "Email" }, { value: "fax_email", label: "Fax Through Email" }, { value: "manual", label: "Manual" }];
const VENDOR_SELECTION_MODE_OPTIONS = [{ value: "lowest", label: "Lowest" }, { value: "highest", label: "Highest" }, { value: "first_available", label: "First Available" }, { value: "specific_vendor", label: "Specific Vendor" }];
const COMPONENT_SOURCE_KIND_OPTIONS = [{ value: "customer_profile", label: "customer_profile" }, { value: "source_value", label: "source_value" }, { value: "tax", label: "tax" }, { value: "tax_schedule", label: "tax_schedule" }, { value: "vendor_min", label: "vendor_min" }, { value: "spot_or_rack_best", label: "spot_or_rack_best" }, { value: "constant", label: "constant" }, { value: "default", label: "default" }, { value: "derived_component", label: "derived_component" }];
const TAX_NAME_OPTIONS = [{ value: "gas_tax", label: "Gas Tax" }, { value: "diesel_tax", label: "Diesel Tax" }];
const EMPTY_CUSTOMER = { name: "", addressLine1: "", addressLine2: "", city: "", state: "", postalCode: "", terminalKey: "", status: "active" };
const PROFILE_RULE_FIELDS = ["distributionLabel", "gasPrepay", "dieselPrepay", "storageFee", "gasFedExcise", "gasStateExcise", "dieselFedExcise", "dieselStateExcise", "gasSalesTaxRate", "dieselSalesTaxRate", "gasRetailMargin", "dieselRetailMargin"];
const EMPTY_PROFILE = { effectiveStart: "", effectiveEnd: "", freightMiles: "", freightCostGas: "", freightCostDiesel: "", rackMarginGas: "", rackMarginDiesel: "", discountRegular: "", discountMid: "", discountPremium: "", discountDiesel: "", branch: "unbranded", marketKey: "", terminalKey: "", distributionLabel: "", gasPrepay: "", dieselPrepay: "", storageFee: "", gasFedExcise: "", gasStateExcise: "", dieselFedExcise: "", dieselStateExcise: "", gasSalesTaxRate: "", dieselSalesTaxRate: "", gasRetailMargin: "", dieselRetailMargin: "", extraRulesJson: "{}" };
const EMPTY_CONTACT = { id: "", name: "", email: "", phone: "", faxEmail: "", isPrimary: false, deliveryMethod: "email" };
const EMPTY_RULE = { name: "", productFamily: "regular", effectiveStart: "", effectiveEnd: "", status: "draft", versionLabel: "", notes: "" };
const EMPTY_COMPONENT = { componentKey: "", label: "", sourceKind: "customer_profile", sourceRef: "", defaultValue: "", multiplier: "1", sortOrder: "1", isEditable: true, metadataJson: "{}" };
const EMPTY_VENDOR_SET = { selectionMode: "lowest", productFamily: "regular", marketKey: "", vendorsCsv: "" };
const EMPTY_TAX = { productFamily: "regular", taxName: "", value: "", unit: "usd_gal", effectiveStart: "", effectiveEnd: "" };
const EMPTY_SOURCE = { sourceType: "opis", sourceLabel: "", status: "draft", notes: "" };
const EMPTY_SOURCE_VALUE = { marketKey: "", terminalKey: "", productKey: "", vendorKey: "", quoteCode: "", value: "", unit: "usd_gal", effectiveDate: "" };

function prettyJson(value) { return JSON.stringify(value, null, 2); }
function formatMoney(value) { return value == null || Number.isNaN(Number(value)) ? "n/a" : `$${Number(value).toFixed(4)}`; }
function formatDateTime(value) { return value ? new Date(value).toLocaleString() : "n/a"; }
function formatPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "n/a";
  const percent = numeric <= 1 ? numeric * 100 : numeric;
  return `${percent.toFixed(percent % 1 === 0 ? 0 : percent < 10 ? 3 : 2)}%`;
}
function isoDate(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}
function todayDate() { return isoDate(new Date()); }
function yesterdayDate() { const value = new Date(); value.setDate(value.getDate() - 1); return isoDate(value); }
function productFamilyLabel(value) {
  if (value === "regular") return "REG 87";
  if (value === "premium") return "PRE 91";
  if (value === "diesel") return "Diesel";
  if (value === "mid") return "MID 89";
  return value;
}
function traceAmount(item) { return item.contribution != null ? formatMoney(item.contribution) : item.value != null ? formatMoney(item.value) : "n/a"; }
function basisTraceItem(output) {
  return (output.trace || []).find((item) => Number.isFinite(item?.spotValue) || Number.isFinite(item?.rackValue)) || null;
}
function derivedBasisTotals(output) {
  if (output?.basisComparison) {
    return {
      spotTotal: output.basisComparison.spotTotal,
      rackTotal: output.basisComparison.rackTotal,
      difference: output.basisComparison.difference
    };
  }
  const basis = basisTraceItem(output);
  if (!basis || !Number.isFinite(output?.totalPrice) || !Number.isFinite(basis.rawValue)) return null;
  const current = Number(output.totalPrice);
  const selectedBasis = Number(basis.rawValue);
  const spotTotal = Number.isFinite(basis.spotValue) ? Number((current - selectedBasis + Number(basis.spotValue)).toFixed(4)) : null;
  const rackTotal = Number.isFinite(basis.rackValue) ? Number((current - selectedBasis + Number(basis.rackValue)).toFixed(4)) : null;
  const difference = spotTotal != null && rackTotal != null ? Number((spotTotal - rackTotal).toFixed(4)) : null;
  return { spotTotal, rackTotal, difference };
}
function defaultTraceMode(output) {
  const recommendation = String(basisTraceItem(output)?.recommendation || "").trim().toLowerCase();
  return recommendation === "spot" ? "spot" : "rack";
}
function traceAmountForMode(item, mode) {
  if ((mode === "spot" || mode === "rack") && Number.isFinite(item?.spotValue) && Number.isFinite(item?.rackValue)) {
    return formatMoney(mode === "spot" ? item.spotValue : item.rackValue);
  }
  return traceAmount(item);
}
function traceDetailForMode(item, mode) {
  if ((mode === "spot" || mode === "rack") && (Number.isFinite(item?.spotValue) || Number.isFinite(item?.rackValue))) {
    const chosen = mode === "spot" ? item.spotValue : item.rackValue;
    const alternate = mode === "spot" ? item.rackValue : item.spotValue;
    const chosenLabel = mode === "spot" ? "Spot" : "Rack";
    const alternateLabel = mode === "spot" ? "Rack" : "Spot";
    return `${item.detail} | Using ${chosenLabel} ${formatMoney(chosen)}${Number.isFinite(alternate) ? ` | ${alternateLabel} ${formatMoney(alternate)}` : ""}`;
  }
  return item.detail;
}
function traceModeSummary(output, mode) {
  const basis = basisTraceItem(output);
  const derived = derivedBasisTotals(output);
  if (!basis || (mode !== "spot" && mode !== "rack")) return "";
  const derivedTotal = mode === "spot" ? derived?.spotTotal : derived?.rackTotal;
  const chosenBasis = mode === "spot" ? basis.spotValue : basis.rackValue;
  const profileTarget = basis.terminalKey || basis.marketKey || "selected profile";
  return `${mode === "spot" ? "Derived Spot" : "Derived Rack"} recalculates the finished price with a ${mode} basis of ${formatMoney(chosenBasis)} for a total of ${formatMoney(derivedTotal)} using ${profileTarget}.`;
}
function formatBasisObserved(output, mode) {
  const comparison = output?.basisComparison || {};
  const observedAt = mode === "spot" ? comparison.spotObservedAt : comparison.rackObservedAt;
  const timing = mode === "spot" ? comparison.spotTimingLabel : comparison.rackTimingLabel;
  const city = mode === "spot" ? comparison.spotSourceCity : comparison.rackSourceCity;
  const supplier = mode === "spot" ? comparison.spotSourceSupplier : comparison.rackSourceSupplier;
  const pieces = [timing, city, supplier, observedAt ? formatDateTime(observedAt) : ""].filter(Boolean);
  return pieces.join(" | ");
}
function spotProductCodeForFamily(family) {
  if (family === "regular") return "O1007NR";
  if (family === "premium") return "O1007NW";
  if (family === "diesel") return "O1007G4";
  return "";
}
function spotMarketReferenceForFamily(family) {
  if (family === "regular") return "San Francisco CARB RFG Regular Average";
  if (family === "premium") return "San Francisco CARB RFG Premium Average";
  if (family === "diesel") return "San Francisco CARB Diesel Average";
  return "OPIS market average";
}
function basisValidationLines(output, mode) {
  const basis = basisTraceItem(output);
  const comparison = output?.basisComparison || {};
  const family = output?.productFamily || "";
  if (!basis || (mode !== "spot" && mode !== "rack")) return [];
  if (mode === "spot") {
    const code = spotProductCodeForFamily(family);
    const endpoint = comparison.spotSourceEndpoint || "GET /api/SpotValues";
    const sourceMode = comparison.spotSourceMode === "intraday"
      ? "Intraday spot"
      : comparison.spotSourceMode === "latest_prompt_average"
        ? "Latest published prompt average"
        : "Spot price";
    return [
      `Source API: OPIS Spot API \u2192 ${endpoint}`,
      `Selection rule: ${sourceMode} for ${productFamilyLabel(family)}`,
      `Report match line: ${spotMarketReferenceForFamily(family)}`,
      `Product code: ${code || "n/a"}`,
      `Market: ${comparison.spotSourceCity || "San Francisco"}`,
      `Timing label: ${comparison.spotTimingLabel || "Latest Spot"}`,
      `Published date: ${comparison.spotPublishedDate ? formatDateTime(comparison.spotPublishedDate) : "n/a"}`,
      `Fetched at: ${comparison.spotFetchedAt ? formatDateTime(comparison.spotFetchedAt) : "n/a"}`,
      `Validation keys: market line, product code, and published date should all match the OPIS spot report`
    ];
  }
  return [
    `Source API: OPIS Rack API \u2192 GET /Summary`,
    `Selection rule: first available unbranded net average after 6:00 AM ET`,
    `Market: ${comparison.rackSourceCity || "n/a"}`,
    `Supplier: ${comparison.rackSourceSupplier || "n/a"}`,
    `Timing label: ${comparison.rackTimingLabel || "n/a"}`,
    `Published date: ${comparison.rackPublishedDate ? formatDateTime(comparison.rackPublishedDate) : "n/a"}`,
    `Fetched at: ${comparison.rackFetchedAt ? formatDateTime(comparison.rackFetchedAt) : "n/a"}`,
    `Invoice match keys: supplier, terminal/market, product family, and BOL/report date should line up with the supplier invoice`
  ];
}
function traceLabel(item) {
  const label = item.label || item.kind || item.componentKey;
  if (label === "Lowest Rack") return "Lowest Rack Input";
  if (label === "Lowest of Day Basis" || label === "Spot or Rack") return "Spot or Rack";
  if (item.kind === "active_taxes") return "Taxes Applied";
  return label;
}
function traceLabelForMode(item, mode) {
  const label = traceLabel(item);
  if (label === "Spot or Rack") {
    return mode === "spot" ? "Spot Basis" : mode === "rack" ? "Rack Basis" : label;
  }
  return label;
}
const TRACE_LABELS_TO_HIDE = new Set([
  "Contract Minus",
  "Freight",
  "Rack Margin",
  "Tax",
  "Taxes Applied",
  "Discount",
  "Distribution Terminal",
  "Today's Cost",
  "discount_not_applied"
]);
const TRACE_KINDS_TO_HIDE = new Set(["active_taxes", "discount_not_applied"]);
function filteredTraceItems(output) {
  return (output?.trace || []).filter((item) => {
    const label = traceLabel(item);
    const kind = String(item?.kind || "");
    return !TRACE_LABELS_TO_HIDE.has(label) && !TRACE_KINDS_TO_HIDE.has(kind);
  });
}
function traceSourceText(item) {
  return String(item?.sourcePath || "").trim();
}
function traceRowTone(item, mode) {
  const label = traceLabel(item);
  if (label === "Landed Cost Price") return "price-tables-trace-row-success";
  if (mode === "spot" && traceLabelForMode(item, mode) === "Spot Basis") return "price-tables-trace-row-spot";
  if (mode === "rack" && traceLabelForMode(item, mode) === "Rack Basis") return "price-tables-trace-row-rack";
  return "";
}
function traceIndentLevel(item, mode) {
  const label = traceLabelForMode(item, mode);
  if (/prepay/i.test(label)) return 1;
  if (/(federal|fed excise|state excise|sales tax amt|sales tax amount|sales tax rate|storage fee|storage fees|freight)/i.test(label)) return 1;
  return 0;
}
function traceDisplayAmount(item, mode) {
  const label = traceLabelForMode(item, mode);
  if (/sales tax rate/i.test(label)) {
    const value = item.contribution != null ? item.contribution : item.value;
    return formatPercent(value);
  }
  return traceAmountForMode(item, mode);
}
function basisCellTone(kind, recommendation) {
  if (kind === "spot") return "price-tables-tone-spot";
  if (kind === "rack") return "price-tables-tone-rack";
  if (kind === "winner") return recommendation === "spot" ? "price-tables-tone-spot" : recommendation === "rack" ? "price-tables-tone-rack" : "";
  return "";
}
function customerToForm(customer) { return { ...EMPTY_CUSTOMER, ...(customer || {}) }; }
function profileToForm(profile) {
  if (!profile) return EMPTY_PROFILE;
  const rules = profile.rules || {};
  const {
    branch = "unbranded",
    marketKey = "",
    terminalKey = "",
    distributionLabel = "",
    gasPrepay = "",
    dieselPrepay = "",
    storageFee = "",
    gasFedExcise = "",
    gasStateExcise = "",
    dieselFedExcise = "",
    dieselStateExcise = "",
    gasSalesTaxRate = "",
    dieselSalesTaxRate = "",
    gasRetailMargin = "",
    dieselRetailMargin = "",
    ...extraRules
  } = rules;
  return { ...EMPTY_PROFILE, ...profile, branch, marketKey, terminalKey, distributionLabel, gasPrepay, dieselPrepay, storageFee, gasFedExcise, gasStateExcise, dieselFedExcise, dieselStateExcise, gasSalesTaxRate, dieselSalesTaxRate, gasRetailMargin, dieselRetailMargin, extraRulesJson: prettyJson(extraRules) };
}
function ruleToForm(rule) { return rule ? { ...EMPTY_RULE, ...rule } : EMPTY_RULE; }
function componentsToRows(components) {
  return components?.length ? components.map((item, index) => ({ componentKey: item.componentKey || "", label: item.label || "", sourceKind: item.sourceKind || "customer_profile", sourceRef: item.sourceRef || "", defaultValue: item.defaultValue ?? "", multiplier: item.multiplier ?? "1", sortOrder: item.sortOrder ?? String(index + 1), isEditable: item.isEditable !== false, metadataJson: prettyJson(item.metadata || {}) })) : [EMPTY_COMPONENT];
}
function vendorSetsToRows(vendorSets, family) {
  return vendorSets?.length ? vendorSets.map((item) => ({ selectionMode: item.selectionMode || "lowest", productFamily: item.productFamily || family, marketKey: item.marketKey || "", vendorsCsv: Array.isArray(item.vendors) ? item.vendors.join(", ") : "" })) : [{ ...EMPTY_VENDOR_SET, productFamily: family }];
}
function taxesToRows(taxes, pricingDate) {
  return taxes?.length ? taxes.map((item) => ({ productFamily: item.productFamily, taxName: item.taxName, value: item.value ?? "", unit: item.unit || "usd_gal", effectiveStart: item.effectiveStart || pricingDate, effectiveEnd: item.effectiveEnd || "" })) : PRODUCT_FAMILIES.map((family) => ({ ...EMPTY_TAX, productFamily: family, taxName: family === "diesel" ? "diesel_tax" : "gas_tax", effectiveStart: pricingDate }));
}
function rowUpdate(setter, index, field, value) { setter((current) => current.map((row, i) => i === index ? { ...row, [field]: value } : row)); }
function rowRemove(setter, index) { setter((current) => current.filter((_, i) => i !== index)); }
function csvValues(value) { return String(value || "").split(",").map((item) => item.trim()).filter(Boolean); }
function selectedOptionValues(event) { return Array.from(event.target.selectedOptions || [], (option) => option.value); }
function contactsToRows(contacts) { return contacts?.length ? contacts.map((item) => ({ ...EMPTY_CONTACT, ...item })) : [{ ...EMPTY_CONTACT }]; }
function outputMetricsFromRecord(record) { return VISIBLE_PRODUCT_FAMILIES.map((family) => ({ productFamily: family, basePrice: record?.[`${family}Base`], totalPrice: record?.[`${family}Total`] })); }
function generatedOutputForFamily(record, family) {
  return (record?.detail?.outputs || []).find((item) => item.productFamily === family) || null;
}
function generatedBasisValues(record, family) {
  const output = generatedOutputForFamily(record, family);
  if (!output) return { spot: null, rack: null };
  if (output.basisComparison) {
    return {
      spot: output.basisComparison.spotBasis,
      rack: output.basisComparison.rackBasis
    };
  }
  const basis = basisTraceItem(output);
  return basis ? { spot: basis.spotValue, rack: basis.rackValue } : { spot: null, rack: null };
}
function latestGeneratedOutputs(items) {
  const latest = new Map();
  for (const item of items || []) {
    const key = `${item.customerId || item.customerName || ""}|${item.pricingDate || ""}`;
    const current = latest.get(key);
    if (!current) {
      latest.set(key, item);
      continue;
    }
    const currentCreatedAt = Date.parse(current.createdAt || 0);
    const nextCreatedAt = Date.parse(item.createdAt || 0);
    if (nextCreatedAt >= currentCreatedAt) {
      latest.set(key, item);
    }
  }
  return [...latest.values()].sort((a, b) => (
    String(b.pricingDate || "").localeCompare(String(a.pricingDate || "")) ||
    String(b.createdAt || "").localeCompare(String(a.createdAt || "")) ||
    String(a.customerName || "").localeCompare(String(b.customerName || ""))
  ));
}
function sourceValueMatchesTerminal(value, terminalKey) {
  if (!terminalKey) return true;
  return String(value?.terminalKey || "").trim() === String(terminalKey).trim();
}

function OutputCards({ outputs, fallbackStatus, onOpenProfile }) {
  const [selectedTrace, setSelectedTrace] = useState(null);

  function setTraceMode(output, mode) {
    setSelectedTrace((current) => {
      if (current?.productFamily === output.productFamily && current?.mode === mode) {
        return null;
      }
      return { productFamily: output.productFamily, mode };
    });
  }

  const visibleOutputs = outputs.filter((output) => VISIBLE_PRODUCT_FAMILIES.includes(output.productFamily));
  const detailOutput = visibleOutputs.find((output) => output.productFamily === selectedTrace?.productFamily) || null;
  const detailMode = selectedTrace?.mode || "";
  const detailTraceItems = detailOutput && detailMode ? filteredTraceItems(detailOutput) : [];

  return (
    <div className="price-tables-output-stack">
      <div className="price-tables-output-list">
      {visibleOutputs.map((output) => {
        const basis = basisTraceItem(output);
        const derived = derivedBasisTotals(output);
        const activeTraceMode = selectedTrace?.productFamily === output.productFamily ? selectedTrace.mode : "";
        return (
        <div key={output.productFamily} className="price-tables-output-card">
          <div className="price-tables-output-head"><strong>{productFamilyLabel(output.productFamily)}</strong><span>{output.status || fallbackStatus}</span></div>
          {basis ? (
            <div className="price-tables-basis-grid">
              <div className={basisCellTone("spot", basis.recommendation)}><span>Spot Basis</span><strong>{formatMoney(basis.spotValue)}</strong>{formatBasisObserved(output, "spot") ? <small>{formatBasisObserved(output, "spot")}</small> : null}</div>
              <div className={basisCellTone("rack", basis.recommendation)}><span>Rack Basis</span><strong>{formatMoney(basis.rackValue)}</strong>{formatBasisObserved(output, "rack") ? <small>{formatBasisObserved(output, "rack")}</small> : null}</div>
              <div className={basisCellTone("winner", basis.recommendation)}><span>Using</span><strong>{basis.recommendation || "n/a"}</strong></div>
              <button type="button" className={`price-tables-basis-action ${basisCellTone("spot", basis.recommendation)}${activeTraceMode === "spot" ? " price-tables-basis-action-active" : ""}`} onClick={() => setTraceMode(output, "spot")}><span>Derived Spot</span><strong>{formatMoney(derived?.spotTotal)}</strong></button>
              <button type="button" className={`price-tables-basis-action ${basisCellTone("rack", basis.recommendation)}${activeTraceMode === "rack" ? " price-tables-basis-action-active" : ""}`} onClick={() => setTraceMode(output, "rack")}><span>Derived Rack</span><strong>{formatMoney(derived?.rackTotal)}</strong></button>
              <div className={basisCellTone("winner", basis.recommendation)}><span>Difference</span><strong>{derived?.difference == null ? "n/a" : `${derived.difference > 0 ? "+" : ""}${formatMoney(derived.difference)}`}</strong></div>
            </div>
          ) : null}
        </div>
      )})}
      </div>
      {detailOutput && detailMode ? (
        <div className="price-tables-trace-card">
          <div className="price-tables-trace-card-head">
            <div>
              <strong>{detailMode === "spot" ? "Derived Spot Detail" : "Derived Rack Detail"} · {productFamilyLabel(detailOutput.productFamily)}</strong>
              <span>{traceModeSummary(detailOutput, detailMode)}</span>
            </div>
            <button type="button" className="price-tables-trace-toggle" onClick={() => setSelectedTrace(null)}>Hide details</button>
          </div>
          <div className={`price-tables-detail-card ${detailMode === "spot" ? "price-tables-tone-spot" : "price-tables-tone-rack"}`.trim()}>
            <strong>{detailMode === "spot" ? "Spot pickup detail" : "Rack pickup detail"}</strong>
            {basisValidationLines(detailOutput, detailMode).map((line) => <span key={line}>{line}</span>)}
          </div>
          <div className="price-tables-trace">
            {detailTraceItems.map((item, index) => (
              <div key={`${detailOutput.productFamily}-${index}`} className={`price-tables-trace-row ${traceRowTone(item, detailMode)} ${traceIndentLevel(item, detailMode) ? `price-tables-trace-row-indent-${traceIndentLevel(item, detailMode)}` : ""}`.trim()}>
                <div className="price-tables-trace-main">
                  <strong>{traceLabelForMode(item, detailMode)}</strong>
                  {item.detail ? <span>{traceDetailForMode(item, detailMode)}</span> : null}
                  {traceSourceText(item) ? (
                    <small>
                      {traceSourceText(item)}
                      {traceSourceText(item).startsWith("Profile >") && onOpenProfile ? (
                        <>
                          {" "}
                          <button type="button" className="price-tables-inline-link" onClick={onOpenProfile}>Open profile</button>
                        </>
                      ) : null}
                    </small>
                  ) : null}
                </div>
                <em>{traceDisplayAmount(item, detailMode)}</em>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PriceTablesPage() {
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [rules, setRules] = useState([]);
  const [taxRows, setTaxRows] = useState([]);
  const [sources, setSources] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [customerForm, setCustomerForm] = useState(EMPTY_CUSTOMER);
  const [contactRows, setContactRows] = useState([{ ...EMPTY_CONTACT }]);
  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE);
  const [ruleForm, setRuleForm] = useState(EMPTY_RULE);
  const [componentRows, setComponentRows] = useState([EMPTY_COMPONENT]);
  const [vendorSetRows, setVendorSetRows] = useState([EMPTY_VENDOR_SET]);
  const [sourceDraft, setSourceDraft] = useState(EMPTY_SOURCE);
  const [sourceValueRows, setSourceValueRows] = useState([{ ...EMPTY_SOURCE_VALUE }]);
  const [selectedSourceDetail, setSelectedSourceDetail] = useState(null);
  const [previewDate, setPreviewDate] = useState(isoDate(new Date()));
  const [preview, setPreview] = useState(null);
  const [runHistory, setRunHistory] = useState(null);
  const [generatedOutputs, setGeneratedOutputs] = useState([]);
  const [historyDateMode, setHistoryDateMode] = useState("selected");
  const [selectedOutputId, setSelectedOutputId] = useState("");
  const [selectedOutputDetail, setSelectedOutputDetail] = useState(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const selectedCustomer = useMemo(() => customers.find((item) => item.id === selectedCustomerId) || null, [customers, selectedCustomerId]);
  const selectedTerminalKey = (profileForm.terminalKey || customerForm.terminalKey || selectedCustomer?.terminalKey || "").trim();
  const selectedSourceTerminalValues = useMemo(
    () => (selectedSourceDetail?.values || []).filter((value) => sourceValueMatchesTerminal(value, selectedTerminalKey)),
    [selectedSourceDetail, selectedTerminalKey]
  );

  async function loadWorkspace(preferredCustomerId, preferredRuleId) {
    setLoading(true);
    setError("");
    try {
      const [nextCustomers, nextRules] = await Promise.all([api.getCustomers(), api.getPricingRules()]);
      setCustomers(nextCustomers);
      setRules(nextRules);
      setSelectedCustomerId(preferredCustomerId || nextCustomers[0]?.id || "");
      setSelectedRuleId(preferredRuleId || nextRules[0]?.id || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError || "Unable to load price tables"));
    } finally {
      setLoading(false);
    }
  }

  async function loadDateInputs(pricingDate, preferredSourceId) {
    try {
      const [nextTaxes, nextSources] = await Promise.all([api.getPricingTaxes({ effectiveDate: pricingDate }), api.getPricingSources({ pricingDate })]);
      setTaxRows(taxesToRows(nextTaxes, pricingDate));
      setSources(nextSources);
      setSelectedSourceId(preferredSourceId || nextSources[0]?.id || "");
      setSourceValueRows((current) => current.length ? current : [{ ...EMPTY_SOURCE_VALUE, effectiveDate: pricingDate }]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError || "Unable to load taxes and sources"));
    }
  }

  async function loadGeneratedWorkspace(pricingDate, preferredOutputId = "") {
    try {
      let history;
      let outputs;
      const baseFilters = {};
      if (historyDateMode === "selected") {
        const [rawHistory, rawOutputs] = await Promise.all([
          api.getPricingRunHistory(pricingDate, baseFilters),
          api.getGeneratedPricingOutputs({ pricingDate, ...baseFilters })
        ]);
        outputs = latestGeneratedOutputs(rawOutputs);
        history = {
          ...rawHistory,
          total: outputs.length,
          generatedCount: outputs.filter((item) => item.status !== "incomplete").length,
          incompleteCount: outputs.filter((item) => item.status === "incomplete").length,
          outputs
        };
      } else if (historyDateMode === "today") {
        const today = todayDate();
        outputs = latestGeneratedOutputs(await api.getGeneratedPricingOutputs({ pricingDate: today, ...baseFilters }));
        history = {
          pricingDate: today,
          total: outputs.length,
          generatedCount: outputs.filter((item) => item.status !== "incomplete").length,
          incompleteCount: outputs.filter((item) => item.status === "incomplete").length,
          outputs
        };
      } else if (historyDateMode === "yesterday") {
        const yesterday = yesterdayDate();
        outputs = latestGeneratedOutputs(await api.getGeneratedPricingOutputs({ pricingDate: yesterday, ...baseFilters }));
        history = {
          pricingDate: yesterday,
          total: outputs.length,
          generatedCount: outputs.filter((item) => item.status !== "incomplete").length,
          incompleteCount: outputs.filter((item) => item.status === "incomplete").length,
          outputs
        };
      } else {
        const [todayOutputs, yesterdayOutputs] = await Promise.all([
          api.getGeneratedPricingOutputs({ pricingDate: todayDate(), ...baseFilters }),
          api.getGeneratedPricingOutputs({ pricingDate: yesterdayDate(), ...baseFilters })
        ]);
        outputs = latestGeneratedOutputs([...todayOutputs, ...yesterdayOutputs]);
        history = {
          pricingDate: `${yesterdayDate()} to ${todayDate()}`,
          total: outputs.length,
          generatedCount: outputs.filter((item) => item.status !== "incomplete").length,
          incompleteCount: outputs.filter((item) => item.status === "incomplete").length,
          outputs
        };
      }
      setRunHistory(history);
      setGeneratedOutputs(outputs);
      setSelectedOutputId((current) => {
        const targetId = preferredOutputId || current;
        return outputs.some((item) => item.id === targetId) ? targetId : (outputs[0]?.id || "");
      });
    } catch (loadError) {
      setRunHistory(null);
      setGeneratedOutputs([]);
      setSelectedOutputId("");
      setSelectedOutputDetail(null);
      setError(loadError instanceof Error ? loadError.message : String(loadError || "Unable to load generated outputs"));
    }
  }

  useEffect(() => { loadWorkspace(); }, []);
  useEffect(() => { loadDateInputs(previewDate); }, [previewDate]);
  useEffect(() => { loadGeneratedWorkspace(previewDate); }, [previewDate, historyDateMode]);
  useEffect(() => {
    if (!selectedCustomerId) { setCustomerForm(EMPTY_CUSTOMER); setContactRows([{ ...EMPTY_CONTACT }]); setProfileForm(EMPTY_PROFILE); return; }
    let active = true;
    Promise.all([api.getCustomer(selectedCustomerId), api.getCustomerPricingProfile(selectedCustomerId)]).then(([customer, profile]) => {
      if (!active) return;
      setCustomerForm(customerToForm(customer));
      setContactRows(contactsToRows(customer.contacts || []));
      setProfileForm(profileToForm(profile));
    }).catch((loadError) => active && setError(loadError instanceof Error ? loadError.message : String(loadError || "Unable to load customer")));
    return () => { active = false; };
  }, [selectedCustomerId]);
  useEffect(() => {
    if (!selectedRuleId) { setRuleForm(EMPTY_RULE); setComponentRows([EMPTY_COMPONENT]); setVendorSetRows([EMPTY_VENDOR_SET]); return; }
    let active = true;
    api.getPricingRule(selectedRuleId).then((rule) => {
      if (!active) return;
      setRuleForm(ruleToForm(rule));
      setComponentRows(componentsToRows(rule.components || []));
      setVendorSetRows(vendorSetsToRows(rule.vendorSets || [], rule.productFamily || "regular"));
    }).catch((loadError) => active && setError(loadError instanceof Error ? loadError.message : String(loadError || "Unable to load pricing rule")));
    return () => { active = false; };
  }, [selectedRuleId]);
  useEffect(() => {
    if (!selectedSourceId) { setSelectedSourceDetail(null); return; }
    let active = true;
    api.getPricingSource(selectedSourceId).then((detail) => active && setSelectedSourceDetail(detail)).catch((loadError) => active && setError(loadError instanceof Error ? loadError.message : String(loadError || "Unable to load source snapshot")));
    return () => { active = false; };
  }, [selectedSourceId]);
  useEffect(() => {
    if (!selectedOutputId) { setSelectedOutputDetail(null); return; }
    let active = true;
    api.getGeneratedPricingOutput(selectedOutputId).then((detail) => active && setSelectedOutputDetail(detail)).catch((loadError) => active && setError(loadError instanceof Error ? loadError.message : String(loadError || "Unable to load generated output")));
    return () => { active = false; };
  }, [selectedOutputId]);

  async function handleCreateCustomer() {
    setError(""); setStatus("Creating customer...");
    try { const created = await api.createCustomer({ ...EMPTY_CUSTOMER, name: "New Customer" }); await loadWorkspace(created.id, selectedRuleId); setStatus("Customer created."); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : String(saveError || "Unable to create customer")); setStatus(""); }
  }
  async function handleSaveCustomer() {
    if (!selectedCustomerId) return;
    setError(""); setStatus("Saving customer...");
    try { await api.updateCustomer(selectedCustomerId, customerForm); setCustomers(await api.getCustomers()); setStatus("Customer saved."); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : String(saveError || "Unable to save customer")); setStatus(""); }
  }
  async function handleSaveProfile() {
    if (!selectedCustomerId) return;
    setError(""); setStatus("Saving pricing profile...");
    try {
      const extraRules = profileForm.extraRulesJson ? JSON.parse(profileForm.extraRulesJson) : {};
      const normalizedRuleFields = Object.fromEntries(PROFILE_RULE_FIELDS.map((field) => [field, profileForm[field] === "" ? null : profileForm[field]]));
      await api.saveCustomerPricingProfile(selectedCustomerId, { ...profileForm, rules: { branch: profileForm.branch, marketKey: profileForm.marketKey, terminalKey: profileForm.terminalKey, ...normalizedRuleFields, ...extraRules } });
      setStatus("Pricing profile saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError || "Unable to save profile"));
      setStatus("");
    }
  }
  async function handleSaveContacts() {
    if (!selectedCustomerId) return;
    setError(""); setStatus("Saving contacts...");
    try {
      const currentCustomer = await api.getCustomer(selectedCustomerId);
      const existingIds = new Set((currentCustomer.contacts || []).map((item) => item.id));
      const nextIds = new Set(contactRows.filter((row) => row.id).map((row) => row.id));
      for (const contact of currentCustomer.contacts || []) if (!nextIds.has(contact.id)) await api.deleteCustomerContact(selectedCustomerId, contact.id);
      for (const row of contactRows.filter((item) => item.name.trim())) {
        const payload = { name: row.name, email: row.email, phone: row.phone, faxEmail: row.faxEmail, isPrimary: !!row.isPrimary, deliveryMethod: row.deliveryMethod };
        if (row.id && existingIds.has(row.id)) await api.updateCustomerContact(selectedCustomerId, row.id, payload);
        else await api.createCustomerContact(selectedCustomerId, payload);
      }
      const refreshed = await api.getCustomer(selectedCustomerId);
      setContactRows(contactsToRows(refreshed.contacts || []));
      setStatus("Contacts saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError || "Unable to save contacts"));
      setStatus("");
    }
  }
  async function handleCreateRule() {
    setError(""); setStatus("Creating rule...");
    try { const created = await api.createPricingRule({ ...EMPTY_RULE, name: `New ${ruleForm.productFamily} rule`, productFamily: ruleForm.productFamily, effectiveStart: previewDate }); await loadWorkspace(selectedCustomerId, created.id); setStatus("Rule created."); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : String(saveError || "Unable to create rule")); setStatus(""); }
  }
  async function handleSaveRule() {
    if (!selectedRuleId) return;
    setError(""); setStatus("Saving rule...");
    try {
      const components = componentRows.filter((row) => row.componentKey && row.label).map((row, index) => ({ componentKey: row.componentKey, label: row.label, sourceKind: row.sourceKind, sourceRef: row.sourceRef, defaultValue: row.defaultValue === "" ? null : Number(row.defaultValue), multiplier: row.multiplier === "" ? 1 : Number(row.multiplier), sortOrder: row.sortOrder === "" ? index + 1 : Number(row.sortOrder), isEditable: !!row.isEditable, metadata: row.metadataJson ? JSON.parse(row.metadataJson) : {} }));
      const vendorSets = vendorSetRows.filter((row) => row.selectionMode).map((row) => ({ selectionMode: row.selectionMode, productFamily: row.productFamily || ruleForm.productFamily, marketKey: row.marketKey, vendors: row.vendorsCsv.split(",").map((item) => item.trim()).filter(Boolean) }));
      await api.updatePricingRule(selectedRuleId, ruleForm);
      await api.savePricingRuleComponents(selectedRuleId, components);
      await api.savePricingRuleVendorSets(selectedRuleId, vendorSets);
      setRules(await api.getPricingRules());
      setStatus("Rule saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError || "Unable to save rule"));
      setStatus("");
    }
  }
  async function handleSaveTaxes() {
    setError(""); setStatus("Saving taxes...");
    try {
      const schedules = taxRows.filter((row) => row.taxName && row.effectiveStart && row.value !== "").map((row) => ({ productFamily: row.productFamily, taxName: row.taxName, value: Number(row.value), unit: row.unit, effectiveStart: row.effectiveStart, effectiveEnd: row.effectiveEnd || null }));
      await api.savePricingTaxes(schedules);
      await loadDateInputs(previewDate, selectedSourceId);
      setStatus("Taxes saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError || "Unable to save taxes"));
      setStatus("");
    }
  }
  async function handleCreateSourceSnapshot() {
    setError(""); setStatus("Creating source snapshot...");
    try {
      const snapshot = await api.createPricingSource({ pricingDate: previewDate, sourceType: sourceDraft.sourceType, sourceLabel: sourceDraft.sourceLabel, status: sourceDraft.status, notes: sourceDraft.notes });
      const values = sourceValueRows.filter((row) => row.marketKey || row.productKey || row.vendorKey || row.quoteCode || row.value).map((row) => ({ marketKey: row.marketKey, terminalKey: row.terminalKey, productKey: row.productKey, vendorKey: row.vendorKey, quoteCode: row.quoteCode, value: row.value === "" ? null : Number(row.value), unit: row.unit, effectiveDate: row.effectiveDate || previewDate }));
      if (values.length) await api.addPricingSourceValues(snapshot.id, values);
      setSourceDraft(EMPTY_SOURCE);
      setSourceValueRows([{ ...EMPTY_SOURCE_VALUE, effectiveDate: previewDate }]);
      await loadDateInputs(previewDate, snapshot.id);
      setStatus("Source snapshot created.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError || "Unable to create source snapshot"));
      setStatus("");
    }
  }
  async function handleRunPreview() {
    if (!selectedCustomerId) return;
    setError(""); setStatus("Running pricing preview...");
    try { setPreview(await api.previewPricingRun({ customerId: selectedCustomerId, pricingDate: previewDate })); setStatus("Preview ready."); }
    catch (previewError) { setError(previewError instanceof Error ? previewError.message : String(previewError || "Unable to run preview")); setStatus(""); }
  }
  async function handleGenerateRun() {
    setError(""); setStatus("Generating pricing outputs for all customers...");
    try {
      const result = await api.generatePricingRun({ pricingDate: previewDate });
      await loadGeneratedWorkspace(previewDate, result.outputs?.[0]?.id || "");
      setStatus(`Generated ${result.generatedCount} pricing output${result.generatedCount === 1 ? "" : "s"} for ${previewDate}.`);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError || "Unable to generate pricing run"));
      setStatus("");
    }
  }

  if (loading) return <div className="login-status">Loading price tables workspace...</div>;

  const outputDetailPayload = selectedOutputDetail?.detail || {};
  const outputDetailCards = (outputDetailPayload.outputs?.length ? outputDetailPayload.outputs : outputMetricsFromRecord(selectedOutputDetail))
    .filter((item) => VISIBLE_PRODUCT_FAMILIES.includes(item.productFamily));
  const previewOutputCards = selectedOutputDetail
    ? outputDetailCards
    : (preview?.outputs || []).filter((item) => VISIBLE_PRODUCT_FAMILIES.includes(item.productFamily));
  const previewStatus = selectedOutputDetail?.status || preview?.status || "";
  const previewMissingInputs = selectedOutputDetail?.detail?.missingInputs || preview?.missingInputs || [];

  return (
    <div className="price-tables-page">
      {status ? <div className="price-tables-banner price-tables-banner-success">{status}</div> : null}
      {error ? <div className="price-tables-banner price-tables-banner-error">{error}</div> : null}
      <div className="price-tables-layout">
        <section className="card price-tables-panel price-tables-preview-panel">
          <div className="price-tables-panel-head">
            <div className="price-tables-button-row">
              <label><span>Pricing Date</span><input type="date" value={previewDate} onChange={(event) => setPreviewDate(event.target.value)} /></label>
            </div>
          </div>
          <div className="price-tables-form-stack">
            <div className="price-tables-inline-head">
              <div className="price-tables-panel-kicker">History Dates</div>
              <div className="price-tables-segmented">
                <button type="button" className={historyDateMode === "selected" ? "price-tables-segmented-active" : ""} onClick={() => setHistoryDateMode("selected")}>Selected Date</button>
                <button type="button" className={historyDateMode === "today" ? "price-tables-segmented-active" : ""} onClick={() => setHistoryDateMode("today")}>Today</button>
                <button type="button" className={historyDateMode === "yesterday" ? "price-tables-segmented-active" : ""} onClick={() => setHistoryDateMode("yesterday")}>Yesterday</button>
                <button type="button" className={historyDateMode === "today_yesterday" ? "price-tables-segmented-active" : ""} onClick={() => setHistoryDateMode("today_yesterday")}>Today + Yesterday</button>
              </div>
            </div>
            <div className="price-tables-button-row">
              <button type="button" onClick={handleGenerateRun} disabled={!customers.length}>Generate All</button>
            </div>
            {runHistory?.outputs?.length ? (
              <div className="price-tables-table-wrap">
                <table className="table price-tables-table">
                  <thead><tr><th>Pricing Date</th><th>Terminal</th><th>Regular</th><th>Premium</th><th>Diesel</th><th>Created</th></tr></thead>
                  <tbody>
                    {runHistory.outputs.map((output) => (
                        <tr key={output.id} className={output.status && output.status !== "generated" ? "price-tables-row-error" : ""}>
                          <td>{formatDateTime(output.pricingDate)}</td>
                          <td>
                            <button type="button" className="price-tables-inline-link" onClick={() => setSelectedOutputId(output.id)}>
                              {output.customerName}
                            </button>
                          </td>
                          <td>
                            {(() => {
                              const basis = generatedBasisValues(output, "regular");
                              return (
                                <div className="price-tables-inline-basis-wrap">
                                  <span className="price-tables-inline-basis price-tables-tone-spot">{formatMoney(basis.spot)}</span>
                                  <span className="price-tables-inline-basis price-tables-tone-rack">{formatMoney(basis.rack)}</span>
                                </div>
                              );
                            })()}
                          </td>
                          <td>
                            {(() => {
                              const basis = generatedBasisValues(output, "premium");
                              return (
                                <div className="price-tables-inline-basis-wrap">
                                  <span className="price-tables-inline-basis price-tables-tone-spot">{formatMoney(basis.spot)}</span>
                                  <span className="price-tables-inline-basis price-tables-tone-rack">{formatMoney(basis.rack)}</span>
                                </div>
                              );
                            })()}
                          </td>
                          <td>
                            {(() => {
                              const basis = generatedBasisValues(output, "diesel");
                              return (
                                <div className="price-tables-inline-basis-wrap">
                                  <span className="price-tables-inline-basis price-tables-tone-spot">{formatMoney(basis.spot)}</span>
                                  <span className="price-tables-inline-basis price-tables-tone-rack">{formatMoney(basis.rack)}</span>
                                </div>
                              );
                            })()}
                          </td>
                          <td>{formatDateTime(output.createdAt)}</td>
                        </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="price-tables-empty">No persisted outputs for this date yet.</div>}
          </div>
        </section>
        <section className="card price-tables-panel price-tables-preview-panel">
          <div className="price-tables-panel-head">
            <div />
          </div>
          {selectedOutputId && !selectedOutputDetail ? (
            <div className="price-tables-empty">Loading output detail...</div>
          ) : previewOutputCards.length ? (
            <div className="price-tables-preview-stack">
              <div className="price-tables-preview-grid">
                <div className="metric-card"><div className="metric-label">Terminal</div><div className="metric-value">{selectedOutputDetail?.customerName || selectedCustomer?.name || "No terminal selected"}</div></div>
              </div>
              {previewMissingInputs.length ? <div className="price-tables-warning">{previewMissingInputs.map((item) => <div key={item.key}>{item.message}</div>)}</div> : null}
              <OutputCards outputs={previewOutputCards} fallbackStatus={previewStatus} onOpenProfile={null} />
            </div>
          ) : <div className="price-tables-empty">Run preview to inspect active rule evaluation, taxes, and per-product trace output.</div>}
        </section>
      </div>
    </div>
  );
}

