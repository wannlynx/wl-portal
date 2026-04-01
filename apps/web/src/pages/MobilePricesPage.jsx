import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

const PRODUCT_FAMILIES = ["regular", "mid", "premium", "diesel"];
const MOBILE_SECTIONS = ["run", "preview", "results", "source"];

function formatMoney(value) {
  return value == null || Number.isNaN(Number(value)) ? "n/a" : `$${Number(value).toFixed(4)}`;
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : "n/a";
}

function sourceValueMatchesTerminal(value, terminalKey) {
  if (!terminalKey) return true;
  return String(value?.terminalKey || "").trim() === terminalKey;
}

function OutputCard({ output, fallbackStatus, onOpen }) {
  return (
    <button type="button" className="mobile-prices-output-card card" onClick={onOpen}>
      <div className="mobile-prices-output-head">
        <strong>{output.productFamily}</strong>
        <span>{output.status || fallbackStatus}</span>
      </div>
      <div className="mobile-prices-kv"><span>Base</span><strong>{formatMoney(output.basePrice)}</strong></div>
      {"taxes" in output ? <div className="mobile-prices-kv"><span>Taxes</span><strong>{formatMoney(output.taxes)}</strong></div> : null}
      <div className="mobile-prices-kv"><span>Total</span><strong>{formatMoney(output.totalPrice)}</strong></div>
    </button>
  );
}

