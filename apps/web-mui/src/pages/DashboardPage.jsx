import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Divider,
  Grid,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Paper,
  TextareaAutosize,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import RouterIcon from "@mui/icons-material/Router";
import OilBarrelIcon from "@mui/icons-material/OilBarrel";
import PaymentsIcon from "@mui/icons-material/Payments";
import FlashOnIcon from "@mui/icons-material/FlashOn";
import { api } from "../api";
import { SiteMap } from "../components/SiteMap";
import { TanStackDataTable } from "../components/TanStackDataTable";
import ReactECharts from "echarts-for-react";
import { SiteAlertsDialog } from "../components/SiteAlertsDialog";
import { gaugeColorStops } from "../tankLimits";

const FILTERS = {
  all: "all",
  critical: "critical",
  warning: "warning"
};

function formatMoney(value) {
  return `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function formatDateTime(value) {
  if (!value) return "No signal";
  return new Date(value).toLocaleString();
}

function statusColor(value) {
  if (value >= 0.95) return "success";
  if (value >= 0.8) return "warning";
  return "error";
}

function siteHealth(site) {
  const expected = Number(site.pumpSidesExpected || 0);
  const connected = Number(site.pumpSidesConnected || 0);
  if (!expected) return 0;
  return connected / expected;
}

function buildRegionRows(sites) {
  const buckets = new Map();
  for (const site of sites) {
    const key = site.region || "Unassigned";
    if (!buckets.has(key)) {
      buckets.set(key, {
        region: key,
        sites: 0,
        critical: 0,
        warning: 0,
        connected: 0,
        expected: 0
      });
    }
    const bucket = buckets.get(key);
    bucket.sites += 1;
    bucket.critical += Number(site.criticalCount || 0);
    bucket.warning += Number(site.warnCount || 0);
    bucket.connected += Number(site.pumpSidesConnected || 0);
    bucket.expected += Number(site.pumpSidesExpected || 0);
  }

  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      health: bucket.expected ? bucket.connected / bucket.expected : 0
    }))
    .sort((a, b) => b.critical - a.critical || b.warning - a.warning || a.region.localeCompare(b.region));
}

function buildAttentionFeed(sites) {
  return [...sites]
    .sort((a, b) => {
      const aScore = Number(a.criticalCount || 0) * 100 + Number(a.warnCount || 0);
      const bScore = Number(b.criticalCount || 0) * 100 + Number(b.warnCount || 0);
      return bScore - aScore;
    })
    .slice(0, 8);
}

function buildConnectivityFeed(sites) {
  return [...sites]
    .sort((a, b) => siteHealth(a) - siteHealth(b))
    .slice(0, 8);
}

function formatCount(value) {
  return Number(value || 0).toLocaleString();
}

function formatVolume(value) {
  return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} Gal`;
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

function initialAgentLog(site) {
  if (!site) return [];
  return [
    "Microsoft Windows [Version 10.0.19045.0]",
    "(c) WannLynx Petroleum local agent console",
    "",
    `C:\\Sites\\${site.siteCode}> connected to ${site.name}`,
    `C:\\Sites\\${site.siteCode}> ready for local AI prompts`
  ];
}

function SummaryCard({ icon, label, value, tone = "default", caption, onClick, active = false }) {
  const borderColor = tone === "critical" ? "#d14343" : tone === "warning" ? "#c77700" : tone === "success" ? "#2e7d32" : "rgba(15, 23, 42, 0.08)";
  const content = (
    <CardContent>
      <Stack spacing={1.5}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="body2" color="text.secondary">{label}</Typography>
          {icon}
        </Stack>
        {typeof value === "string" || typeof value === "number" ? (
          <Typography variant="h4">{value}</Typography>
        ) : (
          value
        )}
        {caption ? <Typography variant="body2" color="text.secondary">{caption}</Typography> : null}
      </Stack>
    </CardContent>
  );

  return (
    <Card
      sx={{
        height: "100%",
        borderColor: active ? "primary.main" : borderColor,
        borderWidth: active ? 2 : 1,
        borderStyle: "solid",
        backgroundColor: active ? "rgba(11, 95, 255, 0.04)" : "background.paper"
      }}
    >
      {onClick ? (
        <CardActionArea onClick={onClick} sx={{ height: "100%", alignItems: "stretch" }}>
          {content}
        </CardActionArea>
      ) : content}
    </Card>
  );
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

export function DashboardPage({ jobber }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [sites, setSites] = useState([]);
  const [alliedSummary, setAlliedSummary] = useState(null);
  const [error, setError] = useState("");
  const [alliedError, setAlliedError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [filter, setFilter] = useState(FILTERS.all);
  const [mobileView, setMobileView] = useState("map");
  const [siteDetail, setSiteDetail] = useState(null);
  const [siteTransactionSummary, setSiteTransactionSummary] = useState(null);
  const [siteDetailLoading, setSiteDetailLoading] = useState(false);
  const [siteDetailError, setSiteDetailError] = useState("");
  const [alertsDialog, setAlertsDialog] = useState({ open: false, severity: "", siteId: "", siteName: "" });
  const [agentDraft, setAgentDraft] = useState("");
  const [agentLog, setAgentLog] = useState([]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const rows = await api.getSites();
        if (!ignore) setSites(rows);
      } catch (nextError) {
        if (!ignore) setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to load portfolio"));
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    let ignore = false;
    async function loadAllied() {
      try {
        const payload = await api.getAlliedPortfolioSummary({ preset: "30d" });
        if (!ignore) {
          setAlliedSummary(payload);
          setAlliedError("");
        }
      } catch (nextError) {
        if (!ignore) {
          setAlliedSummary(null);
          setAlliedError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to load Allied summary"));
        }
      }
    }
    loadAllied();
    return () => {
      ignore = true;
    };
  }, []);

  const filteredSites = useMemo(() => {
    return sites.filter((site) => {
      if (filter === FILTERS.critical) return Number(site.criticalCount || 0) > 0;
      if (filter === FILTERS.warning) return Number(site.warnCount || 0) > 0;
      return true;
    });
  }, [sites, filter]);

  const selectedSite = useMemo(
    () => filteredSites.find((site) => site.id === selectedSiteId) || sites.find((site) => site.id === selectedSiteId) || null,
    [filteredSites, selectedSiteId, sites]
  );

  useEffect(() => {
    setAgentDraft("");
    setAgentLog(initialAgentLog(selectedSite));
  }, [selectedSite]);

  useEffect(() => {
    let ignore = false;

    if (!selectedSiteId) {
      setSiteDetail(null);
      setSiteTransactionSummary(null);
      setSiteDetailError("");
      setSiteDetailLoading(false);
      return () => {
        ignore = true;
      };
    }

    async function loadSiteDetail() {
      setSiteDetailLoading(true);
      setSiteDetailError("");
      try {
        const [detail, alliedSummary] = await Promise.all([
          api.getSite(selectedSiteId),
          api.getAlliedTransactionsSummary(selectedSiteId, { preset: "30d" }).catch(() => null)
        ]);
        if (!ignore) {
          setSiteDetail(detail);
          setSiteTransactionSummary(alliedSummary);
        }
      } catch (nextError) {
        if (!ignore) {
          setSiteDetail(null);
          setSiteTransactionSummary(null);
          setSiteDetailError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to load site detail"));
        }
      } finally {
        if (!ignore) setSiteDetailLoading(false);
      }
    }

    loadSiteDetail();
    return () => {
      ignore = true;
    };
  }, [selectedSiteId]);

  useEffect(() => {
    function handleDashboardHome() {
      setMobileView("map");
      setFilter(FILTERS.all);
      setSelectedSiteId("");
    }

    window.addEventListener("petroleum:dashboard-home", handleDashboardHome);
    return () => window.removeEventListener("petroleum:dashboard-home", handleDashboardHome);
  }, []);

  const totals = useMemo(() => {
    return sites.reduce(
      (acc, site) => {
        acc.critical += Number(site.criticalCount || 0);
        acc.warning += Number(site.warnCount || 0);
        acc.expected += Number(site.pumpSidesExpected || 0);
        acc.connected += Number(site.pumpSidesConnected || 0);
        if (site.atgLastSeenAt) acc.atgReporting += 1;
        return acc;
      },
      { critical: 0, warning: 0, expected: 0, connected: 0, atgReporting: 0 }
    );
  }, [sites]);

  const affectedSiteCounts = useMemo(() => {
    return sites.reduce(
      (acc, site) => {
        if (Number(site.criticalCount || 0) > 0) acc.critical += 1;
        if (Number(site.warnCount || 0) > 0) acc.warning += 1;
        return acc;
      },
      { critical: 0, warning: 0 }
    );
  }, [sites]);

  const mobileSites = useMemo(() => {
    const rows = [...filteredSites];
    if (filter === FILTERS.critical) {
      return rows.sort((a, b) => Number(b.criticalCount || 0) - Number(a.criticalCount || 0) || Number(b.warnCount || 0) - Number(a.warnCount || 0) || a.name.localeCompare(b.name));
    }
    if (filter === FILTERS.warning) {
      return rows.sort((a, b) => Number(b.warnCount || 0) - Number(a.warnCount || 0) || Number(b.criticalCount || 0) - Number(a.criticalCount || 0) || a.name.localeCompare(b.name));
    }
    return rows.sort((a, b) => Number(b.criticalCount || 0) - Number(a.criticalCount || 0) || Number(b.warnCount || 0) - Number(a.warnCount || 0) || a.name.localeCompare(b.name));
  }, [filteredSites, filter]);

  const networkHealth = totals.expected ? totals.connected / totals.expected : 0;
  const regionRows = useMemo(() => buildRegionRows(filteredSites), [filteredSites]);
  const attentionFeed = useMemo(() => buildAttentionFeed(filteredSites), [filteredSites]);
  const connectivityFeed = useMemo(() => buildConnectivityFeed(filteredSites), [filteredSites]);
  const siteTableRows = useMemo(() => filteredSites.map((site) => ({
    ...site,
    health: siteHealth(site),
    siteLabel: site.name,
    addressLabel: [site.address, site.postalCode].filter(Boolean).join(" ") || "No address",
    atgLastSeenLabel: formatDateTime(site.atgLastSeenAt)
  })), [filteredSites]);
  const siteTableColumns = useMemo(() => [
    { accessorKey: "siteLabel", header: "Site", cell: (info) => info.getValue(), meta: { minWidth: 180 } },
    { accessorKey: "region", header: "Region", cell: (info) => info.getValue() || "Unassigned", meta: { minWidth: 140 } },
    { accessorKey: "addressLabel", header: "Address", cell: (info) => info.getValue(), meta: { minWidth: 220 } },
    { accessorKey: "criticalCount", header: "Critical", cell: (info) => Number(info.getValue() || 0).toLocaleString(), meta: { align: "right", minWidth: 100 } },
    { accessorKey: "warnCount", header: "Warn", cell: (info) => Number(info.getValue() || 0).toLocaleString(), meta: { align: "right", minWidth: 90 } },
    { accessorKey: "health", header: "Pump Health", cell: (info) => formatPercent(info.getValue()), meta: { align: "right", minWidth: 120 } },
    { accessorKey: "atgLastSeenLabel", header: "ATG Last Seen", cell: (info) => info.getValue(), meta: { minWidth: 180 } }
  ], []);
  const regionTableColumns = useMemo(() => [
    { accessorKey: "region", header: "Region", cell: (info) => info.getValue(), meta: { minWidth: 160 } },
    { accessorKey: "sites", header: "Sites", cell: (info) => Number(info.getValue() || 0).toLocaleString(), meta: { align: "right", minWidth: 90 } },
    { accessorKey: "critical", header: "Critical", cell: (info) => Number(info.getValue() || 0).toLocaleString(), meta: { align: "right", minWidth: 90 } },
    { accessorKey: "warning", header: "Warn", cell: (info) => Number(info.getValue() || 0).toLocaleString(), meta: { align: "right", minWidth: 90 } },
    { accessorKey: "health", header: "Health", cell: (info) => formatPercent(info.getValue()), meta: { align: "right", minWidth: 100 } }
  ], []);

  function submitAgentPrompt(event) {
    event.preventDefault();
    const prompt = agentDraft.trim();
    if (!prompt || !selectedSite) return;
    setAgentLog((current) => [
      ...current,
      `C:\\Sites\\${selectedSite.siteCode}> ${prompt}`,
      `Local AI agent: preview shell only. Wire this panel to the real local agent workflow later for ${selectedSite.name}.`
    ]);
    setAgentDraft("");
  }

  function openMobileSiteList(nextFilter) {
    setFilter(nextFilter);
    setSelectedSiteId("");
    setMobileView("sites");
  }

  function renderAlertSiteMetric(alerts, sitesCount) {
    return (
      <Stack direction="row" spacing={0.75} alignItems="baseline">
        <Typography variant="h4">{alerts}</Typography>
        <Typography variant="h6" color="text.secondary">/</Typography>
        <Typography variant="h6" color="text.secondary">{sitesCount}</Typography>
      </Stack>
    );
  }

  const selectedSiteAssets = siteDetail || selectedSite;
  const tankPreview = (selectedSiteAssets?.tanks || []).slice(0, 3);
  const tankCount = selectedSiteAssets?.tanks?.length || 0;
  const transactionKpis = siteTransactionSummary?.kpis || null;

  function openAlertsDialog(site, severity) {
    if (!site || !severity) return;
    setAlertsDialog({ open: true, severity, siteId: site.id, siteName: site.name });
  }

  function renderSitePreview(showBackButton = false) {
    return (
      <Stack spacing={2}>
        {showBackButton ? (
          <Button variant="text" onClick={() => setMobileView("sites")}>
            Back to Sites
          </Button>
        ) : null}

        {siteDetailError ? <Alert severity="warning">{siteDetailError}</Alert> : null}

        {siteDetailLoading ? (
          <Card>
            <CardContent>
              <Typography color="text.secondary">Loading site detail...</Typography>
            </CardContent>
          </Card>
        ) : !selectedSiteAssets ? (
          <Card>
            <CardContent>
              <Typography color="text.secondary">Select a site to see pumps, tanks, and transaction health.</Typography>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardContent>
                <Stack spacing={1.5}>
                  <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="flex-start">
                    <div>
                      <Typography variant="overline" color="text.secondary">Site Lens</Typography>
                      <Typography variant="h5">{selectedSiteAssets.name}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {[selectedSiteAssets.siteCode, selectedSiteAssets.region || "Unassigned"].filter(Boolean).join(" · ")}
                      </Typography>
                    </div>
                    <Stack direction="row" spacing={0.75}>
                      <AlertBadge type="critical" count={selectedSiteAssets.criticalCount || 0} onClick={() => openAlertsDialog(selectedSiteAssets, "critical")} />
                      <AlertBadge type="warning" count={selectedSiteAssets.warnCount || 0} onClick={() => openAlertsDialog(selectedSiteAssets, "warning")} />
                    </Stack>
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {[selectedSiteAssets.address, selectedSiteAssets.postalCode].filter(Boolean).join(" ") || "No address"}
                  </Typography>
                </Stack>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Stack spacing={1.5}>
                  <Typography variant="h6">Pumps</Typography>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">Connected sides</Typography>
                    <Typography variant="h4">{selectedSiteAssets.pumpSidesConnected || 0}</Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={Math.max(0, Math.min(100, siteHealth(selectedSiteAssets) * 100))}
                    color={statusColor(siteHealth(selectedSiteAssets))}
                    sx={{ height: 10, borderRadius: 999 }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Red/yellow on the line indicates missing sides. ATG last seen: {formatDateTime(selectedSiteAssets.atgLastSeenAt)}
                  </Typography>
                </Stack>
              </CardContent>
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
                            <CardContent>
                              <Stack spacing={1}>
                                <Typography fontWeight={700}>{tank.label}</Typography>
                                <Typography variant="caption" color="text.secondary">{tank.product || "Product n/a"}</Typography>
                                {isMobile ? (
                                  <Stack direction="row" alignItems="center" spacing={1} sx={{ pl: 0 }}>
                                    <Box sx={{ height: 84, width: 120, ml: -1, flexShrink: 0 }}>
                                      <ReactECharts option={buildTankGaugeOption(tank.fillPercent ?? tank.currentFillPercent ?? 0, jobber?.tankLimits, tank.product)} style={{ height: "100%", width: "100%" }} opts={{ renderer: "svg" }} />
                                    </Box>
                                    <Typography variant="body2" color="text.secondary" sx={{ minWidth: 0 }}>
                                      {formatVolume(tank.currentVolumeLiters ?? tank.fuelVolumeLiters ?? tank.inventoryVolumeLiters ?? 0)} left
                                    </Typography>
                                  </Stack>
                                ) : (
                                  <>
                                    <Box sx={{ height: 120 }}>
                                      <ReactECharts option={buildTankGaugeOption(tank.fillPercent ?? tank.currentFillPercent ?? 0, jobber?.tankLimits, tank.product)} style={{ height: "100%", width: "100%" }} opts={{ renderer: "svg" }} />
                                    </Box>
                                    <Typography variant="body2" color="text.secondary">
                                      {formatVolume(tank.currentVolumeLiters ?? tank.fuelVolumeLiters ?? tank.inventoryVolumeLiters ?? 0)} left
                                    </Typography>
                                  </>
                                )}
                              </Stack>
                            </CardContent>
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
          </>
        )}
      </Stack>
    );
  }

  if (isMobile) {
    return (
      <>
        <Stack spacing={2.5}>
          {error ? <Alert severity="error">{error}</Alert> : null}

        {mobileView === "map" ? (
          <>
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 6 }}>
                <SummaryCard
                  icon={<FlashOnIcon sx={{ color: "#d14343" }} />}
                  label="Critical"
                  value={renderAlertSiteMetric(totals.critical, affectedSiteCounts.critical)}
                  tone="critical"
                  caption="alerts / sites"
                  onClick={() => openMobileSiteList(FILTERS.critical)}
                  active={filter === FILTERS.critical}
                />
              </Grid>
              <Grid size={{ xs: 6 }}>
                <SummaryCard
                  icon={<WarningAmberIcon sx={{ color: "#c77700" }} />}
                  label="Warning"
                  value={renderAlertSiteMetric(totals.warning, affectedSiteCounts.warning)}
                  tone="warning"
                  caption="alerts / sites"
                  onClick={() => openMobileSiteList(FILTERS.warning)}
                  active={filter === FILTERS.warning}
                />
              </Grid>
            </Grid>

            <Button variant="outlined" fullWidth onClick={() => openMobileSiteList(FILTERS.all)}>
              View All Sites
            </Button>

            <Card sx={{ overflow: "hidden" }}>
              <CardContent sx={{ p: 0 }}>
                <Box sx={{ p: 2 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                    <div>
                      <Typography variant="h6">Site Map</Typography>
                      <Typography variant="body2" color="text.secondary">
                        Tap a marker to focus an affected site.
                      </Typography>
                    </div>
                    <Chip size="small" label={`${filteredSites.length} sites`} />
                  </Stack>
                </Box>
                <Box sx={{ height: 420, borderTop: "1px solid rgba(15, 23, 42, 0.08)" }}>
                  <SiteMap
                    sites={sites}
                    selectedSiteId={selectedSiteId}
                    onSelect={(site) => {
                      setSelectedSiteId(site.id);
                      setFilter(FILTERS.all);
                      setMobileView("detail");
                    }}
                  />
                </Box>
              </CardContent>
            </Card>

            {selectedSite ? (
              <Card>
                <CardContent>
                  <Stack spacing={1.25}>
                    <Typography variant="overline" color="text.secondary">
                      Selected Site
                    </Typography>
                    <Typography variant="h6">{selectedSite.name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {[selectedSite.siteCode, selectedSite.region || "Unassigned"].filter(Boolean).join(" · ")}
                    </Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <AlertBadge type="critical" count={selectedSite.criticalCount || 0} onClick={() => openAlertsDialog(selectedSite, "critical")} />
                      <AlertBadge type="warning" count={selectedSite.warnCount || 0} onClick={() => openAlertsDialog(selectedSite, "warning")} />
                    </Stack>
                    <Button variant="contained" onClick={() => setMobileView("detail")}>
                      Open Site Preview
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            ) : null}
          </>
        ) : mobileView === "detail" ? (
          renderSitePreview(true)
        ) : (
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button variant={filter === FILTERS.all ? "contained" : "outlined"} onClick={() => setFilter(FILTERS.all)}>
                All
              </Button>
              <Button color="error" variant={filter === FILTERS.critical ? "contained" : "outlined"} onClick={() => setFilter(FILTERS.critical)}>
                Critical
              </Button>
              <Button color="warning" variant={filter === FILTERS.warning ? "contained" : "outlined"} onClick={() => setFilter(FILTERS.warning)}>
                Warning
              </Button>
            </Stack>

            <Stack spacing={1.5}>
              {mobileSites.map((site) => {
                const health = siteHealth(site);
                return (
                  <Card
                    key={site.id}
                    variant="outlined"
                    sx={{
                      borderColor: selectedSiteId === site.id ? "primary.main" : "divider",
                      borderWidth: selectedSiteId === site.id ? 2 : 1
                    }}
                  >
                    <CardActionArea onClick={() => {
                      setSelectedSiteId(site.id);
                      setMobileView("detail");
                    }}>
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
                          <Stack spacing={0.5}>
                            <Stack direction="row" justifyContent="space-between">
                              <Typography variant="body2">Pump Health</Typography>
                              <Typography variant="body2">{formatPercent(health)}</Typography>
                            </Stack>
                            <LinearProgress variant="determinate" value={Math.max(0, Math.min(100, health * 100))} color={statusColor(health)} sx={{ height: 10, borderRadius: 999 }} />
                          </Stack>
                          <Typography variant="caption" color="text.secondary">
                            ATG last seen: {formatDateTime(site.atgLastSeenAt)}
                          </Typography>
                        </Stack>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                );
              })}
              {!mobileSites.length ? (
                <Alert severity="info">No sites match the current alert filter.</Alert>
              ) : null}
            </Stack>
          </Stack>
          )}
        </Stack>
        <SiteAlertsDialog
          open={alertsDialog.open}
          onClose={() => setAlertsDialog({ open: false, severity: "", siteId: "", siteName: "" })}
          siteId={alertsDialog.siteId}
          siteName={alertsDialog.siteName}
          severity={alertsDialog.severity}
        />
      </>
    );
  }

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} justifyContent="space-between" alignItems={{ xs: "flex-start", md: "center" }}>
        <div>
          <Typography variant="h4">Portfolio Command Center</Typography>
          <Typography color="text.secondary">
            Dense, responsive operations view for the parallel MUI frontend. This is the track to bring the current portfolio into a more polished desktop and mobile layout.
          </Typography>
        </div>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          <TextField
            select
            size="small"
            label="Filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value={FILTERS.all}>All sites</MenuItem>
            <MenuItem value={FILTERS.critical}>Critical only</MenuItem>
            <MenuItem value={FILTERS.warning}>Warning only</MenuItem>
          </TextField>
          <Chip color="primary" label={`Visible sites: ${filteredSites.length}`} />
        </Stack>
      </Stack>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <SummaryCard
            icon={<FlashOnIcon sx={{ color: "#d14343" }} />}
            label="Critical Alerts"
            value={renderAlertSiteMetric(totals.critical, affectedSiteCounts.critical)}
            tone="critical"
            caption="alerts / sites"
            onClick={() => {
              setFilter(FILTERS.critical);
              setSelectedSiteId("");
            }}
            active={filter === FILTERS.critical}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <SummaryCard
            icon={<WarningAmberIcon sx={{ color: "#c77700" }} />}
            label="Warning Alerts"
            value={renderAlertSiteMetric(totals.warning, affectedSiteCounts.warning)}
            tone="warning"
            caption="alerts / sites"
            onClick={() => {
              setFilter(FILTERS.warning);
              setSelectedSiteId("");
            }}
            active={filter === FILTERS.warning}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <SummaryCard
            icon={<RouterIcon color={statusColor(networkHealth)} />}
            label="Pump Connectivity"
            value={formatPercent(networkHealth)}
            tone={statusColor(networkHealth) === "success" ? "success" : statusColor(networkHealth) === "warning" ? "warning" : "critical"}
            caption={`${totals.connected}/${totals.expected} connected pump sides`}
            onClick={() => {
              setFilter(FILTERS.all);
              setSelectedSiteId(connectivityFeed[0]?.id || "");
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <SummaryCard
            icon={<OilBarrelIcon color="primary" />}
            label="ATG Reporting"
            value={`${totals.atgReporting}/${sites.length}`}
            caption="Sites with an ATG heartbeat recorded"
            onClick={() => {
              setFilter(FILTERS.all);
              setSelectedSiteId("");
            }}
            active={filter === FILTERS.all}
          />
        </Grid>
      </Grid>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, xl: 8 }}>
          <Card sx={{ mb: 2.5, overflow: "hidden" }}>
            <CardContent sx={{ p: 0 }}>
              <Box sx={{ p: 2.5, pb: 1.5 }}>
                <Typography variant="h6">Portfolio Map</Typography>
                <Typography color="text.secondary">
                  Map-first overview of the visible site portfolio. Select a site from the map or table to focus the right-side detail panel.
                </Typography>
              </Box>
              <Box sx={{ height: { xs: 280, md: 360, xl: 420 }, borderTop: "1px solid rgba(15, 23, 42, 0.08)" }}>
                <SiteMap sites={filteredSites} selectedSiteId={selectedSiteId} onSelect={(site) => setSelectedSiteId(site.id)} />
              </Box>
            </CardContent>
          </Card>

          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Stack spacing={2.5}>
                <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={2}>
                  <div>
                    <Typography variant="h6">Site Directory</Typography>
                    <Typography color="text.secondary">
                      Operations summary, connectivity, and alert posture across the portfolio.
                    </Typography>
                  </div>
                  <TextField
                    select
                    size="small"
                    label="Focused site"
                    value={selectedSiteId}
                    onChange={(event) => setSelectedSiteId(event.target.value)}
                    sx={{ minWidth: { xs: "100%", md: 260 } }}
                  >
                    <MenuItem value="">None selected</MenuItem>
                    {filteredSites.map((site) => (
                      <MenuItem key={site.id} value={site.id}>{site.siteCode} - {site.name}</MenuItem>
                    ))}
                  </TextField>
                </Stack>
                {isMobile ? (
                  <Stack spacing={1.5}>
                    {filteredSites.map((site) => {
                      const health = siteHealth(site);
                      return (
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
                                <Stack direction="row" justifyContent="space-between" spacing={1}>
                                  <div>
                                    <Typography fontWeight={700}>{site.name}</Typography>
                                    <Typography variant="caption" color="text.secondary">
                                      {site.siteCode} · {site.region || "Unassigned"}
                                    </Typography>
                                  </div>
                                  <Stack direction="row" spacing={0.75}>
                                    <Chip size="small" color="error" variant="outlined" label={`C ${site.criticalCount || 0}`} />
                                    <Chip size="small" color="warning" variant="outlined" label={`W ${site.warnCount || 0}`} />
                                  </Stack>
                                </Stack>
                                <Typography variant="body2" color="text.secondary">
                                  {[site.address, site.postalCode].filter(Boolean).join(" ") || "No address"}
                                </Typography>
                                <Stack spacing={0.5}>
                                  <Stack direction="row" justifyContent="space-between">
                                    <Typography variant="body2">Pump Health</Typography>
                                    <Typography variant="body2">{formatPercent(health)}</Typography>
                                  </Stack>
                                  <LinearProgress variant="determinate" value={Math.max(0, Math.min(100, health * 100))} color={statusColor(health)} sx={{ height: 10, borderRadius: 999 }} />
                                </Stack>
                                <Typography variant="caption" color="text.secondary">
                                  ATG last seen: {formatDateTime(site.atgLastSeenAt)}
                                </Typography>
                              </Stack>
                            </CardContent>
                          </CardActionArea>
                        </Card>
                      );
                    })}
                  </Stack>
                ) : (
                  <TanStackDataTable
                    rows={siteTableRows}
                    columns={siteTableColumns}
                    globalSearchPlaceholder="Search sites..."
                    initialPageSize={10}
                    getRowId={(row) => row.id}
                    isRowSelected={(row) => selectedSiteId === row.id}
                    onRowClick={(row) => setSelectedSiteId(row.id)}
                  />
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, xl: 4 }}>
          <Stack spacing={2.5}>
            {renderSitePreview(false)}

            <Card>
              <CardContent>
                <Stack spacing={1.5}>
                  <Typography variant="h6">Operations Snapshot</Typography>
                  {selectedSite ? (
                    <>
                      <Stack direction="row" justifyContent="space-between">
                        <Typography variant="body2" color="text.secondary">Alert load</Typography>
                        <Typography variant="body2">{Number(selectedSite.criticalCount || 0) + Number(selectedSite.warnCount || 0)} open</Typography>
                      </Stack>
                      <LinearProgress
                        variant="determinate"
                        value={Math.max(0, Math.min(100, ((Number(selectedSite.criticalCount || 0) * 20) + (Number(selectedSite.warnCount || 0) * 10))))}
                        color={Number(selectedSite.criticalCount || 0) > 0 ? "error" : Number(selectedSite.warnCount || 0) > 0 ? "warning" : "success"}
                        sx={{ height: 10, borderRadius: 999 }}
                      />
                      <Stack direction="row" justifyContent="space-between">
                        <Typography variant="body2" color="text.secondary">Pump network</Typography>
                        <Typography variant="body2">{selectedSite.pumpSidesConnected || 0}/{selectedSite.pumpSidesExpected || 0}</Typography>
                      </Stack>
                      <LinearProgress
                        variant="determinate"
                        value={Math.max(0, Math.min(100, siteHealth(selectedSite) * 100))}
                        color={statusColor(siteHealth(selectedSite))}
                        sx={{ height: 10, borderRadius: 999 }}
                      />
                      <Typography variant="caption" color="text.secondary">
                        Use this panel for quick operational triage before opening the full site screen.
                      </Typography>
                    </>
                  ) : (
                    <Typography color="text.secondary">
                      Select a site to see a quick operational snapshot.
                    </Typography>
                  )}
                </Stack>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Stack spacing={1.5}>
                  <Typography variant="h6">Local Agent Console</Typography>
                  <Box
                    sx={{
                      borderRadius: 2,
                      bgcolor: "#09111f",
                      color: "#d3e6ff",
                      px: 2,
                      py: 1.5,
                      fontFamily: "Consolas, 'Courier New', monospace",
                      minHeight: 180
                    }}
                  >
                    {agentLog.length ? agentLog.map((line, index) => (
                      <Typography key={`${selectedSiteId || "none"}-${index}`} variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                        {line || "\u00A0"}
                      </Typography>
                    )) : (
                      <Typography variant="body2">Select a site to start a local site console session.</Typography>
                    )}
                  </Box>
                  <Box component="form" onSubmit={submitAgentPrompt}>
                    <TextareaAutosize
                      minRows={2}
                      value={agentDraft}
                      onChange={(event) => setAgentDraft(event.target.value)}
                      placeholder={selectedSite ? `Ask the local AI agent about ${selectedSite.siteCode}` : "Select a site first"}
                      style={{
                        width: "100%",
                        resize: "vertical",
                        borderRadius: 12,
                        border: "1px solid rgba(15, 23, 42, 0.16)",
                        padding: "12px 14px",
                        fontFamily: "inherit"
                      }}
                    />
                    <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
                      <Button type="submit" variant="contained" disabled={!selectedSite || !agentDraft.trim()}>
                        Send Prompt
                      </Button>
                    </Stack>
                  </Box>
                </Stack>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Stack spacing={1.5}>
                  <Typography variant="h6">Top Attention Sites</Typography>
                  <List disablePadding>
                    {attentionFeed.map((site) => (
                      <ListItem
                        key={site.id}
                        disablePadding
                        secondaryAction={<Chip size="small" color={Number(site.criticalCount || 0) > 0 ? "error" : "warning"} label={`${Number(site.criticalCount || 0) + Number(site.warnCount || 0)} alerts`} />}
                        sx={{ py: 0.75 }}
                      >
                        <ListItemText
                          primary={site.name}
                          secondary={`${site.siteCode} · ${site.region || "Unassigned"}`}
                        />
                      </ListItem>
                    ))}
                  </List>
                </Stack>
              </CardContent>
            </Card>
          </Stack>
        </Grid>
      </Grid>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">Connectivity Watchlist</Typography>
                <Typography color="text.secondary">
                  Lowest pump-side connection ratios in the currently visible portfolio.
                </Typography>
                {connectivityFeed.map((site) => {
                  const health = siteHealth(site);
                  return (
                    <Box key={site.id}>
                      <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                        <Typography fontWeight={600}>{site.name}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {site.pumpSidesConnected || 0}/{site.pumpSidesExpected || 0}
                        </Typography>
                      </Stack>
                      <LinearProgress variant="determinate" value={Math.max(0, Math.min(100, health * 100))} color={statusColor(health)} sx={{ height: 10, borderRadius: 999 }} />
                    </Box>
                  );
                })}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, lg: 6 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">Regional Rollup</Typography>
                <Typography color="text.secondary">
                  Region-level alert counts and connectivity posture for quick management review.
                </Typography>
                {isMobile ? (
                  <Stack spacing={1.25}>
                    {regionRows.map((row) => (
                      <Card key={row.region} variant="outlined">
                        <CardContent>
                          <Stack spacing={1}>
                            <Stack direction="row" justifyContent="space-between" spacing={1}>
                              <Typography fontWeight={700}>{row.region}</Typography>
                              <Chip size="small" label={`${row.sites} sites`} />
                            </Stack>
                            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                              <Chip size="small" color="error" variant="outlined" label={`Critical ${row.critical}`} />
                              <Chip size="small" color="warning" variant="outlined" label={`Warn ${row.warning}`} />
                              <Chip size="small" color={statusColor(row.health)} variant="outlined" label={`Health ${formatPercent(row.health)}`} />
                            </Stack>
                          </Stack>
                        </CardContent>
                      </Card>
                    ))}
                  </Stack>
                ) : (
                  <TanStackDataTable rows={regionRows} columns={regionTableColumns} globalSearchPlaceholder="Search regions..." initialPageSize={8} />
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, md: 4 }}>
          <SummaryCard
            icon={<PaymentsIcon color="primary" />}
            label="Allied Sales (30D)"
            value={alliedSummary ? formatMoney(alliedSummary.kpis.totalSales) : "--"}
            caption={alliedSummary ? `${alliedSummary.kpis.totalTransactions} transactions across ${alliedSummary.kpis.sitesWithTransactions} active sites` : "Allied summary pending"}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <SummaryCard
            icon={<PaymentsIcon color="primary" />}
            label="Completion Rate (30D)"
            value={alliedSummary ? formatPercent(alliedSummary.kpis.completionRate) : "--"}
            caption={alliedSummary ? `Abort rate ${formatPercent(alliedSummary.kpis.abortRate)}` : "Allied summary pending"}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <SummaryCard
            icon={<PaymentsIcon color="primary" />}
            label="Flagged Rate (30D)"
            value={alliedSummary ? formatPercent(alliedSummary.kpis.flaggedRate) : "--"}
            caption={alliedSummary ? `Gallons ${Number(alliedSummary.kpis.totalGallons || 0).toFixed(1)}` : "Allied summary pending"}
          />
        </Grid>
      </Grid>

      {alliedError ? <Alert severity="info">{alliedError}</Alert> : null}

      <Card>
        <CardContent>
          <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={2}>
            <div>
              <Typography variant="h6">Migration Notes</Typography>
              <Typography color="text.secondary">
                This page is the target shell for reproducing the current portfolio with a more professional MUI system. Next sensible additions are a portfolio map panel, work-queue snapshots, and embedded chart widgets.
              </Typography>
            </div>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
              <Button variant="outlined" onClick={() => setSelectedSiteId("")}>Clear Focus</Button>
              <Button variant="contained" onClick={() => window.location.reload()}>Refresh Dashboard</Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
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
