const {
  getActivePricingRuleForFamily,
  getCustomerOwnedByJobber,
  getCustomerPricingProfileForDate,
  listCustomers,
  listPricingSourceSnapshotsForDateOrLatest,
  listPricingSourceValuesForSnapshots,
  listPricingTaxes,
  pricingNullableDate,
  saveGeneratedCustomerPrice
} = require("./repositories");

const PRODUCT_FAMILIES = ["regular", "mid", "premium", "diesel"];
const RUNNABLE_SNAPSHOT_STATUSES = new Set(["ready", "locked", "published"]);

function sourceBucketFromSnapshot(snapshot) {
  return {
    id: snapshot.id,
    sourceType: snapshot.sourceType,
    sourceLabel: snapshot.sourceLabel,
    pricingDate: snapshot.pricingDate,
    status: snapshot.status
  };
}

function buildProfileInputs(profile) {
  if (!profile) return {};
  return {
    freightMiles: profile.freightMiles,
    freightCostGas: profile.freightCostGas,
    freightCostDiesel: profile.freightCostDiesel,
    rackMarginGas: profile.rackMarginGas,
    rackMarginDiesel: profile.rackMarginDiesel,
    discountRegular: profile.discountRegular,
    discountMid: profile.discountMid,
    discountPremium: profile.discountPremium,
    discountDiesel: profile.discountDiesel,
    rules: profile.rules || {}
  };
}

function taxMapForSchedules(taxSchedules) {
  const map = {};
  for (const schedule of taxSchedules) {
    if (!map[schedule.productFamily]) {
      map[schedule.productFamily] = [];
    }
    map[schedule.productFamily].push({
      id: schedule.id,
      taxName: schedule.taxName,
      value: schedule.value,
      unit: schedule.unit,
      effectiveStart: schedule.effectiveStart,
      effectiveEnd: schedule.effectiveEnd
    });
  }
  return map;
}

function sumTaxValue(taxes) {
  return taxes.reduce((sum, item) => sum + (Number.isFinite(item.value) ? item.value : 0), 0);
}

function resolveDynamicToken(token, profile) {
  const raw = String(token || "").trim();
  if (!raw.startsWith("$profile.")) return raw;
  const key = raw.slice("$profile.".length);
  const resolved = profile?.[key] ?? profile?.rules?.[key];
  return resolved == null ? "" : String(resolved);
}

function sourceValueMatchesRef(value, ref, metadata, profile) {
  if (!ref) return true;
  const filters = String(ref)
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const filter of filters) {
    const [rawKey, rawExpected = ""] = filter.split("=");
    const key = rawKey.trim();
    const expected = resolveDynamicToken(rawExpected.trim(), profile);
    const actual = key === "marketKey"
      ? value.marketKey
      : key === "terminalKey"
        ? value.terminalKey
        : key === "productKey"
          ? value.productKey
          : key === "vendorKey"
            ? value.vendorKey
            : key === "quoteCode"
              ? value.quoteCode
              : metadata?.[key];
    if (String(actual || "") !== expected) return false;
  }
  return true;
}

function customerProfileValue(profile, sourceRef) {
  if (!profile || !sourceRef) return null;
  const key = String(sourceRef).trim();
  if (!key) return null;
  return profile[key] ?? profile.rules?.[key] ?? null;
}

function sourceValueTimestamp(value) {
  const effectiveDate = value?.effectiveDate ? Date.parse(value.effectiveDate) : Number.NaN;
  if (Number.isFinite(effectiveDate)) return effectiveDate;
  const createdAt = value?.createdAt ? Date.parse(value.createdAt) : Number.NaN;
  return Number.isFinite(createdAt) ? createdAt : 0;
}

function sourceObservedInfo(value) {
  if (!value) {
    return {
      observedAt: null,
      timingLabel: null,
      sourceCity: null,
      sourceSupplier: null,
      fetchedAt: null,
      sourceEndpoint: null,
      sourceMode: null,
      publishedDate: null
    };
  }
  return {
    observedAt:
      value?.metadata?.moveDate
      || value?.metadata?.effectiveDate
      || value?.effectiveDate
      || value?.createdAt
      || null,
    timingLabel: value?.metadata?.selectedTimingLabel || null,
    sourceCity: value?.metadata?.cityName || value?.metadata?.geography || null,
    sourceSupplier: value?.metadata?.supplierName || null,
    fetchedAt: value?.metadata?.fetchedAt || null,
    sourceEndpoint: value?.metadata?.sourceEndpoint || null,
    sourceMode: value?.metadata?.sourceMode || null,
    publishedDate: value?.metadata?.effectiveDate || value?.effectiveDate || null
  };
}

function preferRackApiValues(values) {
  const rackApiValues = values.filter((value) => String(value?.quoteCode || "").trim().toUpperCase() === "OPIS_RACK_API");
  return rackApiValues.length ? rackApiValues : values;
}

function liveSourceMatches(value, metadata = {}) {
  if (!value) return false;
  if (metadata.excludeWorkbook && value?.metadata?.workbookSource) return false;
  const requireSourceType = String(metadata.requireSourceType || "").trim().toLowerCase();
  if (requireSourceType && String(value?.sourceType || "").trim().toLowerCase() !== requireSourceType) return false;
  const requireQuoteCode = String(metadata.requireQuoteCode || "").trim().toUpperCase();
  if (requireQuoteCode && String(value?.quoteCode || "").trim().toUpperCase() !== requireQuoteCode) return false;
  return true;
}

