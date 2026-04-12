import { Component, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { SiteMap } from "../components/SiteMap";
import { AlliedPortfolioTab } from "./AlliedPortfolioTab";

const FILTERS = {
  all: "all",
  critical: "critical",
  warning: "warning"
};

class MapErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error("Portfolio map failed to render", error);
  }

  render() {
    const { hasError } = this.state;
    const { fallback, children } = this.props;
    return hasError ? fallback : children;
  }
}

export function PortfolioPage() {
  const [sites, setSites] = useState([]);
  const [error, setError] = useState("");
  const [selectedSite, setSelectedSite] = useState(null);
  const [activeFilter, setActiveFilter] = useState(FILTERS.all);
  const [agentDraft, setAgentDraft] = useState("");
  const [agentLog, setAgentLog] = useState([]);
  const [activeTab, setActiveTab] = useState("operations");

  useEffect(() => {
    api
      .getSites()
      .then((rows) => {
        setSites(rows);
        setSelectedSite(null);
      })
      .catch((err) => setError(err.message));
  }, []);

  const totals = sites.reduce(
    (acc, site) => {
      acc.critical += site.criticalCount || 0;
      acc.warn += site.warnCount || 0;
      return acc;
    },
    { critical: 0, warn: 0 }
  );

  const filteredSites = sites.filter((site) => {
    if (activeFilter === FILTERS.critical) return (site.criticalCount || 0) > 0;
    if (activeFilter === FILTERS.warning) return (site.warnCount || 0) > 0;
    return true;
  });

  useEffect(() => {
    if (!filteredSites.length) {
      setSelectedSite(null);
      return;
    }

    if (selectedSite && !filteredSites.some((site) => site.id === selectedSite.id)) {
      setSelectedSite(null);
    }
  }, [filteredSites, selectedSite]);

  useEffect(() => {
    if (!selectedSite) {
      setAgentLog([]);
      setAgentDraft("");
      return;
    }
    setAgentLog([
      `Microsoft Windows [Version 10.0.19045.0]`,
      `(c) WannLynx Petroleum local agent console`,
      "",
      `C:\\Sites\\${selectedSite.siteCode}> connected to ${selectedSite.name}`,
      `C:\\Sites\\${selectedSite.siteCode}> ready for local AI prompts`
    ]);
    setAgentDraft("");
  }, [selectedSite]);

  function toggleFilter(nextFilter) {
    setActiveFilter((current) => (current === nextFilter ? FILTERS.all : nextFilter));
  }

  function submitAgentPrompt(event) {
    event.preventDefault();
    const prompt = agentDraft.trim();
    if (!prompt || !selectedSite) return;

    setAgentLog((current) => [
      ...current,
      `C:\\Sites\\${selectedSite.siteCode}> ${prompt}`,
      `Local AI agent: not connected yet. Ready to answer for ${selectedSite.name} once local agent wiring is added.`
    ]);
    setAgentDraft("");
  }

  return (
    <div>
      <div className="card">
        <div className="inline">
          <button type="button" className={activeTab === "operations" ? "tab-active" : ""} onClick={() => setActiveTab("operations")}>
            Operations
          </button>
          <button type="button" className={activeTab === "allied" ? "tab-active" : ""} onClick={() => setActiveTab("allied")}>
            Allied
          </button>
        </div>
      </div>

      {activeTab === "allied" ? (
        <AlliedPortfolioTab />
      ) : (
        <>
      <div className="stats-row">
        <button type="button" className={`metric-card metric-card-button${activeFilter === FILTERS.all ? " metric-card-active" : ""}`} onClick={() => { setActiveFilter(FILTERS.all); setSelectedSite(null); }}>
          <div className="metric-label">Total Sites</div>
          <div className="metric-value">{sites.length}</div>
        </button>
        <button
          type="button"
          className={`metric-card metric-card-button${activeFilter === FILTERS.critical ? " metric-card-active" : ""}`}
          onClick={() => { toggleFilter(FILTERS.critical); setSelectedSite(null); }}
        >
          <div className="metric-label">Critical Alerts</div>
          <div className="metric-value severity-critical">{totals.critical}</div>
        </button>
        <button
          type="button"
          className={`metric-card metric-card-button${activeFilter === FILTERS.warning ? " metric-card-active" : ""}`}
          onClick={() => { toggleFilter(FILTERS.warning); setSelectedSite(null); }}
        >
          <div className="metric-label">Warning Alerts</div>
          <div className="metric-value severity-warn">{totals.warn}</div>
        </button>
      </div>

      {error && <div className="card severity-critical">{error}</div>}

      <div className={`split-layout portfolio-split-layout${selectedSite ? " portfolio-split-layout-focused" : ""}`}>
        <section className={`card map-panel portfolio-map-panel${selectedSite ? " portfolio-map-panel-focused" : ""}`}>
          <div className="section-header">
            <h3>Portfolio Map</h3>
            <span>Map-first overview</span>
          </div>
          <MapErrorBoundary
            fallback={
              <div className="card portfolio-map-fallback">
                <strong>Map unavailable</strong>
                <div>The site list is still available below while the map is unavailable.</div>
              </div>
            }
          >
            <SiteMap sites={filteredSites} selectedSiteId={selectedSite?.id} onSelect={setSelectedSite} />
          </MapErrorBoundary>
          {selectedSite && (
            <div className="drawer portfolio-site-drawer">
              <div className="drawer-title">{selectedSite.name}</div>
              <div>Site Code: {selectedSite.siteCode}</div>
              <div>
                Address: {selectedSite.address || "n/a"} {selectedSite.postalCode || ""}
              </div>
              <div>
                Pump Sides: {selectedSite.pumpSidesConnected}/{selectedSite.pumpSidesExpected}
              </div>
              <div className="inline">
                <Link to={`/sites/${selectedSite.id}`}>Open Site Detail</Link>
                <Link to={`/sites/${selectedSite.id}/layout`}>Open Layout</Link>
                <Link to={`/work-queue?siteId=${encodeURIComponent(selectedSite.id)}`}>Alerts</Link>
              </div>
              <section className="portfolio-agent-terminal" aria-label="Talk to local AI agent">
                <div className="portfolio-agent-titlebar">
                  <span className="portfolio-agent-dot" />
                  <span className="portfolio-agent-dot" />
                  <span className="portfolio-agent-dot" />
                  <strong>Talk to local AI agent</strong>
                </div>
                <div className="portfolio-agent-screen">
                  {agentLog.map((line, index) => (
                    <div key={`${selectedSite.id}-${index}`} className="portfolio-agent-line">
                      {line || "\u00A0"}
                    </div>
                  ))}
                </div>
                <form className="portfolio-agent-inputbar" onSubmit={submitAgentPrompt}>
                  <span>{`C:\\Sites\\${selectedSite.siteCode}>`}</span>
                  <input
                    value={agentDraft}
                    onChange={(event) => setAgentDraft(event.target.value)}
                    placeholder="Ask the local AI agent about this location"
                  />
                </form>
              </section>
            </div>
          )}
        </section>

        <section className={`card queue-panel portfolio-queue-panel${selectedSite ? " portfolio-queue-panel-focused" : ""}`}>
          <div className="section-header">
            <h3>Needs Attention</h3>
            <span>{activeFilter === FILTERS.all ? "By severity and connectivity" : `${filteredSites.length} sites in current filter`}</span>
          </div>
          <div className="stack">
            {filteredSites.map((site) => (
              <button key={site.id} className="queue-item" onClick={() => setSelectedSite(site)}>
                <div>
                  <strong>{site.name}</strong>
                  <div className="queue-sub">Code {site.siteCode} | {site.region}</div>
                </div>
                <div className="queue-badges">
                  <span className="badge badge-critical">{site.criticalCount}</span>
                  <span className="badge badge-warn">{site.warnCount}</span>
                </div>
              </button>
            ))}
            {!filteredSites.length ? <div className="admin-empty-mini">No sites match the current filter.</div> : null}
          </div>
        </section>
      </div>

      <section className="card portfolio-site-table">
        <div className="section-header">
          <h3>Site Directory</h3>
          <span>{activeFilter === FILTERS.all ? "Always-visible portfolio summary" : `${filteredSites.length} filtered sites`}</span>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Site</th>
                <th>Code</th>
                <th>Region</th>
                <th>Address</th>
                <th>Alerts</th>
              </tr>
            </thead>
            <tbody>
              {filteredSites.length ? (
                filteredSites.map((site) => (
                  <tr key={site.id}>
                    <td>
                      <button className="table-link-button" onClick={() => setSelectedSite(site)}>
                        {site.name}
                      </button>
                    </td>
                    <td>{site.siteCode}</td>
                    <td>{site.region || "n/a"}</td>
                    <td>{[site.address, site.postalCode].filter(Boolean).join(" ") || "n/a"}</td>
                    <td>{(site.criticalCount || 0) + (site.warnCount || 0)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>No sites match the current filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
        </>
      )}
    </div>
  );
}
