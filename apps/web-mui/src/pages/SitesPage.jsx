import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Grid,
  LinearProgress,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import FlashOnIcon from "@mui/icons-material/FlashOn";
import { api } from "../api";
import { SiteAlertsDialog } from "../components/SiteAlertsDialog";
import { gaugeColorStops } from "../tankLimits";

const pumpRangeOptions = [
  { value: "24h", label: "24 Hours" },
  { value: "3d", label: "3 Days" },
  { value: "30d", label: "30 Days" }
];

function formatMoney(value) {
  return `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function formatCount(value) {
  return Number(value || 0).toLocaleString();
}

function formatVolume(value) {
  return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} Gal`;
}

function formatDateTime(value) {
  if (!value) return "No signal";
  return new Date(value).toLocaleString();
}

function formatPumpVolume(value) {
  return `${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  })} Gal`;
}

function formatNumber(value, maximumFractionDigits = 1) {
  if (value == null || value === "") return "Not recorded";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits });
}

function parseSiteLocation(site) {
  const address = String(site?.address || "").trim();
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  const lastPart = parts[parts.length - 1] || "";
  let city = parts.length >= 2 ? parts[parts.length - 2] : "";
  let state = "";

  const stateMatch = lastPart.match(/\b([A-Z]{2})\b(?:\s+\d{5}(?:-\d{4})?)?$/);
  if (stateMatch) {
    state = stateMatch[1];
  }

  if (!city && site?.region) {
    city = String(site.region).trim();
  }

  if (!state && site?.region) {
    const region = String(site.region).trim();
    if (/^[A-Z]{2}$/.test(region)) state = region;
  }

  return {
    city,
    state
  };
}