function sortSourceValuesByRecency(values) {
  return [...values].sort((left, right) => {
    const timestampDiff = sourceValueTimestamp(right) - sourceValueTimestamp(left);
    if (timestampDiff !== 0) return timestampDiff;
    return String(right.id || "").localeCompare(String(left.id || ""));
  });
}

function taxValueForRef(taxesByFamily, productFamily, sourceRef) {
  const taxes = taxesByFamily[productFamily] || [];
  if (!sourceRef) {
    return {
      value: sumTaxValue(taxes),
      detail: `${taxes.length} taxes summed for ${productFamily}`
    };
  }
  const matching = taxes.filter((item) => item.taxName === sourceRef);
  return {
    value: sumTaxValue(matching),
    detail: `${matching.length} matching taxes for ${sourceRef}`
  };
}

function vendorMinValue(sourceValues, vendorSets, component, productFamily, profile) {
  const metadata = component.metadata || {};
  const marketKey = resolveDynamicToken(metadata.marketKey || "", profile);
  const terminalKey = resolveDynamicToken(metadata.terminalKey || "", profile);
  const targetSet = vendorSets.find((item) => {
    if (item.selectionMode !== "lowest") return false;
    if (item.productFamily && item.productFamily !== productFamily) return false;
    if (marketKey && item.marketKey && item.marketKey !== marketKey) return false;
    return true;
  });
  if (!targetSet || !targetSet.vendors.length) {
    return { value: null, detail: "No matching lowest-of vendor set configured" };
  }
  const productKey = resolveDynamicToken(metadata.productKey || "", profile);
  const candidates = sourceValues.filter((value) => {
    if (marketKey && value.marketKey !== marketKey) return false;
    if (terminalKey && value.terminalKey !== terminalKey) return false;
    if (productKey && value.productKey !== productKey) return false;
    return targetSet.vendors.includes(value.vendorKey);
  });
  const preferredCandidates = preferRackApiValues(candidates);
  if (!preferredCandidates.length) {
    return { value: null, detail: "No source values matched the configured vendor set" };
  }
  const latestPerVendor = [];
  const seenVendors = new Set();
  for (const candidate of sortSourceValuesByRecency(preferredCandidates)) {
    const vendorKey = String(candidate.vendorKey || "").trim();
    if (!vendorKey || seenVendors.has(vendorKey)) continue;
    seenVendors.add(vendorKey);
    latestPerVendor.push(candidate);
  }
  const selected = latestPerVendor.reduce((lowest, current) => {
    if (lowest == null) return current;
    return (current.value ?? Number.POSITIVE_INFINITY) < (lowest.value ?? Number.POSITIVE_INFINITY) ? current : lowest;
  }, null);
  return {
    value: selected?.value ?? null,
    detail: `Lowest value from freshest vendor rows ${targetSet.vendors.join(", ")} for ${terminalKey || marketKey || "selected profile"}`,
    matchedValueId: selected?.id || null,
    matchedValue: selected || null
  };
}

function vendorAverageValue(sourceValues, vendorSets, component, productFamily, profile) {
  const metadata = component.metadata || {};
  const marketKey = resolveDynamicToken(metadata.marketKey || "", profile);
  const terminalKey = resolveDynamicToken(metadata.terminalKey || "", profile);
  const targetSet = vendorSets.find((item) => {
    if (item.selectionMode !== "lowest") return false;
    if (item.productFamily && item.productFamily !== productFamily) return false;
    if (marketKey && item.marketKey && item.marketKey !== marketKey) return false;
    return true;
  });
  if (!targetSet || !targetSet.vendors.length) {
    return { value: null, detail: "No matching vendor set configured", matchedValue: null };
  }
  const productKey = resolveDynamicToken(metadata.productKey || "", profile);
  const candidates = sourceValues.filter((value) => {
    if (marketKey && value.marketKey !== marketKey) return false;
    if (terminalKey && value.terminalKey !== terminalKey) return false;
    if (productKey && value.productKey !== productKey) return false;
    if (!liveSourceMatches(value, metadata)) return false;
    return targetSet.vendors.includes(value.vendorKey);
  });
  const preferredCandidates = preferRackApiValues(candidates);
  if (!preferredCandidates.length) {
    return { value: null, detail: "No source values matched the configured vendor set", matchedValue: null };
  }
  const latestPerVendor = [];
  const seenVendors = new Set();
  for (const candidate of sortSourceValuesByRecency(preferredCandidates)) {
    const vendorKey = String(candidate.vendorKey || "").trim();
    if (!vendorKey || seenVendors.has(vendorKey)) continue;
    seenVendors.add(vendorKey);
    latestPerVendor.push(candidate);
  }
  const numeric = latestPerVendor.map((item) => item.value).filter(Number.isFinite);
  if (!numeric.length) {
    return { value: null, detail: "Matched vendor rows had no numeric values", matchedValue: latestPerVendor[0] || null };
  }
  return {
    value: Number((numeric.reduce((sum, item) => sum + item, 0) / numeric.length).toFixed(4)),
    detail: `Average value from freshest vendor rows ${targetSet.vendors.join(", ")} for ${terminalKey || marketKey || "selected profile"}`,
    matchedValue: latestPerVendor[0] || null
  };
}

