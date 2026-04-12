import { startTransition, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  LinearProgress,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import LocalGasStationIcon from "@mui/icons-material/LocalGasStation";
import ShowChartIcon from "@mui/icons-material/ShowChart";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { api } from "../api";
import benchmarkPrices from "../../../web/src/pricing/data/benchmarkPrices.json";
import inventoryTrends from "../../../web/src/pricing/data/inventoryTrends.json";
import forwardCurves from "../../../web/src/pricing/data/forwardCurves.json";
import narrativeDrivers from "../../../web/src/pricing/data/narrativeDrivers.json";
import {
  buildBenchmarkCards,
  buildInsightSummary,
  buildInventoryCards,
  buildPriceHistory,
  filterPriceHistory,
  formatDateLabel,
  formatValue,
  getCurveStructure,
  getSeriesColor
} from "../../../web/src/pricing/utils/marketCalculations.ts";

const HISTORY_OPTIONS = ["7D", "30D", "90D", "1Y"];
const MOBILE_TABS = [
  { value: "overview", label: "Overview" },
  { value: "monitor", label: "Monitor" },
  { value: "outlook", label: "Outlook" }
];

function formatDateTime(value) {
  if (!value) return "n/a";
  return new Date(value).toLocaleString();
}

function loadFallbackDashboard() {
  const fallbackBenchmarks = benchmarkPrices.benchmarks || [];
  const fallbackInventory = inventoryTrends.series || [];
  const curveSeries = forwardCurves.curves || [];
  const drivers = narrativeDrivers;
  const priceHistory = buildPriceHistory(fallbackBenchmarks);
  const benchmarkCards = [
    ...buildBenchmarkCards(
      fallbackBenchmarks.filter((item) =>
        ["wti", "brent", "regular", "midgrade", "premium", "diesel"].includes(item.key)
      )
    ),
    ...buildInventoryCards(fallbackInventory)
  ];

  return {
    lastUpdated: benchmarkPrices.lastUpdated,
    sourceBadges: benchmarkPrices.sourceBadges || [],
    priceHistory,
    benchmarkCards,
    inventorySeries: fallbackInventory,
    forwardCurves: curveSeries,
    insightSummary: buildInsightSummary(benchmarkCards, fallbackInventory, curveSeries, drivers),
    sourceCoverage: drivers.sourceCoverage || [],
    warnings: []
  };
}

function warningMessageFor(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (message.includes("Secret encryption key is missing")) {
    return "Live EIA data is unavailable because the server encryption key is missing.";
  }
  if (message.includes("Unsupported state or unable to authenticate data")) {
    return "Live EIA data is unavailable because the configured jobber credentials could not be authenticated.";
  }
  if (message.includes("EIA_API_KEY is missing")) {
    return "Live EIA data is unavailable because no EIA key is configured for the active jobber.";
  }
  return "Live market data is unavailable, so the page is showing fallback pricing data.";
}

function statusTone(value) {
  if (value > 0) return "success.main";
  if (value < 0) return "error.main";
  return "text.secondary";
}

function structureTone(structure) {
  if (structure === "Backwardation") return "warning";
  if (structure === "Contango") return "info";
  return "default";
}

function SimpleTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <Box
      sx={{
        bgcolor: "background.paper",
        border: "1px solid rgba(15, 23, 42, 0.1)",
        borderRadius: 2,
        px: 1.5,
        py: 1.25,
        boxShadow: "0 10px 24px rgba(15, 23, 42, 0.12)"
      }}
    >
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      {payload.map((entry) => (
        <Typography key={entry.dataKey} variant="body2" sx={{ color: entry.color || "text.primary" }}>
          {entry.name}: {formatter ? formatter(entry.value, entry.name) : entry.value}
        </Typography>
      ))}
    </Box>
  );
}

