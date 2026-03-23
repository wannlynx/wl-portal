import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import pumpIcon from "../assets/pump.svg";
import tankIcon from "../assets/tank.svg";

const emptyCreateStation = {
  siteCode: "",
  name: "",
  address: "",
  postalCode: "",
  region: ""
};
const emptyStationEdit = { name: "", address: "", postalCode: "", region: "" };
const emptyConfig = { atgHost: "", atgPort: "10001", atgPollIntervalSec: "60" };
const emptyTank = { atgTankId: "", label: "", product: "", capacityLiters: "" };
const emptyPump = { pumpNumber: "", label: "", sideAip: "", sideBip: "", port: "5201" };
const emptyBranding = { name: "", logoUrl: "" };

function workspaceLabel(panel, selectedTankId, selectedPumpId) {
  if (panel === "createStation") return "Create Station";
  if (panel === "branding") return "Jobber Branding";
  if (panel === "tank") return selectedTankId ? "Tank Editor" : "Add Tank";
  if (panel === "pump") return selectedPumpId ? "Pump Editor" : "Add Pump";
  return "";
}

function statusTone(site) {
  if (!site) return "idle";
  if ((site.criticalCount || 0) > 0) return "critical";
  if ((site.warnCount || 0) > 0) return "warn";
  return "healthy";
}