function bestSpotOrRackValue(sourceValues, vendorSets, component, productFamily, profile) {
  const metadata = component.metadata || {};
  const spotRef = String(metadata.spotSourceRef || component.sourceRef || "").trim();
  const rackRef = String(
    metadata.rackSourceRef
    || `marketKey=$profile.marketKey|terminalKey=$profile.terminalKey|productKey=${resolveDynamicToken(metadata.productKey || "", profile)}|quoteCode=OPIS_RACK_API_AVG`
  ).trim();
  const marketKey = resolveDynamicToken(metadata.marketKey || "", profile);
  const terminalKey = resolveDynamicToken(metadata.terminalKey || "", profile);
  const spotComponent = {
    ...component,
    sourceRef: spotRef,
    metadata: {
      excludeWorkbook: true,
      requireSourceType: "opis"
    }
  };
  const rackComponent = {
    ...component,
    sourceRef: rackRef,
    metadata: {
      marketKey: metadata.rackMarketKey || metadata.marketKey || "",
      terminalKey: metadata.rackTerminalKey || metadata.terminalKey || "",
      productKey: metadata.rackProductKey || metadata.productKey || "",
      requireQuoteCode: "OPIS_RACK_API_AVG",
      excludeWorkbook: true,
      requireSourceType: "opis"
    }
  };
  const spotResolved = spotRef ? sourceValueFromComponent(sourceValues, spotComponent, profile) : { value: null, detail: "No spot source configured" };
  let rackResolved = sourceValueFromComponent(sourceValues, rackComponent, profile);
  if (!Number.isFinite(rackResolved.value)) {
    const vendorRackComponent = {
      ...component,
      metadata: {
        marketKey: metadata.rackMarketKey || metadata.marketKey || "",
        terminalKey: metadata.rackTerminalKey || metadata.terminalKey || "",
        productKey: metadata.rackProductKey || metadata.productKey || "",
        requireQuoteCode: "OPIS_RACK_API",
        excludeWorkbook: true,
        requireSourceType: "opis"
      }
    };
    rackResolved = vendorAverageValue(sourceValues, vendorSets, vendorRackComponent, productFamily, profile);
  }
  const spotValue = Number.isFinite(spotResolved.value) ? spotResolved.value : null;
  const rackValue = Number.isFinite(rackResolved.value) ? rackResolved.value : null;

  if (spotValue == null && rackValue == null) {
    return { value: null, detail: "No spot or rack source value matched" };
  }

  const useSpot = rackValue == null || (spotValue != null && spotValue <= rackValue);
  const chosenValue = useSpot ? spotValue : rackValue;
  const recommendation = useSpot ? "spot" : "rack";
  const compared = [
    spotValue != null ? `spot ${spotValue.toFixed(4)}` : "spot n/a",
    rackValue != null ? `rack ${rackValue.toFixed(4)}` : "rack n/a"
  ].join(" vs ");

  return {
    value: chosenValue,
    detail: `${compared}; using ${terminalKey || marketKey || "selected profile"}; selected lowest of day ${recommendation}`,
    recommendation,
    spotValue,
    rackValue,
    marketKey,
    terminalKey,
    matchedValueId: useSpot ? (spotResolved.matchedValueId || null) : (rackResolved.matchedValueId || null),
    matchedValue: useSpot ? (spotResolved.matchedValue || null) : (rackResolved.matchedValue || null),
    spotMatchedValue: spotResolved.matchedValue || null,
    rackMatchedValue: rackResolved.matchedValue || null
  };
}

function sourceValueFromComponent(sourceValues, component, profile) {
  const metadata = component.metadata || {};
  const matches = sourceValues.filter((value) => (
    sourceValueMatchesRef(value, component.sourceRef, metadata, profile) &&
    liveSourceMatches(value, metadata)
  ));
  if (!matches.length) {
    return { value: component.defaultValue ?? null, detail: "No source value matched; default used" };
  }
  const selectionMode = metadata.selectionMode || "first";
  if (selectionMode === "sum") {
    return {
      value: matches.reduce((sum, item) => sum + (Number.isFinite(item.value) ? item.value : 0), 0),
      detail: `${matches.length} source values summed`
    };
  }
  const selected = sortSourceValuesByRecency(matches)[0];
  return {
    value: selected.value ?? component.defaultValue ?? null,
    detail: "Matched freshest source value",
    matchedValueId: selected.id,
    matchedValue: selected
  };
}

function evaluateRuleComponent({ component, productFamily, profile, sourceValues, taxesByFamily, vendorSets }) {
  if (component.sourceKind === "constant" || component.sourceKind === "default") {
    return {
      rawValue: component.defaultValue ?? null,
      detail: "Constant/default component"
    };
  }
  if (component.sourceKind === "customer_profile") {
    return {
      rawValue: customerProfileValue(profile, component.sourceRef),
      detail: `Customer profile field ${component.sourceRef || "(missing)"}`
    };
  }
  if (component.sourceKind === "tax") {
    const resolved = taxValueForRef(taxesByFamily, productFamily, component.sourceRef);
    return {
      rawValue: resolved.value,
      detail: resolved.detail
    };
  }
  if (component.sourceKind === "vendor_min") {
    const resolved = vendorMinValue(sourceValues, vendorSets, component, productFamily, profile);
    return {
      rawValue: resolved.value,
      detail: resolved.detail,
      matchedValueId: resolved.matchedValueId || null
    };
  }
  if (component.sourceKind === "spot_or_rack_best") {
    const resolved = bestSpotOrRackValue(sourceValues, vendorSets, component, productFamily, profile);
    return {
      rawValue: resolved.value,
      detail: resolved.detail,
      matchedValueId: resolved.matchedValueId || null,
      recommendation: resolved.recommendation || null,
      spotValue: resolved.spotValue ?? null,
      rackValue: resolved.rackValue ?? null,
      marketKey: resolved.marketKey || null,
      terminalKey: resolved.terminalKey || null,
      matchedValue: resolved.matchedValue || null,
      spotMatchedValue: resolved.spotMatchedValue || null,
      rackMatchedValue: resolved.rackMatchedValue || null
    };
  }
  if (component.sourceKind === "source_value") {
    const resolved = sourceValueFromComponent(sourceValues, component, profile);
    return {
      rawValue: resolved.value,
      detail: resolved.detail,
      matchedValueId: resolved.matchedValueId || null,
      matchedValue: resolved.matchedValue || null
    };
  }
  return {
    rawValue: component.defaultValue ?? null,
    detail: `Unsupported sourceKind ${component.sourceKind}; default used`
  };
}

