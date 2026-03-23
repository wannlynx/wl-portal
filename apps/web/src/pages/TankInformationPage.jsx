import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";

function formatDateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function formatNumber(value, digits = 0) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function buildFromIso(anchorIso, range) {
  const anchorMs = anchorIso ? new Date(anchorIso).getTime() : Date.now();
  if (range === "24h") return new Date(anchorMs - 24 * 60 * 60 * 1000).toISOString();
  if (range === "3d") return new Date(anchorMs - 3 * 24 * 60 * 60 * 1000).toISOString();
  return new Date(anchorMs - 5 * 24 * 60 * 60 * 1000).toISOString();
}

function buildLatestTankRows(rows) {
  const latest = new Map();
  for (const row of rows) {
    if (!latest.has(row.tankId)) latest.set(row.tankId, row);
  }
  return Array.from(latest.values()).sort((a, b) => {
    const siteName = String(a.siteName || a.facilityName || "").localeCompare(String(b.siteName || b.facilityName || ""));
    if (siteName !== 0) return siteName;
    return String(a.atgTankId || "").localeCompare(String(b.atgTankId || ""));
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildReportHtml({ title, generatedAt, scopeLabel, reportRows }) {
  const grouped = new Map();
  for (const row of reportRows) {
    const key = `${row.siteId}::${row.siteName || row.facilityName || row.siteCode}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  const sections = Array.from(grouped.entries())
    .map(([key, items]) => {
      const [siteId, siteName] = key.split("::");
      const siteCode = items[0]?.siteCode || siteId;
      const tankRows = items
        .map(
          (row) => `
            <tr>
              <td>${escapeHtml(row.atgTankId || "-")}</td>
              <td>${escapeHtml(row.tankLabel || "-")}</td>
              <td>${escapeHtml(row.product || "-")}</td>
              <td class="num">${escapeHtml(formatNumber(row.volume, 2))}</td>
              <td class="num">${escapeHtml(formatNumber(row.fillPercent, 1))}%</td>
              <td class="num">${escapeHtml(formatNumber(row.ullage, 2))}</td>
              <td class="num">${escapeHtml(formatNumber(row.safeUllage, 2))}</td>
              <td class="num">${escapeHtml(formatNumber(row.tankCapacity, 2))}</td>
              <td>${escapeHtml(formatDateTime(row.readAt))}</td>
            </tr>`
        )
        .join("");

      return `
        <section class="store-section">
          <div class="store-head">
            <div>
              <h2>${escapeHtml(siteName)}</h2>
              <div class="store-meta">Store ${escapeHtml(siteCode)} • ${escapeHtml(items[0]?.facilityName || siteName)}</div>
            </div>
            <div class="store-badge">${items.length} Tanks</div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Tank</th>
                <th>Label</th>
                <th>Product</th>
                <th>Volume (L)</th>
                <th>Fill %</th>
                <th>Ullage (L)</th>
                <th>Safe Ullage</th>
                <th>Capacity</th>
                <th>Latest Read</th>
              </tr>
            </thead>
            <tbody>${tankRows}</tbody>
          </table>
        </section>`;
    })
    .join("");

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          :root {
            --bg: #091325;
            --panel: #0e1b31;
            --panel-2: #132440;
            --line: rgba(196, 157, 72, 0.24);
            --gold: #f4d98f;
            --gold-strong: #ba8430;
            --muted: #8a97ab;
            --text: #e9edf4;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            font-family: "Segoe UI", Arial, sans-serif;
            background:
              radial-gradient(circle at top left, rgba(196, 157, 72, 0.14), transparent 28%),
              linear-gradient(180deg, var(--bg) 0%, #07111f 100%);
            color: var(--text);
            padding: 28px;
          }
          .report-shell {
            border: 1px solid var(--line);
            border-radius: 28px;
            overflow: hidden;
            background: rgba(10, 18, 33, 0.96);
            box-shadow: 0 30px 70px rgba(1, 5, 12, 0.45);
          }
          .hero {
            padding: 28px 32px 22px;
            background:
              linear-gradient(180deg, rgba(12, 24, 44, 0.98) 0%, rgba(8, 18, 33, 0.98) 100%);
            border-bottom: 1px solid var(--line);
          }
          .kicker {
            color: var(--muted);
            text-transform: uppercase;
            letter-spacing: 0.24em;
            font-size: 11px;
            margin-bottom: 8px;
          }
          h1 {
            margin: 0;
            color: var(--gold);
            font-size: 34px;
            line-height: 1;
          }
          .hero-grid {
            display: grid;
            grid-template-columns: 1.5fr 1fr;
            gap: 18px;
            margin-top: 18px;
          }
          .hero-card {
            border: 1px solid var(--line);
            border-radius: 18px;
            padding: 16px 18px;
            background: rgba(16, 29, 51, 0.9);
          }
          .hero-card strong {
            display: block;
            color: var(--gold);
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.18em;
            margin-bottom: 6px;
          }
          .hero-card span {
            color: var(--text);
            font-size: 15px;
          }
          .content {
            padding: 24px 28px 30px;
            display: grid;
            gap: 18px;
          }
          .store-section {
            border: 1px solid var(--line);
            border-radius: 22px;
            overflow: hidden;
            background: rgba(12, 22, 40, 0.92);
          }
          .store-head {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 16px;
            padding: 18px 20px;
            background: rgba(19, 36, 64, 0.82);
            border-bottom: 1px solid var(--line);
          }
          .store-head h2 {
            margin: 0 0 4px;
            font-size: 21px;
            color: var(--gold);
          }
          .store-meta {
            color: var(--muted);
            font-size: 12px;
          }
          .store-badge {
            border: 1px solid var(--line);
            border-radius: 999px;
            padding: 8px 12px;
            color: var(--gold);
            font-size: 12px;
            background: rgba(10, 18, 33, 0.7);
          }
          table {
            width: 100%;
            border-collapse: collapse;
          }
          th, td {
            padding: 12px 14px;
            border-bottom: 1px solid rgba(196, 157, 72, 0.12);
            text-align: left;
            font-size: 12px;
          }
          th {
            color: var(--muted);
            text-transform: uppercase;
            letter-spacing: 0.12em;
            font-size: 10px;
            background: rgba(10, 18, 33, 0.76);
          }
          .num {
            text-align: right;
            font-variant-numeric: tabular-nums;
          }
          .footer {
            padding: 0 28px 24px;
            color: var(--muted);
            font-size: 11px;
          }
          @media print {
            :root {
              --bg: #ffffff;
              --panel: #ffffff;
              --panel-2: #f5f6f8;
              --line: #cfd6df;
              --gold: #8a5a12;
              --gold-strong: #8a5a12;
              --muted: #5d6777;
              --text: #121722;
            }
            body {
              padding: 0;
              background: white;
              color: #121722;
            }
            .report-shell {
              box-shadow: none;
              border-radius: 0;
              border: 0;
              background: white;
            }
            .hero,
            .hero-card,
            .store-section,
            .store-head,
            th {
              background: white !important;
            }
            .hero,
            .store-head,
            .store-section,
            .hero-card {
              break-inside: avoid;
            }
            h1,
            .store-head h2,
            .store-badge,
            .hero-card strong {
              color: #8a5a12 !important;
            }
            .kicker,
            .store-meta,
            .footer,
            th {
              color: #5d6777 !important;
            }
            td,
            .hero-card span {
              color: #121722 !important;
            }
          }
        </style>
      </head>
      <body>
        <div class="report-shell">
          <header class="hero">
            <div class="kicker">Tank Information Report</div>
            <h1>${escapeHtml(title)}</h1>
            <div class="hero-grid">
              <div class="hero-card">
                <strong>Report Scope</strong>
                <span>${escapeHtml(scopeLabel)}</span>
              </div>
              <div class="hero-card">
                <strong>Generated</strong>
                <span>${escapeHtml(generatedAt)}</span>
              </div>
            </div>
          </header>
          <main class="content">${sections}</main>
          <footer class="footer">Latest inventory value by tank, grouped by store. Generated from local ATG inventory history.</footer>
        </div>
      </body>
    </html>`;
}

export function TankInformationPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSiteId = searchParams.get("siteId") || "";
  const initialTankId = searchParams.get("tankId") || "";
  const [sites, setSites] = useState([]);
  const [siteAssets, setSiteAssets] = useState({ tanks: [] });
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [anchorTs, setAnchorTs] = useState("");
  const [filters, setFilters] = useState({
    siteId: initialSiteId,
    tankId: initialTankId,
    product: "",
    range: "5d",
    refillOnly: false
  });

  useEffect(() => {
    api
      .getSites()
      .then(setSites)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    const siteIdFromUrl = searchParams.get("siteId") || "";
    const tankIdFromUrl = searchParams.get("tankId") || "";
    setFilters((current) => {
      if (current.siteId === siteIdFromUrl && current.tankId === tankIdFromUrl) return current;
      return {
        ...current,
        siteId: siteIdFromUrl,
        tankId: tankIdFromUrl
      };
    });
  }, [searchParams]);

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);
    if (filters.siteId) nextParams.set("siteId", filters.siteId);
    else nextParams.delete("siteId");
    if (filters.tankId) nextParams.set("tankId", filters.tankId);
    else nextParams.delete("tankId");
    const nextString = nextParams.toString();
    const currentString = searchParams.toString();
    if (nextString !== currentString) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [filters.siteId, filters.tankId, searchParams, setSearchParams]);

  useEffect(() => {
    if (!filters.siteId) {
      setSiteAssets({ tanks: [] });
      setFilters((current) => (current.tankId ? { ...current, tankId: "" } : current));
      return;
    }

    api
      .getSite(filters.siteId)
      .then((site) => setSiteAssets({ tanks: site.tanks || [] }))
      .catch((err) => setError(err.message));
  }, [filters.siteId]);

  useEffect(() => {
    const anchorParams = { limit: "1" };
    if (filters.siteId) anchorParams.siteId = filters.siteId;
    if (filters.tankId) anchorParams.tankId = filters.tankId;
    if (filters.product) anchorParams.product = filters.product;

    api
      .getTankInformation(anchorParams)
      .then((latestRows) => {
        const latestReadAt = latestRows[0]?.readAt || "";
        setAnchorTs(latestReadAt);
        if (!latestReadAt) {
          setRows([]);
          setError("");
          return null;
        }

        const params = {
          from: buildFromIso(latestReadAt, filters.range),
          to: latestReadAt,
          limit: filters.tankId ? "2000" : "750"
        };
        if (filters.siteId) params.siteId = filters.siteId;
        if (filters.tankId) params.tankId = filters.tankId;
        if (filters.product) params.product = filters.product;
        if (filters.refillOnly) params.refillOnly = "true";
        return api.getTankInformation(params);
      })
      .then((data) => {
        if (!data) return;
        setRows(data);
        setError("");
      })
      .catch((err) => setError(err.message));
  }, [filters]);

  const siteById = useMemo(() => new Map(sites.map((site) => [site.id, site])), [sites]);

  async function exportPdfReport() {
    try {
      const params = { limit: "10000" };
      if (filters.siteId) params.siteId = filters.siteId;
      const data = await api.getTankInformation(params);
      const latestRows = buildLatestTankRows(data);
      const selectedSite = sites.find((site) => site.id === filters.siteId);
      const scopeLabel = selectedSite
        ? `${selectedSite.siteCode} - ${selectedSite.name}`
        : "All Stores";
      const generatedAt = new Date().toLocaleString();
      const title = selectedSite
        ? `Latest Tank Inventory Report - ${selectedSite.name}`
        : "Latest Tank Inventory Report - All Stores";
      const html = buildReportHtml({
        title,
        generatedAt,
        scopeLabel,
        reportRows: latestRows
      });

      const existingFrame = document.getElementById("tank-report-print-frame");
      if (existingFrame) existingFrame.remove();

      const printFrame = document.createElement("iframe");
      printFrame.id = "tank-report-print-frame";
      printFrame.style.position = "fixed";
      printFrame.style.right = "0";
      printFrame.style.bottom = "0";
      printFrame.style.width = "0";
      printFrame.style.height = "0";
      printFrame.style.border = "0";
      document.body.appendChild(printFrame);

      const frameWindow = printFrame.contentWindow;
      if (!frameWindow) {
        setError("Unable to open the PDF report renderer.");
        printFrame.remove();
        return;
      }

      printFrame.onload = () => {
        frameWindow.focus();
        frameWindow.print();
        window.setTimeout(() => printFrame.remove(), 1000);
      };

      frameWindow.document.open();
      frameWindow.document.write(html);
      frameWindow.document.close();
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <div className="card">
        <div className="section-header">
          <h3>Filters</h3>
          <span>Review five-minute tank history and refill events</span>
        </div>
        {anchorTs ? <div className="queue-sub">Latest available reading: {formatDateTime(anchorTs)}</div> : null}
        <div className="filter-row">
          <select
            value={filters.siteId}
            onChange={(e) => setFilters((current) => ({ ...current, siteId: e.target.value, tankId: "" }))}
          >
            <option value="">All Stores</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.siteCode} - {site.name}
              </option>
            ))}
          </select>
          <select
            value={filters.tankId}
            onChange={(e) => setFilters((current) => ({ ...current, tankId: e.target.value }))}
            disabled={!filters.siteId}
          >
            <option value="">All Tanks</option>
            {siteAssets.tanks.map((tank) => (
              <option key={tank.id} value={tank.id}>
                Tank {tank.atgTankId}: {tank.label}
              </option>
            ))}
          </select>
          <select
            value={filters.product}
            onChange={(e) => setFilters((current) => ({ ...current, product: e.target.value }))}
          >
            <option value="">All Products</option>
            <option value="Regular">Regular</option>
            <option value="Premium">Premium</option>
            <option value="Diesel">Diesel</option>
            <option value="DEF">DEF</option>
            <option value="Unknown">Unknown</option>
          </select>
          <select
            value={filters.range}
            onChange={(e) => setFilters((current) => ({ ...current, range: e.target.value }))}
          >
            <option value="24h">Last 24 Hours</option>
            <option value="3d">Last 3 Days</option>
            <option value="5d">Last 5 Days</option>
          </select>
          <label className="inline">
            <input
              type="checkbox"
              checked={filters.refillOnly}
              onChange={(e) => setFilters((current) => ({ ...current, refillOnly: e.target.checked }))}
            />
            Refills only
          </label>
          <button type="button" onClick={exportPdfReport}>Export PDF Report</button>
        </div>
      </div>

      {error && <div className="card severity-critical">{error}</div>}
      <table className="table">
        <thead>
          <tr>
            <th>Read Time</th>
            <th>Site</th>
            <th>Store Name</th>
            <th>Tank</th>
            <th>Label</th>
            <th>Product</th>
            <th>Volume (L)</th>
            <th>Fill %</th>
            <th>Delta (L)</th>
            <th>Ullage (L)</th>
            <th>Safe Ullage</th>
            <th>Capacity</th>
            <th>Event</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const site = siteById.get(row.siteId);
            return (
              <tr key={row.id}>
                <td>{formatDateTime(row.readAt)}</td>
                <td>{row.siteCode || site?.siteCode || row.siteId}</td>
                <td>{row.siteName || site?.name || row.facilityName || "-"}</td>
                <td>{row.atgTankId || "-"}</td>
                <td>{row.tankLabel || "-"}</td>
                <td>{row.product || "-"}</td>
                <td>{formatNumber(row.volume, 2)}</td>
                <td>{formatNumber(row.fillPercent, 1)}%</td>
                <td className={Number(row.deltaVolume) > 0 ? "severity-warn" : ""}>{formatNumber(row.deltaVolume, 2)}</td>
                <td>{formatNumber(row.ullage, 2)}</td>
                <td>{formatNumber(row.safeUllage, 2)}</td>
                <td>{formatNumber(row.tankCapacity, 2)}</td>
                <td>{row.eventType === "delivery" ? "Refilled to ~80%" : "Pump drawdown"}</td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={13}>No tank history rows matching the current filters.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}