function Sheet({ title, subtitle, onClose, children }) {
  return (
    <div className="mobile-prices-sheet-backdrop" onClick={onClose}>
      <div className="mobile-prices-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="mobile-prices-sheet-head">
          <div>
            <strong>{title}</strong>
            {subtitle ? <span>{subtitle}</span> : null}
          </div>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        <div className="mobile-prices-sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function MobilePricesPage() {
  const [customers, setCustomers] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedSection, setSelectedSection] = useState("run");
  const [customerSearch, setCustomerSearch] = useState("");
  const [pricingDate, setPricingDate] = useState(new Date().toISOString().slice(0, 10));
  const [customerProfile, setCustomerProfile] = useState(null);
  const [profileDraft, setProfileDraft] = useState(null);
  const [preview, setPreview] = useState(null);
  const [runHistory, setRunHistory] = useState(null);
  const [outputs, setOutputs] = useState([]);
  const [selectedOutputId, setSelectedOutputId] = useState("");
  const [selectedOutputDetail, setSelectedOutputDetail] = useState(null);
  const [sources, setSources] = useState([]);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [selectedSourceDetail, setSelectedSourceDetail] = useState(null);
  const [activeSheet, setActiveSheet] = useState("");
  const [selectedFamily, setSelectedFamily] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [touchStartX, setTouchStartX] = useState(null);

  const selectedCustomer = useMemo(() => customers.find((item) => item.id === selectedCustomerId) || null, [customers, selectedCustomerId]);
  const selectedTerminalKey = (customerProfile?.rules?.terminalKey || customerProfile?.terminalKey || selectedCustomer?.terminalKey || "").trim();
  const selectedMarketKey = (customerProfile?.rules?.marketKey || "").trim();
  const selectedBranch = customerProfile?.rules?.branch || "unbranded";
  const selectedSourceRows = useMemo(
    () => (selectedSourceDetail?.values || []).filter((value) => sourceValueMatchesTerminal(value, selectedTerminalKey)),
    [selectedSourceDetail, selectedTerminalKey]
  );
  const filteredCustomers = useMemo(() => {
    const query = customerSearch.trim().toLowerCase();
    if (!query) return customers;
    return customers.filter((customer) => {
      const haystack = [
        customer.name,
        customer.terminalKey,
        customer.status,
        customer.city,
        customer.state
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [customerSearch, customers]);
  const mobileAlerts = useMemo(() => {
    const items = [];
    const seen = new Set();
    for (const issue of preview?.missingInputs || []) {
      if (seen.has(issue.key)) continue;
      seen.add(issue.key);
      items.push(issue);
    }
    for (const issue of selectedOutputDetail?.detail?.missingInputs || []) {
      if (seen.has(issue.key)) continue;
      seen.add(issue.key);
      items.push(issue);
    }
    return items.slice(0, 6);
  }, [preview, selectedOutputDetail]);

  async function loadWorkspace(preferredCustomerId = "") {
    setLoading(true);
    setError("");
    try {
      const nextCustomers = await api.getCustomers();
      const nextCustomerId = preferredCustomerId || nextCustomers[0]?.id || "";
      setCustomers(nextCustomers);
      setSelectedCustomerId(nextCustomerId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError || "Unable to load mobile prices"));
    } finally {
      setLoading(false);
    }
  }

  async function loadRunData(nextPricingDate, customerId) {
    if (!customerId) {
      setRunHistory(null);
      setOutputs([]);
      setSources([]);
      return;
    }
    try {
      const [history, nextOutputs, nextSources] = await Promise.all([
        api.getPricingRunHistory(nextPricingDate, { customerId }),
        api.getGeneratedPricingOutputs({ pricingDate: nextPricingDate, customerId }),
        api.getPricingSources({ pricingDate: nextPricingDate })
      ]);
      setRunHistory(history);
      setOutputs(nextOutputs);
      setSources(nextSources);
      setSelectedOutputId((current) => nextOutputs.some((item) => item.id === current) ? current : (nextOutputs[0]?.id || ""));
      setSelectedSourceId((current) => nextSources.some((item) => item.id === current) ? current : (nextSources[0]?.id || ""));
    } catch (loadError) {
      setRunHistory(null);
      setOutputs([]);
      setSources([]);
      setSelectedOutputId("");
      setSelectedSourceId("");
      setSelectedOutputDetail(null);
      setSelectedSourceDetail(null);
      setError(loadError instanceof Error ? loadError.message : String(loadError || "Unable to load mobile run data"));
    }
  }

  useEffect(() => { loadWorkspace(); }, []);
  useEffect(() => { loadRunData(pricingDate, selectedCustomerId); }, [pricingDate, selectedCustomerId]);
  useEffect(() => {
    if (!selectedCustomerId) {
      setCustomerProfile(null);
      setProfileDraft(null);
      return;
    }
    let active = true;
    api.getCustomerPricingProfile(selectedCustomerId)
      .then((profile) => {
        if (!active) return;
        setCustomerProfile(profile);
        setProfileDraft(profile ? {
          effectiveStart: profile.effectiveStart || pricingDate,
          effectiveEnd: profile.effectiveEnd || "",
          freightCostGas: profile.freightCostGas ?? "",
          freightCostDiesel: profile.freightCostDiesel ?? "",
          rackMarginGas: profile.rackMarginGas ?? "",
          rackMarginDiesel: profile.rackMarginDiesel ?? "",
          discountRegular: profile.discountRegular ?? "",
          discountMid: profile.discountMid ?? "",
          discountPremium: profile.discountPremium ?? "",
          discountDiesel: profile.discountDiesel ?? "",
          branch: profile.rules?.branch || "unbranded",
          marketKey: profile.rules?.marketKey || "",
          terminalKey: profile.rules?.terminalKey || profile.terminalKey || selectedCustomer?.terminalKey || ""
        } : {
          effectiveStart: pricingDate,
          effectiveEnd: "",
          freightCostGas: "",
          freightCostDiesel: "",
          rackMarginGas: "",
          rackMarginDiesel: "",
          discountRegular: "",
          discountMid: "",
          discountPremium: "",
          discountDiesel: "",
          branch: "unbranded",
          marketKey: "",
          terminalKey: selectedCustomer?.terminalKey || ""
        });
      })
      .catch(() => {
        if (!active) return;
        setCustomerProfile(null);
        setProfileDraft({
          effectiveStart: pricingDate,
          effectiveEnd: "",
          freightCostGas: "",
          freightCostDiesel: "",
          rackMarginGas: "",
          rackMarginDiesel: "",
          discountRegular: "",
          discountMid: "",
          discountPremium: "",
          discountDiesel: "",
          branch: "unbranded",
          marketKey: "",
          terminalKey: selectedCustomer?.terminalKey || ""
        });
      });
    return () => { active = false; };
  }, [selectedCustomerId, pricingDate, selectedCustomer]);
  useEffect(() => {
    if (!selectedOutputId) {
      setSelectedOutputDetail(null);
      return;
    }
    let active = true;
    api.getGeneratedPricingOutput(selectedOutputId)
      .then((detail) => active && setSelectedOutputDetail(detail))
      .catch((loadError) => active && setError(loadError instanceof Error ? loadError.message : String(loadError || "Unable to load output detail")));
    return () => { active = false; };
  }, [selectedOutputId]);
  useEffect(() => {
    if (!selectedSourceId) {
      setSelectedSourceDetail(null);
      return;
    }
    let active = true;
    api.getPricingSource(selectedSourceId)
      .then((detail) => active && setSelectedSourceDetail(detail))
      .catch((loadError) => active && setError(loadError instanceof Error ? loadError.message : String(loadError || "Unable to load source detail")));
    return () => { active = false; };
  }, [selectedSourceId]);

  async function handlePreview() {
    if (!selectedCustomerId) return;
    setError(""); setStatus("Running preview...");
    try {
      setPreview(await api.previewPricingRun({ customerId: selectedCustomerId, pricingDate }));
      setSelectedSection("preview");
      setStatus("Preview ready.");
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError || "Unable to run preview"));
      setStatus("");
    }
  }

  async function handleGenerate() {
    if (!selectedCustomerId) return;
    setError(""); setStatus("Generating prices...");
    try {
      await api.generatePricingRun({ customerId: selectedCustomerId, pricingDate });
      await loadRunData(pricingDate, selectedCustomerId);
      setSelectedSection("results");
      setStatus("Generated prices.");
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError || "Unable to generate prices"));
      setStatus("");
    }
  }

  async function handleSaveProfile() {
    if (!selectedCustomerId || !profileDraft) return;
    setError(""); setStatus("Saving profile...");
    try {
      const saved = await api.saveCustomerPricingProfile(selectedCustomerId, {
        effectiveStart: profileDraft.effectiveStart || pricingDate,
        effectiveEnd: profileDraft.effectiveEnd || "",
        freightCostGas: profileDraft.freightCostGas,
        freightCostDiesel: profileDraft.freightCostDiesel,
        rackMarginGas: profileDraft.rackMarginGas,
        rackMarginDiesel: profileDraft.rackMarginDiesel,
        discountRegular: profileDraft.discountRegular,
        discountMid: profileDraft.discountMid,
        discountPremium: profileDraft.discountPremium,
        discountDiesel: profileDraft.discountDiesel,
        rules: {
          branch: profileDraft.branch || "unbranded",
          marketKey: profileDraft.marketKey || "",
          terminalKey: profileDraft.terminalKey || ""
        }
      });
      setCustomerProfile(saved);
      setActiveSheet("");
      setStatus("Profile saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError || "Unable to save profile"));
      setStatus("");
    }
  }

  function openFamilySheet(family) {
    setSelectedFamily(family);
    setActiveSheet("family");
  }

  function handleSectionSwipeStart(event) {
    if (activeSheet) return;
    setTouchStartX(event.touches?.[0]?.clientX ?? null);
  }

  function handleSectionSwipeEnd(event) {
    if (activeSheet || touchStartX == null) return;
    const endX = event.changedTouches?.[0]?.clientX;
    if (typeof endX !== "number") {
      setTouchStartX(null);
      return;
    }
    const deltaX = endX - touchStartX;
    const currentIndex = MOBILE_SECTIONS.indexOf(selectedSection);
    if (Math.abs(deltaX) < 56 || currentIndex === -1) {
      setTouchStartX(null);
      return;
    }
    const direction = deltaX < 0 ? 1 : -1;
    const nextIndex = Math.min(Math.max(currentIndex + direction, 0), MOBILE_SECTIONS.length - 1);
    setSelectedSection(MOBILE_SECTIONS[nextIndex]);
    setTouchStartX(null);
  }

  if (loading) return <div className="login-status">Loading mobile prices...</div>;

  const outputCards = selectedOutputDetail?.detail?.outputs?.length
    ? selectedOutputDetail.detail.outputs
    : PRODUCT_FAMILIES.map((family) => ({
        productFamily: family,
        basePrice: selectedOutputDetail?.[`${family}Base`] ?? selectedOutputDetail?.[`${family}base`] ?? null,
        totalPrice: selectedOutputDetail?.[`${family}Total`] ?? selectedOutputDetail?.[`${family}total`] ?? null,
        trace: []
      }));
  const familyDetail = (preview?.outputs || selectedOutputDetail?.detail?.outputs || []).find((item) => item.productFamily === selectedFamily);

  return (
    <div className="mobile-prices-page">
      <section className="mobile-prices-hero card">
        <div>
          <div className="price-tables-kicker">Prototype</div>
          <h1>Mobile Prices</h1>
          <p>Mobile-first concept for customer pricing, focused on one customer and one action at a time.</p>
        </div>
        <div className="mobile-prices-controls">
          <label><span>Date</span><input type="date" value={pricingDate} onChange={(event) => setPricingDate(event.target.value)} /></label>
          <button type="button" onClick={() => setActiveSheet("customers")}>{selectedCustomer?.name || "Choose Customer"}</button>
        </div>
      </section>

      {status ? <div className="price-tables-banner price-tables-banner-success">{status}</div> : null}
      {error ? <div className="price-tables-banner price-tables-banner-error">{error}</div> : null}
      {mobileAlerts.length ? (
        <section className="mobile-prices-alert-stack">
          {mobileAlerts.map((issue) => (
            <div key={issue.key} className="mobile-prices-alert-card">
              <strong>Input warning</strong>
              <span>{issue.message}</span>
            </div>
          ))}
        </section>
      ) : null}

      <section className="mobile-prices-summary-grid">
        <div className="metric-card"><div className="metric-label">Customer</div><div className="metric-value">{selectedCustomer?.name || "n/a"}</div></div>
        <div className="metric-card"><div className="metric-label">Terminal</div><div className="metric-value">{selectedTerminalKey || "n/a"}</div></div>
        <div className="metric-card"><div className="metric-label">Outputs</div><div className="metric-value">{runHistory?.total || 0}</div></div>
      </section>

      <div className="mobile-prices-section-stage" onTouchStart={handleSectionSwipeStart} onTouchEnd={handleSectionSwipeEnd}>
      {selectedSection === "run" ? (
        <section className="mobile-prices-section card">
          <div className="mobile-prices-section-head">
            <div><div className="price-tables-panel-kicker">Run</div><h3>{selectedCustomer?.name || "Select a customer"}</h3></div>
            <button type="button" onClick={() => setActiveSheet("profile")}>Edit Profile</button>
          </div>
          <div className="mobile-prices-rule-summary card">
            <div className="mobile-prices-inline-head">
              <div>
                <div className="price-tables-panel-kicker">Rule / Source Summary</div>
                <h3>{selectedSourceDetail?.sourceLabel || "Active pricing context"}</h3>
              </div>
              <button type="button" onClick={() => setSelectedSection("source")}>View OPIS</button>
            </div>
            <div className="mobile-prices-summary-pills">
              <span>{selectedBranch}</span>
              <span>{selectedMarketKey || "No market"}</span>
              <span>{selectedTerminalKey || "No terminal"}</span>
            </div>
            <div className="mobile-prices-kv"><span>Source status</span><strong>{selectedSourceDetail?.status || "No snapshot"}</strong></div>
            <div className="mobile-prices-kv"><span>Filtered rows</span><strong>{selectedSourceRows.length}</strong></div>
            <div className="mobile-prices-kv"><span>As of</span><strong>{selectedSourceDetail?.pricingDate || pricingDate}</strong></div>
          </div>
          <div className="mobile-prices-kv"><span>Current date</span><strong>{pricingDate}</strong></div>
          <div className="mobile-prices-kv"><span>Incomplete outputs</span><strong>{runHistory?.incompleteCount || 0}</strong></div>
        </section>
      ) : null}

      {selectedSection === "preview" ? (
        <section className="mobile-prices-section">
          {preview ? (
            <>
              <div className="mobile-prices-output-grid">
                {preview.outputs?.map((output) => <OutputCard key={output.productFamily} output={output} fallbackStatus={preview.status} onOpen={() => openFamilySheet(output.productFamily)} />)}
              </div>
            </>
          ) : <div className="price-tables-empty">Run preview to inspect mobile output cards.</div>}
        </section>
      ) : null}

      {selectedSection === "results" ? (
        <section className="mobile-prices-section">
          {outputs.length ? outputs.map((output) => (
            <button key={output.id} type="button" className={`mobile-prices-history-card card${output.id === selectedOutputId ? " mobile-prices-customer-active" : ""}`} onClick={() => { setSelectedOutputId(output.id); setActiveSheet("output"); }}>
              <strong>{output.customerName}</strong>
              <div className="mobile-prices-kv"><span>Status</span><strong>{output.status}</strong></div>
              <div className="mobile-prices-kv"><span>Regular</span><strong>{formatMoney(output.regularTotal)}</strong></div>
              <div className="mobile-prices-kv"><span>Created</span><strong>{formatDateTime(output.createdAt)}</strong></div>
            </button>
          )) : <div className="price-tables-empty">No generated outputs for this customer/date yet.</div>}
        </section>
      ) : null}

      {selectedSection === "source" ? (
        <section className="mobile-prices-section">
          <div className="mobile-prices-inline-head">
            <div><div className="price-tables-panel-kicker">Source / OPIS</div><h3>{selectedSourceDetail?.sourceLabel || "Snapshot source"}</h3></div>
            <button type="button" onClick={() => setActiveSheet("source")}>{selectedSourceRows.length} Rows</button>
          </div>
          <div className="mobile-prices-detail card">
            <strong>{selectedSourceDetail?.sourceType || "No snapshot selected"}</strong>
            <span>{selectedSourceDetail ? `${selectedSourceDetail.status} | ${selectedSourceDetail.pricingDate}` : "Select a snapshot from the sheet."}</span>
            <span>Terminal filter: {selectedTerminalKey || "All terminals"}</span>
          </div>
          <div className="mobile-prices-source-grid">
            {selectedSourceRows.slice(0, 6).map((row) => (
              <button key={row.id} type="button" className="mobile-prices-source-card card" onClick={() => setActiveSheet("source")}>
                <strong>{row.productKey || row.quoteCode}</strong>
                <span>{row.vendorKey || "market"}</span>
                <div className="mobile-prices-kv"><span>Quote</span><strong>{row.quoteCode}</strong></div>
                <div className="mobile-prices-kv"><span>Value</span><strong>{row.value}</strong></div>
              </button>
            ))}
          </div>
          {!selectedSourceRows.length ? <div className="price-tables-empty">No source rows matched the selected terminal.</div> : null}
        </section>
      ) : null}
      </div>

      <div className="mobile-prices-bottom-bar">
        <div className="mobile-prices-tabbar">
          {[
            ["run", "Run"],
            ["preview", "Preview"],
            ["results", "Results"],
            ["source", "OPIS"]
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={selectedSection === key ? "mobile-prices-nav-active" : ""}
              onClick={() => setSelectedSection(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mobile-prices-bottom-actions">
          <button type="button" onClick={() => setActiveSheet("customers")}>{selectedCustomer?.name ? "Switch Customer" : "Customers"}</button>
          <button type="button" onClick={() => setActiveSheet("profile")} disabled={!selectedCustomerId}>Profile</button>
          <button type="button" onClick={handlePreview} disabled={!selectedCustomerId}>Preview</button>
          <button type="button" onClick={handleGenerate} disabled={!selectedCustomerId}>Generate</button>
        </div>
      </div>

      {activeSheet === "customers" ? (
        <Sheet title="Customers" subtitle="Pick the customer you want to work on" onClose={() => setActiveSheet("")}>
          <label className="mobile-prices-search">
            <span>Search customers</span>
            <input type="search" value={customerSearch} placeholder="Name, terminal, city" onChange={(event) => setCustomerSearch(event.target.value)} />
          </label>
          <div className="mobile-prices-sheet-grid">
            {filteredCustomers.map((customer) => (
              <button key={customer.id} type="button" className={`mobile-prices-customer card${customer.id === selectedCustomerId ? " mobile-prices-customer-active" : ""}`} onClick={() => { setSelectedCustomerId(customer.id); setCustomerSearch(""); setActiveSheet(""); }}>
                <strong>{customer.name}</strong>
                <span>{customer.terminalKey || "No terminal"} | {customer.status}</span>
              </button>
            ))}
          </div>
          {!filteredCustomers.length ? <div className="price-tables-empty">No customers matched that search.</div> : null}
        </Sheet>
      ) : null}

      {activeSheet === "output" && selectedOutputDetail ? (
        <Sheet title={selectedOutputDetail.customerName} subtitle={`${selectedOutputDetail.status} | ${selectedOutputDetail.pricingDate}`} onClose={() => setActiveSheet("")}>
          <div className="mobile-prices-output-grid">
            {outputCards.map((output) => <OutputCard key={output.productFamily} output={output} fallbackStatus={selectedOutputDetail.status} onOpen={() => openFamilySheet(output.productFamily)} />)}
          </div>
        </Sheet>
      ) : null}

      {activeSheet === "profile" && profileDraft ? (
        <Sheet title="Customer Profile" subtitle={selectedCustomer?.name || "Selected customer"} onClose={() => setActiveSheet("")}>
          <div className="mobile-prices-profile-form">
            {[
              ["effectiveStart", "Effective Start", "date"],
              ["effectiveEnd", "Effective End", "date"],
              ["terminalKey", "Terminal Key", "text"],
              ["marketKey", "Market Key", "text"],
              ["freightCostGas", "Freight Gas", "text"],
              ["freightCostDiesel", "Freight Diesel", "text"],
              ["rackMarginGas", "Margin Gas", "text"],
              ["rackMarginDiesel", "Margin Diesel", "text"],
              ["discountRegular", "Discount Regular", "text"],
              ["discountMid", "Discount Mid", "text"],
              ["discountPremium", "Discount Premium", "text"],
              ["discountDiesel", "Discount Diesel", "text"]
            ].map(([field, label, type]) => (
              <label key={field}>
                <span>{label}</span>
                <input type={type} value={profileDraft[field] ?? ""} onChange={(event) => setProfileDraft((current) => ({ ...current, [field]: event.target.value }))} />
              </label>
            ))}
            <label>
              <span>Branch</span>
              <select value={profileDraft.branch} onChange={(event) => setProfileDraft((current) => ({ ...current, branch: event.target.value }))}>
                <option value="unbranded">unbranded</option>
                <option value="branded">branded</option>
              </select>
            </label>
          </div>
          <div className="mobile-prices-sheet-actions">
            <button type="button" onClick={handleSaveProfile}>Save Profile</button>
          </div>
        </Sheet>
      ) : null}

      {activeSheet === "source" ? (
        <Sheet title="Terminal-filtered source rows" subtitle={selectedTerminalKey || "All terminals"} onClose={() => setActiveSheet("")}>
          <div className="mobile-prices-sheet-grid">
            {sources.map((source) => (
              <button key={source.id} type="button" className={`mobile-prices-history-card card${source.id === selectedSourceId ? " mobile-prices-customer-active" : ""}`} onClick={() => setSelectedSourceId(source.id)}>
                <strong>{source.sourceLabel || source.sourceType}</strong>
                <span>{source.sourceType} | {source.status}</span>
              </button>
            ))}
          </div>
          <div className="mobile-prices-sheet-grid">
            {selectedSourceRows.map((row) => (
              <div key={row.id} className="mobile-prices-source-card card">
                <strong>{row.productKey || row.quoteCode}</strong>
                <span>{row.vendorKey || row.marketKey}</span>
                <div className="mobile-prices-kv"><span>Terminal</span><strong>{row.terminalKey}</strong></div>
                <div className="mobile-prices-kv"><span>Quote</span><strong>{row.quoteCode}</strong></div>
                <div className="mobile-prices-kv"><span>Value</span><strong>{row.value}</strong></div>
              </div>
            ))}
          </div>
        </Sheet>
      ) : null}

      {activeSheet === "family" && familyDetail ? (
        <Sheet title={familyDetail.productFamily} subtitle="Full price trace" onClose={() => setActiveSheet("")}>
          <div className="mobile-prices-output-card card">
            <div className="mobile-prices-kv"><span>Base</span><strong>{formatMoney(familyDetail.basePrice)}</strong></div>
            {"taxes" in familyDetail ? <div className="mobile-prices-kv"><span>Taxes</span><strong>{formatMoney(familyDetail.taxes)}</strong></div> : null}
            <div className="mobile-prices-kv"><span>Total</span><strong>{formatMoney(familyDetail.totalPrice)}</strong></div>
          </div>
          <div className="mobile-prices-trace-list">
            {(familyDetail.trace || []).map((item, index) => (
              <div key={`${familyDetail.productFamily}-${index}`} className="mobile-prices-trace-row card">
                <strong>{item.label || item.kind || item.componentKey}</strong>
                <span>{item.detail}</span>
                <em>{item.contribution != null ? formatMoney(item.contribution) : item.value != null ? formatMoney(item.value) : "n/a"}</em>
              </div>
            ))}
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}