function evaluateRuleSet({ ruleSet, productFamily, profile, sourceValues, taxesByFamily }) {
  if (!ruleSet) return null;
  const componentTraces = [];
  let subtotal = 0;
  for (const component of ruleSet.components || []) {
    const resolved = evaluateRuleComponent({
      component,
      productFamily,
      profile,
      sourceValues,
      taxesByFamily,
      vendorSets: ruleSet.vendorSets || []
    });
    const rawValue = Number.isFinite(resolved.rawValue) ? resolved.rawValue : null;
    const multiplier = Number.isFinite(component.multiplier) ? component.multiplier : 1;
    const contribution = rawValue == null ? null : rawValue * multiplier;
    if (contribution != null) subtotal += contribution;
    const matchedInfo = sourceObservedInfo(resolved.matchedValue || null);
    const spotInfo = sourceObservedInfo(resolved.spotMatchedValue || null);
    const rackInfo = sourceObservedInfo(resolved.rackMatchedValue || null);
    componentTraces.push({
      componentKey: component.componentKey,
      label: component.label,
      sourceKind: component.sourceKind,
      sourceRef: component.sourceRef,
      rawValue,
      multiplier,
      contribution,
      detail: resolved.detail,
      matchedValueId: resolved.matchedValueId || null,
      recommendation: resolved.recommendation || null,
      spotValue: Number.isFinite(resolved.spotValue) ? resolved.spotValue : null,
      rackValue: Number.isFinite(resolved.rackValue) ? resolved.rackValue : null,
      marketKey: resolved.marketKey || null,
      terminalKey: resolved.terminalKey || null,
      matchedValueId: resolved.matchedValueId || null,
      matchedObservedAt: matchedInfo.observedAt,
      matchedTimingLabel: matchedInfo.timingLabel,
      spotObservedAt: spotInfo.observedAt,
      spotTimingLabel: spotInfo.timingLabel,
      spotSourceCity: spotInfo.sourceCity,
      spotSourceSupplier: spotInfo.sourceSupplier,
      spotFetchedAt: spotInfo.fetchedAt,
      spotSourceEndpoint: spotInfo.sourceEndpoint,
      spotSourceMode: spotInfo.sourceMode,
      spotPublishedDate: spotInfo.publishedDate,
      rackObservedAt: rackInfo.observedAt,
      rackTimingLabel: rackInfo.timingLabel,
      rackSourceCity: rackInfo.sourceCity,
      rackSourceSupplier: rackInfo.sourceSupplier,
      rackFetchedAt: rackInfo.fetchedAt,
      rackSourceEndpoint: rackInfo.sourceEndpoint,
      rackSourceMode: rackInfo.sourceMode,
      rackPublishedDate: rackInfo.publishedDate
    });
  }
  return {
    ruleSet: {
      id: ruleSet.id,
      name: ruleSet.name,
      productFamily: ruleSet.productFamily,
      effectiveStart: ruleSet.effectiveStart,
      effectiveEnd: ruleSet.effectiveEnd,
      versionLabel: ruleSet.versionLabel,
      status: ruleSet.status
    },
    subtotal: Number(subtotal.toFixed(4)),
    componentTraces
  };
}

function buildMissingInputs({ customer, profile, sourceSnapshots, taxesByFamily }) {
  const missing = [];
  if (!customer) {
    missing.push({ key: "customer", message: "Customer was not found for the active jobber" });
    return missing;
  }
  if (!profile) {
    missing.push({ key: "pricing_profile", message: "No customer pricing profile is active for the requested pricing date" });
  }
  if (!sourceSnapshots.length) {
    missing.push({ key: "pricing_sources", message: "No pricing source snapshots exist for the requested pricing date" });
  }
  for (const family of PRODUCT_FAMILIES) {
    if (!taxesByFamily[family]?.length) {
      missing.push({ key: `tax_${family}`, message: `No active tax schedule found for ${family}` });
    }
  }
  return missing;
}

function collectSnapshotReadinessIssues(sourceSnapshots) {
  if (!sourceSnapshots.length) return [];
  const runnableSnapshots = sourceSnapshots.filter((snapshot) => RUNNABLE_SNAPSHOT_STATUSES.has(snapshot.status));
  if (runnableSnapshots.length) return [];
  return [{
    key: "pricing_sources_ready",
    message: "No pricing source snapshot is in ready or locked status for the requested pricing date"
  }];
}

function collectRuleSourceGaps({ activeRules, profile, sourceValues, taxesByFamily }) {
  const missing = [];
  for (const ruleSet of activeRules.filter(Boolean)) {
    for (const component of ruleSet.components || []) {
      if (component.sourceKind !== "source_value" && component.sourceKind !== "vendor_min" && component.sourceKind !== "spot_or_rack_best") continue;
      const resolved = evaluateRuleComponent({
        component,
        productFamily: ruleSet.productFamily,
        profile,
        sourceValues,
        taxesByFamily,
        vendorSets: ruleSet.vendorSets || []
      });
      if (Number.isFinite(resolved.rawValue)) continue;
      missing.push({
        key: `rule_component_${ruleSet.productFamily}_${component.componentKey}`,
        message: `${ruleSet.productFamily} rule component ${component.componentKey} is missing a matching source value`
      });
    }
  }
  return missing;
}

