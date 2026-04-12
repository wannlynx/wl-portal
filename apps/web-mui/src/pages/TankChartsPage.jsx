import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import {
  Alert,
  Autocomplete,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Collapse,
  CircularProgress,
  Grid,
  LinearProgress,
  Stack,
  TextField,
  Typography,
  useMediaQuery
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import TimelineIcon from "@mui/icons-material/Timeline";
import OpacityIcon from "@mui/icons-material/Opacity";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import FilterListIcon from "@mui/icons-material/FilterList";
import TableRowsIcon from "@mui/icons-material/TableRows";
import { api } from "../api";
import { useNavigate, useSearchParams } from "react-router-dom";
import { gaugeBandRanges, gaugeColorStops, resolveTankLimits, tankLevelTone } from "../tankLimits";

const rangeOptions = [
  { value: "24h", label: "24 Hours", hours: 24 },
  { value: "3d", label: "3 Days", hours: 72 },
  { value: "7d", label: "7 Days", hours: 168 },
  { value: "30d", label: "30 Days", hours: 720 }
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

function formatTimeToThreshold(hours) {
  if (!Number.isFinite(hours) || hours < 0) return "-";
  if (hours < 1) return "<1 hour";
  if (hours < 24) return `${Math.round(hours)} hours`;
  const days = hours / 24;
  if (days < 7) return `${days.toFixed(days < 2 ? 1 : 0)} days`;
  const weeks = days / 7;
  return `${weeks.toFixed(weeks < 2 ? 1 : 0)} weeks`;
}

function buildLowerYellowEstimate(tank, tankLimits) {
  if (!tank?.points?.length) {
    return { label: "No estimate", caption: "No history available for this tank." };
  }

  const latest = tank.points[tank.points.length - 1];
  const threshold = resolveTankLimits(tankLimits, tank.product).lowYellowMax;
  if (latest.fillPercent <= threshold) {
    return { label: "In lower yellow", caption: `At or below ${threshold}% already.` };
  }

  if (tank.points.length < 2) {
    return { label: "No estimate", caption: "Need more history to estimate drain rate." };
  }

  const earliest = tank.points[0];
  const elapsedHours = (new Date(latest.readAt).getTime() - new Date(earliest.readAt).getTime()) / (1000 * 60 * 60);
  if (!Number.isFinite(elapsedHours) || elapsedHours <= 0) {
    return { label: "No estimate", caption: "Not enough elapsed time in the current range." };
  }

  const drainRatePerHour = (Number(earliest.fillPercent) - Number(latest.fillPercent)) / elapsedHours;
  if (!Number.isFinite(drainRatePerHour) || drainRatePerHour <= 0.02) {
    return { label: "Stable / filling", caption: `Not draining toward ${threshold}% in this range.` };
  }

  const hoursLeft = (Number(latest.fillPercent) - threshold) / drainRatePerHour;
  return {
    label: formatTimeToThreshold(hoursLeft),
    caption: `Estimated time until ${threshold}% at ${drainRatePerHour.toFixed(2)}% per hour.`
  };
}

function buildYAxisTicks(minValue = 0, maxValue = 100) {
  const start = Math.max(0, Math.floor(minValue / 10) * 10);
  const end = Math.min(100, Math.ceil(maxValue / 10) * 10);
  const ticks = [];
  for (let value = start; value <= end; value += 10) ticks.push(value);
  return ticks.length ? ticks : [0, 50, 100];
}

function buildGaugeOption(value, tankLimits, product) {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
  return {
    animation: false,
    series: [
      {
        type: "gauge",
        startAngle: 205,
        endAngle: -25,
        min: 0,
        max: 100,
        center: ["50%", "63%"],
        radius: "96%",
        axisLine: {
          lineStyle: {
            width: 30,
            color: gaugeColorStops(tankLimits, product)
          }
        },
        pointer: {
          length: "68%",
          width: 5,
          itemStyle: { color: "#0b5fff" }
        },
        anchor: {
          show: true,
          size: 10,
          itemStyle: {
            color: "#173447",
            borderColor: "#ffffff",
            borderWidth: 2
          }
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        detail: {
          valueAnimation: false,
          offsetCenter: [0, "30%"],
          fontSize: 15,
          fontWeight: 700,
          color: "#173447",
          formatter: "{value}%"
        },
        title: {
          offsetCenter: [0, "44%"],
          color: "#59758a",
          fontSize: 9
        },
        data: [{ value: Number(safeValue.toFixed(1)), name: "fill" }]
      }
    ]
  };
}

function buildTrendOption(tank, minValue, maxValue, yTicks, tankLimits) {
  const ranges = gaugeBandRanges(tankLimits, tank.product);
  const trendLineColor = "rgba(74, 108, 140, 0.92)";
  const trendPointBorder = "rgba(74, 108, 140, 0.92)";
  const chartMin = 0;
  const chartMax = 100;
  return {
    animationDuration: 700,
    grid: { top: 22, right: 22, bottom: 42, left: 56 },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#173447",
      borderWidth: 0,
      textStyle: { color: "#f7fbff" },
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
      axisLine: { lineStyle: { color: "#9bb2c2" } },
      axisTick: { show: false },
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
      min: chartMin,
      max: chartMax,
      interval: yTicks.length > 1 ? yTicks[1] - yTicks[0] : 10,
      axisLabel: {
        color: "#59758a",
        formatter(valueLabel) {
          return `${Math.round(Number(valueLabel) || 0)}%`;
        }
      },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: "rgba(99, 136, 159, 0.18)" } }
    },
    series: [
      {
        type: "line",
        smooth: true,
        symbol: "circle",
        symbolSize: 7,
        showSymbol: tank.points.length <= 20,
        z: 3,
        lineStyle: { width: 4, color: trendLineColor },
        itemStyle: {
          color: "#ffffff",
          borderColor: trendPointBorder,
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
              { offset: 0, color: "rgba(121, 148, 176, 0.26)" },
              { offset: 1, color: "rgba(121, 148, 176, 0.05)" }
            ]
          }
        },
        markArea: {
          silent: true,
          z: 1,
          itemStyle: { opacity: 0.2 },
          data: ranges.map((range) => [{ yAxis: range.start, itemStyle: { color: range.color } }, { yAxis: range.end }])
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

function MobileTankSelectorCard({ tank, selected, onClick, tankLimits }) {
  const latest = tank.points[tank.points.length - 1];
  const fillPercent = latest?.fillPercent || 0;
  const progressColor = tankLevelTone(fillPercent, tankLimits, tank.product);

  return (
    <Card
      variant="outlined"
      sx={{
        borderColor: selected ? "primary.main" : "divider",
        borderWidth: selected ? 2 : 1
      }}
    >
      <CardActionArea onClick={onClick}>
        <CardContent>
          <Stack spacing={1.25}>
            <Stack direction="row" justifyContent="space-between" spacing={1}>
              <div>
                <Typography fontWeight={700}>{tank.label}</Typography>
                <Typography variant="caption" color="text.secondary">
                  Tank {tank.atgTankId} • {tank.product}
                </Typography>
              </div>
              <Chip size="small" label={latest ? formatPercent(latest.fillPercent) : "No data"} />
            </Stack>
            <LinearProgress
              variant="determinate"
              value={Math.max(0, Math.min(100, fillPercent))}
              color={progressColor}
              sx={{ height: 10, borderRadius: 999 }}
            />
            <Typography variant="body2" color="text.secondary">
              {latest ? `Latest ${formatVolume(latest.volume)} at ${formatDateTime(latest.readAt)}` : "No history rows in range"}
            </Typography>
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

function TankChartDetail({ tank, tankLimits }) {
  if (!tank) {
    return (
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>Tank Trend</Typography>
          <Typography color="text.secondary">
            Pick one tank to inspect its trend closely. On phone, keep the selector compact and the chart focused.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  if (!tank.points.length) {
    return (
      <Card>
        <CardContent>
          <Typography variant="h6">{tank.label}</Typography>
          <Typography color="text.secondary">
            No history rows for this tank in the selected timeframe.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const fillValues = tank.points.map((point) => point.fillPercent);
  const minValue = Math.max(0, Math.min(...fillValues) - 4);
  const maxValue = Math.min(100, Math.max(...fillValues) + 4);
  const yTicks = buildYAxisTicks(minValue, maxValue);
  const latest = tank.points[tank.points.length - 1];
  const low = tank.points.reduce((current, point) => (point.fillPercent < current.fillPercent ? point : current), tank.points[0]);
  const high = tank.points.reduce((current, point) => (point.fillPercent > current.fillPercent ? point : current), tank.points[0]);
  const gaugeOption = buildGaugeOption(latest.fillPercent, tankLimits, tank.product);
  const trendOption = buildTrendOption(tank, minValue, maxValue, yTicks, tankLimits);
  const lowerYellowEstimate = buildLowerYellowEstimate(tank, tankLimits);

  return (
    <Card>
      <CardContent>
        <Stack spacing={2.5}>
          <div>
            <Typography variant="h6">{tank.label}</Typography>
            <Typography color="text.secondary">
              Tank {tank.atgTankId} • {tank.product} • {formatVolume(tank.capacity)} capacity
            </Typography>
          </div>
          <Card variant="outlined" sx={{ bgcolor: "rgba(11,95,255,0.03)" }}>
            <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
              <Typography variant="caption" color="text.secondary">Time To Lower Yellow</Typography>
              <Typography variant="h5" fontWeight={800}>{lowerYellowEstimate.label}</Typography>
              <Typography variant="body2" color="text.secondary">{lowerYellowEstimate.caption}</Typography>
            </CardContent>
          </Card>
          <Card variant="outlined" sx={{ bgcolor: "rgba(11,95,255,0.03)" }}>
            <CardContent sx={{ py: 1.25, "&:last-child": { pb: 1.25 } }}>
              <Typography variant="caption" color="text.secondary">Time To Lower Yellow</Typography>
              <Typography variant="h5" fontWeight={800}>{lowerYellowEstimate.label}</Typography>
              <Typography variant="body2" color="text.secondary">{lowerYellowEstimate.caption}</Typography>
            </CardContent>
          </Card>
          <Grid container spacing={1.5}>
            <Grid size={4}>
              <Typography variant="caption" color="text.secondary">Latest</Typography>
              <Typography fontWeight={700}>{formatPercent(latest.fillPercent)}</Typography>
              <Typography variant="body2" color="text.secondary">{formatVolume(latest.volume)}</Typography>
            </Grid>
            <Grid size={4}>
              <Typography variant="caption" color="text.secondary">Low</Typography>
              <Typography fontWeight={700}>{formatPercent(low.fillPercent)}</Typography>
              <Typography variant="body2" color="text.secondary">{formatDateTime(low.readAt)}</Typography>
            </Grid>
            <Grid size={4}>
              <Typography variant="caption" color="text.secondary">Peak</Typography>
              <Typography fontWeight={700}>{formatPercent(high.fillPercent)}</Typography>
              <Typography variant="body2" color="text.secondary">{tank.points.length} rows</Typography>
            </Grid>
          </Grid>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, lg: 4 }}>
              <Card variant="outlined">
                <CardContent>
                  <ReactECharts option={gaugeOption} style={{ height: 260 }} notMerge lazyUpdate opts={{ renderer: "svg" }} />
                </CardContent>
              </Card>
            </Grid>
            <Grid size={{ xs: 12, lg: 8 }}>
              <Card variant="outlined">
                <CardContent>
                  <ReactECharts option={trendOption} style={{ height: 320 }} notMerge lazyUpdate opts={{ renderer: "svg" }} />
                  <Stack direction="row" justifyContent="space-between" sx={{ mt: 1 }}>
                    <Typography variant="caption" color="text.secondary">{formatDateTime(tank.points[0]?.readAt)}</Typography>
                    <Typography variant="caption" color="text.secondary">{formatDateTime(latest.readAt)}</Typography>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Stack>
      </CardContent>
    </Card>
  );
}

function MobileTankChartDetail({ tank, tankLimits, viewMode }) {
  if (!tank) {
    return null;
  }

  if (!tank.points.length) {
    return (
      <Card>
        <CardContent>
          <Typography variant="h6">{tank.label}</Typography>
          <Typography color="text.secondary">
            No history rows for this tank in the selected timeframe.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const fillValues = tank.points.map((point) => point.fillPercent);
  const minValue = Math.max(0, Math.min(...fillValues) - 4);
  const maxValue = Math.min(100, Math.max(...fillValues) + 4);
  const yTicks = buildYAxisTicks(minValue, maxValue);
  const latest = tank.points[tank.points.length - 1];
  const low = tank.points.reduce((current, point) => (point.fillPercent < current.fillPercent ? point : current), tank.points[0]);
  const high = tank.points.reduce((current, point) => (point.fillPercent > current.fillPercent ? point : current), tank.points[0]);
  const gaugeOption = buildGaugeOption(latest.fillPercent, tankLimits, tank.product);
  const trendOption = buildTrendOption(tank, minValue, maxValue, yTicks, tankLimits);

  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <div>
            <Typography variant="h6">{tank.label}</Typography>
            <Typography color="text.secondary">
              Tank {tank.atgTankId} • {tank.product}
            </Typography>
          </div>
          <Grid container spacing={1.5}>
            <Grid size={4}>
              <Typography variant="caption" color="text.secondary">Latest</Typography>
              <Typography fontWeight={700}>{formatPercent(latest.fillPercent)}</Typography>
            </Grid>
            <Grid size={4}>
              <Typography variant="caption" color="text.secondary">Low</Typography>
              <Typography fontWeight={700}>{formatPercent(low.fillPercent)}</Typography>
            </Grid>
            <Grid size={4}>
              <Typography variant="caption" color="text.secondary">Peak</Typography>
              <Typography fontWeight={700}>{formatPercent(high.fillPercent)}</Typography>
            </Grid>
          </Grid>
          {viewMode === "gauge" ? (
            <Card variant="outlined">
              <CardContent>
                <ReactECharts option={gaugeOption} style={{ height: 260 }} notMerge lazyUpdate opts={{ renderer: "svg" }} />
                <Typography variant="body2" color="text.secondary" align="center">
                  Latest {formatVolume(latest.volume)} at {formatDateTime(latest.readAt)}
                </Typography>
              </CardContent>
            </Card>
          ) : (
            <Card variant="outlined">
              <CardContent>
                <ReactECharts option={trendOption} style={{ height: 320 }} notMerge lazyUpdate opts={{ renderer: "svg" }} />
                <Stack direction="row" justifyContent="space-between" sx={{ mt: 1 }}>
                  <Typography variant="caption" color="text.secondary">{formatDateTime(tank.points[0]?.readAt)}</Typography>
                  <Typography variant="caption" color="text.secondary">{formatDateTime(latest.readAt)}</Typography>
                </Stack>
              </CardContent>
            </Card>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

export function TankChartsPage({ jobber }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sites, setSites] = useState([]);
  const [selectedSiteId, setSelectedSiteId] = useState(searchParams.get("siteId") || "");
  const [selectedTankId, setSelectedTankId] = useState(searchParams.get("tankId") || "");
  const [siteDetail, setSiteDetail] = useState(null);
  const [range, setRange] = useState("24h");
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [anchorTs, setAnchorTs] = useState("");
  const [mobileView, setMobileView] = useState(searchParams.get("tankId") ? "detail" : "site");
  const [mobileDetailMode, setMobileDetailMode] = useState("gauge");

  useEffect(() => {
    api.getSites()
      .then((data) => {
        setSites(data);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    const siteIdFromUrl = searchParams.get("siteId") || "";
    const tankIdFromUrl = searchParams.get("tankId") || "";
    if (siteIdFromUrl !== selectedSiteId) setSelectedSiteId(siteIdFromUrl);
    if (tankIdFromUrl !== selectedTankId) setSelectedTankId(tankIdFromUrl);
    if (isMobile) {
      if (!siteIdFromUrl) setMobileView("site");
      else if (tankIdFromUrl) setMobileView("detail");
      else setMobileView("list");
    }
  }, [isMobile, searchParams]);

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);
    if (selectedSiteId) nextParams.set("siteId", selectedSiteId);
    else nextParams.delete("siteId");
    if (selectedTankId) nextParams.set("tankId", selectedTankId);
    else nextParams.delete("tankId");
    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [selectedSiteId, selectedTankId, searchParams, setSearchParams]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      if (!selectedSiteId) {
        setSiteDetail(null);
        setRows([]);
        setAnchorTs("");
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const [site, latestRows] = await Promise.all([
          api.getSite(selectedSiteId),
          api.getTankHistory({ siteId: selectedSiteId, limit: "1" })
        ]);
        if (ignore) return;
        setSiteDetail(site);
        const latestTs = latestRows[0]?.ts || "";
        setAnchorTs(latestTs);
        if (!latestTs) {
          setRows([]);
          setError("");
          setLoading(false);
          return;
        }
        const tankRows = await api.getTankHistory({
          siteId: selectedSiteId,
          from: buildRangeStart(latestTs, range),
          to: latestTs,
          limit: "10000"
        });
        if (ignore) return;
        setRows(tankRows);
        setError("");
      } catch (err) {
        if (!ignore) setError(err.message);
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
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

  useEffect(() => {
    if (!selectedTankId && groupedTanks.length && !isMobile) {
      setSelectedTankId(groupedTanks[0].tankId);
      return;
    }
    if (selectedTankId && !groupedTanks.find((tank) => tank.tankId === selectedTankId)) {
      setSelectedTankId(isMobile ? "" : groupedTanks[0]?.tankId || "");
    }
  }, [groupedTanks, isMobile, selectedTankId]);

  const selectedTank = useMemo(
    () => groupedTanks.find((tank) => tank.tankId === selectedTankId) || (!isMobile ? groupedTanks[0] || null : null),
    [groupedTanks, isMobile, selectedTankId]
  );

  const summary = useMemo(() => {
    const totalRows = groupedTanks.reduce((sum, tank) => sum + tank.points.length, 0);
    const averageFill = groupedTanks.length
      ? groupedTanks.reduce((sum, tank) => sum + Number(tank.points[tank.points.length - 1]?.fillPercent || 0), 0) / groupedTanks.length
      : 0;
    return {
      tanks: groupedTanks.length,
      rows: totalRows,
      averageFill
    };
  }, [groupedTanks]);

  return (
      <Stack spacing={3}>
      <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1.5}>
        <div>
          <Typography variant={isMobile ? "h5" : "h4"}>Tank Charts</Typography>
          {!isMobile ? (
            <Typography color="text.secondary" variant="body2">
              Phone-first trend review. Start with one tank, see the gauge and trend immediately, and expand across the site on larger screens.
            </Typography>
          ) : null}
        </div>
        {!isMobile ? (
          <Stack direction={{ xs: "row", sm: "row" }} spacing={1.25} flexWrap="wrap" useFlexGap>
            <Chip icon={<TimelineIcon />} label={`${summary.rows} rows`} />
            <Chip icon={<OpacityIcon />} label={`Avg ${formatPercent(summary.averageFill)}`} />
          </Stack>
        ) : null}
      </Stack>

      {!isMobile ? (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Card><CardContent><Typography variant="caption" color="text.secondary">Visible Tanks</Typography><Typography variant="h4">{summary.tanks}</Typography></CardContent></Card>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Card><CardContent><Typography variant="caption" color="text.secondary">Time Range</Typography><Typography variant="h4">{rangeOptions.find((option) => option.value === range)?.label || range}</Typography></CardContent></Card>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Card><CardContent><Typography variant="caption" color="text.secondary">Latest Anchor</Typography><Typography variant="body1" fontWeight={700}>{anchorTs ? formatDateTime(anchorTs) : "-"}</Typography></CardContent></Card>
          </Grid>
        </Grid>
      ) : null}

      <Card>
        <CardContent>
          {isMobile ? (
            <Stack spacing={1.5}>
              {!selectedSiteId || mobileView === "site" ? (
                <Grid container spacing={1.5}>
                  <Grid size={12}>
                    <Autocomplete
                      size="small"
                      options={sites}
                      value={sites.find((site) => site.id === selectedSiteId) || null}
                      onChange={(_event, nextSite) => {
                        const nextSiteId = nextSite?.id || "";
                        setSelectedSiteId(nextSiteId);
                        setSelectedTankId("");
                        setMobileView(nextSiteId ? "list" : "site");
                      }}
                      getOptionLabel={(option) => `${option.siteCode} - ${option.name}`}
                      isOptionEqualToValue={(option, value) => option.id === value.id}
                      renderInput={(params) => <TextField {...params} label="Location" placeholder="Type a location" />}
                      clearOnEscape
                    />
                  </Grid>
                </Grid>
              ) : (
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Chip label={sites.find((site) => site.id === selectedSiteId)?.name || "Location selected"} />
                  <Button size="small" startIcon={<FilterListIcon />} onClick={() => setMobileView("site")}>
                    Change Site
                  </Button>
                </Stack>
              )}
            </Stack>
          ) : (
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 12, md: 8 }}>
                <Autocomplete
                  size="small"
                  options={sites}
                  value={sites.find((site) => site.id === selectedSiteId) || null}
                  onChange={(_event, nextSite) => setSelectedSiteId(nextSite?.id || "")}
                  getOptionLabel={(option) => `${option.siteCode} - ${option.name}`}
                  isOptionEqualToValue={(option, value) => option.id === value.id}
                  renderInput={(params) => <TextField {...params} label="Location" placeholder="Type a location" />}
                  clearOnEscape
                />
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <Autocomplete
                  size="small"
                  options={rangeOptions}
                  value={rangeOptions.find((option) => option.value === range) || null}
                  onChange={(_event, nextRange) => setRange(nextRange?.value || "24h")}
                  getOptionLabel={(option) => option.label}
                  isOptionEqualToValue={(option, value) => option.value === value.value}
                  renderInput={(params) => <TextField {...params} label="Range" placeholder="Type a range" />}
                  disableClearable
                />
              </Grid>
            </Grid>
          )}
          <Typography color="text.secondary" sx={{ mt: 2 }}>
            {siteDetail
              ? `${siteDetail.address || "Address n/a"} ${siteDetail.postalCode || ""}`.trim()
              : "Select a location to load all tank charts for that site."}
          </Typography>
        </CardContent>
      </Card>

      {error ? <Alert severity="error">{error}</Alert> : null}

      {loading ? (
        <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 220 }}>
          <CircularProgress />
        </Stack>
      ) : !selectedSiteId ? (
        <Card><CardContent><Typography color="text.secondary">Select a location to view tank trend charts.</Typography></CardContent></Card>
      ) : groupedTanks.length === 0 ? (
        <Card><CardContent><Typography color="text.secondary">No tanks are available for the selected location.</Typography></CardContent></Card>
      ) : isMobile ? (
        <Stack spacing={2}>
          {mobileView === "detail" && selectedTank ? (
            <Stack spacing={2}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Button startIcon={<ArrowBackIcon />} onClick={() => setMobileView("list")}>
                  Back to tanks
                </Button>
                <Chip label={`Tank ${selectedTank.atgTankId}`} />
              </Stack>
              <Stack direction="row" spacing={1}>
                <Button variant={mobileDetailMode === "gauge" ? "contained" : "outlined"} onClick={() => setMobileDetailMode("gauge")}>
                  Gauge
                </Button>
                <Button variant={mobileDetailMode === "graph" ? "contained" : "outlined"} onClick={() => setMobileDetailMode("graph")}>
                  Graph
                </Button>
              </Stack>
              {mobileDetailMode === "graph" ? (
                <Autocomplete
                  size="small"
                  options={rangeOptions}
                  value={rangeOptions.find((option) => option.value === range) || null}
                  onChange={(_event, nextRange) => setRange(nextRange?.value || "24h")}
                  getOptionLabel={(option) => option.label}
                  isOptionEqualToValue={(option, value) => option.value === value.value}
                  renderInput={(params) => <TextField {...params} label="Graph Range" placeholder="Type a range" />}
                  disableClearable
                />
              ) : null}
              <MobileTankChartDetail tank={selectedTank} tankLimits={jobber?.tankLimits} viewMode={mobileDetailMode} />
              <Button
                variant="outlined"
                startIcon={<TableRowsIcon />}
                onClick={() => navigate(`/tank-information?siteId=${encodeURIComponent(selectedSiteId)}&tankId=${encodeURIComponent(selectedTank.tankId)}`)}
              >
                Open Tank Information
              </Button>
            </Stack>
          ) : (
            <Stack spacing={1.5}>
              {groupedTanks.map((tank) => (
                <MobileTankSelectorCard
                  key={tank.tankId}
                  tank={tank}
                  selected={selectedTank?.tankId === tank.tankId}
                  tankLimits={jobber?.tankLimits}
                  onClick={() => {
                    setSelectedTankId(tank.tankId);
                    setMobileDetailMode("gauge");
                    setMobileView("detail");
                  }}
                />
              ))}
            </Stack>
          )}
        </Stack>
      ) : (
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, xl: 4 }}>
            <Stack spacing={1.5}>
              {groupedTanks.map((tank) => (
                <MobileTankSelectorCard
                  key={tank.tankId}
                  tank={tank}
                  selected={selectedTank?.tankId === tank.tankId}
                  tankLimits={jobber?.tankLimits}
                  onClick={() => setSelectedTankId(tank.tankId)}
                />
              ))}
            </Stack>
          </Grid>
          <Grid size={{ xs: 12, xl: 8 }}>
            <TankChartDetail tank={selectedTank} tankLimits={jobber?.tankLimits} />
          </Grid>
        </Grid>
      )}
    </Stack>
  );
}
