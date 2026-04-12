import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Grid,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
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
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DownloadIcon from "@mui/icons-material/Download";
import PaymentsIcon from "@mui/icons-material/Payments";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import LocalGasStationIcon from "@mui/icons-material/LocalGasStation";
import TimelineIcon from "@mui/icons-material/Timeline";
import ReactECharts from "echarts-for-react";
import { useSearchParams } from "react-router-dom";
import { flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable } from "@tanstack/react-table";
import { api, getToken } from "../api";
import { TanStackDataTable } from "../components/TanStackDataTable";

const PRESETS = [
  { label: "Today", value: "today" },
  { label: "7 Days", value: "7d" },
  { label: "30 Days", value: "30d" }
];

const TABS = ["overview", "issues", "pumps", "transactions"];
const COLORS = ["#0f5b7a", "#2e86ab", "#78b0d6", "#d6922f", "#c45b3c"];

function money(value) {
  return `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function percent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function shortDate(value, timezone) {
  if (!value) return "";
  return new Date(value).toLocaleDateString([], { timeZone: timezone || "America/New_York", month: "short", day: "numeric" });
}

function dateTime(value, timezone) {
  if (!value) return "No timestamp";
  return new Date(value).toLocaleString([], { timeZone: timezone || "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function buildParams(values) {
  const next = {};
  Object.entries(values).forEach(([key, value]) => {
    if (value !== "" && value != null) next[key] = value;
  });
  return next;
}

function Section({ title, subtitle, action, children }) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
            <Box>
              <Typography variant="h6">{title}</Typography>
              {subtitle ? <Typography color="text.secondary" variant="body2">{subtitle}</Typography> : null}
            </Box>
            {action}
          </Stack>
          {children}
        </Stack>
      </CardContent>
    </Card>
  );
}

function MetricCard({ label, value, caption, icon, onClick }) {
  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardActionArea onClick={onClick} disabled={!onClick} sx={{ height: "100%" }}>
        <CardContent>
          <Stack spacing={1.25}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="body2" color="text.secondary">{label}</Typography>
              {icon}
            </Stack>
            <Typography variant="h5">{value}</Typography>
            {caption ? <Typography variant="caption" color="text.secondary">{caption}</Typography> : null}
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

function SummaryStrip({ items }) {
  return (
    <Grid container spacing={1.25}>
      {items.map((item) => (
        <Grid key={item.label} size={{ xs: 6, md: 3 }}>
          <Paper variant="outlined" sx={{ p: 1.5, height: "100%" }}>
            <Typography variant="caption" color="text.secondary">{item.label}</Typography>
            <Typography fontWeight={700}>{item.value}</Typography>
            {item.caption ? <Typography variant="caption" color="text.secondary">{item.caption}</Typography> : null}
          </Paper>
        </Grid>
      ))}
    </Grid>
  );
}

function CompactSummaryStrip({ items }) {
  return (
    <Stack direction="row" spacing={1} sx={{ overflowX: "auto", pb: 0.5 }}>
      {items.map((item) => (
        <Paper key={item.label} variant="outlined" sx={{ p: 1.25, minWidth: 132, flex: "0 0 auto" }}>
          <Typography variant="caption" color="text.secondary">{item.label}</Typography>
          <Typography fontWeight={700}>{item.value}</Typography>
          {item.caption ? <Typography variant="caption" color="text.secondary">{item.caption}</Typography> : null}
        </Paper>
      ))}
    </Stack>
  );
}

function BarChart({ rows, title, valueKey = "count", onSelect }) {
  const option = {
    color: COLORS,
    tooltip: { trigger: "item" },
    grid: { left: 24, right: 12, top: 16, bottom: 56, containLabel: true },
    xAxis: { type: "category", data: rows.map((row) => row.label), axisLabel: { interval: 0, rotate: rows.length > 4 ? 25 : 0 } },
    yAxis: { type: "value" },
    series: [{ type: "bar", barMaxWidth: 28, data: rows.map((row, index) => ({ value: Number(row[valueKey] || 0), itemStyle: { color: COLORS[index % COLORS.length] } })) }]
  };
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>{title}</Typography>
      <ReactECharts option={option} style={{ height: 240 }} opts={{ renderer: "svg" }} onEvents={onSelect ? { click: (event) => onSelect(rows[event.dataIndex]) } : undefined} />
    </Box>
  );
}

function ChartDataTable({ rows, columns }) {
  const [sorting, setSorting] = useState([]);
  const [columnFilters, setColumnFilters] = useState([]);
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel()
  });

  return (
    <Stack spacing={1.25}>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sort = header.column.getIsSorted();
                  return (
                    <TableCell
                      key={header.id}
                      align={header.column.columnDef.meta?.align || "left"}
                      sx={{ verticalAlign: "top", minWidth: header.column.columnDef.meta?.minWidth || 120 }}
                    >
                      <Stack spacing={1}>
                        <Button
                          variant="text"
                          color="inherit"
                          onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                          sx={{ justifyContent: "flex-start", px: 0, minWidth: 0, textTransform: "none", fontWeight: 700 }}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sort === "asc" ? " ↑" : sort === "desc" ? " ↓" : ""}
                        </Button>
                        {header.column.getCanFilter() ? (
                          <TextField
                            size="small"
                            placeholder="Search"
                            value={header.column.getFilterValue() ?? ""}
                            onChange={(event) => header.column.setFilterValue(event.target.value)}
                          />
                        ) : null}
                      </Stack>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableHead>
          <TableBody>
            {table.getRowModel().rows.length ? table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} hover>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} align={cell.column.columnDef.meta?.align || "left"}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            )) : (
              <TableRow>
                <TableCell colSpan={columns.length}>
                  <Typography color="text.secondary">No matching rows.</Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}

export function AlliedPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [searchParams, setSearchParams] = useSearchParams();
  const [sites, setSites] = useState([]);
  const [portfolio, setPortfolio] = useState(null);
  const [site, setSite] = useState(null);
  const [summary, setSummary] = useState(null);
  const [transactions, setTransactions] = useState({ rows: [], total: 0 });
  const [selectedTransactionId, setSelectedTransactionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [filters, setFilters] = useState({ preset: searchParams.get("preset") || "30d", from: searchParams.get("from") || "", to: searchParams.get("to") || "" });
  const [drill, setDrill] = useState({
    fuelPositionId: searchParams.get("fuelPositionId") || "",
    paymentType: searchParams.get("paymentType") || "",
    emvStatus: searchParams.get("emvStatus") || "",
    denialReason: searchParams.get("denialReason") || "",
    minFlaggedOnly: searchParams.get("minFlaggedOnly") || ""
  });

  const siteId = searchParams.get("siteId") || "";
  const tab = TABS.includes(searchParams.get("tab")) ? searchParams.get("tab") : "overview";
  const params = useMemo(() => buildParams({ ...filters, ...drill }), [filters, drill]);
  const selectedTransaction = useMemo(() => transactions.rows.find((row) => row.id === selectedTransactionId) || null, [selectedTransactionId, transactions.rows]);

  useEffect(() => {
    const next = new URLSearchParams();
    next.set("tab", tab);
    if (siteId) next.set("siteId", siteId);
    Object.entries(filters).forEach(([key, value]) => { if (value) next.set(key, value); });
    Object.entries(drill).forEach(([key, value]) => { if (value) next.set(key, value); });
    setSearchParams(next, { replace: true });
  }, [drill, filters, setSearchParams, siteId, tab]);

  useEffect(() => {
    let ignore = false;
    async function loadPortfolio() {
      setLoading(true);
      try {
        const [siteRows, portfolioPayload] = await Promise.all([api.getSites(), api.getAlliedPortfolioSummary(buildParams(filters))]);
        if (ignore) return;
        setSites(siteRows);
        setPortfolio(portfolioPayload);
        setError("");
      } catch (nextError) {
        if (!ignore) setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to load Allied portfolio"));
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    loadPortfolio();
    return () => { ignore = true; };
  }, [filters]);

  useEffect(() => {
    if (!siteId) {
      setSite(null);
      setSummary(null);
      setTransactions({ rows: [], total: 0 });
      setSelectedTransactionId("");
      return;
    }
    let ignore = false;
    async function loadDetail() {
      setDetailLoading(true);
      try {
        const [sitePayload, summaryPayload, transactionPayload] = await Promise.all([
          api.getSite(siteId),
          api.getAlliedTransactionsSummary(siteId, params),
          api.getAlliedTransactions(siteId, { ...params, page: 1, pageSize: 12, sortBy: "timestamp", sortDir: "desc" })
        ]);
        if (ignore) return;
        setSite(sitePayload);
        setSummary(summaryPayload);
        setTransactions(transactionPayload);
        setSelectedTransactionId(transactionPayload.rows[0]?.id || "");
        setDetailError("");
      } catch (nextError) {
        if (!ignore) setDetailError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to load Allied detail"));
      } finally {
        if (!ignore) setDetailLoading(false);
      }
    }
    loadDetail();
    return () => { ignore = true; };
  }, [params, siteId]);

  const portfolioRows = portfolio?.siteSummaries || [];
  const trendRows = (summary?.trends?.byDay || []).map((row) => ({
    label: shortDate(row.date, site?.timezone),
    transactions: Number(row.transactions || 0),
    aborts: Number(row.aborts || 0),
    sales: Number(row.sales || 0)
  }));
  const issues = summary?.issues || [];
  const pumps = summary?.pumpHealth || [];
  const paymentMix = (summary?.trends?.paymentTypeMix || []).map((row) => ({ label: row.label, count: row.count }));
  const denialMix = (summary?.trends?.denialReasonDistribution || []).map((row) => ({ label: row.label, count: row.count }));
  const flaggedTransactions = Number(summary?.kpis?.suspiciousFlaggedCount || 0);
  const abortTransactions = Math.round(Number(summary?.kpis?.customerAbortRate || 0) * Number(summary?.kpis?.totalTransactions || 0));
  const topPump = pumps[0] || null;
  const topIssue = issues[0] || null;
  const renderTabSummary = (items) => (isMobile ? <CompactSummaryStrip items={items} /> : <SummaryStrip items={items} />);
  const trendColumns = useMemo(() => [
    { accessorKey: "label", header: "Day", cell: (info) => info.getValue() },
    { accessorKey: "transactions", header: "Transactions", cell: (info) => Number(info.getValue() || 0).toLocaleString(), meta: { align: "right", minWidth: 140 } },
    { accessorKey: "aborts", header: "Aborts", cell: (info) => Number(info.getValue() || 0).toLocaleString(), meta: { align: "right", minWidth: 120 } },
    { accessorKey: "sales", header: "Sales", cell: (info) => money(info.getValue()), meta: { align: "right", minWidth: 140 } }
  ], []);
  const denialColumns = useMemo(() => [
    { accessorKey: "label", header: "Denial Reason", cell: (info) => info.getValue(), meta: { minWidth: 220 } },
    { accessorKey: "count", header: "Count", cell: (info) => Number(info.getValue() || 0).toLocaleString(), meta: { align: "right", minWidth: 120 } }
  ], []);
  const paymentColumns = useMemo(() => [
    { accessorKey: "label", header: "Payment Type", cell: (info) => info.getValue(), meta: { minWidth: 220 } },
    { accessorKey: "count", header: "Count", cell: (info) => Number(info.getValue() || 0).toLocaleString(), meta: { align: "right", minWidth: 120 } }
  ], []);
  const transactionColumns = useMemo(() => [
    { accessorKey: "timestamp", header: "Time", cell: (info) => dateTime(info.getValue(), info.row.original.timezone), meta: { minWidth: 180 } },
    { accessorKey: "transactionId", header: "Transaction", cell: (info) => info.getValue(), meta: { minWidth: 140 } },
    { accessorKey: "fuelPositionId", header: "Pump", cell: (info) => info.getValue() || "-", meta: { minWidth: 90 } },
    { accessorKey: "paymentType", header: "Payment", cell: (info) => info.getValue() || "-", meta: { minWidth: 140 } },
    { accessorKey: "emvStatus", header: "Status", cell: (info) => info.getValue() || "-", meta: { minWidth: 120 } },
    { accessorKey: "totalAmount", header: "Total", cell: (info) => money(info.getValue()), meta: { align: "right", minWidth: 120 } }
  ], []);

  function setSiteId(nextSiteId, nextTab = "overview") {
    const next = new URLSearchParams(searchParams);
    next.set("siteId", nextSiteId);
    next.set("tab", nextTab);
    setSearchParams(next, { replace: false });
  }

  function clearSite() {
    setDrill({ fuelPositionId: "", paymentType: "", emvStatus: "", denialReason: "", minFlaggedOnly: "" });
    const next = new URLSearchParams(searchParams);
    next.delete("siteId");
    next.delete("fuelPositionId");
    next.delete("paymentType");
    next.delete("emvStatus");
    next.delete("denialReason");
    next.delete("minFlaggedOnly");
    setSearchParams(next, { replace: false });
  }

  function applyDrill(patch, nextTab = tab) {
    setDrill((current) => ({ ...current, ...patch }));
    const next = new URLSearchParams(searchParams);
    next.set("tab", nextTab);
    Object.entries({ ...drill, ...patch }).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    setSearchParams(next, { replace: false });
  }

  function exportCsv() {
    if (!siteId) return;
    fetch(api.getAlliedTransactionsExportUrl(siteId, params), { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((response) => {
        if (!response.ok) throw new Error("Export failed");
        return response.blob();
      })
      .then((blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `allied-${site?.siteCode || siteId}.csv`;
        link.click();
        window.URL.revokeObjectURL(url);
      })
      .catch((nextError) => setDetailError(nextError instanceof Error ? nextError.message : String(nextError || "Export failed")));
  }

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: "column", lg: "row" }} justifyContent="space-between" spacing={2}>
        <Box>
          <Typography variant="h4">Allied</Typography>
          <Typography color="text.secondary">Use portfolio selection first, then drill into one site at a time.</Typography>
        </Box>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
          <Autocomplete
            size="small"
            options={PRESETS}
            value={PRESETS.find((preset) => preset.value === filters.preset) || null}
            onChange={(_event, nextPreset) => setFilters({ preset: nextPreset?.value || "", from: "", to: "" })}
            getOptionLabel={(option) => option.label}
            isOptionEqualToValue={(option, value) => option.value === value.value}
            renderInput={(params) => <TextField {...params} label="Preset" placeholder="Type a preset" />}
            sx={{ minWidth: 180 }}
            clearOnEscape
          />
          <TextField size="small" type="date" label="From" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value, preset: "" }))} InputLabelProps={{ shrink: true }} />
          <TextField size="small" type="date" label="To" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value, preset: "" }))} InputLabelProps={{ shrink: true }} />
        </Stack>
      </Stack>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {detailError ? <Alert severity="warning">{detailError}</Alert> : null}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}><MetricCard label="Sales" value={money(portfolio?.kpis?.totalSales)} caption={`${portfolio?.kpis?.totalTransactions || 0} transactions`} icon={<PaymentsIcon color="primary" />} /></Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}><MetricCard label="Completion" value={percent(portfolio?.kpis?.completionRate)} caption={`Abort ${percent(portfolio?.kpis?.abortRate)}`} icon={<TimelineIcon color="primary" />} /></Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}><MetricCard label="Flagged Rate" value={percent(portfolio?.kpis?.flaggedRate)} caption={`${portfolio?.kpis?.sitesWithTransactions || 0} active sites`} icon={<WarningAmberIcon color="warning" />} /></Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}><MetricCard label="Gallons" value={Number(portfolio?.kpis?.totalGallons || 0).toFixed(1)} caption={`${portfolio?.kpis?.visibleSites || 0} visible sites`} icon={<LocalGasStationIcon color="primary" />} /></Grid>
      </Grid>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: siteId ? 4 : 12 }}>
          <Section title="Portfolio Sites" subtitle="Pick one site, then drill in." action={loading ? <LinearProgress sx={{ width: 120 }} /> : null}>
            {isMobile && siteId ? null : (
              <Stack spacing={1.25}>
                {portfolioRows.map((row) => (
                  <Card key={row.siteId} variant="outlined" sx={{ borderColor: siteId === row.siteId ? "primary.main" : "divider", borderWidth: siteId === row.siteId ? 2 : 1 }}>
                    <CardActionArea onClick={() => setSiteId(row.siteId)}>
                      <CardContent>
                        <Stack spacing={1}>
                          <Stack direction="row" justifyContent="space-between" spacing={1}>
                            <Box>
                              <Typography fontWeight={700}>{row.siteName}</Typography>
                              <Typography variant="caption" color="text.secondary">{row.siteCode} | {row.region || "Unassigned"}</Typography>
                            </Box>
                            <Chip size="small" label={`${row.totalTransactions || 0} txns`} color={siteId === row.siteId ? "primary" : "default"} />
                          </Stack>
                          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                            <Chip size="small" variant="outlined" label={money(row.totalSales)} />
                            <Chip size="small" variant="outlined" label={percent(row.completionRate)} />
                            <Chip size="small" variant="outlined" label={`${row.flaggedCount || 0} flagged`} />
                          </Stack>
                          {isMobile ? null : <Typography variant="caption" color="text.secondary">Top denial: {row.topDenialReason || "None"}</Typography>}
                        </Stack>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                ))}
              </Stack>
            )}
          </Section>
        </Grid>

        {siteId ? (
          <Grid size={{ xs: 12, lg: 8 }}>
            <Stack spacing={2.5}>
              <Section
                title={`${site?.siteCode || "Site"} - ${site?.name || site?.siteName || ""}`}
                subtitle={site?.address || "Focused site analysis"}
                action={<Stack direction="row" spacing={1}>{isMobile ? <IconButton onClick={clearSite}><ArrowBackIcon /></IconButton> : null}<Button variant="outlined" startIcon={<DownloadIcon />} onClick={exportCsv}>Export</Button></Stack>}
              >
                {detailLoading ? <LinearProgress /> : null}
                <Grid container spacing={1.5}>
                  <Grid size={{ xs: 6, md: 3 }}><MetricCard label="Transactions" value={Number(summary?.kpis?.totalTransactions || 0).toLocaleString()} icon={<PaymentsIcon color="primary" />} /></Grid>
                  <Grid size={{ xs: 6, md: 3 }}><MetricCard label="Sales" value={money(summary?.kpis?.totalSales)} icon={<PaymentsIcon color="primary" />} /></Grid>
                  <Grid size={{ xs: 6, md: 3 }}><MetricCard label="Completion" value={percent(summary?.kpis?.completionRate)} icon={<TimelineIcon color="primary" />} /></Grid>
                  <Grid size={{ xs: 6, md: 3 }}><MetricCard label="Flagged" value={Number(summary?.kpis?.suspiciousFlaggedCount || 0).toLocaleString()} caption={percent(summary?.kpis?.flaggedRate)} icon={<WarningAmberIcon color="warning" />} onClick={() => applyDrill({ minFlaggedOnly: "true" }, "issues")} /></Grid>
                </Grid>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {Object.entries(drill).filter(([, value]) => value).map(([key, value]) => <Chip key={key} label={`${key}: ${value}`} onDelete={() => applyDrill({ [key]: "" })} />)}
                </Stack>
                <Tabs value={tab} onChange={(_event, value) => setSiteId(siteId, value)} variant={isMobile ? "scrollable" : "standard"} allowScrollButtonsMobile>
                  {TABS.map((value) => <Tab key={value} label={value} value={value} />)}
                </Tabs>
              </Section>

              {tab === "overview" ? (
                <Stack spacing={2.5}>
                  <Section title="Overview Summary" subtitle="Short read first, deeper trend below.">
                    {renderTabSummary([
                      { label: "Avg Ticket", value: money(summary?.kpis?.averageTicket) },
                      { label: "Gal / Sale", value: Number(summary?.kpis?.averageGallonsPerSale || 0).toFixed(2) },
                      { label: "Aborts", value: abortTransactions.toLocaleString(), caption: percent(summary?.kpis?.customerAbortRate) },
                      { label: "Top Issue", value: topIssue?.title || "None", caption: topIssue ? `${topIssue.count || 0} rows` : "" }
                    ])}
                  </Section>
                  <Section title="Trend" subtitle="Transactions, aborts, and sales for the selected window.">
                    <BarChart rows={trendRows} title="Daily Transactions" valueKey="transactions" />
                    <TanStackDataTable rows={trendRows} columns={trendColumns} globalSearchPlaceholder="Search trend rows..." initialPageSize={5} />
                  </Section>
                </Stack>
              ) : null}

              {tab === "issues" ? (
                <Stack spacing={2.5}>
                  <Section title="Issue Summary" subtitle="Current issue posture before the queue.">
                    {renderTabSummary([
                      { label: "Issues", value: issues.length.toLocaleString() },
                      { label: "Flagged", value: flaggedTransactions.toLocaleString(), caption: percent(summary?.kpis?.flaggedRate) },
                      { label: "Top Denial", value: denialMix[0]?.label || "None", caption: denialMix[0] ? `${denialMix[0].count} rows` : "" },
                      { label: "Focus", value: drill.denialReason || drill.emvStatus || (drill.minFlaggedOnly ? "Flagged" : "All") }
                    ])}
                  </Section>
                  <Grid container spacing={2.5}>
                    <Grid size={{ xs: 12, xl: 6 }}>
                      <Section title="Issue Queue" subtitle="Tap an issue to jump into filtered transactions.">
                        <Stack spacing={1.25}>
                          {issues.length ? issues.map((issue) => (
                            <Card key={issue.id} variant="outlined" sx={{ borderColor: issue.severity === "critical" ? "error.main" : "warning.main" }}>
                              <CardActionArea onClick={() => applyDrill(issue.filters || {}, "transactions")}>
                                <CardContent>
                                  <Stack spacing={1}>
                                    <Typography fontWeight={700}>{issue.title}</Typography>
                                    <Typography variant="body2" color="text.secondary">{issue.reason}</Typography>
                                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                      <Chip size="small" color={issue.severity === "critical" ? "error" : "warning"} label={issue.severity} />
                                      <Chip size="small" variant="outlined" label={`${issue.count || 0} rows`} />
                                    </Stack>
                                  </Stack>
                                </CardContent>
                              </CardActionArea>
                            </Card>
                          )) : <Typography color="text.secondary">No issue flags in the current filter.</Typography>}
                        </Stack>
                      </Section>
                    </Grid>
                    <Grid size={{ xs: 12, xl: 6 }}>
                      <Section title="Denial Mix" subtitle="Tap a denial reason to narrow the transaction list.">
                        <BarChart rows={denialMix} title="Denial Reasons" onSelect={(row) => applyDrill({ denialReason: row.label }, "transactions")} />
                        <TanStackDataTable rows={denialMix} columns={denialColumns} globalSearchPlaceholder="Search denial rows..." initialPageSize={5} />
                      </Section>
                    </Grid>
                  </Grid>
                </Stack>
              ) : null}

              {tab === "pumps" ? (
                <Stack spacing={2.5}>
                  <Section title="Pump Summary" subtitle="Current pump posture before the list.">
                    {renderTabSummary([
                      { label: "Pumps", value: pumps.length.toLocaleString() },
                      { label: "Top Pump", value: topPump ? `Pump ${topPump.fuelPositionId}` : "None", caption: topPump ? `${topPump.transactions || 0} txns` : "" },
                      { label: "Top Rate", value: topPump ? percent(topPump.completionRate) : "-" },
                      { label: "Filter", value: drill.fuelPositionId ? `Pump ${drill.fuelPositionId}` : "All" }
                    ])}
                  </Section>
                  <Grid container spacing={2.5}>
                    <Grid size={{ xs: 12, xl: 5 }}>
                      <Section title="Pump Health" subtitle="Select a pump to narrow all transaction detail.">
                        <Stack spacing={1.25}>
                          {pumps.slice(0, 12).map((pump) => (
                            <Card key={pump.fuelPositionId} variant="outlined" sx={{ borderColor: drill.fuelPositionId === pump.fuelPositionId ? "primary.main" : "divider", borderWidth: drill.fuelPositionId === pump.fuelPositionId ? 2 : 1 }}>
                              <CardActionArea onClick={() => applyDrill({ fuelPositionId: pump.fuelPositionId }, "transactions")}>
                                <CardContent>
                                  <Stack direction="row" justifyContent="space-between">
                                    <Typography fontWeight={700}>Pump {pump.fuelPositionId}</Typography>
                                    <Chip size="small" label={percent(pump.completionRate)} />
                                  </Stack>
                                  <Typography variant="body2" color="text.secondary">{pump.transactions || 0} txns | {pump.aborts || 0} aborts | {pump.flaggedCount || 0} flagged</Typography>
                                </CardContent>
                              </CardActionArea>
                            </Card>
                          ))}
                        </Stack>
                      </Section>
                    </Grid>
                    <Grid size={{ xs: 12, xl: 7 }}>
                      <Section title="Payment Mix" subtitle="Tap a payment type to narrow the list.">
                        <BarChart rows={paymentMix} title="Payment Types" onSelect={(row) => applyDrill({ paymentType: row.label }, "transactions")} />
                        <TanStackDataTable rows={paymentMix} columns={paymentColumns} globalSearchPlaceholder="Search payment rows..." initialPageSize={5} />
                      </Section>
                    </Grid>
                  </Grid>
                </Stack>
              ) : null}

              {tab === "transactions" ? (
                <Stack spacing={2.5}>
                  <Section title="Transaction Summary" subtitle="Current slice before the list.">
                    {renderTabSummary([
                      { label: "Rows", value: (transactions.total || 0).toLocaleString() },
                      { label: "Payment", value: drill.paymentType || "All" },
                      { label: "EMV", value: drill.emvStatus || "All" },
                      { label: "Selected", value: selectedTransaction ? selectedTransaction.transactionId : "None" }
                    ])}
                  </Section>
                  <Grid container spacing={2.5}>
                    <Grid size={{ xs: 12, xl: 4 }}>
                      <Section title="Quick Filters" subtitle="Keep phone filtering compact.">
                        <Stack spacing={1.25}>
                          <Autocomplete
                            size="small"
                            options={summary?.filterOptions?.paymentTypes || []}
                            value={drill.paymentType || null}
                            onChange={(_event, nextValue) => applyDrill({ paymentType: nextValue || "" })}
                            renderInput={(params) => <TextField {...params} label="Payment Type" placeholder="Type a payment type" />}
                            clearOnEscape
                          />
                          <Autocomplete
                            size="small"
                            options={summary?.filterOptions?.emvStatuses || []}
                            value={drill.emvStatus || null}
                            onChange={(_event, nextValue) => applyDrill({ emvStatus: nextValue || "" })}
                            renderInput={(params) => <TextField {...params} label="EMV Status" placeholder="Type a status" />}
                            clearOnEscape
                          />
                          <Button variant="outlined" onClick={() => setDrill({ fuelPositionId: "", paymentType: "", emvStatus: "", denialReason: "", minFlaggedOnly: "" })}>Reset Drill Filters</Button>
                        </Stack>
                      </Section>
                    </Grid>
                    <Grid size={{ xs: 12, xl: 8 }}>
                      <Section title="Recent Transactions" subtitle={`${transactions.total || 0} rows in current filter`}>
                        {isMobile ? (
                          <Stack spacing={1.25}>
                            {transactions.rows.map((row) => (
                              <Card key={row.id} variant="outlined" sx={{ borderColor: selectedTransactionId === row.id ? "primary.main" : "divider", borderWidth: selectedTransactionId === row.id ? 2 : 1 }}>
                                <CardActionArea onClick={() => setSelectedTransactionId(row.id)}>
                                  <CardContent>
                                    <Stack spacing={1}>
                                      <Stack direction="row" justifyContent="space-between" spacing={1}>
                                        <Box>
                                          <Typography fontWeight={700}>{row.transactionId}</Typography>
                                          <Typography variant="caption" color="text.secondary">{dateTime(row.timestamp, row.timezone)}</Typography>
                                        </Box>
                                        <Chip size="small" label={row.emvStatus || "-"} color={row.flagged ? "error" : "default"} />
                                      </Stack>
                                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                        <Chip size="small" variant="outlined" label={money(row.totalAmount)} />
                                        <Chip size="small" variant="outlined" label={`${Number(row.fuelQuantityGallons || 0).toFixed(2)} gal`} />
                                        <Chip size="small" variant="outlined" label={`Pump ${row.fuelPositionId || "-"}`} />
                                      </Stack>
                                    </Stack>
                                  </CardContent>
                                </CardActionArea>
                              </Card>
                            ))}
                          </Stack>
                        ) : (
                          <TanStackDataTable rows={transactions.rows} columns={transactionColumns} globalSearchPlaceholder="Search transactions..." initialPageSize={10} />
                        )}
                      </Section>
                    </Grid>
                  </Grid>
                </Stack>
              ) : null}

              {selectedTransaction ? (
                <Section title="Selected Transaction" subtitle="Focused detail after one tap.">
                  <Grid container spacing={1.5}>
                    {[
                      ["Timestamp", dateTime(selectedTransaction.timestamp, selectedTransaction.timezone)],
                      ["Transaction ID", selectedTransaction.transactionId],
                      ["Pump", selectedTransaction.fuelPositionId || "-"],
                      ["Payment", selectedTransaction.paymentType || "-"],
                      ["Card", selectedTransaction.cardName || selectedTransaction.cardType || "-"],
                      ["Entry", selectedTransaction.entryMethod || "-"],
                      ["EMV", selectedTransaction.emvStatus || "-"],
                      ["Total", money(selectedTransaction.totalAmount)],
                      ["Gallons", Number(selectedTransaction.fuelQuantityGallons || 0).toFixed(3)],
                      ["Denial", selectedTransaction.tagDenialReason || "-"],
                      ["Flagged", selectedTransaction.flagged ? "Yes" : "No"],
                      ["Auth Diff", selectedTransaction.derivedChecks?.authSaleDifference == null ? "-" : money(selectedTransaction.derivedChecks.authSaleDifference)]
                    ].map(([label, value]) => (
                      <Grid key={label} size={{ xs: 6, md: 3 }}>
                        <Paper variant="outlined" sx={{ p: 1.5, height: "100%" }}>
                          <Typography variant="caption" color="text.secondary">{label}</Typography>
                          <Typography fontWeight={700}>{value}</Typography>
                        </Paper>
                      </Grid>
                    ))}
                  </Grid>
                </Section>
              ) : null}
            </Stack>
          </Grid>
        ) : null}
      </Grid>
    </Stack>
  );
}