const TERMINAL_DERIVED_DEFAULTS = {
  benicia_terminal: {
    distributionLabel: "Fairfield UNB",
    gasSalesTaxRate: 0.08375,
    dieselSalesTaxRate: 0.13,
    freightGas: 0.05,
    freightDiesel: 0.1
  },
  sacramento_terminal: {
    distributionLabel: "Sacramento UNB",
    gasSalesTaxRate: 0.08375,
    dieselSalesTaxRate: 0.13,
    freightGas: 0.05,
    freightDiesel: 0.1
  },
  stockton_terminal: {
    distributionLabel: "Stockton",
    gasSalesTaxRate: 0.08875,
    dieselSalesTaxRate: 0.13,
    freightGas: 0.07,
    freightDiesel: 0.1
  },
  san_jose_terminal: {
    distributionLabel: "San Jose UNB",
    gasSalesTaxRate: 0.08875,
    dieselSalesTaxRate: 0.13,
    freightGas: 0.07,
    freightDiesel: 0.1
  },
  san_francisco_terminal: {
    distributionLabel: "Fairfield UNB",
    gasSalesTaxRate: 0.08375,
    dieselSalesTaxRate: 0.13,
    freightGas: 0.05,
    freightDiesel: 0.1
  }
};

function profileRuleNumber(profile, key, fallback = null) {
  const raw = profile?.rules?.[key];
  return Number.isFinite(raw) ? raw : fallback;
}

function landedCostSettings(profile, family) {
  const terminalKey = profile?.rules?.terminalKey || "";
  const defaults = TERMINAL_DERIVED_DEFAULTS[terminalKey] || TERMINAL_DERIVED_DEFAULTS.san_francisco_terminal;
  const isDiesel = family === "diesel";
  return {
    distributionLabel: profile?.rules?.distributionLabel || defaults.distributionLabel,
    prepay: profileRuleNumber(profile, isDiesel ? "dieselPrepay" : "gasPrepay", isDiesel ? 0.385 : 0.075),
    fedExcise: profileRuleNumber(profile, isDiesel ? "dieselFedExcise" : "gasFedExcise", isDiesel ? 0.244 : 0.184),
    stateExcise: profileRuleNumber(profile, isDiesel ? "dieselStateExcise" : "gasStateExcise", isDiesel ? 0.466 : 0.612),
    salesTaxRate: profileRuleNumber(profile, isDiesel ? "dieselSalesTaxRate" : "gasSalesTaxRate", isDiesel ? defaults.dieselSalesTaxRate : defaults.gasSalesTaxRate),
    storageFee: profileRuleNumber(profile, "storageFee", 0.02),
    freight: isDiesel
      ? (Number.isFinite(profile?.freightCostDiesel) ? profile.freightCostDiesel : defaults.freightDiesel)
      : (Number.isFinite(profile?.freightCostGas) ? profile.freightCostGas : defaults.freightGas),
    retailMargin: profileRuleNumber(
      profile,
      isDiesel ? "dieselRetailMargin" : "gasRetailMargin",
      isDiesel
        ? (Number.isFinite(profile?.rackMarginDiesel) ? profile.rackMarginDiesel : 0.15)
        : (Number.isFinite(profile?.rackMarginGas) ? profile.rackMarginGas : 0.15)
    )
  };
}

function computeLandedCostBreakdown({ family, output, profile }) {
  const basis = basisTraceItem(output?.trace || []);
  if (!basis || !Number.isFinite(basis.rawValue)) return null;
  const settings = landedCostSettings(profile, family);
  function modeBreakdown(todayCost) {
    if (!Number.isFinite(todayCost)) return null;
    const totalAmt = Number((todayCost + settings.prepay).toFixed(4));
    const taxableBase = Number((totalAmt - settings.fedExcise - settings.stateExcise).toFixed(4));
    const salesTaxAmt = Number((taxableBase * settings.salesTaxRate).toFixed(6));
    const landedCostPrice = Number((totalAmt + settings.fedExcise + settings.stateExcise + salesTaxAmt + settings.storageFee + settings.freight).toFixed(6));
    const suggestedMinRetailPrice = Number((landedCostPrice + settings.retailMargin).toFixed(6));
    return {
      todayCost: Number(todayCost),
      totalAmt,
      taxableBase,
      salesTaxAmt,
      landedCostPrice,
      suggestedMinRetailPrice
    };
  }

  const selectedBreakdown = modeBreakdown(basis.rawValue);
  const spotBreakdown = modeBreakdown(basis.spotValue);
  const rackBreakdown = modeBreakdown(basis.rackValue);
  if (!selectedBreakdown) return null;
  return {
    distributionLabel: settings.distributionLabel,
    todayCost: selectedBreakdown.todayCost,
    prepay: settings.prepay,
    totalAmt: selectedBreakdown.totalAmt,
    fedExcise: settings.fedExcise,
    stateExcise: settings.stateExcise,
    taxableBase: selectedBreakdown.taxableBase,
    salesTaxRate: settings.salesTaxRate,
    salesTaxAmt: selectedBreakdown.salesTaxAmt,
    storageFee: settings.storageFee,
    freight: settings.freight,
    landedCostPrice: selectedBreakdown.landedCostPrice,
    retailMargin: settings.retailMargin,
    suggestedMinRetailPrice: selectedBreakdown.suggestedMinRetailPrice,
    spotTodayCost: spotBreakdown?.todayCost ?? null,
    rackTodayCost: rackBreakdown?.todayCost ?? null,
    spotTotalAmt: spotBreakdown?.totalAmt ?? null,
    rackTotalAmt: rackBreakdown?.totalAmt ?? null,
    spotTaxableBase: spotBreakdown?.taxableBase ?? null,
    rackTaxableBase: rackBreakdown?.taxableBase ?? null,
    spotSalesTaxAmt: spotBreakdown?.salesTaxAmt ?? null,
    rackSalesTaxAmt: rackBreakdown?.salesTaxAmt ?? null,
    spotLandedCost: spotBreakdown?.landedCostPrice ?? null,
    rackLandedCost: rackBreakdown?.landedCostPrice ?? null,
    spotSuggestedMinRetailPrice: spotBreakdown?.suggestedMinRetailPrice ?? null,
    rackSuggestedMinRetailPrice: rackBreakdown?.suggestedMinRetailPrice ?? null,
    difference: spotBreakdown?.landedCostPrice != null && rackBreakdown?.landedCostPrice != null ? Number((spotBreakdown.landedCostPrice - rackBreakdown.landedCostPrice).toFixed(6)) : null
  };
}

