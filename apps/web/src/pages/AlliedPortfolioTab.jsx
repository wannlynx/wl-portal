import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, BarChart, Bar } from "recharts";
import { api } from "../api";
import { AlliedTransactionsTab } from "./AlliedTransactionsTab";

const PRESETS = [
  { label: "Today", value: "today" },
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" }
];

function formatShortDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

function kpiValueMoney(value) {
  return `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function kpiValueRate(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

export function AlliedPortfolioTab() {
  const [filters, setFilters] = useState({ preset: "30d", from: "", to: "", siteId: "" });
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const [sites, setSites] = useState([]);

  useEffect(() => {
    api.getSites().then(setSites).catch(() => {});
  }, []);

  const params = useMemo(() => {
    const next = {};
    for (const [key, value] of Object.entries(filters)) {
      if (value) next[key] = value;
    }
    return next;
  }, [filters]);

  const selectedSite = useMemo(
    () => sites.find((site) => site.id === filters.siteId) || null,
    [sites, filters.siteId]
  );

  useEffect(() => {
    api.getAlliedPortfolioSummary(params)
      .then((payload) => {
        setSummary(payload);
        setError("");
      })
      .catch((err) => setError(err.message));
  }, [params]);

  const trendRows = (summary?.trends?.byDay || []).map((row) => ({ ...row, dateLabel: formatShortDate(row.date) }));

  return (
    <div className="allied-page">
      <section className="card allied-section-card">
        <div className="section-header allied-section-header">
          <div>
            <h3>Allied Portfolio</h3>
            <span>Jobber-wide Allied transaction summary across visible sites</span>
          </div>
          <div className="inline">
            {PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                className={filters.preset === preset.value ? "tab-active" : ""}
                onClick={() => setFilters((current) => ({ ...current, preset: preset.value, from: "", to: "" }))}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
        <div className="allied-filter-grid">
          <label>
            <span>From</span>
            <input type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value, preset: "" }))} />
          </label>
          <label>
            <span>To</span>
            <input type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value, preset: "" }))} />
          </label>
          <label>
            <span>Site</span>
            <select value={filters.siteId} onChange={(event) => setFilters((current) => ({ ...current, siteId: event.target.value }))}>
              <option value="">All visible sites</option>
              {(summary?.siteSummaries || []).map((site) => (
                <option key={site.siteId} value={site.siteId}>{site.siteCode} - {site.siteName}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {error ? <div className="card severity-critical">{error}</div> : null}
      {!summary ? <div className="card">Loading Allied portfolio summary...</div> : (
        <>
          <div className="allied-kpi-grid">
            <div className="metric-card"><div className="metric-label">Visible Sites</div><div className="metric-value">{summary.kpis.visibleSites}</div></div>
            <div className="metric-card"><div className="metric-label">Sites With Transactions</div><div className="metric-value">{summary.kpis.sitesWithTransactions}</div></div>
            <div className="metric-card"><div className="metric-label">Total Transactions</div><div className="metric-value">{summary.kpis.totalTransactions}</div></div>
            <div className="metric-card"><div className="metric-label">Total Sales</div><div className="metric-value">{kpiValueMoney(summary.kpis.totalSales)}</div></div>
            <div className="metric-card"><div className="metric-label">Total Gallons</div><div className="metric-value">{Number(summary.kpis.totalGallons || 0).toFixed(1)}</div></div>
            <div className="metric-card"><div className="metric-label">Completion Rate</div><div className="metric-value">{kpiValueRate(summary.kpis.completionRate)}</div></div>
            <div className="metric-card"><div className="metric-label">Abort Rate</div><div className="metric-value">{kpiValueRate(summary.kpis.abortRate)}</div></div>
            <div className="metric-card"><div className="metric-label">Flagged Rate</div><div className="metric-value">{kpiValueRate(summary.kpis.flaggedRate)}</div></div>
          </div>

          <div className="allied-chart-grid">
            <section className="card allied-section-card">
              <div className="section-header allied-section-header">
                <div>
                  <h3>Jobber Trend</h3>
                  <span>Transactions, sales, and aborts across all visible sites</span>
                </div>
              </div>
              <div className="allied-chart">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={trendRows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d9e5ec" />
                    <XAxis dataKey="dateLabel" />
                    <YAxis yAxisId="left" />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="transactions" stroke="#4e88ad" strokeWidth={3} dot={false} />
                    <Line yAxisId="left" type="monotone" dataKey="aborts" stroke="#cb5c49" strokeWidth={2} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="sales" stroke="#87a867" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="card allied-section-card">
              <div className="section-header allied-section-header">
                <div>
                  <h3>Top Sites By Sales</h3>
                  <span>Highest-performing sites in the selected window</span>
                </div>
              </div>
              <div className="allied-chart">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={(summary.siteSummaries || []).slice(0, 10).map((site) => ({ label: site.siteCode, sales: site.totalSales }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d9e5ec" />
                    <XAxis dataKey="label" />
                    <YAxis />
                    <Tooltip formatter={(value) => kpiValueMoney(value)} />
                    <Bar dataKey="sales" fill="#4e88ad" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>

          <section className="card allied-section-card">
            <div className="section-header allied-section-header">
              <div>
                <h3>Site Summary</h3>
                <span>Per-site Allied health and volume for the current jobber</span>
              </div>
            </div>
            <div className="table-wrapper allied-detail-table-wrap">
              <table className="table allied-detail-table">
                <thead>
                  <tr>
                    <th>Site</th>
                    <th>Region</th>
                    <th>Transactions</th>
                    <th>Sales</th>
                    <th>Gallons</th>
                    <th>Average Ticket</th>
                    <th>Completion</th>
                    <th>Abort</th>
                    <th>Flagged</th>
                    <th>Top Card Brand</th>
                    <th>Top Denial</th>
                    <th>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary.siteSummaries || []).map((site) => (
                    <tr key={site.siteId} className="allied-click-row" onClick={() => setFilters((current) => ({ ...current, siteId: site.siteId }))}>
                      <td>{site.siteCode} - {site.siteName}</td>
                      <td>{site.region || "-"}</td>
                      <td>{site.totalTransactions}</td>
                      <td>{kpiValueMoney(site.totalSales)}</td>
                      <td>{Number(site.totalGallons || 0).toFixed(1)}</td>
                      <td>{kpiValueMoney(site.averageTicket)}</td>
                      <td>{kpiValueRate(site.completionRate)}</td>
                      <td>{kpiValueRate(site.abortRate)}</td>
                      <td>{site.flaggedCount} ({kpiValueRate(site.flaggedRate)})</td>
                      <td>{site.topCardBrand}</td>
                      <td>{site.topDenialReason}</td>
                      <td><Link to={`/sites/${site.siteId}?tab=allied`}>Site Allied</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {selectedSite ? (
            <section className="card allied-section-card">
              <div className="section-header allied-section-header">
                <div>
                  <h3>Focused Site Detail</h3>
                  <span>{selectedSite.siteCode} | {selectedSite.name}</span>
                </div>
                <div className="inline">
                  <button type="button" onClick={() => setFilters((current) => ({ ...current, siteId: "" }))}>
                    Clear Site Focus
                  </button>
                  <Link to={`/sites/${selectedSite.id}?tab=allied`}>Open Site Page</Link>
                </div>
              </div>
              <AlliedTransactionsTab siteId={selectedSite.id} site={selectedSite} />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
