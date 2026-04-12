import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

const SECTION_OPTIONS = [
  { key: "forecourt", label: "Forecourt Real-Time Monitor" },
  { key: "inventory", label: "Fuel Inventory & Compliance" },
  { key: "sales", label: "Sales & Financials" },
  { key: "diagnostics", label: "Hardware Diagnostics" },
  { key: "comparison", label: "Site Comparison" }
];

const PUMP_STATUS_META = {
  idle: { label: "Idle", tone: "neutral" },
  calling: { label: "Calling", tone: "warn" },
  authorized: { label: "Authorized", tone: "info" },
  fueling: { label: "Fueling", tone: "success" },
  offline: { label: "Offline", tone: "critical" }
};

const CONNECTIVITY_META = {
  green: { label: "Connected", tone: "success" },
  amber: { label: "Degraded", tone: "warn" },
  red: { label: "Offline", tone: "critical" }
};

function formatMoney(value) {
  return `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function formatDateTime(value, timezone = "America/New_York") {
  if (!value) return "-";
  return new Date(value).toLocaleString([], {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatRelativeWindow(value) {
  if (!value) return "No recent activity";
  const diffMs = Date.now() - new Date(value).getTime();
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  return `${Math.round(diffHours / 24)} d ago`;
}

function extractDigits(value) {
  const match = String(value || "").match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function latestRowsByKey(rows, key) {
  const latest = new Map();
  for (const row of rows || []) {
    const id = row?.[key];
    if (id && !latest.has(id)) latest.set(id, row);
  }
  return [...latest.values()];
}

function buildConnectivity(site) {
  const connected = Number(site?.pumpSidesConnected || 0);
  const expected = Number(site?.pumpSidesExpected || 0);
  const critical = Number(site?.criticalCount || 0);
  const warning = Number(site?.warnCount || 0);
  if (!expected || connected <= 0 || critical > 0) return "red";
  if (connected < expected || warning > 0) return "amber";
  return "green";
}

function derivePumpState({ emergencyStop, pump, pumpAlerts, pumpHealth, lastTransactionTs }) {
  if (emergencyStop || pump?.active === false || (pumpAlerts || []).some((alert) => alert.severity === "critical")) {
    return "offline";
  }
  const recentMinutes = lastTransactionTs ? (Date.now() - new Date(lastTransactionTs).getTime()) / 60000 : null;
  if (recentMinutes != null && recentMinutes <= 90) return "fueling";
  if ((pumpHealth?.transactions || 0) >= 8 || (pumpHealth?.sales || 0) >= 350) return "authorized";
  if ((pumpAlerts || []).length > 0 || (pumpHealth?.flaggedCount || 0) > 0) return "calling";
  return "idle";
}

function groupByPumpNumber(rows, pickValue) {
  const grouped = new Map();
  for (const row of rows || []) {
    const pumpNumber = extractDigits(row?.fuelPositionId);
    if (pumpNumber == null) continue;
    if (!grouped.has(pumpNumber)) grouped.set(pumpNumber, []);
    grouped.get(pumpNumber).push(row);
  }

  const result = new Map();
  for (const [pumpNumber, pumpRows] of grouped.entries()) {
    result.set(pumpNumber, pickValue(pumpRows));
  }
  return result;
}

function findMostRecentDelivery(rows) {
  return (rows || []).find((row) => row.eventType === "delivery" || Number(row.deltaVolume || 0) > 1000) || null;
}

function benchmarkForKey(pricingSnapshot, key) {
  return (pricingSnapshot?.benchmarkSnapshots || []).find((item) => item.key === key) || null;
}

function InventoryBar({ fillPercent }) {
  const safeFill = Math.max(0, Math.min(100, Number(fillPercent || 0)));
  return (
    <div className="allied-mgmt-tank-bar">
      <div className="allied-mgmt-tank-fuel" style={{ height: `${safeFill}%` }} />
    </div>
  );
}

function SectionShell({ title, subtitle, actions, children }) {
  return (
    <section className="card allied-mgmt-section">
      <div className="section-header allied-section-header">
        <div>
          <h3>{title}</h3>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
        {actions || null}
      </div>
      {children}
    </section>
  );
}

export function AlliedMgmtPage() {
  const [sites, setSites] = useState([]);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [selectedSection, setSelectedSection] = useState("forecourt");
  const [emergencyStop, setEmergencyStop] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [overview, setOverview] = useState({
    portfolioToday: null,
    portfolioWindow: null,
    tankRows: [],
    alerts: [],
    pricingSnapshot: null
  });
  const [detail, setDetail] = useState({
    site: null,
    pumps: [],
    tanks: [],
    tankRows: [],
    tankHistory: [],
    alerts: [],
    alliedSummary: null,
    alliedRows: []
  });

  useEffect(() => {
    let ignore = false;
    async function loadOverview() {
      setOverviewLoading(true);
      try {
        const [siteRows, portfolioToday, portfolioWindow, tankRows, alerts, pricingSnapshot] = await Promise.all([
          api.getSites(),
          api.getAlliedPortfolioSummary({ preset: "today" }),
          api.getAlliedPortfolioSummary({ preset: "30d" }),
          api.getTankInformation({ limit: 600 }),
          api.getAlerts(),
          api.getPricingSnapshot().catch(() => null)
        ]);

        if (ignore) return;
        setSites(siteRows || []);
        setOverview({
          portfolioToday,
          portfolioWindow,
          tankRows: tankRows || [],
          alerts: alerts || [],
          pricingSnapshot
        });
        setError("");
        setSelectedSiteId((current) => current || siteRows?.[0]?.id || "");
      } catch (nextError) {
        if (!ignore) setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to load Allied Mgmt"));
      } finally {
        if (!ignore) setOverviewLoading(false);
      }
    }

    loadOverview();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedSiteId) return;
    let ignore = false;
    async function loadDetail() {
      setDetailLoading(true);
      try {
        const [site, pumps, tankRows, tankHistory, alerts, alliedSummary, alliedRows] = await Promise.all([
          api.getSite(selectedSiteId),
          api.getPumps(selectedSiteId),
          api.getTankInformation({ siteId: selectedSiteId, limit: 200 }),
          api.getTankHistory({ siteId: selectedSiteId, limit: 200 }),
          api.getAlerts({ siteId: selectedSiteId }),
          api.getAlliedTransactionsSummary(selectedSiteId, { preset: "today" }),
          api.getAlliedTransactions(selectedSiteId, { preset: "today", page: 1, pageSize: 120, sortBy: "timestamp", sortDir: "desc" })
        ]);

        if (ignore) return;
        setDetail({
          site,
          pumps: pumps || [],
          tanks: site?.tanks || [],
          tankRows: tankRows || [],
          tankHistory: tankHistory || [],
          alerts: alerts || [],
          alliedSummary,
          alliedRows: alliedRows?.rows || []
        });
        setError("");
      } catch (nextError) {
        if (!ignore) setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to load site detail"));
      } finally {
        if (!ignore) setDetailLoading(false);
      }
    }

    loadDetail();
    return () => {
      ignore = true;
    };
  }, [selectedSiteId]);

  const latestNetworkTanks = useMemo(() => latestRowsByKey(overview.tankRows, "tankId"), [overview.tankRows]);
  const latestSiteTanks = useMemo(() => latestRowsByKey(detail.tankRows, "tankId"), [detail.tankRows]);
  const latestTankHistory = useMemo(() => latestRowsByKey(detail.tankHistory, "tankId"), [detail.tankHistory]);

  const connectivityRows = useMemo(
    () =>
      (sites || []).map((site) => ({
        ...site,
        connectivity: buildConnectivity(site)
      })),
    [sites]
  );

  const lowInventoryRows = useMemo(
    () =>
      latestNetworkTanks
        .filter((row) => Number(row.fillPercent || 0) < 15)
        .sort((a, b) => Number(a.fillPercent || 0) - Number(b.fillPercent || 0)),
    [latestNetworkTanks]
  );

  const storePulse = useMemo(() => {
    const lowestTank = lowInventoryRows[0] || latestNetworkTanks.slice().sort((a, b) => Number(a.fillPercent || 0) - Number(b.fillPercent || 0))[0] || null;
    const activePumpEstimate = Math.round(
      connectivityRows.reduce((sum, site) => sum + Number(site.pumpSidesConnected || 0), 0) / 2
    );
    return {
      salesToday: overview.portfolioToday?.kpis?.totalSales || 0,
      lowestTank,
      activePumpEstimate
    };
  }, [connectivityRows, latestNetworkTanks, lowInventoryRows, overview.portfolioToday]);

  const selectedSite = useMemo(() => {
    if (detail.site?.id === selectedSiteId) return detail.site;
    return sites.find((site) => site.id === selectedSiteId) || detail.site || null;
  }, [sites, detail.site, selectedSiteId]);

  const pumpHealthByNumber = useMemo(
    () =>
      groupByPumpNumber(detail.alliedSummary?.pumpHealth || [], (rows) =>
        rows.slice().sort((a, b) => b.transactions - a.transactions)[0]
      ),
    [detail.alliedSummary]
  );

  const fuelGradeByPumpNumber = useMemo(
    () =>
      groupByPumpNumber(detail.alliedRows, (rows) => {
        const counts = new Map();
        for (const row of rows) {
          const label = row.fuelDescription || "Unknown";
          counts.set(label, (counts.get(label) || 0) + 1);
        }
        return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "Unknown";
      }),
    [detail.alliedRows]
  );

  const latestTransactionByPumpNumber = useMemo(
    () =>
      groupByPumpNumber(detail.alliedRows, (rows) =>
        rows.slice().sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0]
      ),
    [detail.alliedRows]
  );

  const forecourtPumps = useMemo(
    () =>
      (detail.pumps || []).map((pump) => {
        const pumpNumber = Number(pump.pumpNumber);
        const pumpAlerts = (detail.alerts || []).filter((alert) => alert.pumpId === pump.id);
        const pumpHealth = pumpHealthByNumber.get(pumpNumber) || null;
        const latestTransaction = latestTransactionByPumpNumber.get(pumpNumber) || null;
        const stateKey = derivePumpState({
          emergencyStop,
          pump,
          pumpAlerts,
          pumpHealth,
          lastTransactionTs: latestTransaction?.timestamp
        });
        return {
          ...pump,
          pumpNumber,
          stateKey,
          state: PUMP_STATUS_META[stateKey],
          pumpAlerts,
          pumpHealth,
          grade: fuelGradeByPumpNumber.get(pumpNumber) || "Standby",
          latestTransaction
        };
      }),
    [detail.alerts, detail.pumps, emergencyStop, fuelGradeByPumpNumber, latestTransactionByPumpNumber, pumpHealthByNumber]
  );

  const mostRecentDelivery = useMemo(() => findMostRecentDelivery(detail.tankRows), [detail.tankRows]);
  const leakAlerts = useMemo(
    () =>
      (detail.alerts || []).filter((alert) =>
        String(alert.component || "").toLowerCase().includes("tank") ||
        String(alert.alertType || "").toLowerCase().includes("leak") ||
        String(alert.message || "").toLowerCase().includes("leak")
      ),
    [detail.alerts]
  );

  const paymentTerminalRows = useMemo(
    () =>
      forecourtPumps.map((pump) => {
        const terminalAlerts = pump.pumpAlerts.filter((alert) =>
          String(alert.component || "").toLowerCase().includes("card") ||
          String(alert.message || "").toLowerCase().includes("paper") ||
          String(alert.message || "").toLowerCase().includes("reader")
        );
        const status = terminalAlerts.some((alert) => alert.severity === "critical")
          ? "Error"
          : terminalAlerts.length
            ? "Needs attention"
            : "Healthy";
        return {
          pumpLabel: pump.label,
          status,
          issue: terminalAlerts[0]?.message || "No card terminal alarms in current alert feed"
        };
      }),
    [forecourtPumps]
  );

  const currentPricingRows = useMemo(() => {
    const regular = benchmarkForKey(overview.pricingSnapshot, "regular");
    const midgrade = benchmarkForKey(overview.pricingSnapshot, "midgrade");
    const premium = benchmarkForKey(overview.pricingSnapshot, "premium");
    const diesel = benchmarkForKey(overview.pricingSnapshot, "diesel");
    return [regular, midgrade, premium, diesel].filter(Boolean);
  }, [overview.pricingSnapshot]);

  const temperatureValues = useMemo(
    () =>
      latestTankHistory
        .map((row) => row.tempC)
        .filter((value) => value != null && value !== "" && !Number.isNaN(Number(value)))
        .map((value) => Number(value)),
    [latestTankHistory]
  );

  return (
    <div className="allied-page allied-mgmt-page">
      <section className="card allied-mgmt-hero">
        <div>
          <div className="allied-mgmt-kicker">Allied Management Portal</div>
          <h2>Legacy forecourt control translated into a modern operations menu.</h2>
          <p>
            This test slice keeps the current Allied analytics intact and adds an operator-facing management layer for live view,
            compliance, diagnostics, and multi-site comparison.
          </p>
        </div>
        <div className="allied-mgmt-hero-actions">
          <label>
            <span>Focus Site</span>
            <select value={selectedSiteId} onChange={(event) => setSelectedSiteId(event.target.value)}>
              {(sites || []).map((site) => (
                <option key={site.id} value={site.id}>
                  {site.siteCode} - {site.name}
                </option>
              ))}
            </select>
          </label>
          <div className="inline">
            <Link to="/allied">Open Allied Analytics</Link>
            {selectedSite ? <Link to={`/sites/${selectedSite.id}?tab=allied`}>Open Site Detail</Link> : null}
          </div>
        </div>
      </section>

      <div className="allied-mgmt-pulse-grid">
        <div className="metric-card allied-mgmt-pulse-card">
          <div className="metric-label">Store Pulse</div>
          <div className="metric-value">{formatMoney(storePulse.salesToday)}</div>
          <div className="allied-mgmt-pulse-meta">Total sales today across visible Allied sites</div>
        </div>
        <div className="metric-card allied-mgmt-pulse-card">
          <div className="metric-label">Lowest Tank Volume</div>
          <div className="metric-value">
            {storePulse.lowestTank ? formatPercent(storePulse.lowestTank.fillPercent) : "--"}
          </div>
          <div className="allied-mgmt-pulse-meta">
            {storePulse.lowestTank
              ? `${storePulse.lowestTank.siteCode} ${storePulse.lowestTank.tankLabel || storePulse.lowestTank.atgTankId}`
              : "No tank readings"}
          </div>
        </div>
        <div className="metric-card allied-mgmt-pulse-card">
          <div className="metric-label">Active Pump Count</div>
          <div className="metric-value">{storePulse.activePumpEstimate}</div>
          <div className="allied-mgmt-pulse-meta">Estimated from connected pump sides across the visible network</div>
        </div>
      </div>

      <div className="card">
        <div className="inline allied-mgmt-section-tabs">
          {SECTION_OPTIONS.map((section) => (
            <button
              key={section.key}
              type="button"
              className={selectedSection === section.key ? "tab-active" : ""}
              onClick={() => setSelectedSection(section.key)}
            >
              {section.label}
            </button>
          ))}
        </div>
      </div>

      {error ? <div className="card severity-critical">{error}</div> : null}
      {overviewLoading ? <div className="card">Loading Allied Mgmt overview...</div> : null}
      {detailLoading ? <div className="card">Refreshing selected site detail...</div> : null}

      {selectedSection === "forecourt" ? (
        <SectionShell
          title="Forecourt Real-Time Monitor"
          subtitle="Visual operator view built from today's Allied activity, current site alarms, and pump configuration."
          actions={selectedSite ? (
            <div className="inline">
              <button type="button" onClick={() => setEmergencyStop((current) => !current)}>
                {emergencyStop ? "Restore Pumps" : "All Pumps Off"}
              </button>
              <span className={`allied-mgmt-pill allied-mgmt-pill-${emergencyStop ? "critical" : "success"}`}>
                {emergencyStop ? "Safety lock active" : "Normal operations"}
              </span>
            </div>
          ) : null}
        >
          <div className="allied-mgmt-grid allied-mgmt-grid-2">
            <div className="allied-mgmt-pump-grid">
              {forecourtPumps.map((pump) => (
                <article key={pump.id} className={`allied-mgmt-pump-card allied-mgmt-pump-${pump.state.tone}`}>
                  <div className="allied-mgmt-pump-head">
                    <strong>{pump.label}</strong>
                    <span className={`allied-mgmt-pill allied-mgmt-pill-${pump.state.tone}`}>{pump.state.label}</span>
                  </div>
                  <div className="allied-mgmt-pump-grade">{pump.grade}</div>
                  <div className="allied-mgmt-pump-metrics">
                    <div>
                      <span>Transaction Progress</span>
                      <strong>
                        {pump.latestTransaction
                          ? `${formatNumber(Number(pump.latestTransaction.fuelQuantityGallons || 0) * 3.78541, 1)} L / ${formatMoney(pump.latestTransaction.totalAmount)}`
                          : "No active sale snapshot"}
                      </strong>
                    </div>
                    <div>
                      <span>Today</span>
                      <strong>
                        {formatNumber(pump.pumpHealth?.transactions || 0)} tx / {formatMoney(pump.pumpHealth?.sales || 0)}
                      </strong>
                    </div>
                    <div>
                      <span>Last activity</span>
                      <strong>{formatRelativeWindow(pump.latestTransaction?.timestamp)}</strong>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <div className="allied-mgmt-stack">
              <div className="allied-mgmt-note-card">
                <strong>Live view notes</strong>
                <p>
                  Pump states are inferred from today's Allied throughput, recent transaction timestamps, and active alerts so the team can test
                  the management layout before direct controller command wiring exists.
                </p>
              </div>
              <div className="allied-mgmt-mini-grid">
                <div className="metric-card">
                  <div className="metric-label">Selected Site Sales</div>
                  <div className="metric-value">{formatMoney(detail.alliedSummary?.kpis?.totalSales || 0)}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Completion Rate</div>
                  <div className="metric-value">{formatPercent((detail.alliedSummary?.kpis?.completionRate || 0) * 100)}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Fueling Pumps</div>
                  <div className="metric-value">{forecourtPumps.filter((pump) => pump.stateKey === "fueling").length}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Offline Pumps</div>
                  <div className="metric-value">{forecourtPumps.filter((pump) => pump.stateKey === "offline").length}</div>
                </div>
              </div>
            </div>
          </div>
        </SectionShell>
      ) : null}

      {selectedSection === "inventory" ? (
        <SectionShell
          title="Fuel Inventory & Compliance"
          subtitle="Tank utilization, delivery visibility, leak watch, and temperature context for the selected store."
        >
          <div className="allied-mgmt-inventory-grid">
            {latestSiteTanks.map((tankRow) => {
              const history = latestTankHistory.find((row) => row.tankId === tankRow.tankId) || null;
              return (
                <article key={tankRow.tankId} className="allied-mgmt-tank-card">
                  <InventoryBar fillPercent={tankRow.fillPercent} />
                  <div className="allied-mgmt-tank-copy">
                    <strong>{tankRow.tankLabel || tankRow.atgTankId}</strong>
                    <span>{tankRow.product}</span>
                    <div className="allied-mgmt-tank-stats">
                      <div><span>Fuel</span><strong>{formatNumber(tankRow.volume, 0)} L</strong></div>
                      <div><span>Water</span><strong>{history?.waterHeightMm != null ? `${formatNumber(history.waterHeightMm, 0)} mm` : "n/a"}</strong></div>
                      <div><span>Ullage</span><strong>{formatNumber(tankRow.ullage, 0)} L</strong></div>
                      <div><span>Temp</span><strong>{history?.tempC != null ? `${formatNumber(history.tempC, 1)} C` : "n/a"}</strong></div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="allied-mgmt-grid allied-mgmt-grid-3">
            <div className="allied-mgmt-note-card">
              <strong>Last Delivery Report</strong>
              <p>
                {mostRecentDelivery
                  ? `${mostRecentDelivery.tankLabel || mostRecentDelivery.atgTankId} received ${formatNumber(mostRecentDelivery.deltaVolume, 0)} L on ${formatDateTime(mostRecentDelivery.readAt, selectedSite?.timezone)}.`
                  : "No delivery event was detected in the current tank read window."}
              </p>
            </div>
            <div className="allied-mgmt-note-card">
              <strong>Leak Test History</strong>
              <p>
                {leakAlerts.length
                  ? `${leakAlerts.length} tank-related alarms are present. Treat the latest result as attention required until native TLS leak-test codes are wired through.`
                  : "Pass. No leak-oriented tank alarms are present in the current site alert feed."}
              </p>
            </div>
            <div className="allied-mgmt-note-card">
              <strong>Temperature Readings</strong>
              <p>
                {temperatureValues.length
                  ? `Latest temperature span is ${formatNumber(Math.min(...temperatureValues), 1)} C to ${formatNumber(Math.max(...temperatureValues), 1)} C.`
                  : "No tank temperature measurements are available in the current history window."}
              </p>
            </div>
          </div>
        </SectionShell>
      ) : null}

      {selectedSection === "sales" ? (
        <SectionShell
          title="Sales & Financials"
          subtitle="Shift totals, meter-style throughput, grade pricing, and payment terminal health."
        >
          <div className="allied-kpi-grid">
            <div className="metric-card"><div className="metric-label">Shift Totals</div><div className="metric-value">{formatMoney(detail.alliedSummary?.kpis?.totalSales || 0)}</div></div>
            <div className="metric-card"><div className="metric-label">Transactions</div><div className="metric-value">{formatNumber(detail.alliedSummary?.kpis?.totalTransactions || 0)}</div></div>
            <div className="metric-card"><div className="metric-label">Gallons Dispensed</div><div className="metric-value">{formatNumber(detail.alliedSummary?.kpis?.totalGallons || 0, 1)}</div></div>
            <div className="metric-card"><div className="metric-label">Average Ticket</div><div className="metric-value">{formatMoney(detail.alliedSummary?.kpis?.averageTicket || 0)}</div></div>
          </div>

          <div className="allied-mgmt-grid allied-mgmt-grid-2">
            <div className="table-wrapper allied-detail-table-wrap">
              <table className="table allied-detail-table">
                <thead>
                  <tr>
                    <th>Electronic Meter</th>
                    <th>Transactions</th>
                    <th>Gallons</th>
                    <th>Sales</th>
                    <th>Completion</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.alliedSummary?.pumpHealth || []).map((row) => (
                    <tr key={row.fuelPositionId}>
                      <td>{row.fuelPositionId}</td>
                      <td>{formatNumber(row.transactions)}</td>
                      <td>{formatNumber(row.gallons, 1)}</td>
                      <td>{formatMoney(row.sales)}</td>
                      <td>{formatPercent(row.completionRate * 100)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="allied-mgmt-stack">
              <div className="allied-mgmt-note-card">
                <strong>Price Management</strong>
                <p>
                  Current unit pricing is shown as the live benchmark reference. Price push controls should stay disabled until controller write
                  authorization and audit logging are wired.
                </p>
              </div>
              <div className="allied-mgmt-mini-grid">
                {currentPricingRows.map((row) => (
                  <div key={row.key} className="metric-card">
                    <div className="metric-label">{row.label}</div>
                    <div className="metric-value">{`${formatMoney(row.current).replace("$", "")} ${row.unit}`}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <SectionShell title="Payment Terminal Health" subtitle="CRIND and OPT status inferred from pump-level alerts in the selected site.">
            <div className="table-wrapper allied-detail-table-wrap">
              <table className="table allied-detail-table">
                <thead>
                  <tr>
                    <th>Pump</th>
                    <th>Status</th>
                    <th>Latest Issue</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentTerminalRows.map((row) => (
                    <tr key={row.pumpLabel}>
                      <td>{row.pumpLabel}</td>
                      <td>{row.status}</td>
                      <td>{row.issue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionShell>
        </SectionShell>
      ) : null}

      {selectedSection === "diagnostics" ? (
        <SectionShell
          title="Hardware Diagnostics"
          subtitle="Controller, loop, and dispenser-level troubleshooting without leaving the portal."
        >
          <div className="allied-mgmt-grid allied-mgmt-grid-3">
            <div className="allied-mgmt-note-card">
              <strong>Controller Health</strong>
              <p>
                {selectedSite?.integration
                  ? `ATG ${selectedSite.integration.atgHost || "not set"}:${selectedSite.integration.atgPort || "n/a"} with stale timeout ${selectedSite.integration.atgStaleSec || 0}s and pump stale timeout ${selectedSite.integration.pumpStaleSec || 0}s.`
                  : "No controller integration settings are configured for this site."}
              </p>
            </div>
            <div className="allied-mgmt-note-card">
              <strong>Loop Activity</strong>
              <p>
                {detail.pumps.length
                  ? `${detail.pumps.reduce((sum, pump) => sum + (pump.sides?.length || 0), 0)} configured sides across ${detail.pumps.length} pumps.`
                  : "No pump sides are configured for this site."}
              </p>
            </div>
            <div className="allied-mgmt-note-card">
              <strong>Event Logs</strong>
              <p>{detail.alerts.length ? `${detail.alerts.length} recent alarms available for drill-down below.` : "No recent alarm events for this site."}</p>
            </div>
          </div>

          <div className="table-wrapper allied-detail-table-wrap">
            <table className="table allied-detail-table">
              <thead>
                <tr>
                  <th>Event Time</th>
                  <th>Severity</th>
                  <th>Component</th>
                  <th>Code</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {(detail.alerts || []).slice(0, 15).map((alert) => (
                  <tr key={alert.id}>
                    <td>{formatDateTime(alert.createdAt || alert.eventAt, selectedSite?.timezone)}</td>
                    <td>{alert.severity}</td>
                    <td>{alert.component || "-"}</td>
                    <td>{alert.code || "-"}</td>
                    <td>{alert.message || "-"}</td>
                  </tr>
                ))}
                {!detail.alerts.length ? (
                  <tr>
                    <td colSpan={5}>No recent hardware events for the selected site.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </SectionShell>
      ) : null}

      {selectedSection === "comparison" ? (
        <SectionShell
          title="Site Comparison"
          subtitle="Network-wide throughput, low inventory watchlist, and connectivity rollup for multi-site operations."
        >
          <div className="allied-kpi-grid">
            <div className="metric-card"><div className="metric-label">Total Network Throughput</div><div className="metric-value">{formatNumber(overview.portfolioWindow?.kpis?.totalGallons || 0, 1)}</div></div>
            <div className="metric-card"><div className="metric-label">Total Network Sales</div><div className="metric-value">{formatMoney(overview.portfolioWindow?.kpis?.totalSales || 0)}</div></div>
            <div className="metric-card"><div className="metric-label">Sites With Transactions</div><div className="metric-value">{formatNumber(overview.portfolioWindow?.kpis?.sitesWithTransactions || 0)}</div></div>
            <div className="metric-card"><div className="metric-label">Low Inventory Alerts</div><div className="metric-value">{formatNumber(lowInventoryRows.length)}</div></div>
          </div>

          <div className="allied-mgmt-grid allied-mgmt-grid-2">
            <div className="table-wrapper allied-detail-table-wrap">
              <table className="table allied-detail-table">
                <thead>
                  <tr>
                    <th>Site</th>
                    <th>Status</th>
                    <th>Pump Sides</th>
                    <th>Critical</th>
                    <th>Warning</th>
                  </tr>
                </thead>
                <tbody>
                  {connectivityRows.map((site) => {
                    const meta = CONNECTIVITY_META[site.connectivity];
                    return (
                      <tr key={site.id}>
                        <td>{site.siteCode} - {site.name}</td>
                        <td><span className={`allied-mgmt-pill allied-mgmt-pill-${meta.tone}`}>{meta.label}</span></td>
                        <td>{Number(site.pumpSidesConnected || 0)}/{Number(site.pumpSidesExpected || 0)}</td>
                        <td>{Number(site.criticalCount || 0)}</td>
                        <td>{Number(site.warnCount || 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="table-wrapper allied-detail-table-wrap">
              <table className="table allied-detail-table">
                <thead>
                  <tr>
                    <th>Tank</th>
                    <th>Site</th>
                    <th>Fill %</th>
                    <th>Volume</th>
                    <th>Latest Read</th>
                  </tr>
                </thead>
                <tbody>
                  {lowInventoryRows.slice(0, 12).map((row) => (
                    <tr key={row.tankId}>
                      <td>{row.tankLabel || row.atgTankId}</td>
                      <td>{row.siteCode} - {row.siteName}</td>
                      <td>{formatPercent(row.fillPercent)}</td>
                      <td>{formatNumber(row.volume, 0)} L</td>
                      <td>{formatDateTime(row.readAt)}</td>
                    </tr>
                  ))}
                  {!lowInventoryRows.length ? (
                    <tr>
                      <td colSpan={5}>No visible tanks are currently below the 15% threshold.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </SectionShell>
      ) : null}
    </div>
  );
}