function basisTraceItem(trace) {
  return (trace || []).find((item) => Number.isFinite(item?.spotValue) || Number.isFinite(item?.rackValue)) || null;
}

function skeletonOutputs(profile, taxesByFamily, ruleEvaluations) {
  const gasFreight = profile?.freightCostGas ?? null;
  const dieselFreight = profile?.freightCostDiesel ?? null;
  const outputs = [];
  for (const family of PRODUCT_FAMILIES) {
    const taxes = taxesByFamily[family] || [];
    const ruleEvaluation = ruleEvaluations[family] || null;
    const freight =
      family === "diesel"
        ? dieselFreight
        : gasFreight;
    const margin =
      family === "diesel"
        ? profile?.rackMarginDiesel ?? null
        : profile?.rackMarginGas ?? null;
    const discount =
      family === "regular"
        ? profile?.discountRegular ?? null
        : family === "mid"
          ? profile?.discountMid ?? null
          : family === "premium"
            ? profile?.discountPremium ?? null
            : profile?.discountDiesel ?? null;
    const fallbackBase = [freight, margin]
      .filter((value) => Number.isFinite(value))
      .reduce((sum, value) => sum + value, 0);
    const ruleBase = ruleEvaluation ? ruleEvaluation.subtotal : fallbackBase || null;
    const taxTotal = sumTaxValue(taxes);
    const output = {
      productFamily: family,
      status: ruleEvaluation ? "rule_evaluated" : "placeholder",
      basePrice: ruleBase,
      taxes: taxTotal || null,
      totalPrice: ruleBase || taxTotal ? Number(((ruleBase || 0) + taxTotal).toFixed(4)) : null,
      trace: [
        ...(ruleEvaluation
          ? ruleEvaluation.componentTraces.map((item) => ({
              kind: "rule_component",
              ...item
            }))
          : [
              {
                kind: "placeholder_base",
                value: fallbackBase || null,
                detail: "No active rule set found; using profile freight and rack margin as the provisional base"
              }
            ]),
        {
          kind: "active_taxes",
          value: taxTotal || null,
          detail: `${taxes.length} active tax schedules applied by product family`
        },
        {
          kind: "discount_not_applied",
          value: discount,
          detail: "Discount is loaded into the trace but not yet applied until rule sets are wired"
        }
      ]
    };
    const landedCost = computeLandedCostBreakdown({ family, output, profile });
    if (landedCost) {
      output.todayCost = landedCost.todayCost;
      output.taxes = Number((landedCost.fedExcise + landedCost.stateExcise + landedCost.salesTaxAmt).toFixed(6));
      output.totalPrice = landedCost.landedCostPrice;
      output.landedCostPrice = landedCost.landedCostPrice;
      output.suggestedMinRetailPrice = landedCost.suggestedMinRetailPrice;
      output.basisComparison = {
        spotBasis: basisTraceItem(output.trace)?.spotValue ?? null,
        rackBasis: basisTraceItem(output.trace)?.rackValue ?? null,
        selectedBasis: basisTraceItem(output.trace)?.recommendation || null,
        spotTotal: landedCost.spotLandedCost,
        rackTotal: landedCost.rackLandedCost,
        difference: landedCost.difference,
        spotObservedAt: basisTraceItem(output.trace)?.spotObservedAt || null,
        rackObservedAt: basisTraceItem(output.trace)?.rackObservedAt || null,
        spotFetchedAt: basisTraceItem(output.trace)?.spotFetchedAt || null,
        rackFetchedAt: basisTraceItem(output.trace)?.rackFetchedAt || null,
        spotTimingLabel: basisTraceItem(output.trace)?.spotTimingLabel || null,
        rackTimingLabel: basisTraceItem(output.trace)?.rackTimingLabel || null,
        spotSourceEndpoint: basisTraceItem(output.trace)?.spotSourceEndpoint || null,
        rackSourceEndpoint: basisTraceItem(output.trace)?.rackSourceEndpoint || null,
        spotSourceMode: basisTraceItem(output.trace)?.spotSourceMode || null,
        rackSourceMode: basisTraceItem(output.trace)?.rackSourceMode || null,
        spotPublishedDate: basisTraceItem(output.trace)?.spotPublishedDate || null,
        rackPublishedDate: basisTraceItem(output.trace)?.rackPublishedDate || null,
        spotSourceCity: basisTraceItem(output.trace)?.spotSourceCity || null,
        rackSourceCity: basisTraceItem(output.trace)?.rackSourceCity || null,
        spotSourceSupplier: basisTraceItem(output.trace)?.spotSourceSupplier || null,
        rackSourceSupplier: basisTraceItem(output.trace)?.rackSourceSupplier || null
      };
      output.trace.push(
        { kind: "derived_metric", label: "Distribution Terminal", value: landedCost.distributionLabel, detail: "Distribution terminal used for landed cost pricing" },
        { kind: "derived_metric", label: "Today's Cost", value: landedCost.todayCost, spotValue: landedCost.spotTodayCost, rackValue: landedCost.rackTodayCost, detail: "Selected spot or rack basis" },
        { kind: "derived_metric", label: "Prepay", value: landedCost.prepay, spotValue: landedCost.prepay, rackValue: landedCost.prepay, detail: "Prepay amount added to today's cost", sourcePath: family === "diesel" ? "Profile > dieselPrepay" : "Profile > gasPrepay" },
        { kind: "derived_metric", label: "Total Amt", value: landedCost.totalAmt, spotValue: landedCost.spotTotalAmt, rackValue: landedCost.rackTotalAmt, detail: "Today's cost plus prepay" },
        { kind: "derived_metric", label: "Fed Excise", value: landedCost.fedExcise, spotValue: landedCost.fedExcise, rackValue: landedCost.fedExcise, detail: "Federal excise tax", sourcePath: family === "diesel" ? "Profile > dieselFedExcise" : "Profile > gasFedExcise" },
        { kind: "derived_metric", label: "State Excise", value: landedCost.stateExcise, spotValue: landedCost.stateExcise, rackValue: landedCost.stateExcise, detail: "State excise tax", sourcePath: family === "diesel" ? "Profile > dieselStateExcise" : "Profile > gasStateExcise" },
        { kind: "derived_metric", label: "Taxable Base", value: landedCost.taxableBase, spotValue: landedCost.spotTaxableBase, rackValue: landedCost.rackTaxableBase, detail: "Total amount minus excise taxes" },
        { kind: "derived_metric", label: "Sales Tax Amt", value: landedCost.salesTaxAmt, spotValue: landedCost.spotSalesTaxAmt, rackValue: landedCost.rackSalesTaxAmt, detail: `Taxable base multiplied by sales tax rate ${landedCost.salesTaxRate}`, sourcePath: family === "diesel" ? "Profile > dieselSalesTaxRate" : "Profile > gasSalesTaxRate" },
        { kind: "derived_metric", label: "Storage Fees", value: landedCost.storageFee, spotValue: landedCost.storageFee, rackValue: landedCost.storageFee, detail: "Storage fee", sourcePath: "Profile > storageFee" },
        { kind: "derived_metric", label: "Freight", value: landedCost.freight, spotValue: landedCost.freight, rackValue: landedCost.freight, detail: "Freight charge from profile/terminal defaults", sourcePath: family === "diesel" ? "Profile > freightCostDiesel" : "Profile > freightCostGas" },
        { kind: "derived_metric", label: "Landed Cost Price", value: landedCost.landedCostPrice, spotValue: landedCost.spotLandedCost, rackValue: landedCost.rackLandedCost, detail: "Workbook landed cost formula output" },
        { kind: "derived_metric", label: "Suggested Min Retail Price", value: landedCost.suggestedMinRetailPrice, spotValue: landedCost.spotSuggestedMinRetailPrice, rackValue: landedCost.rackSuggestedMinRetailPrice, detail: `Landed cost plus retail margin ${landedCost.retailMargin}`, sourcePath: family === "diesel" ? "Profile > dieselRetailMargin" : "Profile > gasRetailMargin" }
      );
    }
    outputs.push(output);
  }
  return outputs;
}