export function AdminPage({ user, jobber, onJobberUpdated }) {
  const [sites, setSites] = useState([]);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [siteDetail, setSiteDetail] = useState(null);
  const [pumpsWithSides, setPumpsWithSides] = useState([]);
  const [outstandingAlerts, setOutstandingAlerts] = useState([]);
  const [tankSnapshot, setTankSnapshot] = useState({});
  const [activePanel, setActivePanel] = useState("createStation");
  const [selectedTankId, setSelectedTankId] = useState("");
  const [selectedPumpId, setSelectedPumpId] = useState("");
  const [createStationForm, setCreateStationForm] = useState(emptyCreateStation);
  const [stationEditForm, setStationEditForm] = useState(emptyStationEdit);
  const [configForm, setConfigForm] = useState(emptyConfig);
  const [tankForm, setTankForm] = useState(emptyTank);
  const [pumpForm, setPumpForm] = useState(emptyPump);
  const [brandingForm, setBrandingForm] = useState(emptyBranding);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [stationCodeError, setStationCodeError] = useState("");

  async function loadSites() {
    const rows = await api.getSites();
    setSites(rows);
  }

  async function loadSelectedSite(siteId) {
    if (!siteId) {
      setSiteDetail(null);
      setPumpsWithSides([]);
      setOutstandingAlerts([]);
      setTankSnapshot({});
      return;
    }
    const [site, pumpRows, alertRows, tankRows] = await Promise.all([
      api.getSite(siteId),
      api.getPumps(siteId),
      api.getAlerts({ siteId, state: "raised" }),
      api.getTankInformation({ siteId, limit: "200" })
    ]);
    setSiteDetail(site);
    setPumpsWithSides(pumpRows);
    setOutstandingAlerts(alertRows);
    const latestByTank = {};
    for (const row of tankRows) {
      if (!latestByTank[row.tankId]) latestByTank[row.tankId] = row;
    }
    setTankSnapshot(latestByTank);
    setStationEditForm({
      name: site.name || "",
      address: site.address || "",
      postalCode: site.postalCode || "",
      region: site.region || ""
    });
    setConfigForm({
      atgHost: site.integration?.atgHost || "",
      atgPort: String(site.integration?.atgPort || 10001),
      atgPollIntervalSec: String(site.integration?.atgPollIntervalSec || 60)
    });
  }

  useEffect(() => {
    setBrandingForm({
      name: jobber?.name || "",
      logoUrl: jobber?.logoUrl || ""
    });
  }, [jobber]);

  useEffect(() => {
    (async () => {
      try {
        await loadSites();
      } catch (err) {
        setError(err.message);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await loadSelectedSite(selectedSiteId);
      } catch (err) {
        setError(err.message);
      }
    })();
  }, [selectedSiteId]);

  const selectedSite = useMemo(
    () => sites.find((s) => s.id === selectedSiteId) || null,
    [sites, selectedSiteId]
  );
  const tanks = siteDetail?.tanks || [];
  const pumps = pumpsWithSides || [];
  const existingCodes = useMemo(
    () => new Set(sites.map((s) => String(s.siteCode || "").trim())),
    [sites]
  );
  const totalAlerts = (selectedSite?.criticalCount || 0) + (selectedSite?.warnCount || 0);
  const topOutstandingAlerts = outstandingAlerts.slice(0, 4);
  const healthTone = statusTone(selectedSite);
  const activeWorkspace = workspaceLabel(activePanel, selectedTankId, selectedPumpId);
  const canManageBranding = user?.jobberRole === "admin";

  function clearStatus() {
    setMessage("");
    setError("");
  }

  function validateStationCode(rawCode) {
    const code = String(rawCode || "").trim();
    if (!code) return "Station number is required.";
    if (!/^\d+$/.test(code)) return "Station number must be numeric only.";
    if (existingCodes.has(code)) return `Station ${code} already exists.`;
    return "";
  }

  function onChangeStationCode(value) {
    const numericOnly = value.replace(/[^\d]/g, "");
    setCreateStationForm((f) => ({ ...f, siteCode: numericOnly }));
    setStationCodeError(validateStationCode(numericOnly));
  }

  function requireStation() {
    if (!selectedSiteId) {
      setError("Select a station first.");
      return false;
    }
    return true;
  }

  async function submitCreateStation(e) {
    e.preventDefault();
    clearStatus();
    const codeError = validateStationCode(createStationForm.siteCode);
    setStationCodeError(codeError);
    if (codeError) {
      setError(codeError);
      return;
    }
    try {
      const created = await api.createSite({
        siteCode: createStationForm.siteCode.trim(),
        name: createStationForm.name.trim(),
        address: createStationForm.address.trim(),
        postalCode: createStationForm.postalCode.trim(),
        region: createStationForm.region.trim()
      });
      setMessage(`Created station ${created.siteCode}.`);
      setCreateStationForm(emptyCreateStation);
      setStationCodeError("");
      await loadSites();
      setSelectedSiteId(created.id);
      setActivePanel("station");
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveStationEdit(e) {
    e.preventDefault();
    clearStatus();
    if (!requireStation()) return;
    try {
      await api.updateSite(selectedSiteId, {
        name: stationEditForm.name.trim(),
        address: stationEditForm.address.trim(),
        postalCode: stationEditForm.postalCode.trim(),
        region: stationEditForm.region.trim()
      });
      setMessage("Station updated.");
      await loadSites();
      await loadSelectedSite(selectedSiteId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteStation() {
    clearStatus();
    if (!requireStation()) return;
    if (!confirm("Delete this station and all its assets?")) return;
    try {
      await api.deleteSite(selectedSiteId);
      setMessage("Station deleted.");
      setSelectedSiteId("");
      setActivePanel("createStation");
      await loadSites();
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveConfig(e) {
    e.preventDefault();
    clearStatus();
    if (!requireStation()) return;
    try {
      await api.updateIntegrations(selectedSiteId, {
        atgHost: configForm.atgHost.trim(),
        atgPort: Number(configForm.atgPort || 10001),
        atgPollIntervalSec: Number(configForm.atgPollIntervalSec || 60)
      });
      setMessage("Config saved.");
    } catch (err) {
      setError(err.message);
    }
  }

  function onLogoFileSelected(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setBrandingForm((form) => ({ ...form, logoUrl: reader.result }));
      }
    };
    reader.readAsDataURL(file);
  }

  async function saveBranding(e) {
    e.preventDefault();
    clearStatus();
    try {
      const updated = await api.updateCurrentJobber({
        name: brandingForm.name.trim() || jobber?.name || "Jobber",
        logoUrl: brandingForm.logoUrl
      });
      onJobberUpdated(updated);
      setMessage("Jobber branding updated.");
    } catch (err) {
      setError(err.message);
    }
  }

  function selectTank(tank) {
    setActivePanel("tank");
    setSelectedTankId(tank.id);
    setTankForm({
      atgTankId: tank.atgTankId || "",
      label: tank.label || "",
      product: tank.product || "",
      capacityLiters: String(tank.capacityLiters ?? "")
    });
  }

  function startAddTank() {
    if (!requireStation()) return;
    setActivePanel("tank");
    setSelectedTankId("");
    setTankForm(emptyTank);
  }

  async function saveTank(e) {
    e.preventDefault();
    clearStatus();
    if (!requireStation()) return;
    const payload = {
      atgTankId: tankForm.atgTankId.trim(),
      label: tankForm.label.trim(),
      product: tankForm.product.trim(),
      capacityLiters: Number(tankForm.capacityLiters || 0)
    };
    try {
      if (selectedTankId) {
        await api.updateTank(selectedTankId, payload);
        setMessage("Tank updated.");
      } else {
        await api.addTank(selectedSiteId, payload);
        setMessage("Tank added.");
      }
      await loadSelectedSite(selectedSiteId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteTank(tankId) {
    clearStatus();
    if (!requireStation()) return;
    if (!confirm("Delete this tank?")) return;
    try {
      await api.deleteTank(tankId);
      setMessage("Tank deleted.");
      await loadSelectedSite(selectedSiteId);
    } catch (err) {
      setError(err.message);
    }
  }

  function sideOf(pump, code) {
    return (pump.sides || []).find((s) => s.side === code) || { ip: "", port: 5201 };
  }

  function selectPump(pump) {
    setActivePanel("pump");
    setSelectedPumpId(pump.id);
    const a = sideOf(pump, "A");
    const b = sideOf(pump, "B");
    setPumpForm({
      pumpNumber: String(pump.pumpNumber || ""),
      label: pump.label || "",
      sideAip: a.ip || "",
      sideBip: b.ip || "",
      port: String(a.port || b.port || 5201)
    });
  }

  function startAddPump() {
    if (!requireStation()) return;
    setActivePanel("pump");
    setSelectedPumpId("");
    setPumpForm(emptyPump);
  }

  async function savePump(e) {
    e.preventDefault();
    clearStatus();
    if (!requireStation()) return;
    const payload = {
      pumpNumber: Number(pumpForm.pumpNumber || 0),
      label: pumpForm.label.trim(),
      sides: {
        A: { ip: pumpForm.sideAip.trim(), port: Number(pumpForm.port || 5201) },
        B: { ip: pumpForm.sideBip.trim(), port: Number(pumpForm.port || 5201) }
      }
    };
    try {
      if (selectedPumpId) {
        await api.updatePump(selectedPumpId, payload);
        setMessage("Pump updated.");
      } else {
        await api.addPump(selectedSiteId, payload);
        setMessage("Pump added.");
      }
      await loadSelectedSite(selectedSiteId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function deletePump(pumpId) {
    clearStatus();
    if (!requireStation()) return;
    if (!confirm("Delete this pump?")) return;
    try {
      await api.deletePump(pumpId);
      setMessage("Pump deleted.");
      await loadSelectedSite(selectedSiteId);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="admin-page admin-hud">
      <div className="admin-hud-shell">
        <section className="admin-hud-hero">
          <div className="admin-hud-title-wrap">
            <div className="admin-kicker">Station Administration</div>
            <select
              className="admin-hero-select"
              value={selectedSiteId}
              onChange={(e) => {
                setSelectedSiteId(e.target.value);
                setActivePanel("station");
              }}
            >
              <option value="">Selection of Station</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.siteCode} - {site.name}
                </option>
              ))}
            </select>
            <p>{selectedSite ? `${selectedSite.address || "Address n/a"} ${selectedSite.postalCode || ""}`.trim() : "Choose a station to load configuration, pumps, and tanks."}</p>
          </div>
          <div className={`admin-radar admin-radar-${healthTone}`}>
            <div className="admin-radar-ring admin-radar-ring-a" />
            <div className="admin-radar-ring admin-radar-ring-b" />
            <div className="admin-radar-core">
              <span>Active Workspace</span>
              <strong>{activeWorkspace || ""}</strong>
            </div>
          </div>
        </section>

        <div className="admin-hud-stats admin-hud-stats-wide">
          <div className="admin-stat-card admin-stat-card-compact">
            <span>Selected Station</span>
            <strong>{selectedSite?.name || "No station selected"}</strong>
            <em>{selectedSite ? `${selectedSite.siteCode} � ${selectedSite.region || "Region n/a"}` : "Awaiting station selection"}</em>
          </div>
          <div className="admin-stat-card admin-stat-card-loadout">
            <span>Asset Loadout</span>
            <strong>{tanks.length} Tanks / {pumps.length} Pumps</strong>
            <div className="admin-loadout-columns">
              <div>
                <div className="admin-loadout-head">
                  <label>Tanks</label>
                </div>
                <div className="admin-loadout-scroll">
                  <div className="icon-grid admin-asset-grid admin-loadout-grid">
                    {tanks.length ? tanks.map((tank, idx) => (
                      <div key={tank.id} className={`icon-card admin-asset-card ${selectedTankId === tank.id ? "icon-card-active" : ""}`} onClick={() => selectTank(tank)}>
                        <div className="admin-loadout-metrics">
                          <strong>{tankSnapshot[tank.id] ? `${Number(tankSnapshot[tank.id].volume).toLocaleString(undefined, { maximumFractionDigits: 0 })} L` : "-"}</strong>
                          <span>{tankSnapshot[tank.id] ? `${Number(tankSnapshot[tank.id].fillPercent).toLocaleString(undefined, { maximumFractionDigits: 1 })}%` : "-%"}</span>
                        </div>
                        <img src={tankIcon} alt="tank" className="asset-icon admin-loadout-icon" />
                        <div className="admin-loadout-copy">
                          <div>Tank {idx + 1}</div>
                          <small>{tank.label}</small>
                        </div>
                        <button type="button" className="admin-delete-btn" onClick={(e) => { e.stopPropagation(); deleteTank(tank.id); }}>Delete</button>
                      </div>
                    )) : <div className="admin-empty-mini">No tanks loaded</div>}
                  </div>
                </div>
              </div>
              <div>
                <div className="admin-loadout-head">
                  <label>Pumps</label>
                </div>
                <div className="admin-loadout-scroll">
                  <div className="icon-grid admin-asset-grid admin-loadout-grid">
                    {pumps.length ? pumps.map((pump, idx) => (
                      <div key={pump.id} className={`icon-card admin-asset-card ${selectedPumpId === pump.id ? "icon-card-active" : ""}`} onClick={() => selectPump(pump)}>
                        <img src={pumpIcon} alt="pump" className="asset-icon admin-loadout-icon" />
                        <div className="admin-loadout-copy">
                          <div>Pump {idx + 1}</div>
                          <small>{pump.label}</small>
                        </div>
                        <button type="button" className="admin-delete-btn" onClick={(e) => { e.stopPropagation(); deletePump(pump.id); }}>Delete</button>
                      </div>
                    )) : <div className="admin-empty-mini">No pumps loaded</div>}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="admin-stat-card admin-stat-card-alerts">
            <span>Outstanding Alerts</span>
            <strong>{totalAlerts}</strong>
            <em>{(selectedSite?.criticalCount || 0)} critical, {(selectedSite?.warnCount || 0)} warn</em>
            {selectedSiteId ? (
              <>
                <div className="admin-alert-mini-list">
                  {topOutstandingAlerts.length ? topOutstandingAlerts.map((alert) => (
                    <div key={alert.id} className={`admin-alert-mini admin-alert-mini-${alert.severity}`}>
                      <strong>{alert.alertType || alert.component}</strong>
                      <span>{alert.message}</span>
                    </div>
                  )) : (
                    <div className="admin-empty-mini">No outstanding alerts for this store</div>
                  )}
                </div>
                <Link className="admin-alert-link" to={`/work-queue?siteId=${selectedSiteId}`}>
                  Open In Work Queue
                </Link>
              </>
            ) : (
              <div className="admin-empty-mini">Select a station to inspect outstanding alerts</div>
            )}
          </div>
        </div>

        {message && <div className="admin-banner admin-banner-success">{message}</div>}
        {error && <div className="admin-banner admin-banner-error">{error}</div>}

        <div className="admin-layout admin-hud-layout">
          <aside className="admin-left-pane admin-hud-panel admin-nav-panel">
            <div className="admin-panel-label">Mode Select</div>
            <div className="admin-mode-grid">
              {canManageBranding ? (
                <button className={`left-panel-btn admin-mode-btn ${activePanel === "branding" ? "left-panel-btn-active" : ""}`} onClick={() => setActivePanel("branding")}>Branding</button>
              ) : null}
              <button className={`left-panel-btn admin-mode-btn ${activePanel === "createStation" ? "left-panel-btn-active" : ""}`} onClick={() => setActivePanel("createStation")}>Add Station</button>
              <button className={`left-panel-btn admin-mode-btn ${activePanel === "station" ? "left-panel-btn-active" : ""}`} onClick={() => setActivePanel("station")}>Station</button>
              <button className={`left-panel-btn admin-mode-btn ${activePanel === "config" ? "left-panel-btn-active" : ""}`} onClick={() => setActivePanel("config")}>ATG Config</button>
              <button className={`left-panel-btn admin-mode-btn ${activePanel === "tank" ? "left-panel-btn-active" : ""}`} onClick={startAddTank}>Tank</button>
              <button className={`left-panel-btn admin-mode-btn ${activePanel === "pump" ? "left-panel-btn-active" : ""}`} onClick={startAddPump}>Pump</button>
            </div>

            <div className="admin-signal-card">
              <span>Current Focus</span>
              <strong>{jobber?.name || selectedSite?.name || "Awaiting station selection"}</strong>
              <em>{jobber?.slug ? `${sites.length} visible locations for ${jobber.slug}` : selectedSite?.address ? `${selectedSite.address} ${selectedSite.postalCode || ""}` : "Create or select a station to load details"}</em>
            </div>
          </aside>

          <section className="admin-right-pane admin-hud-panel admin-work-panel">
            <div className="admin-work-head">
              <div>
                <div className="admin-panel-label">Workspace</div>
                <h3>{activeWorkspace || ""}</h3>
              </div>
              <div className={`admin-work-status admin-work-status-${healthTone}`}>
                <span>{healthTone}</span>
              </div>
            </div>

            {canManageBranding && activePanel === "branding" && (
              <form className="admin-form admin-hud-form" onSubmit={saveBranding}>
                <div className="admin-form-intro">
                  <strong>Jobber Branding</strong>
                  <span>Upload the logo that should replace the current mark in the top left corner for this jobber.</span>
                </div>
                <input
                  value={brandingForm.name}
                  onChange={(e) => setBrandingForm((form) => ({ ...form, name: e.target.value }))}
                  placeholder="Jobber Name"
                />
                <label className="admin-file-field">
                  <span>Logo Upload</span>
                  <input type="file" accept="image/*" onChange={(e) => onLogoFileSelected(e.target.files?.[0])} />
                </label>
                <input
                  value={brandingForm.logoUrl}
                  onChange={(e) => setBrandingForm((form) => ({ ...form, logoUrl: e.target.value }))}
                  placeholder="Logo URL or data URL"
                />
                <div className="admin-brand-preview">
                  {brandingForm.logoUrl ? (
                    <img src={brandingForm.logoUrl} alt={brandingForm.name || "Jobber logo"} className="admin-brand-image" />
                  ) : (
                    <div className="admin-empty-mini">No custom logo saved yet</div>
                  )}
                </div>
                <div className="inline">
                  <button type="submit" className="admin-hud-cta">Save Branding</button>
                  <button type="button" onClick={() => setBrandingForm((form) => ({ ...form, logoUrl: "" }))}>Clear Logo</button>
                </div>
              </form>
            )}

            {activePanel === "createStation" && (
              <form className="admin-form admin-hud-form" onSubmit={submitCreateStation}>
                <div className="admin-form-intro">
                  <strong>Provision New Station</strong>
                  <span>Create a station record with enough location detail for mapping and future asset import.</span>
                </div>
                <input
                  placeholder="Station Number / Site Code"
                  value={createStationForm.siteCode}
                  onChange={(e) => onChangeStationCode(e.target.value)}
                  onBlur={() => setStationCodeError(validateStationCode(createStationForm.siteCode))}
                  required
                />
                {stationCodeError && <div className="admin-inline-error">{stationCodeError}</div>}
                <input placeholder="Station Name" value={createStationForm.name} onChange={(e) => setCreateStationForm((f) => ({ ...f, name: e.target.value }))} required />
                <input placeholder="Address" value={createStationForm.address} onChange={(e) => setCreateStationForm((f) => ({ ...f, address: e.target.value }))} required />
                <input placeholder="ZIP Code" value={createStationForm.postalCode} onChange={(e) => setCreateStationForm((f) => ({ ...f, postalCode: e.target.value }))} required />
                <input placeholder="Region" value={createStationForm.region} onChange={(e) => setCreateStationForm((f) => ({ ...f, region: e.target.value }))} />
                <button type="submit" className="admin-hud-cta" disabled={!!stationCodeError}>Create Station</button>
              </form>
            )}

            {selectedSiteId && activePanel === "station" && (
              <form className="admin-form admin-hud-form" onSubmit={saveStationEdit}>
                <div className="admin-form-intro">
                  <strong>Station Profile</strong>
                  <span>Update visible portfolio data and location metadata for the selected station.</span>
                </div>
                <input value={selectedSite?.siteCode || ""} readOnly placeholder="Station Number" />
                <input value={stationEditForm.name} onChange={(e) => setStationEditForm((f) => ({ ...f, name: e.target.value }))} placeholder="Station Name" required />
                <input value={stationEditForm.address} onChange={(e) => setStationEditForm((f) => ({ ...f, address: e.target.value }))} placeholder="Address" required />
                <input value={stationEditForm.postalCode} onChange={(e) => setStationEditForm((f) => ({ ...f, postalCode: e.target.value }))} placeholder="ZIP Code" required />
                <input value={stationEditForm.region} onChange={(e) => setStationEditForm((f) => ({ ...f, region: e.target.value }))} placeholder="Region" />
                <div className="inline">
                  <button type="submit" className="admin-hud-cta">Save Station</button>
                  <button type="button" className="danger-btn" onClick={deleteStation}>Delete Station</button>
                </div>
              </form>
            )}

            {selectedSiteId && activePanel === "config" && (
              <form className="admin-form admin-hud-form" onSubmit={saveConfig}>
                <div className="admin-form-intro">
                  <strong>ATG Polling Configuration</strong>
                  <span>Set the ATG endpoint and collection cadence that drive station inventory and alerts.</span>
                </div>
                <input value={configForm.atgHost} onChange={(e) => setConfigForm((f) => ({ ...f, atgHost: e.target.value }))} placeholder="ATG Host" />
                <input value={configForm.atgPort} onChange={(e) => setConfigForm((f) => ({ ...f, atgPort: e.target.value }))} placeholder="ATG Port" />
                <input value={configForm.atgPollIntervalSec} onChange={(e) => setConfigForm((f) => ({ ...f, atgPollIntervalSec: e.target.value }))} placeholder="Poll Interval (sec)" />
                <button type="submit" className="admin-hud-cta">Save Config</button>
              </form>
            )}

            {selectedSiteId && activePanel === "tank" && (
              <form className="admin-form admin-hud-form" onSubmit={saveTank}>
                <div className="admin-form-intro">
                  <strong>{selectedTankId ? "Edit Tank" : "Add Tank"}</strong>
                  <span>Maintain tank identity, product, and capacity for ATG import and alert correlation.</span>
                </div>
                <input value={tankForm.atgTankId} onChange={(e) => setTankForm((f) => ({ ...f, atgTankId: e.target.value }))} placeholder="Tank Number" required />
                <input value={tankForm.label} onChange={(e) => setTankForm((f) => ({ ...f, label: e.target.value }))} placeholder="Tank Label" required />
                <input value={tankForm.product} onChange={(e) => setTankForm((f) => ({ ...f, product: e.target.value }))} placeholder="Product" required />
                <input value={tankForm.capacityLiters} onChange={(e) => setTankForm((f) => ({ ...f, capacityLiters: e.target.value }))} placeholder="Capacity Liters" required />
                <button type="submit" className="admin-hud-cta">{selectedTankId ? "Save Tank" : "Create Tank"}</button>
              </form>
            )}

            {selectedSiteId && activePanel === "pump" && (
              <form className="admin-form admin-hud-form" onSubmit={savePump}>
                <div className="admin-form-intro">
                  <strong>{selectedPumpId ? "Edit Pump" : "Add Pump"}</strong>
                  <span>Keep the forecourt pump lineup and side endpoints synchronized with the field layout.</span>
                </div>
                <input value={pumpForm.pumpNumber} onChange={(e) => setPumpForm((f) => ({ ...f, pumpNumber: e.target.value }))} placeholder="Pump Number" required />
                <input value={pumpForm.label} onChange={(e) => setPumpForm((f) => ({ ...f, label: e.target.value }))} placeholder="Pump Label" required />
                <input value={pumpForm.sideAip} onChange={(e) => setPumpForm((f) => ({ ...f, sideAip: e.target.value }))} placeholder="Side A IP" required />
                <input value={pumpForm.sideBip} onChange={(e) => setPumpForm((f) => ({ ...f, sideBip: e.target.value }))} placeholder="Side B IP" required />
                <input value={pumpForm.port} onChange={(e) => setPumpForm((f) => ({ ...f, port: e.target.value }))} placeholder="Port" />
                <button type="submit" className="admin-hud-cta">{selectedPumpId ? "Save Pump" : "Create Pump"}</button>
              </form>
            )}

            {!selectedSiteId && !["createStation", "branding"].includes(activePanel) && (
              <div className="admin-empty-state">
                Select or create a station first.
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}