function pumpRangeParams(rangeValue) {
  const end = new Date();
  if (rangeValue === "24h") {
    return {
      from: new Date(end.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      to: end.toISOString()
    };
  }
  if (rangeValue === "3d") {
    return {
      from: new Date(end.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      to: end.toISOString()
    };
  }
  return { preset: "30d" };
}

function tankCapacity(tank) {
  return tank?.capacityLiters ?? tank?.capacity ?? tank?.maxVolumeLiters ?? null;
}

function tankCurrentVolume(tank) {
  return tank?.currentVolumeLiters ?? tank?.fuelVolumeLiters ?? tank?.inventoryVolumeLiters ?? null;
}

function tankUllage(tank) {
  return tank?.ullageLiters ?? tank?.ullage ?? null;
}

function tankFillPercent(tank) {
  return tank?.fillPercent ?? tank?.currentFillPercent ?? null;
}

function siteHealth(site) {
  const expected = Number(site?.pumpSidesExpected || 0);
  const connected = Number(site?.pumpSidesConnected || 0);
  if (!expected) return 0;
  return connected / expected;
}

function statusColor(value) {
  if (value >= 0.95) return "success";
  if (value >= 0.8) return "warning";
  return "error";
}

function buildTankGaugeOption(fillPercent, tankLimits, product) {
  const safeValue = Math.max(0, Math.min(100, Number(fillPercent) || 0));
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
            width: 14,
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

function AlertBadge({ type, count, onClick }) {
  if (!Number(count || 0)) return null;

  const isCritical = type === "critical";
  const Icon = isCritical ? FlashOnIcon : WarningAmberIcon;
  const accent = isCritical ? "#d14343" : "#c77700";

  return (
    <Chip
      size="small"
      icon={<Icon sx={{ color: `${accent} !important` }} />}
      label={`${count || 0}`}
      variant="outlined"
      onClick={onClick}
      sx={{
        color: accent,
        borderColor: isCritical ? "rgba(209,67,67,0.4)" : "rgba(199,119,0,0.45)",
        backgroundColor: isCritical ? "rgba(209,67,67,0.06)" : "rgba(199,119,0,0.10)",
        cursor: onClick ? "pointer" : "default",
        "& .MuiChip-label": {
          px: 1,
          fontWeight: 700
        }
      }}
    />
  );
}

function buildPumpActivityChartOption(rows) {
  const labels = rows.map((row) => `Pump ${row.fuelPositionId || "?"}`);
  const maxVolume = Math.max(...rows.map((row) => Number(row.gallons || 0)), 0);
  return {
    animationDuration: 500,
    grid: { top: 18, right: 18, bottom: 36, left: 72 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: "#173447",
      borderWidth: 0,
      textStyle: { color: "#f7fbff" },
      formatter(params) {
        const point = params?.[0];
        if (!point) return "";
        return `${point.axisValue}<br/>Volume: ${formatPumpVolume(point.value)}`;
      }
    },
    xAxis: {
      type: "value",
      min: 0,
      max: maxVolume ? undefined : 1,
      axisLabel: {
        color: "#59758a",
        formatter(value) {
          return `${Number(value).toLocaleString()}`;
        }
      },
      splitLine: { lineStyle: { color: "rgba(99, 136, 159, 0.18)" } }
    },
    yAxis: {
      type: "category",
      data: labels,
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: {
        color: "#173447",
        fontWeight: 600
      }
    },
    series: [
      {
        type: "bar",
        data: rows.map((row, index) => ({
          value: Number(row.gallons || 0),
          itemStyle: {
            color: index === 0 ? "#0b5fff" : "#78a6ff",
            borderRadius: [0, 8, 8, 0]
          }
        })),
        barWidth: 18,
        label: {
          show: true,
          position: "right",
          color: "#173447",
          fontWeight: 700,
          formatter(params) {
            return formatPumpVolume(params.value);
          }
        }
      }
    ]
  };
}

function TankDetailDialog({ tank, open, onClose }) {
  const currentVolume = tankCurrentVolume(tank);
  const capacity = tankCapacity(tank);
  const ullage = tankUllage(tank);
  const fillPercent = tankFillPercent(tank);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{tank?.label || "Tank Detail"}</DialogTitle>
      <DialogContent dividers>
        {tank ? (
          <Grid container spacing={1.5}>
            <Grid size={{ xs: 6 }}>
              <Typography variant="caption" color="text.secondary">Product</Typography>
              <Typography fontWeight={700}>{tank.product || "Not recorded"}</Typography>
            </Grid>
            <Grid size={{ xs: 6 }}>
              <Typography variant="caption" color="text.secondary">Tank ID</Typography>
              <Typography fontWeight={700}>{tank.atgTankId || tank.id || "Not recorded"}</Typography>
            </Grid>
            <Grid size={{ xs: 6 }}>
              <Typography variant="caption" color="text.secondary">Fill %</Typography>
              <Typography fontWeight={700}>{fillPercent == null ? "Not recorded" : `${Number(fillPercent).toFixed(1)}%`}</Typography>
            </Grid>
            <Grid size={{ xs: 6 }}>
              <Typography variant="caption" color="text.secondary">Current Volume</Typography>
              <Typography fontWeight={700}>{currentVolume == null ? "Not recorded" : formatVolume(currentVolume)}</Typography>
            </Grid>
            <Grid size={{ xs: 6 }}>
              <Typography variant="caption" color="text.secondary">Capacity</Typography>
              <Typography fontWeight={700}>{capacity == null ? "Not recorded" : formatVolume(capacity)}</Typography>
            </Grid>
            <Grid size={{ xs: 6 }}>
              <Typography variant="caption" color="text.secondary">Ullage</Typography>
              <Typography fontWeight={700}>{ullage == null ? "Not recorded" : formatVolume(ullage)}</Typography>
            </Grid>
            <Grid size={{ xs: 6 }}>
              <Typography variant="caption" color="text.secondary">Water</Typography>
              <Typography fontWeight={700}>{tank?.waterVolumeLiters == null ? "Not recorded" : `${formatNumber(tank.waterVolumeLiters, 2)} L`}</Typography>
            </Grid>
            <Grid size={{ xs: 6 }}>
              <Typography variant="caption" color="text.secondary">Temperature</Typography>
              <Typography fontWeight={700}>{tank?.temperatureCelsius == null ? "Not recorded" : `${formatNumber(tank.temperatureCelsius, 1)} °C`}</Typography>
            </Grid>
            <Grid size={{ xs: 12 }}>
              <Typography variant="caption" color="text.secondary">Last Read</Typography>
              <Typography fontWeight={700}>{formatDateTime(tank?.readAt || tank?.lastReadAt || tank?.recordedAt)}</Typography>
            </Grid>
          </Grid>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PumpActivityDialog({ site, open, range, rows, loading, error, onClose, onRangeChange }) {
  const topPump = rows[0] || null;
  const chartRows = rows.slice(0, 8);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{site?.name ? `${site.name} Pump Activity` : "Pump Activity"}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {pumpRangeOptions.map((option) => (
              <Button
                key={option.value}
                size="small"
                variant={range === option.value ? "contained" : "outlined"}
                onClick={() => onRangeChange(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </Stack>

          {loading ? <LinearProgress sx={{ borderRadius: 999, height: 8 }} /> : null}
          {error ? <Alert severity="warning">{error}</Alert> : null}

          {!loading && !rows.length ? (
            <Typography color="text.secondary">No pump transactions were recorded in this time range.</Typography>
          ) : null}

          {rows.length ? (
            <>
              <Card variant="outlined">
                <CardContent>
                  <Stack spacing={0.5}>
                    <Typography variant="overline" color="text.secondary">Most Active Pump</Typography>
                    <Typography variant="h5">{topPump ? `Pump ${topPump.fuelPositionId}` : "No pump data"}</Typography>
                    <Typography color="text.secondary">
                      {topPump ? `${formatPumpVolume(topPump.gallons)} pumped across ${formatCount(topPump.transactions)} transactions.` : "No activity in range."}
                    </Typography>
                  </Stack>
                </CardContent>
              </Card>

              <Grid container spacing={2}>
                <Grid size={{ xs: 12, md: 7 }}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="h6" gutterBottom>Volume By Pump</Typography>
                      <Box sx={{ height: 320 }}>
                        <ReactECharts
                          option={buildPumpActivityChartOption(chartRows)}
                          style={{ height: "100%", width: "100%" }}
                          notMerge
                          lazyUpdate
                          opts={{ renderer: "svg" }}
                        />
                      </Box>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid size={{ xs: 12, md: 5 }}>
                  <Card variant="outlined">
                    <CardContent>
                      <Stack spacing={1.25}>
                        <Typography variant="h6">Pump List</Typography>
                        {rows.map((pump, index) => (
                          <Box
                            key={pump.fuelPositionId || `pump-${index}`}
                            sx={{
                              border: "1px solid",
                              borderColor: index === 0 ? "primary.main" : "divider",
                              borderRadius: 2,
                              p: 1.25,
                              backgroundColor: index === 0 ? "rgba(11,95,255,0.05)" : "transparent"
                            }}
                          >
                            <Stack direction="row" justifyContent="space-between" spacing={1}>
                              <div>
                                <Typography fontWeight={700}>{`Pump ${pump.fuelPositionId || "Unknown"}`}</Typography>
                                <Typography variant="body2" color="text.secondary">
                                  {formatCount(pump.transactions)} transactions
                                </Typography>
                              </div>
                              <Typography fontWeight={700}>{formatPumpVolume(pump.gallons)}</Typography>
                            </Stack>
                          </Box>
                        ))}
                      </Stack>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            </>
          ) : null}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

function SitePreview({ site, summary, loading, error, isMobile, onBack, onOpenAlerts, onOpenTank, onOpenPumps, tankLimits }) {
  const tankPreview = (site?.tanks || []).slice(0, 3);
  const tankCount = site?.tanks?.length || 0;
  const transactionKpis = summary?.kpis || null;

  if (loading) {
    return (
      <Card>
        <CardContent>
          <Typography color="text.secondary">Loading site detail...</Typography>
        </CardContent>
      </Card>
    );
  }

  if (!site) {
    return (
      <Card>
        <CardContent>
          <Typography color="text.secondary">Tap a site to see pumps, tanks, and transactions.</Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Stack spacing={2}>
      {isMobile ? <Button onClick={onBack}>Back to Sites</Button> : null}
      {error ? <Alert severity="warning">{error}</Alert> : null}

      <Card>
        <CardContent>
          <Stack spacing={1.5}>
            <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="flex-start">
              <div>
                <Typography variant="overline" color="text.secondary">Site Lens</Typography>
                <Typography variant="h5">{site.name}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {[site.siteCode, site.region || "Unassigned"].filter(Boolean).join(" · ")}
                </Typography>
              </div>
              <Stack direction="row" spacing={0.75}>
                <AlertBadge type="critical" count={site.criticalCount || 0} onClick={() => onOpenAlerts?.(site, "critical")} />
                <AlertBadge type="warning" count={site.warnCount || 0} onClick={() => onOpenAlerts?.(site, "warning")} />
              </Stack>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {[site.address, site.postalCode].filter(Boolean).join(" ") || "No address"}
            </Typography>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardActionArea onClick={() => onOpenPumps?.(site)}>
          <CardContent>
            <Stack spacing={1.5}>
              <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
                <Typography variant="h6">Pumps</Typography>
                <Typography variant="caption" color="primary.main">Tap for activity</Typography>
              </Stack>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" color="text.secondary">Connected sides</Typography>
                <Typography variant="h4">{site.pumpSidesConnected || 0}</Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={Math.max(0, Math.min(100, siteHealth(site) * 100))}
                color={statusColor(siteHealth(site))}
                sx={{ height: 10, borderRadius: 999 }}
              />
              <Typography variant="caption" color="text.secondary">
                Red/yellow on the line indicates missing sides. ATG last seen: {formatDateTime(site.atgLastSeenAt)}
              </Typography>
            </Stack>
          </CardContent>
        </CardActionArea>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={1.5}>
            <Typography variant="h6">Tank Snapshot</Typography>
            {tankPreview.length ? (
              <Grid container spacing={1.5}>
                {tankPreview.map((tank) => (
                  <Grid key={tank.id} size={{ xs: 12, sm: 4 }}>
                    <Card variant="outlined">
                      <CardActionArea onClick={() => onOpenTank?.(tank)}>
                        <CardContent>
                          <Stack spacing={1}>
                            <Typography fontWeight={700}>{tank.label}</Typography>
                            <Typography variant="caption" color="text.secondary">{tank.product || "Product n/a"}</Typography>
                            {isMobile ? (
                              <Stack direction="row" alignItems="center" spacing={1}>
                                <Box sx={{ height: 84, width: 120, ml: -1, flexShrink: 0 }}>
                                  <ReactECharts option={buildTankGaugeOption(tank.fillPercent ?? tank.currentFillPercent ?? 0, tankLimits, tank.product)} style={{ height: "100%", width: "100%" }} opts={{ renderer: "svg" }} />
                                </Box>
                                <Typography variant="body2" color="text.secondary">
                                  {formatVolume(tank.currentVolumeLiters ?? tank.fuelVolumeLiters ?? tank.inventoryVolumeLiters ?? 0)} left
                                </Typography>
                              </Stack>
                            ) : (
                              <>
                                <Box sx={{ height: 120 }}>
                                  <ReactECharts option={buildTankGaugeOption(tank.fillPercent ?? tank.currentFillPercent ?? 0, tankLimits, tank.product)} style={{ height: "100%", width: "100%" }} opts={{ renderer: "svg" }} />
                                </Box>
                                <Typography variant="body2" color="text.secondary">
                                  {formatVolume(tank.currentVolumeLiters ?? tank.fuelVolumeLiters ?? tank.inventoryVolumeLiters ?? 0)} left
                                </Typography>
                              </>
                            )}
                            <Typography variant="caption" color="text.secondary">
                              Tap for tank information
                            </Typography>
                          </Stack>
                        </CardContent>
                      </CardActionArea>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            ) : (
              <Typography color="text.secondary">No tank assets loaded for this site.</Typography>
            )}
            {tankPreview.length && tankCount > tankPreview.length ? (
              <Typography variant="caption" color="text.secondary">+{tankCount - tankPreview.length} more tanks</Typography>
            ) : null}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={1.5}>
            <Typography variant="h6">Transaction Pulse</Typography>
            {transactionKpis ? (
              <Grid container spacing={1.5}>
                <Grid size={{ xs: 12 }}>
                  <Typography variant="caption" color="text.secondary">Transactions</Typography>
                  <Typography variant="h5">{formatCount(transactionKpis.totalTransactions)}</Typography>
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <Typography variant="caption" color="text.secondary">Sales</Typography>
                  <Typography variant="h6">{formatMoney(transactionKpis.totalSales)}</Typography>
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <Typography variant="caption" color="text.secondary">Gallons</Typography>
                  <Typography variant="h6">{Number(transactionKpis.totalGallons || 0).toFixed(1)}</Typography>
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <Typography variant="caption" color="text.secondary">Completion</Typography>
                  <Typography variant="h6">{formatPercent(transactionKpis.completionRate)}</Typography>
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <Typography variant="caption" color="text.secondary">Avg Ticket</Typography>
                  <Typography variant="h6">{formatMoney(transactionKpis.averageTicket)}</Typography>
                </Grid>
              </Grid>
            ) : (
              <Typography color="text.secondary">No transaction summary is available for this site yet.</Typography>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}

export function SitesPage({ jobber }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [siteDetail, setSiteDetail] = useState(null);
  const [siteSummary, setSiteSummary] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [mobileView, setMobileView] = useState("list");
  const [alertsDialog, setAlertsDialog] = useState({ open: false, severity: "", siteId: "", siteName: "" });
  const [selectedTank, setSelectedTank] = useState(null);
  const [pumpDialogOpen, setPumpDialogOpen] = useState(false);
  const [pumpRange, setPumpRange] = useState("24h");
  const [pumpRows, setPumpRows] = useState([]);
  const [pumpLoading, setPumpLoading] = useState(false);
  const [pumpError, setPumpError] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [siteFilter, setSiteFilter] = useState("");

  useEffect(() => {
    let ignore = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const result = await api.getSites();
        if (!ignore) {
          setSites(result);
        }
      } catch (nextError) {
        if (!ignore) {
          setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to load sites"));
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    let ignore = false;
    if (!selectedSiteId) {
      setSiteDetail(null);
      setSiteSummary(null);
      setSelectedTank(null);
      return () => {
        ignore = true;
      };
    }

    async function loadDetail() {
      setDetailLoading(true);
      setDetailError("");
      try {
        const [detail, summary] = await Promise.all([
          api.getSite(selectedSiteId),
          api.getAlliedTransactionsSummary(selectedSiteId, { preset: "30d" }).catch(() => null)
        ]);
        if (!ignore) {
          setSiteDetail(detail);
          setSiteSummary(summary);
        }
      } catch (nextError) {
        if (!ignore) {
          setSiteDetail(null);
          setSiteSummary(null);
          setDetailError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to load site detail"));
        }
      } finally {
        if (!ignore) setDetailLoading(false);
      }
    }

    loadDetail();
    return () => {
      ignore = true;
    };
  }, [selectedSiteId]);

  const sitesWithLocation = useMemo(
    () => sites.map((site) => ({ ...site, ...parseSiteLocation(site) })),
    [sites]
  );

  const stateOptions = useMemo(
    () => [...new Set(sitesWithLocation.map((site) => site.state).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [sitesWithLocation]
  );

  const cityOptions = useMemo(() => {
    const visible = stateFilter ? sitesWithLocation.filter((site) => site.state === stateFilter) : sitesWithLocation;
    return [...new Set(visible.map((site) => site.city).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }, [sitesWithLocation, stateFilter]);

  const filteredSites = useMemo(() => {
    return sitesWithLocation.filter((site) => {
      if (stateFilter && site.state !== stateFilter) return false;
      if (cityFilter && site.city !== cityFilter) return false;
      if (siteFilter && site.id !== siteFilter) return false;
      return true;
    });
  }, [sitesWithLocation, stateFilter, cityFilter, siteFilter]);

  const orderedSites = useMemo(
    () => [...filteredSites].sort((a, b) => Number(b.criticalCount || 0) - Number(a.criticalCount || 0) || Number(b.warnCount || 0) - Number(a.warnCount || 0) || a.name.localeCompare(b.name)),
    [filteredSites]
  );

  useEffect(() => {
    if (stateFilter && !stateOptions.includes(stateFilter)) setStateFilter("");
  }, [stateFilter, stateOptions]);

  useEffect(() => {
    if (cityFilter && !cityOptions.includes(cityFilter)) setCityFilter("");
  }, [cityFilter, cityOptions]);

  useEffect(() => {
    if (siteFilter && !filteredSites.some((site) => site.id === siteFilter)) setSiteFilter("");
  }, [siteFilter, filteredSites]);

  useEffect(() => {
    if (!orderedSites.length && selectedSiteId) {
      setSelectedSiteId("");
    }
    if (selectedSiteId && !orderedSites.some((site) => site.id === selectedSiteId)) {
      setSelectedSiteId("");
    }
  }, [orderedSites, selectedSiteId]);

  function openAlertsDialog(site, severity) {
    if (!site || !severity) return;
    setAlertsDialog({ open: true, severity, siteId: site.id, siteName: site.name });
  }

  useEffect(() => {
    let ignore = false;
    if (!pumpDialogOpen || !selectedSiteId) {
      if (!pumpDialogOpen) {
        setPumpLoading(false);
        setPumpError("");
      }
      return () => {
        ignore = true;
      };
    }

    async function loadPumpActivity() {
      setPumpLoading(true);
      setPumpError("");
      try {
        const summary = await api.getAlliedTransactionsSummary(selectedSiteId, pumpRangeParams(pumpRange));
        if (!ignore) {
          setPumpRows(Array.isArray(summary?.pumpHealth) ? summary.pumpHealth : []);
        }
      } catch (nextError) {
        if (!ignore) {
          setPumpRows([]);
          setPumpError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to load pump activity"));
        }
      } finally {
        if (!ignore) setPumpLoading(false);
      }
    }

    loadPumpActivity();
    return () => {
      ignore = true;
    };
  }, [pumpDialogOpen, pumpRange, selectedSiteId]);

  if (loading) {
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 240 }}>
        <CircularProgress />
      </Stack>
    );
  }

  return (
    <Stack spacing={3}>
      <div>
        <Typography variant="h4">Sites</Typography>
        <Typography color="text.secondary">
          Tap a site card to open the same operational preview used in the dashboard.
        </Typography>
      </div>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">Filters</Typography>
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 12, md: 4 }}>
                <Autocomplete
                  size="small"
                  options={stateOptions}
                  value={stateFilter || null}
                  onChange={(_event, nextValue) => {
                    setStateFilter(nextValue || "");
                    setCityFilter("");
                    setSiteFilter("");
                  }}
                  renderInput={(params) => <TextField {...params} label="State" placeholder="Type a state" />}
                  clearOnEscape
                />
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <Autocomplete
                  size="small"
                  options={cityOptions}
                  value={cityFilter || null}
                  onChange={(_event, nextValue) => {
                    setCityFilter(nextValue || "");
                    setSiteFilter("");
                  }}
                  renderInput={(params) => <TextField {...params} label="City" placeholder="Type a city" />}
                  clearOnEscape
                />
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <Autocomplete
                  size="small"
                  options={filteredSites}
                  value={filteredSites.find((site) => site.id === siteFilter) || null}
                  onChange={(_event, nextSite) => {
                    const nextSiteId = nextSite?.id || "";
                    setSiteFilter(nextSiteId);
                    if (nextSiteId) setSelectedSiteId(nextSiteId);
                  }}
                  getOptionLabel={(option) => (typeof option === "string" ? option : option?.name || "")}
                  isOptionEqualToValue={(option, value) => option.id === value.id}
                  renderInput={(params) => <TextField {...params} label="Site" placeholder="Type a site name" />}
                  clearOnEscape
                />
              </Grid>
            </Grid>
          </Stack>
        </CardContent>
      </Card>

      {error ? <Alert severity="error">{error}</Alert> : null}

      {isMobile ? (
        mobileView === "detail" ? (
          <SitePreview
            site={siteDetail}
            summary={siteSummary}
            loading={detailLoading}
            error={detailError}
            isMobile
            onBack={() => setMobileView("list")}
            onOpenAlerts={openAlertsDialog}
            onOpenTank={setSelectedTank}
            onOpenPumps={() => setPumpDialogOpen(true)}
            tankLimits={jobber?.tankLimits}
          />
        ) : (
          <Stack spacing={1.5}>
            {orderedSites.map((site) => (
              <Card
                key={site.id}
                variant="outlined"
                sx={{
                  borderColor: selectedSiteId === site.id ? "primary.main" : "divider",
                  borderWidth: selectedSiteId === site.id ? 2 : 1
                }}
              >
                <CardActionArea
                  onClick={() => {
                    setSelectedSiteId(site.id);
                    setMobileView("detail");
                  }}
                >
                  <CardContent>
                    <Stack spacing={1.25}>
                      <Stack direction="row" justifyContent="space-between" spacing={1}>
                        <div>
                          <Typography fontWeight={700}>{site.name}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {[site.siteCode, site.region || "Unassigned"].filter(Boolean).join(" · ")}
                          </Typography>
                        </div>
                        <Stack direction="row" spacing={0.75}>
                          <AlertBadge type="critical" count={site.criticalCount || 0} onClick={(event) => { event.stopPropagation(); openAlertsDialog(site, "critical"); }} />
                          <AlertBadge type="warning" count={site.warnCount || 0} onClick={(event) => { event.stopPropagation(); openAlertsDialog(site, "warning"); }} />
                        </Stack>
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        {[site.address, site.postalCode].filter(Boolean).join(" ") || "No address"}
                      </Typography>
                    </Stack>
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
          </Stack>
        )
      ) : (
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, xl: 5 }}>
            <Stack spacing={1.5}>
              {orderedSites.map((site) => (
                <Card
                  key={site.id}
                  variant="outlined"
                  sx={{
                    borderColor: selectedSiteId === site.id ? "primary.main" : "divider",
                    borderWidth: selectedSiteId === site.id ? 2 : 1
                  }}
                >
                  <CardActionArea onClick={() => setSelectedSiteId(site.id)}>
                    <CardContent>
                      <Stack spacing={1.25}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                          <div>
                            <Typography variant="h6">{site.name}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {[site.siteCode, site.region || "Unassigned"].filter(Boolean).join(" · ")}
                            </Typography>
                          </div>
                          <Stack direction="row" spacing={0.75}>
                            <AlertBadge
                              type="critical"
                              count={site.criticalCount || 0}
                              onClick={(event) => {
                                event.stopPropagation();
                                openAlertsDialog(site, "critical");
                              }}
                            />
                            <AlertBadge
                              type="warning"
                              count={site.warnCount || 0}
                              onClick={(event) => {
                                event.stopPropagation();
                                openAlertsDialog(site, "warning");
                              }}
                            />
                          </Stack>
                        </Stack>
                        <Typography color="text.secondary">{site.address || "No address"}</Typography>
                      </Stack>
                    </CardContent>
                  </CardActionArea>
                </Card>
              ))}
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, xl: 7 }}>
            <SitePreview
              site={siteDetail}
              summary={siteSummary}
              loading={detailLoading}
              error={detailError}
              isMobile={false}
              onBack={() => {}}
              onOpenAlerts={openAlertsDialog}
              onOpenTank={setSelectedTank}
              onOpenPumps={() => setPumpDialogOpen(true)}
              tankLimits={jobber?.tankLimits}
            />
          </Grid>
        </Grid>
      )}
      <TankDetailDialog tank={selectedTank} open={Boolean(selectedTank)} onClose={() => setSelectedTank(null)} />
      <PumpActivityDialog
        site={siteDetail}
        open={pumpDialogOpen}
        range={pumpRange}
        rows={pumpRows}
        loading={pumpLoading}
        error={pumpError}
        onClose={() => setPumpDialogOpen(false)}
        onRangeChange={setPumpRange}
      />
      <SiteAlertsDialog
        open={alertsDialog.open}
        onClose={() => setAlertsDialog({ open: false, severity: "", siteId: "", siteName: "" })}
        siteId={alertsDialog.siteId}
        siteName={alertsDialog.siteName}
        severity={alertsDialog.severity}
      />
    </Stack>
  );
}