function buildSourceSnapshotGroup(sourceSnapshots) {
  return {
    snapshotIds: sourceSnapshots.map((snapshot) => snapshot.id),
    sourceTypes: [...new Set(sourceSnapshots.map((snapshot) => snapshot.sourceType).filter(Boolean))],
    sourceLabels: sourceSnapshots
      .map((snapshot) => snapshot.sourceLabel || snapshot.sourceType)
      .filter(Boolean)
  };
}

function buildGeneratedOutputPayload(preview) {
  const primaryRuleSetId = preview.activeRules?.[0]?.id || null;
  return {
    ruleSetId: primaryRuleSetId,
    sourceSnapshotGroup: buildSourceSnapshotGroup(preview.sourceSnapshots || []),
    outputs: preview.outputs || [],
    status: preview.missingInputs?.length ? "failed" : "generated",
    detail: {
      pricingDate: preview.pricingDate,
      customer: preview.customer,
      profile: preview.profile,
      sourceSnapshots: preview.sourceSnapshots,
      sourceValueCount: preview.sourceValueCount,
      activeRules: preview.activeRules,
      taxesByFamily: preview.taxesByFamily,
      missingInputs: preview.missingInputs,
      outputs: preview.outputs,
      trace: preview.trace
    }
  };
}

async function evaluateCustomerPricing({ jobberId, customerId, pricingDate }) {
  const normalizedPricingDate = pricingNullableDate(pricingDate) || new Date().toISOString().slice(0, 10);
  const [customer, profile, sourceSnapshotLookup, taxSchedules, activeRules] = await Promise.all([
    getCustomerOwnedByJobber(jobberId, customerId),
    getCustomerPricingProfileForDate(jobberId, customerId, normalizedPricingDate),
    listPricingSourceSnapshotsForDateOrLatest(jobberId, normalizedPricingDate),
    listPricingTaxes(jobberId, { effectiveDate: normalizedPricingDate }),
    Promise.all(PRODUCT_FAMILIES.map((family) => getActivePricingRuleForFamily(jobberId, family, normalizedPricingDate)))
  ]);
  const allSourceSnapshots = sourceSnapshotLookup.snapshots || [];
  const sourceSnapshots = allSourceSnapshots.filter((snapshot) => RUNNABLE_SNAPSHOT_STATUSES.has(snapshot.status));
  const sourceValues = sourceSnapshots.length
    ? await listPricingSourceValuesForSnapshots(sourceSnapshots.map((snapshot) => snapshot.id))
    : [];

  const taxesByFamily = taxMapForSchedules(taxSchedules);
  const ruleEvaluations = {};
  for (const ruleSet of activeRules) {
    if (!ruleSet) continue;
    ruleEvaluations[ruleSet.productFamily] = evaluateRuleSet({
      ruleSet,
      productFamily: ruleSet.productFamily,
      profile,
      sourceValues,
      taxesByFamily
    });
  }

  const missingInputs = buildMissingInputs({
    customer,
    profile,
    sourceSnapshots: allSourceSnapshots,
    taxesByFamily
  });
  missingInputs.push(...collectSnapshotReadinessIssues(allSourceSnapshots));
  missingInputs.push(...collectRuleSourceGaps({
    activeRules,
    profile,
    sourceValues,
    taxesByFamily
  }));

  return {
    pricingDate: normalizedPricingDate,
    status: missingInputs.length ? "incomplete" : "ready_for_rules",
    customer: customer
      ? {
          id: customer.id,
          name: customer.name,
          terminalKey: customer.terminalKey,
          status: customer.status
        }
      : null,
    profile: profile
      ? {
          id: profile.id,
          effectiveStart: profile.effectiveStart,
          effectiveEnd: profile.effectiveEnd,
          inputs: buildProfileInputs(profile)
        }
      : null,
    sourceSnapshots: sourceSnapshots.map(sourceBucketFromSnapshot),
    sourceSnapshotSummary: {
      requestedPricingDate: sourceSnapshotLookup.requestedPricingDate,
      resolvedPricingDate: sourceSnapshotLookup.resolvedPricingDate,
      usedFallbackDate: !!sourceSnapshotLookup.usedFallbackDate,
      totalCount: allSourceSnapshots.length,
      runnableCount: sourceSnapshots.length,
      draftCount: allSourceSnapshots.filter((snapshot) => snapshot.status === "draft").length
    },
    sourceValueCount: sourceValues.length,
    activeRules: activeRules.filter(Boolean).map((ruleSet) => ({
      id: ruleSet.id,
      name: ruleSet.name,
      productFamily: ruleSet.productFamily,
      effectiveStart: ruleSet.effectiveStart,
      versionLabel: ruleSet.versionLabel,
      status: ruleSet.status
    })),
    taxesByFamily,
    missingInputs,
    outputs: skeletonOutputs(profile, taxesByFamily, ruleEvaluations),
    trace: {
      notes: [
        "This is the pricing-engine skeleton. It now evaluates configured rule components against source values, taxes, customer profile values, constants, and lowest-of vendor sets.",
        "Only ready or locked source snapshots are eligible for preview and generation.",
        sourceSnapshotLookup.usedFallbackDate
          ? `No snapshots existed for ${normalizedPricingDate}, so the engine used the latest available snapshot date ${sourceSnapshotLookup.resolvedPricingDate}.`
          : null,
        "Workbook-specific branching and branded/unbranded orchestration are still pending, but pricing runs can now be persisted for history/output review."
      ].filter(Boolean)
    }
  };
}

