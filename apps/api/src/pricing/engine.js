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
    if (productKey && value.productKey !== productKey) return false;
    return targetSet.vendors.includes(value.vendorKey);
  });
  if (!candidates.length) {
    return { value: null, detail: "No source values matched the configured vendor set" };
  }
  const selected = candidates.reduce((lowest, current) => {
    if (lowest == null) return current;
    return (current.value ?? Number.POSITIVE_INFINITY) < (lowest.value ?? Number.POSITIVE_INFINITY) ? current : lowest;
  }, null);
  return {
    value: selected?.value ?? null,
    detail: `Lowest value from vendors ${targetSet.vendors.join(", ")}`,
    matchedValueId: selected?.id || null
  };
}

function sourceValueFromComponent(sourceValues, component, profile) {
  const metadata = component.metadata || {};
  const matches = sourceValues.filter((value) => sourceValueMatchesRef(value, component.sourceRef, metadata, profile));
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
  const selected = matches[0];
  return {
    value: selected.value ?? component.defaultValue ?? null,
    detail: "Matched source value",
    matchedValueId: selected.id
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
  if (component.sourceKind === "source_value") {
    const resolved = sourceValueFromComponent(sourceValues, component, profile);
    return {
      rawValue: resolved.value,
      detail: resolved.detail,
      matchedValueId: resolved.matchedValueId || null
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
    componentTraces.push({
      componentKey: component.componentKey,
      label: component.label,
      sourceKind: component.sourceKind,
      sourceRef: component.sourceRef,
      rawValue,
      multiplier,
      contribution,
      detail: resolved.detail,
      matchedValueId: resolved.matchedValueId || null
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
      if (component.sourceKind !== "source_value" && component.sourceKind !== "vendor_min") continue;
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
    const basePrice = ruleEvaluation ? ruleEvaluation.subtotal : fallbackBase || null;
    const taxTotal = sumTaxValue(taxes);
    outputs.push({
      productFamily: family,
      status: ruleEvaluation ? "rule_evaluated" : "placeholder",
      basePrice,
      taxes: taxTotal || null,
      totalPrice: basePrice || taxTotal ? Number(((basePrice || 0) + taxTotal).toFixed(4)) : null,
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
    });
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
