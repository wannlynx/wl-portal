import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Autocomplete,
  Collapse,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  LinearProgress,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useMediaQuery
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import PrintIcon from "@mui/icons-material/Print";
import WaterDropIcon from "@mui/icons-material/WaterDrop";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import FilterListIcon from "@mui/icons-material/FilterList";
import { api } from "../api";
import { tankLevelTone } from "../tankLimits";

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
          body { font-family: "Segoe UI", Arial, sans-serif; margin: 24px; color: #122033; }
          h1, h2 { margin: 0; color: #0b5fff; }
          .hero, .store-section { border: 1px solid #d8e2f0; border-radius: 16px; overflow: hidden; margin-bottom: 18px; }
          .hero { padding: 20px; }
          .hero-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 16px; }
          .hero-card { border: 1px solid #d8e2f0; border-radius: 12px; padding: 12px; }
          .hero-card strong, .kicker, th, .store-meta { color: #5f7088; text-transform: uppercase; letter-spacing: 0.08em; font-size: 11px; }
          .store-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 16px; background: #f7faff; border-bottom: 1px solid #d8e2f0; }
          .store-badge { border: 1px solid #d8e2f0; border-radius: 999px; padding: 6px 10px; font-size: 12px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 10px 12px; border-bottom: 1px solid #e6edf7; text-align: left; font-size: 12px; }
          .num { text-align: right; font-variant-numeric: tabular-nums; }
          .footer { color: #5f7088; font-size: 11px; }
        </style>
      </head>
      <body>
        <section class="hero">
          <div class="kicker">Tank Information Report</div>
          <h1>${escapeHtml(title)}</h1>
          <div class="hero-grid">
            <div class="hero-card"><strong>Report Scope</strong><div>${escapeHtml(scopeLabel)}</div></div>
            <div class="hero-card"><strong>Generated</strong><div>${escapeHtml(generatedAt)}</div></div>
          </div>
        </section>
        ${sections}
        <div class="footer">Latest inventory value by tank, grouped by store. Generated from local ATG inventory history.</div>
      </body>
    </html>`;
}

function MobileTankCard({ row, selected, onClick, tankLimits }) {
  const fillPercent = Number(row.fillPercent || 0);
  const progressColor = tankLevelTone(fillPercent, tankLimits, row.product);

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
                <Typography fontWeight={700}>{row.tankLabel || `Tank ${row.atgTankId || "-"}`}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {row.siteCode || "-"} • {row.product || "Unknown"}
                </Typography>
              </div>
              <Chip
                size="small"
                color={row.eventType === "delivery" ? "warning" : "default"}
                icon={row.eventType === "delivery" ? <LocalShippingIcon /> : <WaterDropIcon />}
                label={row.eventType === "delivery" ? "Refill" : "Drawdown"}
              />
            </Stack>
            <Stack spacing={0.5}>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2">Fill level</Typography>
                <Typography variant="body2" fontWeight={700}>{formatNumber(row.fillPercent, 1)}%</Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={Math.max(0, Math.min(100, fillPercent))}
                color={progressColor}
                sx={{ height: 10, borderRadius: 999 }}
              />
            </Stack>
            <Grid container spacing={1}>
              <Grid size={6}>
                <Typography variant="caption" color="text.secondary">Volume</Typography>
                <Typography variant="body2" fontWeight={700}>{formatNumber(row.volume, 2)} L</Typography>
              </Grid>
              <Grid size={6}>
                <Typography variant="caption" color="text.secondary">Delta</Typography>
                <Typography variant="body2" fontWeight={700}>{formatNumber(row.deltaVolume, 2)} L</Typography>
              </Grid>
              <Grid size={6}>
                <Typography variant="caption" color="text.secondary">Ullage</Typography>
                <Typography variant="body2">{formatNumber(row.ullage, 2)} L</Typography>
              </Grid>
              <Grid size={6}>
                <Typography variant="caption" color="text.secondary">Read time</Typography>
                <Typography variant="body2">{formatDateTime(row.readAt)}</Typography>
              </Grid>
            </Grid>
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

function TankDetailPanel({ row }) {
  if (!row) {
    return (
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>Tank Detail</Typography>
          <Typography color="text.secondary">
            Tap a tank card to drill into one tank without losing the compact list.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <div>
            <Typography variant="h6">{row.tankLabel || `Tank ${row.atgTankId || "-"}`}</Typography>
            <Typography color="text.secondary">
              {row.siteName || row.facilityName || "-"} • {row.siteCode || "-"}
            </Typography>
          </div>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip label={row.product || "Unknown"} />
            <Chip label={`Tank ${row.atgTankId || "-"}`} />
            <Chip label={row.eventType === "delivery" ? "Refill event" : "Pump drawdown"} color={row.eventType === "delivery" ? "warning" : "default"} />
          </Stack>
          <Grid container spacing={1.5}>
            <Grid size={6}>
              <Typography variant="caption" color="text.secondary">Volume</Typography>
              <Typography variant="body1" fontWeight={700}>{formatNumber(row.volume, 2)} L</Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="caption" color="text.secondary">Fill</Typography>
              <Typography variant="body1" fontWeight={700}>{formatNumber(row.fillPercent, 1)}%</Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="caption" color="text.secondary">Delta</Typography>
              <Typography variant="body1">{formatNumber(row.deltaVolume, 2)} L</Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="caption" color="text.secondary">Capacity</Typography>
              <Typography variant="body1">{formatNumber(row.tankCapacity, 2)} L</Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="caption" color="text.secondary">Ullage</Typography>
              <Typography variant="body1">{formatNumber(row.ullage, 2)} L</Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="caption" color="text.secondary">Safe Ullage</Typography>
              <Typography variant="body1">{formatNumber(row.safeUllage, 2)} L</Typography>
            </Grid>
          </Grid>
          <Typography variant="body2" color="text.secondary">
            Latest read: {formatDateTime(row.readAt)}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

export function TankInformationPage({ jobber }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSiteId = searchParams.get("siteId") || "";
  const initialTankId = searchParams.get("tankId") || "";
  const [sites, setSites] = useState([]);
  const [siteAssets, setSiteAssets] = useState({ tanks: [] });
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [anchorTs, setAnchorTs] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailTankId, setDetailTankId] = useState(initialTankId);
  const [mobileView, setMobileView] = useState(initialTankId ? "detail" : "list");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({
    siteId: initialSiteId,
    tankId: initialTankId,
    product: "",
    range: "5d",
    refillOnly: false
  });
  const productOptions = ["Regular", "Premium", "Diesel", "DEF", "Unknown"];
  const rangeOptions = [
    { value: "24h", label: "Last 24 Hours" },
    { value: "3d", label: "Last 3 Days" },
    { value: "5d", label: "Last 5 Days" }
  ];

  useEffect(() => {
    api.getSites().then(setSites).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    const siteIdFromUrl = searchParams.get("siteId") || "";
    const tankIdFromUrl = searchParams.get("tankId") || "";
    setFilters((current) => {
      if (current.siteId === siteIdFromUrl && current.tankId === tankIdFromUrl) return current;
      return { ...current, siteId: siteIdFromUrl, tankId: tankIdFromUrl };
    });
    setDetailTankId(tankIdFromUrl);
    setMobileView(tankIdFromUrl ? "detail" : "list");
  }, [searchParams]);

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);
    if (filters.siteId) nextParams.set("siteId", filters.siteId);
    else nextParams.delete("siteId");
    if (filters.tankId) nextParams.set("tankId", filters.tankId);
    else nextParams.delete("tankId");
    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [filters.siteId, filters.tankId, searchParams, setSearchParams]);

  useEffect(() => {
    if (!filters.siteId) {
      setSiteAssets({ tanks: [] });
      setFilters((current) => (current.tankId ? { ...current, tankId: "" } : current));
      return;
    }

    api.getSite(filters.siteId)
      .then((site) => setSiteAssets({ tanks: site.tanks || [] }))
      .catch((err) => setError(err.message));
  }, [filters.siteId]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      setLoading(true);
      try {
        const anchorParams = { limit: "1" };
        if (filters.siteId) anchorParams.siteId = filters.siteId;
        if (filters.tankId) anchorParams.tankId = filters.tankId;
        if (filters.product) anchorParams.product = filters.product;

        const latestRows = await api.getTankInformation(anchorParams);
        if (ignore) return;
        const latestReadAt = latestRows[0]?.readAt || "";
        setAnchorTs(latestReadAt);
        if (!latestReadAt) {
          setRows([]);
          setError("");
          setLoading(false);
          return;
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

        const data = await api.getTankInformation(params);
        if (ignore) return;
        setRows(data);
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
  }, [filters]);

  const siteById = useMemo(() => new Map(sites.map((site) => [site.id, site])), [sites]);

  const latestRows = useMemo(() => buildLatestTankRows(rows), [rows]);
  const detailRow = useMemo(() => latestRows.find((row) => row.tankId === detailTankId) || latestRows[0] || null, [detailTankId, latestRows]);
  const selectedSite = useMemo(() => sites.find((site) => site.id === filters.siteId) || null, [filters.siteId, sites]);

  const summary = useMemo(() => {
    const refills = rows.filter((row) => row.eventType === "delivery").length;
    const averageFill = latestRows.length
      ? latestRows.reduce((sum, row) => sum + Number(row.fillPercent || 0), 0) / latestRows.length
      : 0;
    return {
      visibleTanks: latestRows.length,
      refillEvents: refills,
      averageFill
    };
  }, [latestRows, rows]);

  async function exportPdfReport() {
    try {
      const params = { limit: "10000" };
      if (filters.siteId) params.siteId = filters.siteId;
      const data = await api.getTankInformation(params);
      const reportRows = buildLatestTankRows(data);
      const scopeLabel = selectedSite ? `${selectedSite.siteCode} - ${selectedSite.name}` : "All Stores";
      const generatedAt = new Date().toLocaleString();
      const title = selectedSite ? `Latest Tank Inventory Report - ${selectedSite.name}` : "Latest Tank Inventory Report - All Stores";
      const html = buildReportHtml({ title, generatedAt, scopeLabel, reportRows });
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
      <Stack spacing={3}>
      <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1.5}>
        <div>
          <Typography variant={isMobile ? "h5" : "h4"}>Tank Information</Typography>
          <Typography color="text.secondary" variant="body2">
            {isMobile
              ? "Scan the list first, then open one tank."
              : "Compact phone-first tank review. Scan the latest tank state quickly, then drill into one tank for the deeper numbers."}
          </Typography>
        </div>
        {!isMobile ? (
          <Button variant="outlined" startIcon={<PrintIcon />} onClick={exportPdfReport}>
            Export PDF Report
          </Button>
        ) : null}
      </Stack>

      {isMobile ? (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip label={`${summary.visibleTanks} tanks`} />
          <Chip label={`${summary.refillEvents} refills`} />
          <Chip label={`Avg ${formatNumber(summary.averageFill, 1)}%`} />
          <Chip icon={<PrintIcon />} label="Export" onClick={exportPdfReport} clickable />
        </Stack>
      ) : (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Card><CardContent><Typography variant="caption" color="text.secondary">Visible Tanks</Typography><Typography variant="h4">{summary.visibleTanks}</Typography></CardContent></Card>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Card><CardContent><Typography variant="caption" color="text.secondary">Refill Events</Typography><Typography variant="h4">{summary.refillEvents}</Typography></CardContent></Card>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Card><CardContent><Typography variant="caption" color="text.secondary">Average Fill</Typography><Typography variant="h4">{formatNumber(summary.averageFill, 1)}%</Typography></CardContent></Card>
          </Grid>
        </Grid>
      )}

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={2}>
              <div>
                <Typography variant="h6">Filters</Typography>
                <Typography color="text.secondary">
                  On phone, keep the list short and use the tank picker only when you need to inspect one tank closely.
                </Typography>
              </div>
              {anchorTs ? <Chip label={`Latest reading: ${formatDateTime(anchorTs)}`} /> : null}
            </Stack>
            {isMobile ? (
              <Stack spacing={1.5}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Chip label={filters.siteId ? (selectedSite ? `${selectedSite.siteCode} - ${selectedSite.name}` : "Store selected") : "All stores"} />
                  <Button
                    size="small"
                    startIcon={<FilterListIcon />}
                    onClick={() => setMobileFiltersOpen((open) => !open)}
                  >
                    {mobileFiltersOpen ? "Hide filters" : "More filters"}
                  </Button>
                </Stack>
                <Collapse in={mobileFiltersOpen}>
                  <Grid container spacing={1.5}>
                    <Grid size={12}>
                      <Autocomplete
                        size="small"
                        options={sites}
                        value={sites.find((site) => site.id === filters.siteId) || null}
                        onChange={(_event, nextSite) => setFilters((current) => ({ ...current, siteId: nextSite?.id || "", tankId: "" }))}
                        getOptionLabel={(option) => `${option.siteCode} - ${option.name}`}
                        isOptionEqualToValue={(option, value) => option.id === value.id}
                        renderInput={(params) => <TextField {...params} label="Store" placeholder="Type a store" />}
                        clearOnEscape
                      />
                    </Grid>
                    <Grid size={12}>
                      <Autocomplete
                        size="small"
                        disabled={!filters.siteId}
                        options={siteAssets.tanks}
                        value={siteAssets.tanks.find((tank) => tank.id === filters.tankId) || null}
                        onChange={(_event, nextTank) => {
                          const nextTankId = nextTank?.id || "";
                          setFilters((current) => ({ ...current, tankId: nextTankId }));
                          setDetailTankId(nextTankId);
                          setMobileView(nextTankId ? "detail" : "list");
                        }}
                        getOptionLabel={(option) => `Tank ${option.atgTankId}: ${option.label}`}
                        isOptionEqualToValue={(option, value) => option.id === value.id}
                        renderInput={(params) => <TextField {...params} label="Tank" placeholder="Type a tank" />}
                        clearOnEscape
                      />
                    </Grid>
                    <Grid size={6}>
                      <Autocomplete
                        size="small"
                        options={productOptions}
                        value={filters.product || null}
                        onChange={(_event, nextProduct) => setFilters((current) => ({ ...current, product: nextProduct || "" }))}
                        renderInput={(params) => <TextField {...params} label="Product" placeholder="Type a product" />}
                        clearOnEscape
                      />
                    </Grid>
                    <Grid size={6}>
                      <Autocomplete
                        size="small"
                        options={rangeOptions}
                        value={rangeOptions.find((option) => option.value === filters.range) || null}
                        onChange={(_event, nextRange) => setFilters((current) => ({ ...current, range: nextRange?.value || "5d" }))}
                        getOptionLabel={(option) => option.label}
                        isOptionEqualToValue={(option, value) => option.value === value.value}
                        renderInput={(params) => <TextField {...params} label="Range" placeholder="Type a range" />}
                        disableClearable
                      />
                    </Grid>
                    <Grid size={12}>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ minHeight: 40 }}>
                        <Switch
                          checked={filters.refillOnly}
                          onChange={(event) => setFilters((current) => ({ ...current, refillOnly: event.target.checked }))}
                        />
                        <Typography variant="body2">Refills only</Typography>
                      </Stack>
                    </Grid>
                  </Grid>
                </Collapse>
              </Stack>
            ) : (
              <Grid container spacing={1.5}>
              <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
                <Autocomplete
                  size="small"
                  options={sites}
                  value={sites.find((site) => site.id === filters.siteId) || null}
                  onChange={(_event, nextSite) => setFilters((current) => ({ ...current, siteId: nextSite?.id || "", tankId: "" }))}
                  getOptionLabel={(option) => `${option.siteCode} - ${option.name}`}
                  isOptionEqualToValue={(option, value) => option.id === value.id}
                  renderInput={(params) => <TextField {...params} label="Store" placeholder="Type a store" />}
                  clearOnEscape
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
                <Autocomplete
                  size="small"
                  disabled={!filters.siteId}
                  options={siteAssets.tanks}
                  value={siteAssets.tanks.find((tank) => tank.id === filters.tankId) || null}
                  onChange={(_event, nextTank) => {
                    const nextTankId = nextTank?.id || "";
                    setFilters((current) => ({ ...current, tankId: nextTankId }));
                    setDetailTankId(nextTankId);
                  }}
                  getOptionLabel={(option) => `Tank ${option.atgTankId}: ${option.label}`}
                  isOptionEqualToValue={(option, value) => option.id === value.id}
                  renderInput={(params) => <TextField {...params} label="Tank" placeholder="Type a tank" />}
                  clearOnEscape
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, lg: 2 }}>
                <Autocomplete
                  size="small"
                  options={productOptions}
                  value={filters.product || null}
                  onChange={(_event, nextProduct) => setFilters((current) => ({ ...current, product: nextProduct || "" }))}
                  renderInput={(params) => <TextField {...params} label="Product" placeholder="Type a product" />}
                  clearOnEscape
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, lg: 2 }}>
                <Autocomplete
                  size="small"
                  options={rangeOptions}
                  value={rangeOptions.find((option) => option.value === filters.range) || null}
                  onChange={(_event, nextRange) => setFilters((current) => ({ ...current, range: nextRange?.value || "5d" }))}
                  getOptionLabel={(option) => option.label}
                  isOptionEqualToValue={(option, value) => option.value === value.value}
                  renderInput={(params) => <TextField {...params} label="Range" placeholder="Type a range" />}
                  disableClearable
                />
              </Grid>
              <Grid size={{ xs: 12, lg: 2 }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ height: "100%", minHeight: 40 }}>
                  <Switch
                    checked={filters.refillOnly}
                    onChange={(event) => setFilters((current) => ({ ...current, refillOnly: event.target.checked }))}
                  />
                  <Typography variant="body2">Refills only</Typography>
                </Stack>
              </Grid>
              </Grid>
            )}
          </Stack>
        </CardContent>
      </Card>

      {error ? <Alert severity="error">{error}</Alert> : null}

      {loading ? (
        <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 220 }}>
          <CircularProgress />
        </Stack>
      ) : isMobile ? (
        <Stack spacing={2}>
          {mobileView === "detail" && detailRow ? (
            <Stack spacing={2}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Button startIcon={<ArrowBackIcon />} onClick={() => setMobileView("list")}>
                  Back to list
                </Button>
                <Chip label={detailRow.siteCode || "Selected tank"} />
              </Stack>
              <TankDetailPanel row={detailRow} />
              <Button
                variant="contained"
                onClick={() => navigate(`/tank-charts?siteId=${encodeURIComponent(detailRow.siteId)}&tankId=${encodeURIComponent(detailRow.tankId)}`)}
              >
                Open Tank Chart
              </Button>
            </Stack>
          ) : (
            <Stack spacing={1.5}>
              {latestRows.map((row) => (
                <MobileTankCard
                  key={`${row.tankId}-${row.readAt}`}
                  row={row}
                  selected={detailRow?.tankId === row.tankId}
                  tankLimits={jobber?.tankLimits}
                  onClick={() => {
                    setDetailTankId(row.tankId);
                    setMobileView("detail");
                  }}
                />
              ))}
              {!latestRows.length ? (
                <Card><CardContent><Typography color="text.secondary">No tank history rows matching the current filters.</Typography></CardContent></Card>
              ) : null}
            </Stack>
          )}
        </Stack>
      ) : (
        <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, xl: 4 }}>
            <Stack spacing={2}>
              <TankDetailPanel row={detailRow} />
              {detailRow ? (
                <Button
                  variant="contained"
                  onClick={() => navigate(`/tank-charts?siteId=${encodeURIComponent(detailRow.siteId)}&tankId=${encodeURIComponent(detailRow.tankId)}`)}
                >
                  Open Tank Chart
                </Button>
              ) : null}
            </Stack>
          </Grid>
          <Grid size={{ xs: 12, xl: 8 }}>
            <Card>
              <CardContent>
                <Stack spacing={2}>
                  <Typography variant="h6">Tank Inventory Table</Typography>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Read Time</TableCell>
                          <TableCell>Site</TableCell>
                          <TableCell>Tank</TableCell>
                          <TableCell>Product</TableCell>
                          <TableCell align="right">Volume (L)</TableCell>
                          <TableCell align="right">Fill %</TableCell>
                          <TableCell align="right">Delta (L)</TableCell>
                          <TableCell align="right">Ullage (L)</TableCell>
                          <TableCell align="right">Safe Ullage</TableCell>
                          <TableCell>Event</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {rows.map((row) => {
                          const site = siteById.get(row.siteId);
                          return (
                            <TableRow
                              key={row.id}
                              hover
                              selected={detailRow?.tankId === row.tankId}
                              onClick={() => setDetailTankId(row.tankId)}
                              sx={{ cursor: "pointer" }}
                            >
                              <TableCell>{formatDateTime(row.readAt)}</TableCell>
                              <TableCell>{row.siteCode || site?.siteCode || row.siteId}</TableCell>
                              <TableCell>{row.tankLabel || `Tank ${row.atgTankId || "-"}`}</TableCell>
                              <TableCell>{row.product || "-"}</TableCell>
                              <TableCell align="right">{formatNumber(row.volume, 2)}</TableCell>
                              <TableCell align="right">{formatNumber(row.fillPercent, 1)}%</TableCell>
                              <TableCell align="right">{formatNumber(row.deltaVolume, 2)}</TableCell>
                              <TableCell align="right">{formatNumber(row.ullage, 2)}</TableCell>
                              <TableCell align="right">{formatNumber(row.safeUllage, 2)}</TableCell>
                              <TableCell>{row.eventType === "delivery" ? "Refilled to ~80%" : "Pump drawdown"}</TableCell>
                            </TableRow>
                          );
                        })}
                        {!rows.length ? (
                          <TableRow>
                            <TableCell colSpan={10}>No tank history rows matching the current filters.</TableCell>
                          </TableRow>
                        ) : null}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
    </Stack>
  );
}