async function previewCustomerPricing({ jobberId, customerId, pricingDate }) {
  return evaluateCustomerPricing({ jobberId, customerId, pricingDate });
}

async function generateCustomerPricingRun({ jobberId, userId, pricingDate, customerId }) {
  const normalizedPricingDate = pricingNullableDate(pricingDate) || new Date().toISOString().slice(0, 10);
  const targetCustomers = customerId
    ? [await getCustomerOwnedByJobber(jobberId, customerId)]
    : await listCustomers(jobberId);

  if (customerId && !targetCustomers[0]) {
    return {
      pricingDate: normalizedPricingDate,
      generatedCount: 0,
      incompleteCount: 0,
      outputs: []
    };
  }

  const persistedOutputs = [];
  const skippedOutputs = [];
  for (const customer of targetCustomers.filter(Boolean)) {
    const preview = await evaluateCustomerPricing({
      jobberId,
      customerId: customer.id,
      pricingDate: normalizedPricingDate
    });
    if (preview.missingInputs?.length) {
      skippedOutputs.push({
        customerId: customer.id,
        customerName: customer.name,
        status: "incomplete",
        missingInputs: preview.missingInputs
      });
      continue;
    }
    const saved = await saveGeneratedCustomerPrice(jobberId, userId, {
      customerId: customer.id,
      pricingDate: normalizedPricingDate,
      ...buildGeneratedOutputPayload(preview)
    });
    if (saved) {
      persistedOutputs.push(saved);
    }
  }

  return {
    pricingDate: normalizedPricingDate,
    generatedCount: persistedOutputs.length,
    incompleteCount: skippedOutputs.length,
    outputs: persistedOutputs,
    skipped: skippedOutputs
  };
}

module.exports = {
  generateCustomerPricingRun,
  previewCustomerPricing
};