function KpiCard({ card }) {
  const regionEntries = Object.entries(card.regionalSeries || {});
  const [selectedRegion, setSelectedRegion] = useState(card.defaultRegion || regionEntries[0]?.[0] || "");
  const regional = selectedRegion ? card.regionalSeries?.[selectedRegion] : null;
  const currentValue = regional ? regional.current : card.currentValue;
  const dailyChange = regional ? regional.current - regional.dayAgo : card.dailyChange;
  const weeklyChange = regional ? regional.current - regional.weekAgo : card.weeklyChange;
  const sparkline = regional ? regional.sparkline : card.sparkline;
  const historyAnchors = regional?.historyAnchors || card.historyAnchors || [];

  const chartData = sparkline.map((value, index) => ({
    label: historyAnchors[index]?.date ? formatDateLabel(historyAnchors[index].date) : `P${index + 1}`,
    value
  }));

  return (
    <Card sx={{ height: "100%" }}>
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1.5}>
            <Box>
              <Typography variant="body2" color="text.secondary">
                {card.label}
              </Typography>
              <Typography variant="h5" sx={{ mt: 0.5 }}>
                {formatValue(currentValue, card.unit)}
              </Typography>
            </Box>
            <Chip
              size="small"
              color={weeklyChange > 0 ? "warning" : weeklyChange < 0 ? "success" : "default"}
              label={card.status}
              variant="outlined"
            />
          </Stack>

          {regionEntries.length ? (
            <TextField
              select
              size="small"
              label="Region"
              value={selectedRegion}
              onChange={(event) => setSelectedRegion(event.target.value)}
            >
              {regionEntries.map(([key, item]) => (
                <MenuItem key={key} value={key}>
                  {item.label}
                </MenuItem>
              ))}
            </TextField>
          ) : null}

          <Stack direction="row" spacing={2}>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Daily
              </Typography>
              <Typography variant="body2" sx={{ color: statusTone(dailyChange), fontWeight: 700 }}>
                {dailyChange > 0 ? "+" : ""}
                {formatValue(dailyChange, card.unit)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Weekly
              </Typography>
              <Typography variant="body2" sx={{ color: statusTone(weeklyChange), fontWeight: 700 }}>
                {weeklyChange > 0 ? "+" : ""}
                {formatValue(weeklyChange, card.unit)}
              </Typography>
            </Box>
          </Stack>

          <Box sx={{ height: 72 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <Tooltip content={<SimpleTooltip formatter={(value) => formatValue(Number(value), card.unit)} />} />
                <Line
                  type="monotone"
                  dataKey="value"
                  dot={false}
                  stroke={getSeriesColor(card.key)}
                  strokeWidth={2.5}
                />
              </LineChart>
            </ResponsiveContainer>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

function SectionCard({ title, subtitle, action, children, minHeight }) {
  return (
    <Card sx={{ height: "100%" }}>
      <CardContent sx={{ minHeight }}>
        <Stack spacing={2.5}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", sm: "center" }}
            spacing={1.5}
          >
            <Box>
              <Typography variant="h6">{title}</Typography>
              {subtitle ? (
                <Typography color="text.secondary" variant="body2">
                  {subtitle}
                </Typography>
              ) : null}
            </Box>
            {action || null}
          </Stack>
          {children}
        </Stack>
      </CardContent>
    </Card>
  );
}

export function PricingPreviewPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [dashboard, setDashboard] = useState(loadFallbackDashboard);
  const [opisSnapshot, setOpisSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [opisLoading, setOpisLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [warnings, setWarnings] = useState([]);
  const [opisError, setOpisError] = useState("");
  const [historyRange, setHistoryRange] = useState("30D");
  const [mobileTab, setMobileTab] = useState("overview");
  const [opisFilters, setOpisFilters] = useState({
    timing: "prompt",
    state: "CA",
    fuelType: "all"
  });

  async function loadDashboard({ showRefresh = false } = {}) {
    if (showRefresh) setRefreshing(true);
    const fallback = loadFallbackDashboard();
    const nextWarnings = [];

    try {
      const liveSnapshot = await api.getPricingSnapshot();
      const benchmarkSnapshots = liveSnapshot.benchmarkSnapshots;
      const inventorySeries = liveSnapshot.inventorySeries;
      const benchmarkCards = [
        ...buildBenchmarkCards(
          benchmarkSnapshots.filter((item) =>
            ["wti", "brent", "regular", "midgrade", "premium", "diesel"].includes(item.key)
          )
        ),
        ...buildInventoryCards(inventorySeries)
      ];

      setDashboard({
        lastUpdated: liveSnapshot.lastUpdated,
        sourceBadges: benchmarkPrices.sourceBadges || [],
        priceHistory: buildPriceHistory(benchmarkSnapshots),
        benchmarkCards,
        inventorySeries,
        forwardCurves: forwardCurves.curves || [],
        insightSummary: buildInsightSummary(
          benchmarkCards,
          inventorySeries,
          forwardCurves.curves || [],
          narrativeDrivers
        ),
        sourceCoverage: narrativeDrivers.sourceCoverage || [],
        warnings: []
      });
    } catch (error) {
      nextWarnings.push(warningMessageFor(error));
      setDashboard({ ...fallback, warnings: nextWarnings });
    } finally {
      setWarnings(nextWarnings);
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function loadOpis(nextFilters = opisFilters) {
    setOpisLoading(true);
    setOpisError("");
    try {
      const payload = await api.getOpisSnapshot(nextFilters);
      setOpisSnapshot(payload);
    } catch (error) {
      setOpisSnapshot(null);
      setOpisError(error instanceof Error ? error.message : String(error || "Unable to load OPIS market monitor"));
    } finally {
      setOpisLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    loadOpis(opisFilters);
  }, []);

  const filteredHistory = useMemo(
    () => filterPriceHistory(dashboard.priceHistory || [], historyRange),
    [dashboard.priceHistory, historyRange]
  );

  const curveSummaries = useMemo(
    () => (dashboard.forwardCurves || []).map(getCurveStructure),
    [dashboard.forwardCurves]
  );

  const stateAverages = opisSnapshot?.charts?.stateAverages?.slice(0, isMobile ? 6 : 10) || [];
  const productAverages = opisSnapshot?.charts?.productAverages?.slice(0, 6) || [];
  const lowRows = opisSnapshot?.highlights?.lowest?.slice(0, isMobile ? 3 : 5) || [];
  const highRows = opisSnapshot?.highlights?.highest?.slice(0, isMobile ? 3 : 5) || [];

  function handleRefresh() {
    loadDashboard({ showRefresh: true });
    loadOpis(opisFilters);
  }

  function updateOpisFilter(key, value) {
    const nextFilters = { ...opisFilters, [key]: value };
    setOpisFilters(nextFilters);
    startTransition(() => {
      loadOpis(nextFilters);
    });
  }

  function renderOverview() {
    return (
      <Stack spacing={2.5}>
        <Grid container spacing={2.5}>
          {dashboard.benchmarkCards.map((card) => (
            <Grid key={card.key} size={{ xs: 12, sm: 6, xl: 3 }}>
              <KpiCard card={card} />
            </Grid>
          ))}
        </Grid>

        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, xl: 8 }}>
            <SectionCard
              title="Benchmarks"
              subtitle="Track crude and refined products without dropping into a dense analyst screen."
              action={
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  {HISTORY_OPTIONS.map((option) => (
                    <Chip
                      key={option}
                      label={option}
                      clickable
                      color={historyRange === option ? "primary" : "default"}
                      variant={historyRange === option ? "filled" : "outlined"}
                      onClick={() => setHistoryRange(option)}
                    />
                  ))}
                </Stack>
              }
              minHeight={420}
            >
              <Box sx={{ height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={filteredHistory}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(15, 23, 42, 0.08)" />
                    <XAxis dataKey="date" tickFormatter={formatDateLabel} minTickGap={24} />
                    <YAxis />
                    <Tooltip content={<SimpleTooltip formatter={(value) => Number(value).toFixed(2)} />} />
                    <Line type="monotone" dataKey="wti" name="WTI" stroke={getSeriesColor("wti")} dot={false} strokeWidth={2.5} />
                    <Line type="monotone" dataKey="brent" name="Brent" stroke={getSeriesColor("brent")} dot={false} strokeWidth={2.5} />
                    <Line type="monotone" dataKey="gasoline" name="RBOB" stroke={getSeriesColor("gasoline")} dot={false} strokeWidth={2.5} />
                    <Line type="monotone" dataKey="diesel" name="Diesel" stroke={getSeriesColor("diesel")} dot={false} strokeWidth={2.5} />
                  </LineChart>
                </ResponsiveContainer>
              </Box>
            </SectionCard>
          </Grid>

          <Grid size={{ xs: 12, xl: 4 }}>
            <SectionCard
              title="Market Read"
              subtitle="Shorter narrative blocks that fit the MUI command-center style."
              minHeight={420}
            >
              <Stack spacing={1.5}>
                {dashboard.insightSummary?.narrativeBullets?.map((bullet, index) => (
                  <Stack key={index} direction="row" spacing={1.25} alignItems="flex-start">
                    <TrendingUpIcon color="primary" sx={{ fontSize: 18, mt: 0.15 }} />
                    <Typography variant="body2" color="text.secondary">
                      {bullet}
                    </Typography>
                  </Stack>
                ))}
                <Divider />
                <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
                  <Chip
                    color={dashboard.insightSummary?.outlookTitle === "Tightening" ? "warning" : dashboard.insightSummary?.outlookTitle === "Loosening" ? "success" : "default"}
                    label={`Bias: ${dashboard.insightSummary?.outlookTitle || "Neutral"}`}
                  />
                  <Chip variant="outlined" label={`Confidence: ${dashboard.insightSummary?.confidence || "Medium"}`} />
                </Stack>
                {(dashboard.insightSummary?.outlookBody || []).map((paragraph, index) => (
                  <Typography key={index} variant="body2" color="text.secondary">
                    {paragraph}
                  </Typography>
                ))}
              </Stack>
            </SectionCard>
          </Grid>
        </Grid>
      </Stack>
    );
  }

  function renderMonitor() {
    return (
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: 4 }}>
          <SectionCard
            title="OPIS Market Monitor"
            subtitle="Filters collapse into one compact card on phones instead of a wide desktop form."
            action={
              <Button
                variant="contained"
                startIcon={<RefreshIcon />}
                onClick={() => loadOpis(opisFilters)}
                disabled={opisLoading}
              >
                Refresh
              </Button>
            }
          >
            <Stack spacing={1.5}>
              <Autocomplete
                size="small"
                options={opisSnapshot?.filterOptions?.timing || []}
                value={(opisSnapshot?.filterOptions?.timing || []).find((option) => option.value === opisFilters.timing) || null}
                onChange={(_event, nextOption) => updateOpisFilter("timing", nextOption?.value || "")}
                getOptionLabel={(option) => option.label}
                isOptionEqualToValue={(option, value) => option.value === value.value}
                renderInput={(params) => <TextField {...params} label="Timing" placeholder="Type timing" />}
                clearOnEscape
              />
              <Autocomplete
                size="small"
                options={opisSnapshot?.filterOptions?.states || []}
                value={(opisSnapshot?.filterOptions?.states || []).find((option) => option.value === opisFilters.state) || null}
                onChange={(_event, nextOption) => updateOpisFilter("state", nextOption?.value || "")}
                getOptionLabel={(option) => option.label}
                isOptionEqualToValue={(option, value) => option.value === value.value}
                renderInput={(params) => <TextField {...params} label="State" placeholder="Type state" />}
                clearOnEscape
              />
              <Autocomplete
                size="small"
                options={opisSnapshot?.filterOptions?.fuelTypes || []}
                value={(opisSnapshot?.filterOptions?.fuelTypes || []).find((option) => option.value === opisFilters.fuelType) || null}
                onChange={(_event, nextOption) => updateOpisFilter("fuelType", nextOption?.value || "")}
                getOptionLabel={(option) => option.label}
                isOptionEqualToValue={(option, value) => option.value === value.value}
                renderInput={(params) => <TextField {...params} label="Fuel" placeholder="Type fuel" />}
                clearOnEscape
              />
              {opisLoading ? <LinearProgress /> : null}
              {opisError ? <Alert severity="warning">{opisError}</Alert> : null}
              <Grid container spacing={1.25}>
                <Grid size={{ xs: 6 }}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="caption" color="text.secondary">Rows</Typography>
                      <Typography variant="h6">{opisSnapshot?.metrics?.rowCount ?? "--"}</Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="caption" color="text.secondary">Markets</Typography>
                      <Typography variant="h6">{opisSnapshot?.coverage?.cities ?? "--"}</Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="caption" color="text.secondary">Avg Gas</Typography>
                      <Typography variant="h6">
                        {opisSnapshot?.metrics?.gasolineAverage != null ? `$${opisSnapshot.metrics.gasolineAverage.toFixed(3)}` : "--"}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="caption" color="text.secondary">Avg Diesel</Typography>
                      <Typography variant="h6">
                        {opisSnapshot?.metrics?.dieselAverage != null ? `$${opisSnapshot.metrics.dieselAverage.toFixed(3)}` : "--"}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            </Stack>
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12, lg: 8 }}>
          <SectionCard
            title="State Averages"
            subtitle="Quick statewide spread instead of the legacy table-heavy market view."
            minHeight={420}
          >
            <Box sx={{ height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stateAverages}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(15, 23, 42, 0.08)" />
                  <XAxis dataKey="stateAbbr" />
                  <YAxis />
                  <Tooltip content={<SimpleTooltip formatter={(value) => `$${Number(value).toFixed(3)}`} />} />
                  <Bar dataKey="averagePrice" name="Average">
                    {stateAverages.map((item) => (
                      <Cell key={item.stateAbbr} fill={item.stateAbbr === opisFilters.state ? theme.palette.primary.main : "#9ab7ff"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12, lg: 6 }}>
          <SectionCard title="Lowest Markets" subtitle="Keep the shortlist scan-friendly on phones.">
            <Stack spacing={1.25}>
              {lowRows.length ? lowRows.map((row) => (
                <Card key={`low-${row.cityId}-${row.productId}`} variant="outlined">
                  <CardContent>
                    <Stack direction="row" justifyContent="space-between" spacing={1.5}>
                      <Box>
                        <Typography fontWeight={700}>{row.cityName}, {row.stateAbbr}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {row.productName}
                        </Typography>
                      </Box>
                      <Typography variant="h6">${Number(row.price || 0).toFixed(3)}</Typography>
                    </Stack>
                  </CardContent>
                </Card>
              )) : <Typography color="text.secondary">No OPIS rows available for the selected filter.</Typography>}
            </Stack>
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12, lg: 6 }}>
          <SectionCard title="Highest Markets" subtitle="Paired with the low side for faster market comparison.">
            <Stack spacing={1.25}>
              {highRows.length ? highRows.map((row) => (
                <Card key={`high-${row.cityId}-${row.productId}`} variant="outlined">
                  <CardContent>
                    <Stack direction="row" justifyContent="space-between" spacing={1.5}>
                      <Box>
                        <Typography fontWeight={700}>{row.cityName}, {row.stateAbbr}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {row.productName}
                        </Typography>
                      </Box>
                      <Typography variant="h6">${Number(row.price || 0).toFixed(3)}</Typography>
                    </Stack>
                  </CardContent>
                </Card>
              )) : <Typography color="text.secondary">No OPIS rows available for the selected filter.</Typography>}
            </Stack>
          </SectionCard>
        </Grid>
      </Grid>
    );
  }

  function renderOutlook() {
    return (
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, xl: 5 }}>
          <SectionCard title="Forward Curves" subtitle="Curve cards fit the rest of the command-center visual language.">
            <Stack spacing={1.5}>
              {curveSummaries.map((curve) => (
                <Card key={curve.market} variant="outlined">
                  <CardContent>
                    <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1.5}>
                      <Box>
                        <Typography fontWeight={700}>{curve.label}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {curve.description}
                        </Typography>
                      </Box>
                      <Stack spacing={1} alignItems={{ xs: "flex-start", sm: "flex-end" }}>
                        <Chip size="small" color={structureTone(curve.structure)} label={curve.structure} />
                        <Typography variant="body2" color="text.secondary">
                          Spread {curve.spread > 0 ? "+" : ""}{curve.spread.toFixed(3)}
                        </Typography>
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12, xl: 7 }}>
          <SectionCard title="Product Averages" subtitle="Compact ranking view for the current OPIS mix.">
            <Box sx={{ height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={productAverages} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(15, 23, 42, 0.08)" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="productName" width={110} />
                  <Tooltip content={<SimpleTooltip formatter={(value) => `$${Number(value).toFixed(3)}`} />} />
                  <Bar dataKey="averagePrice" name="Average">
                    {productAverages.map((item) => (
                      <Cell key={item.productName} fill={item.fuelType === "diesel" ? getSeriesColor("diesel") : getSeriesColor("gasoline")} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <SectionCard title="Source Coverage" subtitle="Visibility into what supports the current market read.">
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              {(dashboard.sourceCoverage || []).map((item) => (
                <Chip key={item.source} icon={<ShowChartIcon />} label={`${item.source}: ${item.description}`} variant="outlined" />
              ))}
            </Stack>
          </SectionCard>
        </Grid>
      </Grid>
    );
  }

  return (
    <Stack spacing={2.5}>
      <Card
        sx={{
          background: "linear-gradient(135deg, rgba(11,95,255,0.12) 0%, rgba(255,255,255,1) 52%, rgba(29,131,72,0.08) 100%)"
        }}
      >
        <CardContent>
          <Stack spacing={2}>
            <Stack
              direction={{ xs: "column", md: "row" }}
              justifyContent="space-between"
              alignItems={{ xs: "flex-start", md: "center" }}
              spacing={2}
            >
              <Box>
                <Typography variant="h4">Pricing Command Center</Typography>
                <Typography color="text.secondary">
                  Rebuilt to match the MUI workspace, with compact phone flows instead of the legacy pricing shell.
                </Typography>
              </Box>
              <Button
                variant="contained"
                startIcon={<RefreshIcon />}
                onClick={handleRefresh}
                disabled={refreshing}
              >
                {refreshing ? "Refreshing..." : "Refresh"}
              </Button>
            </Stack>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              {(dashboard.sourceBadges || []).map((badge) => (
                <Chip key={badge} icon={<LocalGasStationIcon />} label={badge} variant="outlined" />
              ))}
              <Chip label={`Updated ${formatDateTime(dashboard.lastUpdated)}`} color="primary" />
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {loading ? <LinearProgress /> : null}
      {(warnings.length ? warnings : dashboard.warnings || []).map((warning) => (
        <Alert key={warning} severity="warning">
          {warning}
        </Alert>
      ))}

      {isMobile ? (
        <>
          <Tabs
            value={mobileTab}
            onChange={(_event, value) => setMobileTab(value)}
            variant="fullWidth"
            sx={{ bgcolor: "background.paper", borderRadius: 2 }}
          >
            {MOBILE_TABS.map((tab) => (
              <Tab key={tab.value} value={tab.value} label={tab.label} />
            ))}
          </Tabs>
          {mobileTab === "overview" ? renderOverview() : null}
          {mobileTab === "monitor" ? renderMonitor() : null}
          {mobileTab === "outlook" ? renderOutlook() : null}
        </>
      ) : (
        <Stack spacing={2.5}>
          {renderOverview()}
          {renderMonitor()}
          {renderOutlook()}
        </Stack>
      )}
    </Stack>
  );
}
