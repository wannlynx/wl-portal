import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

const rangeOptions = [
  { value: "12h", label: "12 Hours", hours: 12 },
  { value: "24h", label: "24 Hours", hours: 24 },
  { value: "48h", label: "48 Hours", hours: 48 },
  { value: "72h", label: "3 Days", hours: 72 }
];

function buildRangeStart(anchorIso, range) {
  const selected = rangeOptions.find((option) => option.value === range) || rangeOptions[1];
  return new Date(new Date(anchorIso).getTime() - selected.hours * 60 * 60 * 1000).toISOString();
}

function formatVolume(value) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })} L`;
}

function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return `${Number(value).toFixed(1)}%`;
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function pointsToPath(points, width, height, minValue, maxValue) {
  if (!points.length) return "";
  const safeMax = maxValue <= minValue ? minValue + 1 : maxValue;
  return points
    .map((point, index) => {
      const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
      const y = height - ((point.fillPercent - minValue) / (safeMax - minValue)) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function areaToPath(points, width, height, minValue, maxValue) {
  const linePath = pointsToPath(points, width, height, minValue, maxValue);
  if (!linePath) return "";
  const firstX = points.length === 1 ? width / 2 : 0;
  const lastX = points.length === 1 ? width / 2 : width;
  return `${linePath} L${lastX.toFixed(2)},${height.toFixed(2)} L${firstX.toFixed(2)},${height.toFixed(2)} Z`;
}

function buildYAxisTicks(minValue, maxValue) {
  const start = Math.max(0, Math.floor(minValue / 10) * 10);
  const end = Math.min(100, Math.ceil(maxValue / 10) * 10);
  const ticks = [];
  for (let value = start; value <= end; value += 10) ticks.push(value);
  return ticks.length ? ticks : [0, 50, 100];
}

function TankChart({ tank }) {
  if (!tank.points.length) {
    return (
      <article className="tank-chart-card" key={tank.tankId}>
        <div className="tank-chart-header">
          <div>
            <div className="tank-chart-kicker">Tank {tank.atgTankId}</div>
            <h3>{tank.label}</h3>
            <p>{tank.product} • {formatVolume(tank.capacity)} capacity</p>
          </div>
        </div>
        <div className="admin-empty-state">No history rows for this tank in the selected timeframe.</div>
      </article>
    );
  }

  const width = 760;
  const height = 210;
  const fillValues = tank.points.map((point) => point.fillPercent);
  const minValue = Math.max(0, Math.min(...fillValues) - 4);
  const maxValue = Math.min(100, Math.max(...fillValues) + 4);
  const linePath = pointsToPath(tank.points, width, height, minValue, maxValue);
  const areaPath = areaToPath(tank.points, width, height, minValue, maxValue);
  const yTicks = buildYAxisTicks(minValue, maxValue);
  const latest = tank.points[tank.points.length - 1];
  const low = tank.points.reduce((current, point) => (point.fillPercent < current.fillPercent ? point : current), tank.points[0]);
  const high = tank.points.reduce((current, point) => (point.fillPercent > current.fillPercent ? point : current), tank.points[0]);

  return (
    <article className="tank-chart-card" key={tank.tankId}>
      <div className="tank-chart-header">
        <div>
          <div className="tank-chart-kicker">Tank {tank.atgTankId}</div>
          <h3>{tank.label}</h3>
          <p>{tank.product} • {formatVolume(tank.capacity)} capacity</p>
        </div>
        <div className="tank-chart-metrics">
          <div>
            <span>Latest</span>
            <strong>{formatPercent(latest.fillPercent)}</strong>
            <em>{formatVolume(latest.volume)}</em>
          </div>
          <div>
            <span>Low</span>
            <strong>{formatPercent(low.fillPercent)}</strong>
            <em>{formatDateTime(low.readAt)}</em>
          </div>
          <div>
            <span>Rows</span>
            <strong>{tank.points.length}</strong>
            <em>{formatPercent(high.fillPercent)} peak</em>
          </div>
        </div>
      </div>

      <div className="tank-chart-shell">
        <div className="tank-chart-yaxis">
          {yTicks.slice().reverse().map((tick) => (
            <span key={tick}>{tick}%</span>
          ))}
        </div>
        <div className="tank-chart-plot-wrap">
          <svg viewBox={`0 0 ${width} ${height}`} className="tank-chart-svg" preserveAspectRatio="none">
            {yTicks.map((tick) => {
              const y = height - ((tick - minValue) / Math.max(maxValue - minValue, 1)) * height;
              return <line key={tick} x1="0" x2={width} y1={y} y2={y} className="tank-chart-grid" />;
            })}
            <path d={areaPath} className="tank-chart-area" />
            <path d={linePath} className="tank-chart-line" />
          </svg>
          <div className="tank-chart-xaxis">
            <span>{formatDateTime(tank.points[0]?.readAt)}</span>
            <span>{formatDateTime(latest.readAt)}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

export function TankChartsPage() {
  const [sites, setSites] = useState([]);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [siteDetail, setSiteDetail] = useState(null);
  const [range, setRange] = useState("24h");
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [anchorTs, setAnchorTs] = useState("");

  useEffect(() => {
    api.getSites()
      .then((data) => {
        setSites(data);
        if (!selectedSiteId && data.length) setSelectedSiteId(data[0].id);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!selectedSiteId) {
      setSiteDetail(null);
      setRows([]);
      setAnchorTs("");
      return;
    }

    Promise.all([
      api.getSite(selectedSiteId),
      api.getTankHistory({
        siteId: selectedSiteId,
        limit: "1"
      })
    ])
      .then(([site, latestRows]) => {
        setSiteDetail(site);
        const latestTs = latestRows[0]?.ts || "";
        setAnchorTs(latestTs);
        if (!latestTs) {
          setRows([]);
          setError("");
          return;
        }
        return api.getTankHistory({
          siteId: selectedSiteId,
          from: buildRangeStart(latestTs, range),
          to: latestTs,
          limit: "10000"
        }).then((tankRows) => {
          setRows(tankRows);
          setError("");
        });
      })
      .catch((err) => setError(err.message));
  }, [selectedSiteId, range]);

  const groupedTanks = useMemo(() => {
    if (!siteDetail?.tanks?.length) return [];
    const rowsByTankId = new Map();
    rows.forEach((row) => {
      if (!rowsByTankId.has(row.tankId)) rowsByTankId.set(row.tankId, []);
      rowsByTankId.get(row.tankId).push(row);
    });

    return siteDetail.tanks.map((tank) => {
      const capacity = Number(tank.capacityLiters || 0);
      const points = (rowsByTankId.get(tank.id) || [])
        .slice()
        .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
        .map((row) => {
          const volume = Number(row.fuelVolumeL || 0);
          return {
            ...row,
            volume,
            readAt: row.ts,
            fillPercent: capacity > 0 ? (volume / capacity) * 100 : 0
          };
        });

      return {
        tankId: tank.id,
        atgTankId: tank.atgTankId,
        label: tank.label,
        product: tank.product,
        capacity,
        points
      };
    });
  }, [rows, siteDetail]);

  return (
    <div className="admin-page admin-hud tank-trends-page">
      <div className="admin-hud-shell tank-trends-shell">
        <section className="admin-hud-hero tank-trends-hero">
          <div className="admin-hud-title-wrap">
            <div className="admin-kicker">Tank Trend Review</div>
            <select className="admin-hero-select" value={selectedSiteId} onChange={(e) => setSelectedSiteId(e.target.value)}>
              <option value="">Select a Location</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.siteCode} - {site.name}
                </option>
              ))}
            </select>
            <p>
              {siteDetail
                ? `${siteDetail.address || "Address n/a"} ${siteDetail.postalCode || ""}`.trim()
                : "Select a location to load all tank charts for that site."}
            </p>
            {anchorTs && <p>Latest available reading: {formatDateTime(anchorTs)}</p>}
          </div>
          <div className="tank-trends-control-card">
            <span>Time Frame</span>
            <select value={range} onChange={(e) => setRange(e.target.value)}>
              {rangeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <em>{groupedTanks.length} tanks shown</em>
          </div>
        </section>

        {error && <div className="admin-banner admin-banner-error">{error}</div>}
        {!selectedSiteId && <div className="admin-empty-state">Select a location to view tank trend charts.</div>}
        {selectedSiteId && groupedTanks.length === 0 && <div className="admin-empty-state">No tanks are available for the selected location.</div>}

        <section className="tank-chart-grid">
          {groupedTanks.map((tank) => (
            <TankChart key={tank.tankId} tank={tank} />
          ))}
        </section>
      </div>
    </div>
  );
}
