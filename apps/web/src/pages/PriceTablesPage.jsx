import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

const PRODUCT_FAMILIES = ["regular", "mid", "premium", "diesel"];
const CUSTOMER_STATUS_OPTIONS = [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }];
const PRICING_BRANCH_OPTIONS = [{ value: "unbranded", label: "Unbranded" }, { value: "branded", label: "Branded" }, { value: "spot", label: "Spot" }, { value: "rack", label: "Rack" }];
const MARKET_KEY_OPTIONS = [{ value: "san_francisco", label: "San Francisco" }, { value: "benicia", label: "Benicia" }, { value: "sacramento", label: "Sacramento" }, { value: "san_jose", label: "San Jose" }, { value: "stockton", label: "Stockton" }, { value: "bay_area", label: "Bay Area" }];
const TERMINAL_KEY_OPTIONS = [{ value: "benicia_terminal", label: "Benicia" }, { value: "stockton_terminal", label: "Stockton" }, { value: "sacramento_terminal", label: "Sacramento" }, { value: "san_jose_terminal", label: "San Jose" }, { value: "san_francisco_terminal", label: "San Francisco" }];
const PRODUCT_KEY_OPTIONS = [{ value: "reg_87_carb", label: "87 CARB" }, { value: "mid_89_carb", label: "89 CARB" }, { value: "premium_91_carb", label: "91 CARB" }, { value: "diesel_carb_ulsd", label: "CARB ULSD" }, { value: "diesel_red", label: "Red Diesel" }, { value: "ethanol", label: "Ethanol" }, { value: "rin", label: "RIN" }, { value: "lcfs_gasoline", label: "LCFS Gasoline" }, { value: "lcfs_diesel", label: "LCFS Diesel" }, { value: "ghg_gasoline", label: "GHG Gasoline" }, { value: "ghg_diesel", label: "GHG Diesel" }];
const VENDOR_KEY_OPTIONS = [{ value: "valero", label: "Valero" }, { value: "psx", label: "Phillips 66" }, { value: "tesoro", label: "Tesoro" }, { value: "marathon", label: "Marathon" }, { value: "shell", label: "Shell" }, { value: "chevron", label: "Chevron" }, { value: "bp", label: "BP" }];
const SOURCE_TYPE_OPTIONS = [{ value: "opis", label: "OPIS" }, { value: "branded_zone", label: "Branded Zone" }, { value: "branded_area", label: "Branded Area" }, { value: "tax", label: "Tax" }, { value: "manual_adjustment", label: "Manual Adjustment" }, { value: "derived", label: "Derived" }];
const SNAPSHOT_STATUS_OPTIONS = [{ value: "draft", label: "Draft" }, { value: "ready", label: "Ready" }, { value: "locked", label: "Locked" }, { value: "superseded", label: "Superseded" }];
const RULE_STATUS_OPTIONS = [{ value: "draft", label: "Draft" }, { value: "active", label: "Active" }, { value: "retired", label: "Retired" }];
const DELIVERY_METHOD_OPTIONS = [{ value: "email", label: "Email" }, { value: "fax_email", label: "Fax Through Email" }, { value: "manual", label: "Manual" }];
const VENDOR_SELECTION_MODE_OPTIONS = [{ value: "lowest", label: "Lowest" }, { value: "highest", label: "Highest" }, { value: "first_available", label: "First Available" }, { value: "specific_vendor", label: "Specific Vendor" }];
const COMPONENT_SOURCE_KIND_OPTIONS = [{ value: "customer_profile", label: "customer_profile" }, { value: "source_value", label: "source_value" }, { value: "tax", label: "tax" }, { value: "tax_schedule", label: "tax_schedule" }, { value: "vendor_min", label: "vendor_min" }, { value: "constant", label: "constant" }, { value: "default", label: "default" }, { value: "derived_component", label: "derived_component" }];
const TAX_NAME_OPTIONS = [{ value: "gas_tax", label: "Gas Tax" }, { value: "diesel_tax", label: "Diesel Tax" }];
const EMPTY_CUSTOMER = { name: "", addressLine1: "", addressLine2: "", city: "", state: "", postalCode: "", terminalKey: "", status: "active" };
const EMPTY_PROFILE = { effectiveStart: "", effectiveEnd: "", freightMiles: "", freightCostGas: "", freightCostDiesel: "", rackMarginGas: "", rackMarginDiesel: "", discountRegular: "", discountMid: "", discountPremium: "", discountDiesel: "", branch: "unbranded", marketKey: "", terminalKey: "", extraRulesJson: "{}" };
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
function customerToForm(customer) { return { ...EMPTY_CUSTOMER, ...(customer || {}) }; }
function profileToForm(profile) {
  if (!profile) return EMPTY_PROFILE;
  const rules = profile.rules || {};
  const { branch = "unbranded", marketKey = "", terminalKey = "", ...extraRules } = rules;
  return { ...EMPTY_PROFILE, ...profile, branch, marketKey, terminalKey, extraRulesJson: prettyJson(extraRules) };
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
function outputMetricsFromRecord(record) { return PRODUCT_FAMILIES.map((family) => ({ productFamily: family, basePrice: record?.[`${family}Base`], totalPrice: record?.[`${family}Total`] })); }
function sourceValueMatchesTerminal(value, terminalKey) {
  if (!terminalKey) return true;
  return String(value?.terminalKey || "").trim() === String(terminalKey).trim();
}

function OutputCards({ outputs, fallbackStatus }) {
  return (
    <div className="price-tables-output-list">
      {outputs.map((output) => (
        <div key={output.productFamily} className="price-tables-output-card">
          <div className="price-tables-output-head"><strong>{output.productFamily}</strong><span>{output.status || fallbackStatus}</span></div>
          <div className="price-tables-output-metrics">
            <span>Base {formatMoney(output.basePrice)}</span>
            {"taxes" in output ? <span>Taxes {formatMoney(output.taxes)}</span> : null}
            <span>Total {formatMoney(output.totalPrice)}</span>
          </div>
          {output.trace?.length ? (
            <div className="price-tables-trace">
              {output.trace.map((item, index) => (
                <div key={`${output.productFamily}-${index}`} className="price-tables-trace-row">
                  <strong>{item.label || item.kind || item.componentKey}</strong>
                  <span>{item.detail}</span>
                  <em>{item.contribution != null ? formatMoney(item.contribution) : item.value != null ? formatMoney(item.value) : "n/a"}</em>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
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
  const [previewDate, setPreviewDate] = useState(new Date().toISOString().slice(0, 10));
  const [preview, setPreview] = useState(null);
  const [runHistory, setRunHistory] = useState(null);
  const [generatedOutputs, setGeneratedOutputs] = useState([]);
  const [detailView, setDetailView] = useState("run_review");
  const [outputScope, setOutputScope] = useState("date");
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

  async function loadGeneratedWorkspace(pricingDate, customerId, scope = outputScope, preferredOutputId = "") {
    try {
      const customerFilter = scope === "customer" ? customerId : "";
      const [history, outputs] = await Promise.all([
        api.getPricingRunHistory(pricingDate, customerFilter ? { customerId: customerFilter } : {}),
        api.getGeneratedPricingOutputs({ pricingDate, ...(customerFilter ? { customerId: customerFilter } : {}) })
      ]);
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
  useEffect(() => { loadGeneratedWorkspace(previewDate, selectedCustomerId, outputScope); }, [previewDate, selectedCustomerId, outputScope]);
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
      await api.saveCustomerPricingProfile(selectedCustomerId, { ...profileForm, rules: { branch: profileForm.branch, marketKey: profileForm.marketKey, terminalKey: profileForm.terminalKey, ...extraRules } });
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
  async function handleGenerateRun(mode) {
    if (mode === "selected" && !selectedCustomerId) return;
    setError(""); setStatus(mode === "all" ? "Generating pricing outputs for all customers..." : "Generating pricing output...");
    try {
      const result = await api.generatePricingRun({ pricingDate: previewDate, ...(mode === "selected" ? { customerId: selectedCustomerId } : {}) });
      if (mode === "selected" && selectedCustomerId) setPreview(await api.previewPricingRun({ customerId: selectedCustomerId, pricingDate: previewDate }));
      await loadGeneratedWorkspace(previewDate, selectedCustomerId, outputScope, result.outputs?.[0]?.id || "");
      setStatus(`Generated ${result.generatedCount} pricing output${result.generatedCount === 1 ? "" : "s"} for ${previewDate}.`);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError || "Unable to generate pricing run"));
      setStatus("");
    }
  }

  if (loading) return <div className="login-status">Loading price tables workspace...</div>;

  const outputDetailPayload = selectedOutputDetail?.detail || {};
  const outputDetailCards = outputDetailPayload.outputs?.length ? outputDetailPayload.outputs : outputMetricsFromRecord(selectedOutputDetail);

  return (
    <div className="price-tables-page">
      <section className="price-tables-hero">
        <div>
          <div className="price-tables-kicker">Customer Pricing Workspace</div>
          <h1>Price Tables</h1>
          <p>Work customer setup, rule configuration, taxes, source snapshots, preview, and generated daily outputs in one workflow.</p>
        </div>
        <div className="price-tables-hero-actions">
          <label><span>Pricing Date</span><input type="date" value={previewDate} onChange={(event) => setPreviewDate(event.target.value)} /></label>
          <button type="button" onClick={handleRunPreview} disabled={!selectedCustomerId}>Run Preview</button>
        </div>
      </section>
      {status ? <div className="price-tables-banner price-tables-banner-success">{status}</div> : null}
      {error ? <div className="price-tables-banner price-tables-banner-error">{error}</div> : null}
      <div className="price-tables-layout">
        <section className="card price-tables-panel">
          <div className="price-tables-panel-head">
            <div><div className="price-tables-panel-kicker">Customers</div><h3>Customer and profile</h3></div>
            <button type="button" onClick={handleCreateCustomer}>New Customer</button>
          </div>
          <div className="price-tables-shell">
            <div className="price-tables-list">
              {customers.length ? customers.map((customer) => (
                <button key={customer.id} type="button" className={`price-tables-list-item${customer.id === selectedCustomerId ? " price-tables-list-item-active" : ""}`} onClick={() => setSelectedCustomerId(customer.id)}>
                  <strong>{customer.name}</strong>
                  <span>{customer.terminalKey || "No terminal"} | {customer.status}</span>
                </button>
              )) : <div className="price-tables-empty">No customers yet.</div>}
            </div>
            <div className="price-tables-form-stack">
              <div className="price-tables-form-grid">
                {["name", "addressLine1", "addressLine2", "city", "state", "postalCode"].map((field) => (
                  <label key={field}>
                    <span>{field}</span>
                    <input value={customerForm[field] ?? ""} onChange={(event) => setCustomerForm((current) => ({ ...current, [field]: event.target.value }))} />
                  </label>
                ))}
                <label>
                  <span>terminalKey</span>
                  <select value={customerForm.terminalKey} onChange={(event) => setCustomerForm((current) => ({ ...current, terminalKey: event.target.value }))}>
                    <option value="">Select terminal</option>
                    {TERMINAL_KEY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label>
                  <span>status</span>
                  <select value={customerForm.status} onChange={(event) => setCustomerForm((current) => ({ ...current, status: event.target.value }))}>
                    {CUSTOMER_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="price-tables-actions"><button type="button" onClick={handleSaveCustomer} disabled={!selectedCustomerId}>Save Customer</button></div>
              <div className="price-tables-subsection">
                <div className="price-tables-panel-kicker">Pricing Profile</div>
                <div className="price-tables-form-grid">
                  {["effectiveStart", "effectiveEnd", "freightMiles", "freightCostGas", "freightCostDiesel", "rackMarginGas", "rackMarginDiesel", "discountRegular", "discountMid", "discountPremium", "discountDiesel"].map((field) => (
                    <label key={field}>
                      <span>{field}</span>
                      <input type={field.includes("Start") || field.includes("End") ? "date" : "text"} value={profileForm[field] ?? ""} onChange={(event) => setProfileForm((current) => ({ ...current, [field]: event.target.value }))} />
                    </label>
                  ))}
                  <label><span>branch</span><select value={profileForm.branch} onChange={(event) => setProfileForm((current) => ({ ...current, branch: event.target.value }))}>{PRICING_BRANCH_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                  <label><span>marketKey</span><select value={profileForm.marketKey} onChange={(event) => setProfileForm((current) => ({ ...current, marketKey: event.target.value }))}><option value="">Select market</option>{MARKET_KEY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                  <label><span>terminalKey</span><select value={profileForm.terminalKey} onChange={(event) => setProfileForm((current) => ({ ...current, terminalKey: event.target.value }))}><option value="">Select terminal</option>{TERMINAL_KEY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                  <label className="price-tables-full"><span>extraRulesJson</span><textarea rows={5} value={profileForm.extraRulesJson} onChange={(event) => setProfileForm((current) => ({ ...current, extraRulesJson: event.target.value }))} /></label>
                </div>
                <div className="price-tables-actions"><button type="button" onClick={handleSaveProfile} disabled={!selectedCustomerId}>Save Profile</button></div>
              </div>
              <div className="price-tables-subsection">
                <div className="price-tables-inline-head">
                  <div className="price-tables-panel-kicker">Contacts</div>
                  <button type="button" onClick={() => setContactRows((current) => [...current, { ...EMPTY_CONTACT }])}>Add Contact</button>
                </div>
                <div className="price-tables-table-wrap">
                  <table className="table price-tables-table">
                    <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Fax Email</th><th>Primary</th><th>Delivery</th><th /></tr></thead>
                    <tbody>
                      {contactRows.map((row, index) => (
                        <tr key={`contact-${row.id || index}`}>
                          <td><input value={row.name} onChange={(event) => rowUpdate(setContactRows, index, "name", event.target.value)} /></td>
                          <td><input value={row.email} onChange={(event) => rowUpdate(setContactRows, index, "email", event.target.value)} /></td>
                          <td><input value={row.phone} onChange={(event) => rowUpdate(setContactRows, index, "phone", event.target.value)} /></td>
                          <td><input value={row.faxEmail} onChange={(event) => rowUpdate(setContactRows, index, "faxEmail", event.target.value)} /></td>
                          <td><input type="checkbox" checked={!!row.isPrimary} onChange={(event) => rowUpdate(setContactRows, index, "isPrimary", event.target.checked)} /></td>
                          <td><select value={row.deliveryMethod} onChange={(event) => rowUpdate(setContactRows, index, "deliveryMethod", event.target.value)}>{DELIVERY_METHOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></td>
                          <td><button type="button" onClick={() => rowRemove(setContactRows, index)}>Remove</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="price-tables-actions"><button type="button" onClick={handleSaveContacts} disabled={!selectedCustomerId}>Save Contacts</button></div>
              </div>
            </div>
          </div>
        </section>
        <section className="card price-tables-panel price-tables-preview-panel">
          <div className="price-tables-panel-head">
            <div><div className="price-tables-panel-kicker">Preview</div><h3>Daily output trace</h3></div>
            <div className="price-tables-preview-meta"><strong>{selectedCustomer?.name || "No customer selected"}</strong><span>{previewDate}</span></div>
          </div>
          {preview ? (
            <div className="price-tables-preview-stack">
              <div className="price-tables-preview-grid">
                <div className="metric-card"><div className="metric-label">Preview Status</div><div className="metric-value">{preview.status}</div></div>
                <div className="metric-card"><div className="metric-label">Active Rules</div><div className="metric-value">{preview.activeRules?.length || 0}</div></div>
                <div className="metric-card"><div className="metric-label">Source Values</div><div className="metric-value">{preview.sourceValueCount || 0}</div></div>
              </div>
              {preview.missingInputs?.length ? <div className="price-tables-warning">{preview.missingInputs.map((item) => <div key={item.key}>{item.message}</div>)}</div> : null}
              <OutputCards outputs={preview.outputs || []} fallbackStatus={preview.status} />
            </div>
          ) : <div className="price-tables-empty">Run preview to inspect active rule evaluation, taxes, and per-product trace output.</div>}
        </section>
        <section className="card price-tables-panel">
          <div className="price-tables-panel-head">
            <div><div className="price-tables-panel-kicker">Price Run</div><h3>Generate and review persisted outputs</h3></div>
            <div className="price-tables-button-row">
              <button type="button" onClick={() => handleGenerateRun("selected")} disabled={!selectedCustomerId}>Generate Selected</button>
              <button type="button" onClick={() => handleGenerateRun("all")} disabled={!customers.length}>Generate All</button>
            </div>
          </div>
          <div className="price-tables-form-stack">
            <div className="price-tables-preview-grid">
              <div className="metric-card"><div className="metric-label">Run Date</div><div className="metric-value">{runHistory?.pricingDate || previewDate}</div></div>
              <div className="metric-card"><div className="metric-label">Outputs</div><div className="metric-value">{runHistory?.total || 0}</div></div>
              <div className="metric-card"><div className="metric-label">Incomplete</div><div className="metric-value">{runHistory?.incompleteCount || 0}</div></div>
            </div>
            <div className="price-tables-inline-head">
              <div className="price-tables-panel-kicker">History Filter</div>
              <div className="price-tables-segmented">
                <button type="button" className={outputScope === "date" ? "price-tables-segmented-active" : ""} onClick={() => setOutputScope("date")}>All Customers</button>
                <button type="button" className={outputScope === "customer" ? "price-tables-segmented-active" : ""} onClick={() => setOutputScope("customer")} disabled={!selectedCustomerId}>Selected Customer</button>
              </div>
            </div>
            {runHistory?.outputs?.length ? (
              <div className="price-tables-table-wrap">
                <table className="table price-tables-table">
                  <thead><tr><th>Customer</th><th>Status</th><th>Regular</th><th>Diesel</th><th>Created</th></tr></thead>
                  <tbody>
                    {runHistory.outputs.map((output) => (
                      <tr key={output.id}>
                        <td>{output.customerName}</td>
                        <td>{output.status}</td>
                        <td>{formatMoney(output.regularTotal)}</td>
                        <td>{formatMoney(output.dieselTotal)}</td>
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
            <div><div className="price-tables-panel-kicker">Workspace Detail</div><h3>Run review, rules, inputs, and logs</h3></div>
            <div className="price-tables-detail-picker">
              <label>
                <span>View</span>
                <select value={detailView} onChange={(event) => setDetailView(event.target.value)}>
                  <option value="run_review">Run Review</option>
                  <option value="rules">Rules</option>
                  <option value="inputs">Inputs</option>
                  <option value="opis_report">OPIS Report</option>
                  <option value="logs">Output Log</option>
                </select>
              </label>
            </div>
          </div>
          {detailView === "run_review" ? (
            <div className="price-tables-form-stack">
              <div className="price-tables-detail-card">
                <div><strong>{selectedCustomer?.name || "No customer selected"}</strong></div>
                <div>{previewDate}</div>
                <div>Use this view for preview output and the most recent generated run review.</div>
              </div>
              {preview ? (
                <>
                  <div className="price-tables-preview-grid">
                    <div className="metric-card"><div className="metric-label">Preview Status</div><div className="metric-value">{preview.status}</div></div>
                    <div className="metric-card"><div className="metric-label">Active Rules</div><div className="metric-value">{preview.activeRules?.length || 0}</div></div>
                    <div className="metric-card"><div className="metric-label">Source Values</div><div className="metric-value">{preview.sourceValueCount || 0}</div></div>
                  </div>
                  {preview.missingInputs?.length ? <div className="price-tables-warning">{preview.missingInputs.map((item) => <div key={item.key}>{item.message}</div>)}</div> : null}
                  <OutputCards outputs={preview.outputs || []} fallbackStatus={preview.status} />
                </>
              ) : <div className="price-tables-empty">Run preview to inspect active rule evaluation, taxes, and per-product trace output.</div>}
            </div>
          ) : null}
          {detailView === "rules" ? (
            <div className="price-tables-shell">
              <div className="price-tables-list">
                {rules.length ? rules.map((rule) => (
                  <button key={rule.id} type="button" className={`price-tables-list-item${rule.id === selectedRuleId ? " price-tables-list-item-active" : ""}`} onClick={() => setSelectedRuleId(rule.id)}>
                    <strong>{rule.name}</strong>
                    <span>{rule.productFamily} | {rule.status} | {rule.versionLabel || "unversioned"}</span>
                  </button>
                )) : <div className="price-tables-empty">No pricing rules yet.</div>}
              </div>
              <div className="price-tables-form-stack">
                <div className="price-tables-panel-head">
                  <div><div className="price-tables-panel-kicker">Rules</div><h3>Rule sets and component editor</h3></div>
                  <button type="button" onClick={handleCreateRule}>New Rule</button>
                </div>
                <div className="price-tables-form-grid">
                  <label className="price-tables-full"><span>name</span><input value={ruleForm.name} onChange={(event) => setRuleForm((current) => ({ ...current, name: event.target.value }))} /></label>
                  <label><span>productFamily</span><select value={ruleForm.productFamily} onChange={(event) => setRuleForm((current) => ({ ...current, productFamily: event.target.value }))}>{PRODUCT_FAMILIES.map((family) => <option key={family} value={family}>{family}</option>)}</select></label>
                  <label><span>status</span><select value={ruleForm.status} onChange={(event) => setRuleForm((current) => ({ ...current, status: event.target.value }))}>{RULE_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                  <label><span>effectiveStart</span><input type="date" value={ruleForm.effectiveStart} onChange={(event) => setRuleForm((current) => ({ ...current, effectiveStart: event.target.value }))} /></label>
                  <label><span>effectiveEnd</span><input type="date" value={ruleForm.effectiveEnd} onChange={(event) => setRuleForm((current) => ({ ...current, effectiveEnd: event.target.value }))} /></label>
                  <label><span>versionLabel</span><input value={ruleForm.versionLabel} onChange={(event) => setRuleForm((current) => ({ ...current, versionLabel: event.target.value }))} /></label>
                  <label className="price-tables-full"><span>notes</span><textarea rows={3} value={ruleForm.notes} onChange={(event) => setRuleForm((current) => ({ ...current, notes: event.target.value }))} /></label>
                </div>
                <div className="price-tables-subsection">
                  <div className="price-tables-inline-head">
                    <div className="price-tables-panel-kicker">Components</div>
                    <button type="button" onClick={() => setComponentRows((current) => [...current, { ...EMPTY_COMPONENT, sortOrder: String(current.length + 1) }])}>Add Component</button>
                  </div>
                  <div className="price-tables-table-wrap">
                    <table className="table price-tables-table">
                      <thead><tr><th>Key</th><th>Label</th><th>Kind</th><th>Source Ref</th><th>Default</th><th>Multiplier</th><th>Order</th><th>Editable</th><th>Metadata</th><th /></tr></thead>
                      <tbody>
                        {componentRows.map((row, index) => (
                          <tr key={`component-${index}`}>
                            <td><input value={row.componentKey} onChange={(event) => rowUpdate(setComponentRows, index, "componentKey", event.target.value)} /></td>
                            <td><input value={row.label} onChange={(event) => rowUpdate(setComponentRows, index, "label", event.target.value)} /></td>
                            <td><select value={row.sourceKind} onChange={(event) => rowUpdate(setComponentRows, index, "sourceKind", event.target.value)}>{COMPONENT_SOURCE_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></td>
                            <td><input value={row.sourceRef} onChange={(event) => rowUpdate(setComponentRows, index, "sourceRef", event.target.value)} /></td>
                            <td><input value={row.defaultValue} onChange={(event) => rowUpdate(setComponentRows, index, "defaultValue", event.target.value)} /></td>
                            <td><input value={row.multiplier} onChange={(event) => rowUpdate(setComponentRows, index, "multiplier", event.target.value)} /></td>
                            <td><input value={row.sortOrder} onChange={(event) => rowUpdate(setComponentRows, index, "sortOrder", event.target.value)} /></td>
                            <td><input type="checkbox" checked={!!row.isEditable} onChange={(event) => rowUpdate(setComponentRows, index, "isEditable", event.target.checked)} /></td>
                            <td><textarea rows={3} value={row.metadataJson} onChange={(event) => rowUpdate(setComponentRows, index, "metadataJson", event.target.value)} /></td>
                            <td><button type="button" onClick={() => rowRemove(setComponentRows, index)}>Remove</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="price-tables-subsection">
                  <div className="price-tables-inline-head">
                    <div className="price-tables-panel-kicker">Vendor Sets</div>
                    <button type="button" onClick={() => setVendorSetRows((current) => [...current, { ...EMPTY_VENDOR_SET, productFamily: ruleForm.productFamily }])}>Add Vendor Set</button>
                  </div>
                  <div className="price-tables-table-wrap">
                    <table className="table price-tables-table">
                      <thead><tr><th>Selection</th><th>Family</th><th>Market Key</th><th>Vendors</th><th /></tr></thead>
                      <tbody>
                        {vendorSetRows.map((row, index) => (
                          <tr key={`vendor-set-${index}`}>
                            <td><select value={row.selectionMode} onChange={(event) => rowUpdate(setVendorSetRows, index, "selectionMode", event.target.value)}>{VENDOR_SELECTION_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></td>
                            <td><select value={row.productFamily} onChange={(event) => rowUpdate(setVendorSetRows, index, "productFamily", event.target.value)}>{PRODUCT_FAMILIES.map((family) => <option key={family} value={family}>{family}</option>)}</select></td>
                            <td><select value={row.marketKey} onChange={(event) => rowUpdate(setVendorSetRows, index, "marketKey", event.target.value)}><option value="">All markets</option>{MARKET_KEY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></td>
                            <td><select multiple size={Math.min(4, VENDOR_KEY_OPTIONS.length)} value={csvValues(row.vendorsCsv)} onChange={(event) => rowUpdate(setVendorSetRows, index, "vendorsCsv", selectedOptionValues(event).join(", "))}>{VENDOR_KEY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></td>
                            <td><button type="button" onClick={() => rowRemove(setVendorSetRows, index)}>Remove</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="price-tables-actions"><button type="button" onClick={handleSaveRule} disabled={!selectedRuleId}>Save Rule</button></div>
              </div>
            </div>
          ) : null}
          {detailView === "inputs" ? (
            <div className="price-tables-form-stack">
              <div className="price-tables-subsection">
                <div className="price-tables-inline-head">
                  <div className="price-tables-panel-kicker">Tax Schedules</div>
                  <button type="button" onClick={() => setTaxRows((current) => [...current, { ...EMPTY_TAX, effectiveStart: previewDate }])}>Add Tax</button>
                </div>
                <div className="price-tables-table-wrap">
                  <table className="table price-tables-table">
                    <thead><tr><th>Family</th><th>Tax Name</th><th>Value</th><th>Unit</th><th>Start</th><th>End</th><th /></tr></thead>
                    <tbody>
                      {taxRows.map((row, index) => (
                        <tr key={`tax-${index}`}>
                          <td><select value={row.productFamily} onChange={(event) => rowUpdate(setTaxRows, index, "productFamily", event.target.value)}>{PRODUCT_FAMILIES.map((family) => <option key={family} value={family}>{family}</option>)}</select></td>
                          <td><select value={row.taxName} onChange={(event) => rowUpdate(setTaxRows, index, "taxName", event.target.value)}><option value="">Select tax</option>{TAX_NAME_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></td>
                          <td><input value={row.value} onChange={(event) => rowUpdate(setTaxRows, index, "value", event.target.value)} /></td>
                          <td><input value={row.unit} onChange={(event) => rowUpdate(setTaxRows, index, "unit", event.target.value)} /></td>
                          <td><input type="date" value={row.effectiveStart} onChange={(event) => rowUpdate(setTaxRows, index, "effectiveStart", event.target.value)} /></td>
                          <td><input type="date" value={row.effectiveEnd} onChange={(event) => rowUpdate(setTaxRows, index, "effectiveEnd", event.target.value)} /></td>
                          <td><button type="button" onClick={() => rowRemove(setTaxRows, index)}>Remove</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="price-tables-actions"><button type="button" onClick={handleSaveTaxes}>Save Taxes</button></div>
              </div>
              <div className="price-tables-subsection">
                <div className="price-tables-inline-head"><div className="price-tables-panel-kicker">Source Snapshots For Date</div></div>
                <div className="price-tables-shell">
                  <div className="price-tables-list">
                    {sources.length ? sources.map((source) => (
                      <button key={source.id} type="button" className={`price-tables-list-item${source.id === selectedSourceId ? " price-tables-list-item-active" : ""}`} onClick={() => setSelectedSourceId(source.id)}>
                        <strong>{source.sourceLabel || source.sourceType}</strong>
                        <span>{source.sourceType} | {source.status}</span>
                      </button>
                    )) : <div className="price-tables-empty">No source snapshots for this date.</div>}
                  </div>
                  <div className="price-tables-form-stack">
                    <div className="price-tables-form-grid">
                      <label><span>sourceType</span><select value={sourceDraft.sourceType} onChange={(event) => setSourceDraft((current) => ({ ...current, sourceType: event.target.value }))}>{SOURCE_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                      <label><span>status</span><select value={sourceDraft.status} onChange={(event) => setSourceDraft((current) => ({ ...current, status: event.target.value }))}>{SNAPSHOT_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                      <label className="price-tables-full"><span>sourceLabel</span><input value={sourceDraft.sourceLabel} onChange={(event) => setSourceDraft((current) => ({ ...current, sourceLabel: event.target.value }))} /></label>
                      <label className="price-tables-full"><span>notes</span><textarea rows={3} value={sourceDraft.notes} onChange={(event) => setSourceDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
                    </div>
                    <div className="price-tables-inline-head">
                      <div className="price-tables-panel-kicker">New Source Values</div>
                      <button type="button" onClick={() => setSourceValueRows((current) => [...current, { ...EMPTY_SOURCE_VALUE, effectiveDate: previewDate }])}>Add Value</button>
                    </div>
                    <div className="price-tables-table-wrap">
                      <table className="table price-tables-table">
                        <thead><tr><th>Market</th><th>Terminal</th><th>Product</th><th>Vendor</th><th>Quote</th><th>Value</th><th>Unit</th><th>Effective</th><th /></tr></thead>
                        <tbody>
                          {sourceValueRows.map((row, index) => (
                            <tr key={`source-value-${index}`}>
                              <td><select value={row.marketKey} onChange={(event) => rowUpdate(setSourceValueRows, index, "marketKey", event.target.value)}><option value="">Any market</option>{MARKET_KEY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></td>
                              <td><select value={row.terminalKey} onChange={(event) => rowUpdate(setSourceValueRows, index, "terminalKey", event.target.value)}><option value="">Any terminal</option>{TERMINAL_KEY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></td>
                              <td><select value={row.productKey} onChange={(event) => rowUpdate(setSourceValueRows, index, "productKey", event.target.value)}><option value="">Select product</option>{PRODUCT_KEY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></td>
                              <td><select value={row.vendorKey} onChange={(event) => rowUpdate(setSourceValueRows, index, "vendorKey", event.target.value)}><option value="">Any vendor</option>{VENDOR_KEY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></td>
                              <td><input value={row.quoteCode} onChange={(event) => rowUpdate(setSourceValueRows, index, "quoteCode", event.target.value)} /></td>
                              <td><input value={row.value} onChange={(event) => rowUpdate(setSourceValueRows, index, "value", event.target.value)} /></td>
                              <td><input value={row.unit} onChange={(event) => rowUpdate(setSourceValueRows, index, "unit", event.target.value)} /></td>
                              <td><input type="date" value={row.effectiveDate || previewDate} onChange={(event) => rowUpdate(setSourceValueRows, index, "effectiveDate", event.target.value)} /></td>
                              <td><button type="button" onClick={() => rowRemove(setSourceValueRows, index)}>Remove</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="price-tables-actions"><button type="button" onClick={handleCreateSourceSnapshot}>Create Snapshot</button></div>
                  </div>
                </div>
              </div>
              {selectedSourceDetail ? (
                <div className="price-tables-subsection">
                  <div className="price-tables-panel-kicker">Selected Snapshot Detail</div>
                  <div className="price-tables-detail-card">
                    <div><strong>{selectedSourceDetail.sourceLabel || selectedSourceDetail.sourceType}</strong></div>
                    <div>{selectedSourceDetail.sourceType} | {selectedSourceDetail.status} | {selectedSourceDetail.pricingDate}</div>
                    <div>{selectedSourceDetail.notes || "No notes"}</div>
                  </div>
                  <div className="price-tables-table-wrap">
                    <table className="table price-tables-table">
                      <thead><tr><th>Market</th><th>Terminal</th><th>Product</th><th>Vendor</th><th>Quote</th><th>Value</th><th>Unit</th><th>Effective</th></tr></thead>
                      <tbody>
                        {selectedSourceDetail.values?.map((value) => (
                          <tr key={value.id}>
                            <td>{value.marketKey}</td><td>{value.terminalKey}</td><td>{value.productKey}</td><td>{value.vendorKey}</td><td>{value.quoteCode}</td><td>{value.value}</td><td>{value.unit}</td><td>{value.effectiveDate}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {detailView === "opis_report" ? (
            <div className="price-tables-form-stack">
              <div className="price-tables-detail-card">
                <div><strong>{selectedSourceDetail?.sourceLabel || selectedSourceDetail?.sourceType || "No source snapshot selected"}</strong></div>
                <div>{selectedSourceDetail ? `${selectedSourceDetail.sourceType} | ${selectedSourceDetail.status} | ${selectedSourceDetail.pricingDate}` : "Select a source snapshot from Inputs first."}</div>
                <div>Terminal filter: {selectedTerminalKey || "All terminals"}</div>
              </div>
              {selectedSourceDetail ? (
                <>
                  <div className="price-tables-inline-head">
                    <div className="price-tables-panel-kicker">Filtered OPIS Source Rows</div>
                    <div className="price-tables-inline-note">Showing only rows for the selected terminal.</div>
                  </div>
                  {selectedSourceTerminalValues.length ? (
                    <div className="price-tables-table-wrap">
                      <table className="table price-tables-table">
                        <thead><tr><th>Market</th><th>Terminal</th><th>Product</th><th>Vendor</th><th>Quote</th><th>Value</th><th>Unit</th><th>Effective</th></tr></thead>
                        <tbody>
                          {selectedSourceTerminalValues.map((value) => (
                            <tr key={value.id}>
                              <td>{value.marketKey}</td>
                              <td>{value.terminalKey}</td>
                              <td>{value.productKey}</td>
                              <td>{value.vendorKey}</td>
                              <td>{value.quoteCode}</td>
                              <td>{value.value}</td>
                              <td>{value.unit}</td>
                              <td>{value.effectiveDate}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <div className="price-tables-empty">No source rows matched terminal `{selectedTerminalKey || "all"}` for the selected snapshot.</div>}
                </>
              ) : <div className="price-tables-empty">Open the Inputs view, select a source snapshot, then return here to inspect the terminal-filtered OPIS rows.</div>}
            </div>
          ) : null}
          {detailView === "logs" ? (
            <div className="price-tables-shell">
              <div className="price-tables-list">
                {generatedOutputs.length ? generatedOutputs.map((output) => (
                  <button key={output.id} type="button" className={`price-tables-list-item${output.id === selectedOutputId ? " price-tables-list-item-active" : ""}`} onClick={() => setSelectedOutputId(output.id)}>
                    <strong>{output.customerName}</strong>
                    <span>{output.status} | {formatMoney(output.regularTotal)} regular | {formatMoney(output.dieselTotal)} diesel</span>
                  </button>
                )) : <div className="price-tables-empty">No generated outputs match the current filter.</div>}
              </div>
              <div className="price-tables-form-stack">
                <div className="price-tables-inline-head">
                  <div className="price-tables-panel-kicker">Output Log</div>
                  <div className="price-tables-segmented">
                    <button type="button" className={outputScope === "date" ? "price-tables-segmented-active" : ""} onClick={() => setOutputScope("date")}>All Customers</button>
                    <button type="button" className={outputScope === "customer" ? "price-tables-segmented-active" : ""} onClick={() => setOutputScope("customer")} disabled={!selectedCustomerId}>Selected Customer</button>
                  </div>
                </div>
                {selectedOutputDetail ? (
                  <>
                    <div className="price-tables-detail-card">
                      <div><strong>{selectedOutputDetail.customerName}</strong></div>
                      <div>{selectedOutputDetail.status} | {selectedOutputDetail.pricingDate}</div>
                      <div>Created {formatDateTime(selectedOutputDetail.createdAt)}</div>
                      <div>{selectedOutputDetail.ruleSetName || "Multiple/family-specific rules"}</div>
                    </div>
                    {outputDetailPayload.missingInputs?.length ? <div className="price-tables-warning">{outputDetailPayload.missingInputs.map((item) => <div key={item.key}>{item.message}</div>)}</div> : null}
                    <OutputCards outputs={outputDetailCards} fallbackStatus={selectedOutputDetail.status} />
                    {outputDetailPayload.sourceSnapshots?.length ? (
                      <div className="price-tables-subsection">
                        <div className="price-tables-panel-kicker">Source Snapshot Group</div>
                        <div className="price-tables-run-badges">{outputDetailPayload.sourceSnapshots.map((snapshot) => <span key={snapshot.id} className="price-tables-badge">{snapshot.sourceLabel || snapshot.sourceType}</span>)}</div>
                      </div>
                    ) : null}
                  </>
                ) : <div className="price-tables-empty">Select a generated output to inspect persisted totals and trace detail.</div>}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

