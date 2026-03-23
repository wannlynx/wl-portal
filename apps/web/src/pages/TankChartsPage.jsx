import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
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

function buildYAxisTicks(minValue, maxValue) {
  const start = Math.max(0, Math.floor(minValue / 10) * 10);
  const end = Math.min(100, Math.ceil(maxValue / 10) * 10);
  const ticks = [];
  for (let value = start; value <= end; value += 10) ticks.push(value);
  return ticks.length ? ticks : [0, 50, 100];
}

function buildGaugeOption(value) {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
  return {
    animationDuration: 700,
    animationEasing: "cubicOut",
    series: [
      {
        type: "gauge",
        startAngle: 205,
        endAngle: -25,
        min: 0,
        max: 100,
        splitNumber: 10,
        center: ["50%", "66%"],
        radius: "92%",
        axisLine: {
          lineStyle: {
            width: 18,
            color: [
              [0.1, "#c84232"],
              [0.15, "#d6a63f"],
              [0.8, "#4c9a63"],
              [0.9, "#d6a63f"],
              [1, "#c84232"]
            ]
          }
        },
        pointer: {
          length: "72%",
          width: 7,
          itemStyle: {
            color: "#f17b23",
            shadowBlur: 10,
            shadowColor: "rgba(241, 123, 35, 0.35)"
          }
        },
        anchor: {
          show: true,
          size: 14,
          itemStyle: {
            color: "#173447",
            borderColor: "#f7fbff",
            borderWidth: 3
          }
        },
        progress: {
          show: false
        },
        axisTick: {
          distance: -19,
          splitNumber: 4,
          lineStyle: {
            width: 2,
            color: "#5a7689"
          }
        },
        splitLine: {
          distance: -20,
          length: 18,
          lineStyle: {
            width: 4,
            color: "#29465a"
          }
        },
        axisLabel: {
          distance: 10,
          color: "#59758a",
          fontSize: 12,
          formatter(valueLabel) {
            if (valueLabel === 0) return "E";
            if (valueLabel === 50) return "1/2";
            if (valueLabel === 100) return "F";
            return "";
          }
        },
        detail: {
          valueAnimation: true,
          offsetCenter: [0, "48%"],
          fontSize: 26,
          fontWeight: 700,
          color: "#173447",
          formatter: "{value}%"
        },
        title: {
          offsetCenter: [0, "66%"],
          color: "#59758a",
          fontSize: 11
        },
        data: [
          {
            value: Number(safeValue.toFixed(1)),
            name: "Current fill"
          }
        ]
      }
    ]
  };
}

function buildTrendOption(tank, minValue, maxValue, yTicks) {
  return {
    animationDuration: 700,
    grid: {
      top: 22,
      right: 22,
      bottom: 42,
      left: 56
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#173447",
      borderWidth: 0,
      textStyle: {
        color: "#f7fbff"
      },
      formatter(params) {
        const point = params?.[0]?.data;
        if (!point) return "";
        return [
          new Date(point.readAt).toLocaleString(),
          `Fill: ${formatPercent(point.fillPercent)}`,
          `Volume: ${formatVolume(point.volume)}`
        ].join("<br/>");
      }
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      axisLine: {
        lineStyle: {
          color: "#9bb2c2"
        }
      },
      axisTick: {
        show: false
      },
      axisLabel: {
        color: "#59758a",
        formatter(value) {
          return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        }
      },
      data: tank.points.map((point) => point.readAt)
    },
    yAxis: {
      type: "value",
      min: minValue,
      max: maxValue,
      interval: yTicks.length > 1 ? yTicks[1] - yTicks[0] : 10,
      axisLabel: {
        color: "#59758a",
        formatter(valueLabel) {
          return `${valueLabel}%`;
        }
      },
      axisLine: {
        show: false
      },
      axisTick: {
        show: false
      },
      splitLine: {
        lineStyle: {
          color: "rgba(99, 136, 159, 0.18)"
        }
      }
    },
    series: [
      {
        type: "line",
        smooth: true,
        symbol: "circle",
        symbolSize: 7,
        showSymbol: tank.points.length <= 20,
        lineStyle: {
          width: 4,
          color: "#4f88ad"
        },
        itemStyle: {
          color: "#ffffff",
          borderColor: "#4f88ad",
          borderWidth: 2
        },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(91, 160, 209, 0.42)" },
              { offset: 1, color: "rgba(91, 160, 209, 0.06)" }
            ]
          }
        },
        emphasis: {
          focus: "series"
        },
        markArea: {
          silent: true,
          itemStyle: {
            opacity: 0.12
          },
          data: [
            [{ yAxis: 0, itemStyle: { color: "#c84232" } }, { yAxis: 10 }],
            [{ yAxis: 10, itemStyle: { color: "#d6a63f" } }, { yAxis: 15 }],
            [{ yAxis: 15, itemStyle: { color: "#4c9a63" } }, { yAxis: 80 }],
            [{ yAxis: 80, itemStyle: { color: "#d6a63f" } }, { yAxis: 90 }],
            [{ yAxis: 90, itemStyle: { color: "#c84232" } }, { yAxis: 100 }]
          ]
        },
        data: tank.points.map((point) => ({
          value: Number(point.fillPercent.toFixed(2)),
          volume: point.volume,
          readAt: point.readAt,
          fillPercent: point.fillPercent
        }))
      }
    ]
  };
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

  const fillValues = tank.points.map((point) => point.fillPercent);
  const minValue = Math.max(0, Math.min(...fillValues) - 4);
  const maxValue = Math.min(100, Math.max(...fillValues) + 4);
  const yTicks = buildYAxisTicks(minValue, maxValue);
  const latest = tank.points[tank.points.length - 1];
  const low = tank.points.reduce((current, point) => (point.fillPercent < current.fillPercent ? point : current), tank.points[0]);
  const high = tank.points.reduce((current, point) => (point.fillPercent > current.fillPercent ? point : current), tank.points[0]);
  const gaugeOption = buildGaugeOption(latest.fillPercent);
  const trendOption = buildTrendOption(tank, minValue, maxValue, yTicks);

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
        <div className="tank-gauge-card">
          <ReactECharts option={gaugeOption} className="tank-gauge-echart" notMerge lazyUpdate opts={{ renderer: "svg" }} />
        </div>
        <div className="tank-chart-plot-wrap">
          <ReactECharts option={trendOption} className="tank-chart-echart" notMerge lazyUpdate opts={{ renderer: "svg" }} />
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
