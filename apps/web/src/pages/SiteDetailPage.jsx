import { useEffect, useState } from "react";
import { Link, useSearchParams, useParams } from "react-router-dom";
import { api } from "../api";
import { AlliedTransactionsTab } from "./AlliedTransactionsTab";

const TABS = ["overview", "alerts", "tanks", "pumps", "history", "allied", "layout", "config"];

function formatDateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

export function SiteDetailPage() {
  const { siteId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [site, setSite] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");
  const activeTab = TABS.includes(searchParams.get("tab")) ? searchParams.get("tab") : "overview";

  useEffect(() => {
    Promise.all([
      api.getSite(siteId),
      api.getAlerts({ siteId }),
      api.getTankHistory({ siteId })
    ])
      .then(([siteData, alertData, historyData]) => {
        setSite(siteData);
        setAlerts(alertData);
        setHistory(historyData);
      })
      .catch((err) => setError(err.message));
  }, [siteId]);

  if (error) return <div className="card severity-critical">{error}</div>;
  if (!site) return <div className="card">Loading site...</div>;

  const activeAlerts = alerts.filter((a) => a.state === "raised");

  return (
    <div>
      <div className="card">
        <div className="section-header">
          <h3>{site.name}</h3>
          <span>{site.siteCode} | {site.region}</span>
        </div>
        <div>Address: {site.address} {site.postalCode || ""}</div>
        <div>ATG Host: {site.integration?.atgHost || "-"}</div>
        <div>ATG Poll: {site.integration?.atgPollIntervalSec || "-"} sec</div>
        <div>Pump Connectivity: {site.pumpSidesConnected}/{site.pumpSidesExpected}</div>
        <div className="inline">
          {TABS.map((tab) => (
            <button
              key={tab}
              className={activeTab === tab ? "tab-active" : ""}
              onClick={() => setSearchParams({ tab })}
            >
              {tab[0].toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "overview" && (
        <div className="grid">
          <div className="card">
            <h3>Active Alerts</h3>
            {activeAlerts.slice(0, 6).map((alert) => (
              <div key={alert.id} className="queue-item plain-row">
                <span>{alert.message}</span>
                <span className={alert.severity === "critical" ? "severity-critical" : "severity-warn"}>
                  {alert.severity}
                </span>
              </div>
            ))}
            {activeAlerts.length === 0 && <div>No active alerts.</div>}
          </div>
          <div className="card">
            <h3>Tank Summary</h3>
            {(site.tanks || []).slice(0, 3).map((tank) => (
              <div key={tank.id} className="plain-row">
                <span>{tank.label}</span>
                <span>{tank.capacityLiters} L</span>
              </div>
            ))}
          </div>
          <div className="card">
            <h3>Pump Health Grid</h3>
            <div className="grid">
              {(site.pumps || []).map((pump) => (
                <div className="card" key={pump.id}>
                  <strong>{pump.label}</strong>
                  <div>Pump #{pump.pumpNumber}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === "alerts" && (
        <div className="card">
          <h3>Site Alerts</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Event Time</th>
                <th>Alert Type</th>
                <th>Type ID</th>
                <th>Severity</th>
                <th>State</th>
                <th>Reported</th>
                <th>Device</th>
                <th>Side</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert) => (
                <tr key={alert.id}>
                  <td>{formatDateTime(alert.eventAt || alert.raisedAt || alert.createdAt)}</td>
                  <td>{alert.alertType || "-"}</td>
                  <td>{alert.alertTypeId || "-"}</td>
                  <td className={alert.severity === "critical" ? "severity-critical" : "severity-warn"}>
                    {alert.severity}
                  </td>
                  <td>{alert.state}</td>
                  <td>{alert.reportedState || "-"}</td>
                  <td>{alert.pumpId || alert.tankId || "-"}</td>
                  <td>{alert.side || "-"}</td>
                  <td>{alert.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "tanks" && (
        <div className="grid">
          {(site.tanks || []).map((tank) => (
            <div className="card" key={tank.id}>
              <strong>{tank.label}</strong>
              <div>Product: {tank.product}</div>
              <div>Capacity: {tank.capacityLiters} L</div>
              <div>ATG Tank ID: {tank.atgTankId}</div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "pumps" && (
        <div className="grid">
          {(site.pumps || []).map((pump) => (
            <div className="card" key={pump.id}>
              <strong>{pump.label}</strong>
              <div>Pump Number: {pump.pumpNumber}</div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "history" && (
        <div className="card">
          <h3>Tank Measurement History</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Tank</th>
                <th>Fuel Volume (L)</th>
                <th>Ullage (L)</th>
                <th>Temp C</th>
              </tr>
            </thead>
            <tbody>
              {history.slice(-20).reverse().map((row) => (
                <tr key={row.id}>
                  <td>{new Date(row.ts).toLocaleString()}</td>
                  <td>{row.tankId}</td>
                  <td>{row.fuelVolumeL}</td>
                  <td>{row.ullageL}</td>
                  <td>{row.tempC}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "allied" && (
        <AlliedTransactionsTab siteId={siteId} site={site} />
      )}

      {activeTab === "layout" && (
        <div className="card inline">
          <Link to={`/sites/${siteId}/layout`}>Open Layout Viewer</Link>
          <Link to={`/sites/${siteId}/layout/edit`}>Open Layout Editor</Link>
        </div>
      )}

      {activeTab === "config" && (
        <div className="card">
          <h3>Configuration</h3>
          <div className="grid">
            <div className="card">
              <strong>Integrations</strong>
              <div>ATG Host: {site.integration?.atgHost || "-"}</div>
              <div>ATG Port: {site.integration?.atgPort || "-"}</div>
              <div>ATG Timeout: {site.integration?.atgTimeoutSec || "-"} sec</div>
            </div>
            <div className="card">
              <strong>Assets</strong>
              <div>Tanks: {site.tanks?.length || 0}</div>
              <div>Pumps: {site.pumps?.length || 0}</div>
            </div>
            <div className="card">
              <strong>Access</strong>
              <div>Operator assignment and tech groups are scaffolded in API data model.</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
