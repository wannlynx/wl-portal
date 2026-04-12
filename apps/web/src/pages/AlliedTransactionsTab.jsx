import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell
} from "recharts";
import { api, getToken } from "../api";

const PRESETS = [
  { label: "Today", value: "today" },
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" }
];

const KPI_CONFIG = [
  { key: "totalTransactions", label: "Total transactions", format: (value) => Number(value || 0).toLocaleString() },
  { key: "totalSales", label: "Total sales", format: (value) => `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
  { key: "totalGallons", label: "Total gallons", format: (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 }) },
  { key: "averageTicket", label: "Average ticket", format: (value) => `$${Number(value || 0).toFixed(2)}` },
  { key: "averageGallonsPerSale", label: "Avg gallons / sale", format: (value) => Number(value || 0).toFixed(2) },
  { key: "completionRate", label: "Completion rate", format: (value) => `${(Number(value || 0) * 100).toFixed(1)}%`, filterValue: { minFlaggedOnly: "" } },
  { key: "customerAbortRate", label: "Customer abort rate", format: (value) => `${(Number(value || 0) * 100).toFixed(1)}%`, filterValue: { emvStatus: "CustomerAbort" } },
  { key: "contactlessShare", label: "Contactless share", format: (value) => `${(Number(value || 0) * 100).toFixed(1)}%`, filterValue: { entryMethod: "EmvContactless" } },
  { key: "emvShare", label: "EMV share", format: (value) => `${(Number(value || 0) * 100).toFixed(1)}%` },
  { key: "presetCashCount", label: "Preset cash count", format: (value, kpis) => `${Number(value || 0).toLocaleString()} (${(Number(kpis?.presetCashShare || 0) * 100).toFixed(1)}%)`, filterValue: { paymentType: "Preset" } },
  { key: "topCardBrand", label: "Top card brand", format: (value) => value?.label ? `${value.label} (${value.count})` : "-" , filterValue: (value) => value?.label ? { cardName: value.label } : {} },
  { key: "topDenialReason", label: "Top denial reason", format: (value) => value?.label ? `${value.label} (${value.count})` : "-", filterValue: (value) => value?.label ? { denialReason: value.label } : {} },
  { key: "suspiciousFlaggedCount", label: "Suspicious / flagged", format: (value) => Number(value || 0).toLocaleString(), filterValue: { minFlaggedOnly: "true" } }
];

const CHART_COLORS = ["#4e88ad", "#7bb4d6", "#87a867", "#d29f4c", "#cb5c49", "#6b7ea8", "#7e5ea3"];

function formatDateTime(value, timezone) {
  if (!value) return "-";
  return new Date(value).toLocaleString([], {
    timeZone: timezone || "America/New_York",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatShortDate(value, timezone) {
  if (!value) return "";
  return new Date(value).toLocaleDateString([], {
    timeZone: timezone || "America/New_York",
    month: "short",
    day: "numeric"
  });
}

function buildQuery(filters, tableState = {}) {
  const params = {};
  Object.entries({ ...filters, ...tableState }).forEach(([key, value]) => {
    if (value == null || value === "") return;
    params[key] = String(value);
  });
  return params;
}

function StatCard({ label, value, active, onClick }) {
  return (
    <button type="button" className={`metric-card metric-card-button allied-kpi-card${active ? " metric-card-active" : ""}`} onClick={onClick}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
    </button>
  );
}

function SectionCard({ title, subtitle, children, actions = null }) {
  return (
    <section className="card allied-section-card">
      <div className="section-header allied-section-header">
        <div>
          <h3>{title}</h3>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function DistributionChart({ data, dataKey = "count", onSelect }) {
  return (
    <div className="allied-chart">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#d9e5ec" />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} interval={0} angle={-20} textAnchor="end" height={60} />
          <YAxis />
          <Tooltip />
          <Bar dataKey={dataKey} fill="#4e88ad" radius={[6, 6, 0, 0]} onClick={(payload) => onSelect?.(payload?.label)} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PieMixChart({ data, onSelect }) {
  return (
    <div className="allied-chart">
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey="label"
            outerRadius={88}
            innerRadius={44}
            paddingAngle={2}
            onClick={(payload) => onSelect?.(payload?.label)}
          >
            {data.map((entry, index) => (
              <Cell key={entry.label} fill={CHART_COLORS[index % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AlliedTransactionsTab({ siteId, site }) {
  const timezone = site?.timezone || "America/New_York";
  const [filters, setFilters] = useState({
    preset: "30d",
    from: "",
    to: "",
    fuelPositionId: "",
    paymentType: "",
    cardType: "",
    cardName: "",
    emvStatus: "",
    entryMethod: "",
    emvTranType: "",
    denialReason: "",
    amountMin: "",
    amountMax: "",
    gallonsMin: "",
    gallonsMax: "",
    minFlaggedOnly: ""
  });
  const [summary, setSummary] = useState(null);
  const [tableData, setTableData] = useState({ rows: [], total: 0, page: 1, pageSize: 25 });
  const [tableState, setTableState] = useState({ page: 1, pageSize: 25, sortBy: "timestamp", sortDir: "desc" });
  const [selectedRow, setSelectedRow] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeFilterKey, setActiveFilterKey] = useState("");

  const requestParams = useMemo(() => buildQuery(filters), [filters]);
  const tableParams = useMemo(() => buildQuery(filters, tableState), [filters, tableState]);

  useEffect(() => {
    if (!siteId) return;
    let ignore = false;
    setLoading(true);
    Promise.all([
      api.getAlliedTransactionsSummary(siteId, requestParams),
      api.getAlliedTransactions(siteId, tableParams)
    ])
      .then(([summaryPayload, tablePayload]) => {
        if (ignore) return;
        setSummary(summaryPayload);
        setTableData(tablePayload);
        setError("");
        setSelectedRow((current) => tablePayload.rows.find((row) => row.id === current?.id) || null);
      })
      .catch((err) => {
        if (!ignore) setError(err.message);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [siteId, requestParams, tableParams]);

  function patchFilters(nextPatch, filterKey = "") {
    setFilters((current) => ({ ...current, ...nextPatch }));
    setTableState((current) => ({ ...current, page: 1 }));
    setActiveFilterKey(filterKey);
  }

  function resetFilters() {
    setFilters({
      preset: "30d",
      from: "",
      to: "",
      fuelPositionId: "",
      paymentType: "",
      cardType: "",
      cardName: "",
      emvStatus: "",
      entryMethod: "",
      emvTranType: "",
      denialReason: "",
      amountMin: "",
      amountMax: "",
      gallonsMin: "",
      gallonsMax: "",
      minFlaggedOnly: ""
    });
    setTableState((current) => ({ ...current, page: 1 }));
    setActiveFilterKey("");
  }

  function exportCsv() {
    const url = api.getAlliedTransactionsExportUrl(siteId, requestParams);
    fetch(url, {
      headers: {
        Authorization: `Bearer ${getToken()}`
      }
    })
      .then((res) => {
        if (!res.ok) throw new Error("Export failed");
        return res.blob();
      })
      .then((blob) => {
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = `allied-transactions-${site?.siteCode || siteId}.csv`;
        link.click();
        window.URL.revokeObjectURL(blobUrl);
      })
      .catch((err) => setError(err.message));
  }

  const issues = summary?.issues || [];
  const pumpHealth = summary?.pumpHealth || [];
  const trendRows = summary?.trends?.byDay || [];
  const paymentMix = summary?.trends?.paymentTypeMix || [];
  const cardTypeMix = summary?.trends?.cardTypeMix || [];
  const cardBrandMix = summary?.trends?.cardBrandMix || [];
  const emvStatusMix = summary?.trends?.emvStatusDistribution || [];
  const entryMethodMix = summary?.trends?.entryMethodDistribution || [];
  const denialMix = summary?.trends?.denialReasonDistribution || [];
  const topPumpsByVolume = summary?.trends?.topPumpsByVolume || [];
  const topPumpsByCount = summary?.trends?.topPumpsByCount || [];
  const chartTrendRows = trendRows.map((row) => ({ ...row, dateLabel: formatShortDate(row.date, timezone) }));
  const detailRows = tableData.rows || [];
  const pageCount = Math.max(1, Math.ceil((tableData.total || 0) / (tableData.pageSize || 25)));
  const detailFields = selectedRow ? [
    ["Timestamp", formatDateTime(selectedRow.timestamp, selectedRow.timezone)],
    ["Transaction ID", selectedRow.transactionId],
    ["Store ID", selectedRow.storeId],
    ["Fuel position", selectedRow.fuelPositionId || "-"],
    ["Payment type", selectedRow.paymentType],
    ["Card", `${selectedRow.cardName || "-"} / ${selectedRow.cardType || "-"}`],
    ["Entry method", selectedRow.entryMethod || "-"],
    ["EMV type", selectedRow.emvTranType || "-"],
    ["EMV status", selectedRow.emvStatus || "-"],
    ["EMV error code", selectedRow.emvErrorCode || "-"],
    ["Denial reason", selectedRow.tagDenialReason || "-"],
    ["Gallons", Number(selectedRow.fuelQuantityGallons || 0).toFixed(3)],
    ["Price", `$${Number(selectedRow.actualSalesPrice || 0).toFixed(3)}`],
    ["Total amount", `$${Number(selectedRow.totalAmount || 0).toFixed(2)}`],
    ["Auth amount", selectedRow.authAmount == null ? "-" : `$${Number(selectedRow.authAmount).toFixed(2)}`],
    ["Masked PAN", selectedRow.maskedPan],
    ["Likely type", selectedRow.likelyTransactionType],
    ["Flagged", selectedRow.flagged ? "Yes" : "No"],
    ["Auth vs sale difference", selectedRow.derivedChecks?.authSaleDifference == null ? "-" : `$${Number(selectedRow.derivedChecks.authSaleDifference).toFixed(2)}`],
    ["Internally consistent", selectedRow.derivedChecks?.internallyConsistent ? "Yes" : "No"]
  ] : [];

  return (
    <div className="allied-page">
      <SectionCard
        title="Allied Transactions"
        subtitle={site ? `${site.siteCode} | ${site.name}` : "Transaction health and drill-down"}
        actions={(
          <div className="inline">
            {PRESETS.map((preset) => (
              <button key={preset.value} type="button" className={filters.preset === preset.value ? "tab-active" : ""} onClick={() => patchFilters({ preset: preset.value, from: "", to: "" }, `preset:${preset.value}`)}>
                {preset.label}
              </button>
            ))}
            <button type="button" onClick={exportCsv}>Export CSV</button>
            <button type="button" onClick={resetFilters}>Reset filters</button>
          </div>
        )}
      >
        <div className="allied-filter-grid">
          <label>
            <span>Site</span>
            <input value={site ? `${site.siteCode} - ${site.name}` : ""} readOnly />
          </label>
          <label>
            <span>From</span>
            <input type="date" value={filters.from} onChange={(event) => patchFilters({ from: event.target.value, preset: "" })} />
          </label>
          <label>
            <span>To</span>
            <input type="date" value={filters.to} onChange={(event) => patchFilters({ to: event.target.value, preset: "" })} />
          </label>
          <label>
            <span>Fuel position</span>
            <select value={filters.fuelPositionId} onChange={(event) => patchFilters({ fuelPositionId: event.target.value }, "pump")}>
              <option value="">All pumps</option>
              {(summary?.filterOptions?.fuelPositions || []).map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>
            <span>Payment type</span>
            <select value={filters.paymentType} onChange={(event) => patchFilters({ paymentType: event.target.value }, "payment")}>
              <option value="">All</option>
              {(summary?.filterOptions?.paymentTypes || []).map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>
            <span>Card type</span>
            <select value={filters.cardType} onChange={(event) => patchFilters({ cardType: event.target.value }, "card-type")}>
              <option value="">All</option>
              {(summary?.filterOptions?.cardTypes || []).map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>
            <span>Card brand / name</span>
            <select value={filters.cardName} onChange={(event) => patchFilters({ cardName: event.target.value }, "card-name")}>
              <option value="">All</option>
              {(summary?.filterOptions?.cardNames || []).map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>
            <span>EMV status</span>
            <select value={filters.emvStatus} onChange={(event) => patchFilters({ emvStatus: event.target.value }, "emv-status")}>
              <option value="">All</option>
              {(summary?.filterOptions?.emvStatuses || []).map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>
            <span>Entry method</span>
            <select value={filters.entryMethod} onChange={(event) => patchFilters({ entryMethod: event.target.value }, "entry-method")}>
              <option value="">All</option>
              {(summary?.filterOptions?.entryMethods || []).map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>
            <span>EMV transaction type</span>
            <select value={filters.emvTranType} onChange={(event) => patchFilters({ emvTranType: event.target.value }, "emv-type")}>
              <option value="">All</option>
              {(summary?.filterOptions?.emvTranTypes || []).map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>
            <span>Denial reason</span>
            <select value={filters.denialReason} onChange={(event) => patchFilters({ denialReason: event.target.value }, "denial")}>
              <option value="">All</option>
              {(summary?.filterOptions?.denialReasons || []).map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>
            <span>Amount range</span>
            <div className="inline allied-range-row">
              <input placeholder="Min" value={filters.amountMin} onChange={(event) => patchFilters({ amountMin: event.target.value })} />
              <input placeholder="Max" value={filters.amountMax} onChange={(event) => patchFilters({ amountMax: event.target.value })} />
            </div>
          </label>
          <label>
            <span>Gallons range</span>
            <div className="inline allied-range-row">
              <input placeholder="Min" value={filters.gallonsMin} onChange={(event) => patchFilters({ gallonsMin: event.target.value })} />
              <input placeholder="Max" value={filters.gallonsMax} onChange={(event) => patchFilters({ gallonsMax: event.target.value })} />
            </div>
          </label>
        </div>
      </SectionCard>

      {error ? <div className="card severity-critical">{error}</div> : null}
      {loading && !summary ? <div className="card">Loading Allied transactions...</div> : null}

      {summary ? (
        <>
          <div className="allied-kpi-grid">
            {KPI_CONFIG.map((item) => {
              const rawValue = summary.kpis?.[item.key];
              const filterValue = typeof item.filterValue === "function" ? item.filterValue(rawValue) : (item.filterValue || {});
              return (
                <StatCard
                  key={item.key}
                  label={item.label}
                  value={item.format(rawValue, summary.kpis)}
                  active={activeFilterKey === item.key}
                  onClick={() => {
                    patchFilters({ ...filterValue }, item.key);
                  }}
                />
              );
            })}
          </div>

          <div className="allied-chart-grid">
            <SectionCard title="Transactions by day" subtitle="Daily transaction count in the selected site and date range.">
              <div className="allied-chart">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chartTrendRows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d9e5ec" />
                    <XAxis dataKey="dateLabel" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="transactions" fill="#4e88ad" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>

            <SectionCard title="Sales dollars by day" subtitle="Completed-sale dollars by day.">
              <div className="allied-chart">
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={chartTrendRows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d9e5ec" />
                    <XAxis dataKey="dateLabel" />
                    <YAxis />
                    <Tooltip formatter={(value) => `$${Number(value || 0).toFixed(2)}`} />
                    <Area type="monotone" dataKey="sales" stroke="#cb5c49" fill="#f0c7c2" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>

            <SectionCard title="Gallons by day" subtitle="Fuel volume trend across the selected range.">
              <div className="allied-chart">
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={chartTrendRows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d9e5ec" />
                    <XAxis dataKey="dateLabel" />
                    <YAxis />
                    <Tooltip formatter={(value) => Number(value || 0).toFixed(2)} />
                    <Area type="monotone" dataKey="gallons" stroke="#87a867" fill="#dbe8cf" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>

            <SectionCard title="Completion vs abort trend" subtitle="Completion and customer-abort rates over time.">
              <div className="allied-chart">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartTrendRows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d9e5ec" />
                    <XAxis dataKey="dateLabel" />
                    <YAxis tickFormatter={(value) => `${Math.round(value * 100)}%`} />
                    <Tooltip formatter={(value) => `${(Number(value || 0) * 100).toFixed(1)}%`} />
                    <Legend />
                    <Line type="monotone" dataKey="completionRate" stroke="#4e88ad" strokeWidth={3} dot={false} />
                    <Line type="monotone" dataKey="abortRate" stroke="#cb5c49" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>

            <SectionCard title="Payment type mix over time" subtitle="Current range mix by payment type. Click a segment to filter.">
              <PieMixChart data={paymentMix} onSelect={(label) => patchFilters({ paymentType: label }, "paymentTypeMix")} />
            </SectionCard>

            <SectionCard title="Card type / network mix" subtitle="Mix by card type for investigation and QA.">
              <DistributionChart data={cardTypeMix} onSelect={(label) => patchFilters({ cardType: label }, "cardTypeMix")} />
            </SectionCard>

            <SectionCard title="Card brand / name mix" subtitle="Top brands by count within the current site/date filter.">
              <DistributionChart data={cardBrandMix} onSelect={(label) => patchFilters({ cardName: label }, "cardBrandMix")} />
            </SectionCard>

            <SectionCard title="Contactless vs chip trend" subtitle="Entry-method behavior over time, including contactless and chip share.">
              <div className="allied-chart">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartTrendRows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d9e5ec" />
                    <XAxis dataKey="dateLabel" />
                    <YAxis tickFormatter={(value) => `${Math.round(value * 100)}%`} />
                    <Tooltip formatter={(value) => `${(Number(value || 0) * 100).toFixed(1)}%`} />
                    <Legend />
                    <Line type="monotone" dataKey="contactlessRate" stroke="#4e88ad" strokeWidth={3} dot={false} />
                    <Line type="monotone" dataKey="chipRate" stroke="#6b7ea8" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>

            <SectionCard title="Issue rate and average ticket trend" subtitle="7-day and prior 7-day comparisons are computed on the backend.">
              <div className="allied-chart">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartTrendRows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d9e5ec" />
                    <XAxis dataKey="dateLabel" />
                    <YAxis yAxisId="left" tickFormatter={(value) => `${Math.round(value * 100)}%`} />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip formatter={(value, name) => name === "averageTicket" ? `$${Number(value || 0).toFixed(2)}` : `${(Number(value || 0) * 100).toFixed(1)}%`} />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="issueRate" stroke="#d29f4c" strokeWidth={2} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="averageTicket" stroke="#173447" strokeWidth={3} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>

            <SectionCard title="EMV status distribution" subtitle="Spot abort, complete, and other state patterns fast.">
              <DistributionChart data={emvStatusMix} onSelect={(label) => patchFilters({ emvStatus: label }, "emvStatusMix")} />
            </SectionCard>

            <SectionCard title="Entry method distribution" subtitle="Use this to isolate EMV flow issues and fallback behavior.">
              <DistributionChart data={entryMethodMix} onSelect={(label) => patchFilters({ entryMethod: label }, "entryMethodMix")} />
            </SectionCard>

            <SectionCard title="Top pumps by volume" subtitle="Highest-gallon pumps in the current filter. Click a bar to isolate the pump.">
              <DistributionChart
                data={topPumpsByVolume.map((row) => ({ label: row.fuelPositionId, count: row.gallons }))}
                dataKey="count"
                onSelect={(label) => patchFilters({ fuelPositionId: label }, "topPumpsByVolume")}
              />
            </SectionCard>

            <SectionCard title="Top pumps by count" subtitle="Most-active pumps in the current filter. Click a bar to isolate the pump.">
              <DistributionChart
                data={topPumpsByCount.map((row) => ({ label: row.fuelPositionId, count: row.transactions }))}
                dataKey="count"
                onSelect={(label) => patchFilters({ fuelPositionId: label }, "topPumpsByCount")}
              />
            </SectionCard>

            <SectionCard title="Top denial reasons" subtitle="Issuer and EMV pain points in the current time range.">
              <DistributionChart data={denialMix} onSelect={(label) => patchFilters({ denialReason: label }, "denialMix")} />
            </SectionCard>
          </div>

          <div className="allied-insights-grid">
            <SectionCard title="Issue detection / insights" subtitle="Each issue card links straight into filtered drill-down.">
              <div className="allied-issue-list">
                {issues.length ? issues.map((issue) => (
                  <button
                    key={issue.id}
                    type="button"
                    className={`allied-issue-card allied-issue-${issue.severity}`}
                    onClick={() => patchFilters({ ...issue.filters }, issue.id)}
                  >
                    <strong>{issue.title}</strong>
                    <span>{issue.reason}</span>
                    <div className="allied-issue-meta">
                      <span>{issue.severity}</span>
                      <span>{issue.count} rows</span>
                      <span>{issue.relatedPumps?.length ? issue.relatedPumps.join(", ") : "All pumps"}</span>
                    </div>
                  </button>
                )) : <div className="admin-empty-mini">No issues triggered for the current filters.</div>}
              </div>
            </SectionCard>

            <SectionCard title="Pump health" subtitle="Click a row to focus all charts and detail on that pump.">
              <div className="table-wrapper">
                <table className="table allied-mini-table">
                  <thead>
                    <tr>
                      <th>Pump</th>
                      <th>Transactions</th>
                      <th>Aborts</th>
                      <th>Completion</th>
                      <th>Sales</th>
                      <th>Gallons</th>
                      <th>Flagged</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pumpHealth.slice(0, 12).map((row) => (
                      <tr key={row.fuelPositionId} className="allied-click-row" onClick={() => patchFilters({ fuelPositionId: row.fuelPositionId }, "pump-health")}>
                        <td>{row.fuelPositionId}</td>
                        <td>{row.transactions}</td>
                        <td>{row.aborts}</td>
                        <td>{(row.completionRate * 100).toFixed(1)}%</td>
                        <td>${Number(row.sales || 0).toFixed(2)}</td>
                        <td>{Number(row.gallons || 0).toFixed(1)}</td>
                        <td>{row.flaggedCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </div>

          <SectionCard
            title="Transaction detail"
            subtitle={`${tableData.total || 0} rows in current filter`}
            actions={(
              <div className="inline">
                <label className="inline">
                  <span>Sort</span>
                  <select value={`${tableState.sortBy}:${tableState.sortDir}`} onChange={(event) => {
                    const [sortBy, sortDir] = event.target.value.split(":");
                    setTableState((current) => ({ ...current, sortBy, sortDir, page: 1 }));
                  }}>
                    <option value="timestamp:desc">Newest first</option>
                    <option value="timestamp:asc">Oldest first</option>
                    <option value="total_amount:desc">Highest amount</option>
                    <option value="fuel_quantity_gallons:desc">Highest gallons</option>
                    <option value="fuel_position_id:asc">Pump</option>
                  </select>
                </label>
                <label className="inline">
                  <span>Rows</span>
                  <select value={tableState.pageSize} onChange={(event) => setTableState((current) => ({ ...current, pageSize: Number(event.target.value), page: 1 }))}>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </label>
              </div>
            )}
          >
            <div className="table-wrapper allied-detail-table-wrap">
              <table className="table allied-detail-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Transaction ID</th>
                    <th>Store ID</th>
                    <th>Pump</th>
                    <th>Payment</th>
                    <th>Card name</th>
                    <th>Card type</th>
                    <th>Entry</th>
                    <th>EMV type</th>
                    <th>EMV status</th>
                    <th>EMV error</th>
                    <th>Denial reason</th>
                    <th>Gallons</th>
                    <th>Price</th>
                    <th>Total</th>
                    <th>Auth</th>
                    <th>Masked PAN</th>
                  </tr>
                </thead>
                <tbody>
                  {detailRows.length ? detailRows.map((row) => (
                    <tr key={row.id} className={`allied-click-row${selectedRow?.id === row.id ? " allied-detail-selected" : ""}`} onClick={() => setSelectedRow(row)}>
                      <td>{formatDateTime(row.timestamp, row.timezone)}</td>
                      <td>{row.transactionId}</td>
                      <td>{row.storeId}</td>
                      <td>{row.fuelPositionId || "-"}</td>
                      <td>{row.paymentType}</td>
                      <td>{row.cardName || "-"}</td>
                      <td>{row.cardType || "-"}</td>
                      <td>{row.entryMethod || "-"}</td>
                      <td>{row.emvTranType || "-"}</td>
                      <td className={row.emvStatus === "CustomerAbort" || row.emvStatus === "Declined" ? "severity-critical" : ""}>{row.emvStatus}</td>
                      <td>{row.emvErrorCode || "-"}</td>
                      <td>{row.tagDenialReason || "-"}</td>
                      <td>{Number(row.fuelQuantityGallons || 0).toFixed(3)}</td>
                      <td>${Number(row.actualSalesPrice || 0).toFixed(3)}</td>
                      <td>${Number(row.totalAmount || 0).toFixed(2)}</td>
                      <td>{row.authAmount == null ? "-" : `$${Number(row.authAmount).toFixed(2)}`}</td>
                      <td>{row.maskedPan}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={17}>No Allied transactions match the current filters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="allied-pagination inline">
              <button type="button" disabled={tableState.page <= 1} onClick={() => setTableState((current) => ({ ...current, page: current.page - 1 }))}>Previous</button>
              <span>{tableState.page} / {pageCount}</span>
              <button type="button" disabled={tableState.page >= pageCount} onClick={() => setTableState((current) => ({ ...current, page: current.page + 1 }))}>Next</button>
            </div>
          </SectionCard>

          <SectionCard title="Transaction detail drawer" subtitle={selectedRow ? `Selected ${selectedRow.transactionId}` : "Select a transaction row to inspect"}>
            {selectedRow ? (
              <div className="allied-drawer-grid">
                <div className="allied-detail-grid">
                  {detailFields.map(([label, value]) => (
                    <div key={label} className="allied-detail-field">
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
                <div className="allied-check-list">
                  <strong>Derived checks</strong>
                  {selectedRow.derivedChecks?.checks?.length ? (
                    selectedRow.derivedChecks.checks.map((check) => <div key={check} className="admin-empty-mini">{check}</div>)
                  ) : (
                    <div className="admin-empty-mini">No consistency issues detected for this record.</div>
                  )}
                  <div className="admin-empty-mini">Timeline of transaction events can plug into this drawer later if Allied event stages are added.</div>
                </div>
              </div>
            ) : (
              <div className="admin-empty-mini">Click a transaction row to inspect derived consistency checks and record context.</div>
            )}
          </SectionCard>
        </>
      ) : null}
    </div>
  );
}
