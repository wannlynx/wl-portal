import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  LinearProgress,
  Paper,
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
import DownloadIcon from "@mui/icons-material/Download";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
import PlaceIcon from "@mui/icons-material/Place";
import InsightsIcon from "@mui/icons-material/Insights";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
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
import { api, getToken } from "../api";
import { TanStackDataTable } from "../components/TanStackDataTable";

const STATUS_COLORS = {
  approved: "#1d8348",
  pending: "#d6922f",
  reconciled: "#0b5fff",
  rejected: "#c45b3c",
  received: "#5c6b7a",
  unknown: "#8a94a6"
};

function defaultDateRange() {
  const end = new Date();
  const start = new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10)
  };
}

function money(value) {
  return `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function gallons(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function price(value) {
  return `$${Number(value || 0).toFixed(4)}`;
}

function dateTime(value) {
  if (!value) return "n/a";
  return new Date(value).toLocaleString();
}

function shortDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

function splitFilterValue(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function isFillExceptionRecord(item) {
  const shortLoadGallons = Number(((item.gallonsFilled || 0) - (item.gallonsCorrected || 0)).toFixed(1));
  const truckingRate = item.gallonsCorrected > 0 ? Number((item.truckingCost / item.gallonsCorrected).toFixed(4)) : 0;
  return item.status === "pending" || item.status === "received" || shortLoadGallons >= 18 || truckingRate >= 0.05;
}

function buildSummary(records) {
  const totalGallons = records.reduce((sum, item) => sum + Number(item.gallonsCorrected || 0), 0);
  const totalCost = records.reduce((sum, item) => sum + Number(item.totalCost || 0), 0);
  const totalTruckingCost = records.reduce((sum, item) => sum + Number(item.truckingCost || 0), 0);
  return {
    totalLoads: records.length,
    totalGallons,
    totalCost,
    totalTruckingCost,
    averagePricePerGallon: totalGallons > 0 ? totalCost / totalGallons : 0,
    averageCostPerLoad: records.length > 0 ? totalCost / records.length : 0,
    uniqueTerminals: new Set(records.map((item) => item.terminalId || item.terminalName).filter(Boolean)).size,
    uniqueSuppliers: new Set(records.map((item) => item.supplier).filter(Boolean)).size,
    uniqueSites: new Set(records.map((item) => item.destinationSiteId || item.destinationSiteCode || item.destinationSiteName).filter(Boolean)).size,
    approvedCount: records.filter((item) => item.status === "approved").length
  };
}

function buildStatusRows(records, exceptionCount) {
  return [
    {
      status: "approved",
      count: records.filter((item) => item.status === "approved").length,
      gallons: records.filter((item) => item.status === "approved").reduce((sum, item) => sum + Number(item.gallonsCorrected || 0), 0),
      totalCost: records.filter((item) => item.status === "approved").reduce((sum, item) => sum + Number(item.totalCost || 0), 0)
    },
    {
      status: "reconciled",
      count: records.filter((item) => item.status === "reconciled").length,
      gallons: records.filter((item) => item.status === "reconciled").reduce((sum, item) => sum + Number(item.gallonsCorrected || 0), 0),
      totalCost: records.filter((item) => item.status === "reconciled").reduce((sum, item) => sum + Number(item.totalCost || 0), 0)
    },
    {
      status: "flagged loads",
      count: exceptionCount,
      gallons: 0,
      totalCost: 0,
      isException: true
    }
  ];
}

function buildTerminalRows(records, sourceRows) {
  const sourceByKey = new Map((sourceRows || []).map((item) => [item.terminalId || item.terminalName, item]));
  const buckets = new Map();
  records.forEach((item) => {
    const key = item.terminalId || item.terminalName;
    if (!key) return;
    if (!buckets.has(key)) {
      const source = sourceByKey.get(key) || {};
      buckets.set(key, {
        terminalId: item.terminalId,
        terminalName: item.terminalName,
        city: item.terminalCity || source.city,
        state: item.terminalState || source.state,
        address: source.address || "",
        postalCode: source.postalCode || "",
        country: source.country || "USA",
        latitude: source.latitude ?? null,
        longitude: source.longitude ?? null,
        terminalStatus: source.terminalStatus || "unknown",
        loads: 0,
        gallons: 0,
        totalCost: 0,
        avgPricePerGallon: 0
      });
    }
    const bucket = buckets.get(key);
    bucket.loads += 1;
    bucket.gallons += Number(item.gallonsCorrected || 0);
    bucket.totalCost += Number(item.totalCost || 0);
  });
  return [...buckets.values()]
    .map((item) => ({ ...item, avgPricePerGallon: item.gallons > 0 ? item.totalCost / item.gallons : 0 }))
    .sort((a, b) => b.totalCost - a.totalCost || b.loads - a.loads)
    .slice(0, 8);
}

function buildSiteRows(records) {
  const buckets = new Map();
  records.forEach((item) => {
    const key = item.destinationSiteId || item.destinationSiteCode || item.destinationSiteName;
    if (!key) return;
    if (!buckets.has(key)) {
      buckets.set(key, {
        siteId: item.destinationSiteId,
        siteCode: item.destinationSiteCode,
        siteName: item.destinationSiteName,
        address: item.destinationAddress,
        tankLabels: new Set(),
        loads: 0,
        gallons: 0
      });
    }
    const bucket = buckets.get(key);
    bucket.loads += 1;
    bucket.gallons += Number(item.gallonsCorrected || 0);
    if (item.tankLabel) bucket.tankLabels.add(item.tankLabel);
  });
  return [...buckets.values()]
    .map((item) => ({ ...item, tankLabels: [...item.tankLabels] }))
    .sort((a, b) => b.loads - a.loads)
    .slice(0, 8);
}

function buildMonthlyComparison(records) {
  const months = new Map();
  records.forEach((item) => {
    const month = String(item.loadDate || item.createdAt || "").slice(0, 7);
    if (!month) return;
    if (!months.has(month)) months.set(month, { month, gallons: 0, totalCost: 0 });
    const bucket = months.get(month);
    bucket.gallons += Number(item.gallonsCorrected || 0);
    bucket.totalCost += Number(item.totalCost || 0);
  });
  const series = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
  return {
    period: series[series.length - 1]?.month || "",
    currentMonth: series[series.length - 1] || null,
    priorMonth: series[series.length - 2] || null
  };
}

function filterLabel(filters) {
  const parts = [];
  if (filters.siteId) parts.push(`Site: ${splitFilterValue(filters.siteId).join(", ")}`);
  if (filters.terminalId) parts.push(`Terminal: ${splitFilterValue(filters.terminalId).length}`);
  if (filters.supplierId) parts.push(`Supplier: ${splitFilterValue(filters.supplierId).length}`);
  return parts.join(" | ");
}

function SectionCard({ title, subtitle, action, children }) {
  return (
    <Card>
      <CardContent>
        <Stack spacing={2.5}>
          <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1.5}>
            <Box>
              <Typography variant="h6">{title}</Typography>
              {subtitle ? <Typography color="text.secondary" variant="body2">{subtitle}</Typography> : null}
            </Box>
            {action || null}
          </Stack>
          {children}
        </Stack>
      </CardContent>
    </Card>
  );
}

function MetricCard({ label, value, caption, icon }) {
  return (
    <Card sx={{ height: "100%" }}>
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
    </Card>
  );
}

function TooltipCard({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <Box
      sx={{
        bgcolor: "background.paper",
        border: "1px solid rgba(15, 23, 42, 0.1)",
        borderRadius: 2,
        px: 1.5,
        py: 1.25
      }}
    >
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      {payload.map((entry) => (
        <Typography key={entry.dataKey} variant="body2">
          {entry.name}: {formatter ? formatter(entry.value, entry.name) : entry.value}
        </Typography>
      ))}
    </Box>
  );
}

export function EbolPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [filters, setFilters] = useState(defaultDateRange);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedBol, setSelectedBol] = useState("");
  const [statusDetail, setStatusDetail] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [selectedTerminalId, setSelectedTerminalId] = useState("");
  const [priceDialogOpen, setPriceDialogOpen] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [visibleSeries, setVisibleSeries] = useState({ approved: true, reconciled: true, exceptions: true });

  const query = useMemo(() => {
    const next = {};
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== "" && value != null) next[key] = value;
    });
    return next;
  }, [filters]);

  useEffect(() => {
    let ignore = false;
    async function loadOverview() {
      setLoading(true);
      try {
        const payload = await api.getEbolOverview(query);
        if (ignore) return;
        setOverview(payload);
        setSelectedBol((current) => current && payload.records.some((item) => item.bolNumber === current) ? current : payload.records[0]?.bolNumber || "");
        setError("");
      } catch (nextError) {
        if (!ignore) {
          setOverview(null);
          setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to load eBOL data"));
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    loadOverview();
    return () => {
      ignore = true;
    };
  }, [query]);

  useEffect(() => {
    if (!selectedBol) {
      setStatusDetail(null);
      setStatusError("");
      return;
    }
    let ignore = false;
    async function loadStatus() {
      setStatusLoading(true);
      try {
        const payload = await api.getEbolStatus(selectedBol);
        if (ignore) return;
        setStatusDetail(payload);
        setStatusError("");
      } catch (nextError) {
        if (!ignore) {
          setStatusDetail(null);
          setStatusError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to load eBOL status"));
        }
      } finally {
        if (!ignore) setStatusLoading(false);
      }
    }
    loadStatus();
    return () => {
      ignore = true;
    };
  }, [selectedBol]);

  const filteredRecords = useMemo(() => {
    return (overview?.records || []).filter((item) => {
      const isApproved = item.status === "approved";
      const isReconciled = item.status === "reconciled";
      const isException = isFillExceptionRecord(item);
      return (visibleSeries.approved && isApproved) || (visibleSeries.reconciled && isReconciled) || (visibleSeries.exceptions && isException);
    });
  }, [overview, visibleSeries]);
  const selectedRecord = useMemo(
    () => filteredRecords.find((item) => item.bolNumber === selectedBol) || null,
    [filteredRecords, selectedBol]
  );
  const exceptionRows = useMemo(() => (overview?.fillExceptions || []).filter((item) => {
    const record = (overview?.records || []).find((row) => row.bolNumber === item.bolNumber);
    return record ? filteredRecords.some((row) => row.bolNumber === record.bolNumber) : false;
  }), [filteredRecords, overview]);
  const summary = useMemo(() => buildSummary(filteredRecords), [filteredRecords]);
  const statusRows = useMemo(() => buildStatusRows(filteredRecords, exceptionRows.length), [filteredRecords, exceptionRows]);
  const terminalRows = useMemo(() => buildTerminalRows(filteredRecords, overview?.terminalSummaries || []), [filteredRecords, overview]);
  const siteRows = useMemo(() => buildSiteRows(filteredRecords), [filteredRecords]);
  const monthlyComparisons = useMemo(() => buildMonthlyComparison(filteredRecords), [filteredRecords]);
  const comparisonRows = overview?.priceComparison || [];
  const supplierOptions = (overview?.supplierSummaries || []).map((item) => ({ label: item.supplier, value: item.supplier })) || [];
  const terminalOptions = overview?.filterOptions?.terminals || [];
  const siteOptions = overview?.filterOptions?.sites || [];
  const selectedSupplierValues = splitFilterValue(filters.supplierId);
  const selectedTerminalValues = splitFilterValue(filters.terminalId);
  const selectedSiteValues = splitFilterValue(filters.siteId);
  const terminalTableColumns = useMemo(() => [
    { accessorKey: "terminalName", header: "Terminal", cell: (info) => info.getValue(), meta: { minWidth: 180 } },
    { accessorKey: "cityState", header: "City", cell: (info) => info.getValue(), meta: { minWidth: 160 } },
    { accessorKey: "coordinates", header: "Coordinates", cell: (info) => info.getValue(), meta: { minWidth: 160 } },
    { accessorKey: "terminalStatus", header: "Status", cell: (info) => info.getValue(), meta: { minWidth: 120 } },
    { accessorKey: "loads", header: "Loads", cell: (info) => Number(info.getValue() || 0).toLocaleString(), meta: { align: "right", minWidth: 90 } },
    { accessorKey: "avgPricePerGallon", header: "Avg Delivered", cell: (info) => price(info.getValue()), meta: { align: "right", minWidth: 120 } }
  ], []);
  const selectedTerminalFillColumns = useMemo(() => [
    { accessorKey: "bolNumber", header: "BOL", cell: (info) => info.getValue(), meta: { minWidth: 160 } },
    { accessorKey: "destinationSiteCode", header: "Site", cell: (info) => info.getValue(), meta: { minWidth: 100 } },
    { accessorKey: "productName", header: "Product", cell: (info) => info.getValue(), meta: { minWidth: 160 } },
    { accessorKey: "status", header: "Status", cell: (info) => info.getValue(), meta: { minWidth: 120 } },
    { accessorKey: "gallonsCorrected", header: "Gallons", cell: (info) => gallons(info.getValue()), meta: { align: "right", minWidth: 100 } },
    { accessorKey: "totalCost", header: "Total", cell: (info) => money(info.getValue()), meta: { align: "right", minWidth: 120 } }
  ], []);
  const recentEbolColumns = useMemo(() => [
    { accessorKey: "bolNumber", header: "BOL", cell: (info) => info.getValue(), meta: { minWidth: 170 } },
    { accessorKey: "destinationSiteCode", header: "Site", cell: (info) => info.getValue(), meta: { minWidth: 100 } },
    { accessorKey: "loadedLabel", header: "Loaded", cell: (info) => info.getValue(), meta: { minWidth: 180 } },
    { accessorKey: "terminalName", header: "Terminal", cell: (info) => info.getValue(), meta: { minWidth: 160 } },
    { accessorKey: "supplier", header: "Supplier", cell: (info) => info.getValue(), meta: { minWidth: 140 } },
    { accessorKey: "status", header: "Status", cell: (info) => info.getValue(), meta: { minWidth: 120 } },
    { accessorKey: "gallonsCorrected", header: "Gallons", cell: (info) => gallons(info.getValue()), meta: { align: "right", minWidth: 100 } },
    { accessorKey: "pricePerGallon", header: "Price/Gal", cell: (info) => price(info.getValue()), meta: { align: "right", minWidth: 110 } },
    { accessorKey: "totalCost", header: "Total", cell: (info) => money(info.getValue()), meta: { align: "right", minWidth: 120 } }
  ], []);
  const dailyRows = useMemo(() => {
    const buckets = new Map();
    filteredRecords.forEach((item) => {
      const date = String(item.loadDate || item.createdAt || "").slice(0, 10);
      if (!date) return;
      if (!buckets.has(date)) {
        buckets.set(date, {
          date,
          label: shortDate(date),
          approved: 0,
          reconciled: 0,
          fillExceptions: 0,
          totalCost: 0
        });
      }
      const bucket = buckets.get(date);
      if (item.status === "approved") bucket.approved += 1;
      if (item.status === "reconciled") bucket.reconciled += 1;
      const shortLoadGallons = Number(((item.gallonsFilled || 0) - (item.gallonsCorrected || 0)).toFixed(1));
      const truckingRate = item.gallonsCorrected > 0 ? Number((item.truckingCost / item.gallonsCorrected).toFixed(4)) : 0;
      if (item.status === "pending" || item.status === "received" || shortLoadGallons >= 18 || truckingRate >= 0.05) {
        bucket.fillExceptions += 1;
      }
      bucket.totalCost += Number(item.totalCost || 0);
    });
    return [...buckets.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-12);
  }, [filteredRecords]);
  const selectedTerminal = useMemo(
    () => terminalRows.find((item) => (item.terminalId || item.terminalName) === selectedTerminalId) || terminalRows[0] || null,
    [terminalRows, selectedTerminalId]
  );
  const selectedTerminalFills = useMemo(() => {
    if (!selectedTerminal) return [];
    const key = selectedTerminal.terminalId || selectedTerminal.terminalName;
    return filteredRecords.filter((item) => (item.terminalId || item.terminalName) === key).slice(0, 12);
  }, [filteredRecords, selectedTerminal]);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function resetFilters() {
    setFilters({ ...defaultDateRange(), supplierId: "", terminalId: "", siteId: "" });
    setVisibleSeries({ approved: true, reconciled: true, exceptions: true });
  }

  function updateMultiFilter(key, values) {
    setFilters((current) => ({ ...current, [key]: values.join(",") }));
  }

  function toggleSeries(key) {
    setVisibleSeries((current) => ({ ...current, [key]: !current[key] }));
  }

  function setSingleDay(date) {
    if (!date) return;
    setFilters((current) => ({ ...current, startDate: date, endDate: date }));
  }

  function exportData(format) {
    fetch(api.getEbolExportUrl(format, query), {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
      .then(async (response) => {
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || "Export failed");
        }
        return response.blob();
      })
      .then((blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `ebols-${filters.startDate}-to-${filters.endDate}.${format}`;
        link.click();
        window.URL.revokeObjectURL(url);
      })
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : String(nextError || "Export failed")));
  }

  function openStatusDialog(bolNumber) {
    setSelectedBol(bolNumber);
    setStatusDialogOpen(true);
  }

  useEffect(() => {
    if (!selectedTerminalId && terminalRows[0]) {
      setSelectedTerminalId(terminalRows[0].terminalId || terminalRows[0].terminalName || "");
    }
  }, [selectedTerminalId, terminalRows]);

  useEffect(() => {
    function handleReset() {
      resetFilters();
    }
    window.addEventListener("petroleum:reset-filters", handleReset);
    return () => window.removeEventListener("petroleum:reset-filters", handleReset);
  }, []);

  return (
    <Stack spacing={2.5}>
      <Card
        sx={{
          background: "linear-gradient(135deg, rgba(11,95,255,0.12) 0%, rgba(255,255,255,1) 54%, rgba(214,146,47,0.10) 100%)"
        }}
      >
        <CardContent>
          <Stack spacing={2}>
            <Stack direction={{ xs: "column", xl: "row" }} justifyContent="space-between" spacing={2}>
              <Box>
                <Typography variant="h4">eBOL</Typography>
                <Typography color="text.secondary">
                  Pull electronic bills of lading, costs, terminal pricing, approval status, and export-ready reporting from DTN.
                </Typography>
              </Box>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} useFlexGap flexWrap="wrap">
                <TextField
                  size="small"
                  type="date"
                  label="Start"
                  value={filters.startDate || ""}
                  onChange={(event) => updateFilter("startDate", event.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  size="small"
                  type="date"
                  label="End"
                  value={filters.endDate || ""}
                  onChange={(event) => updateFilter("endDate", event.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
                <Button variant="outlined" onClick={resetFilters}>Reset</Button>
                <Button variant="outlined" startIcon={<DownloadIcon />} onClick={() => exportData("json")}>JSON</Button>
                <Button variant="contained" startIcon={<DownloadIcon />} onClick={() => exportData("csv")}>CSV</Button>
              </Stack>
            </Stack>

            <Stack direction={{ xs: "column", md: "row" }} spacing={1.25}>
              <Autocomplete
                multiple
                size="small"
                options={supplierOptions}
                value={supplierOptions.filter((item) => selectedSupplierValues.includes(item.value))}
                onChange={(_event, options) => updateMultiFilter("supplierId", options.map((item) => item.value))}
                getOptionLabel={(option) => option.label}
                isOptionEqualToValue={(option, value) => option.value === value.value}
                renderInput={(params) => <TextField {...params} label="Supplier" placeholder="Any supplier" />}
                sx={{ minWidth: 220 }}
                disableCloseOnSelect
                clearOnEscape
              />
              <Autocomplete
                multiple
                size="small"
                options={terminalOptions}
                value={terminalOptions.filter((item) => selectedTerminalValues.includes(item.value))}
                onChange={(_event, options) => updateMultiFilter("terminalId", options.map((item) => item.value))}
                getOptionLabel={(option) => option.label}
                isOptionEqualToValue={(option, value) => option.value === value.value}
                renderInput={(params) => <TextField {...params} label="Terminal" placeholder="Any terminal" />}
                sx={{ minWidth: 260 }}
                disableCloseOnSelect
                clearOnEscape
              />
              <Autocomplete
                multiple
                size="small"
                options={siteOptions}
                value={siteOptions.filter((item) => selectedSiteValues.includes(item.value))}
                onChange={(_event, options) => updateMultiFilter("siteId", options.map((item) => item.value))}
                getOptionLabel={(option) => option.label}
                isOptionEqualToValue={(option, value) => option.value === value.value}
                renderInput={(params) => <TextField {...params} label="Destination Site" placeholder="Any site" />}
                sx={{ minWidth: 260 }}
                disableCloseOnSelect
                clearOnEscape
              />
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="warning">{error}</Alert> : null}
      {statusError ? <Alert severity="warning">{statusError}</Alert> : null}
      {overview?.sourceMode === "demo_sites" ? (
        <Alert severity="info">
          Demo mode is active. eBOL loads are being generated from the actual California site list in the seeded portal and mapped to the nearest California OPIS terminal market so you can demo fill workflows without DTN credentials.
        </Alert>
      ) : null}
      {filterLabel(filters) ? (
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          <Chip label={filterLabel(filters)} onDelete={resetFilters} />
        </Stack>
      ) : null}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6, xl: 2.4 }}>
          <MetricCard
            label="Loads"
            value={Number(summary.totalLoads || 0).toLocaleString()}
            caption={`${summary.approvedCount || 0} approved`}
            icon={<ReceiptLongIcon color="primary" />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 2.4 }}>
          <MetricCard
            label="Gallons"
            value={gallons(summary.totalGallons)}
            caption={`${summary.uniqueTerminals || 0} terminals`}
            icon={<LocalShippingIcon color="primary" />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 2.4 }}>
          <MetricCard
            label="Total Cost"
            value={money(summary.totalCost)}
            caption={`${money(summary.totalTruckingCost)} trucking`}
            icon={<ReceiptLongIcon color="primary" />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 2.4 }}>
          <MetricCard
            label="Avg Price/Gal"
            value={price(summary.averagePricePerGallon)}
            caption={`${summary.uniqueSuppliers || 0} suppliers`}
            icon={<CompareArrowsIcon color="primary" />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 2.4 }}>
          <MetricCard
            label="Sites"
            value={Number(summary.uniqueSites || 0).toLocaleString()}
            caption={money(summary.averageCostPerLoad)}
            icon={<PlaceIcon color="warning" />}
          />
        </Grid>
      </Grid>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, xl: 7 }}>
          <SectionCard title="Monthly Summary" subtitle="Volume and cost trend for the selected eBOL range. Click a bar to filter to that day.">
            <Box sx={{ height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyRows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(15, 23, 42, 0.08)" />
                  <XAxis dataKey="label" />
                  <YAxis yAxisId="loads" />
                  <YAxis yAxisId="cost" orientation="right" />
                  <Tooltip content={<TooltipCard formatter={(value, name) => name === "Cost" ? money(value) : Number(value).toLocaleString()} />} />
                  <Bar yAxisId="loads" stackId="status" dataKey="approved" name="Approved" fill={STATUS_COLORS.approved} radius={[0, 0, 0, 0]} onClick={(payload) => setSingleDay(payload?.activePayload?.[0]?.payload?.date || payload?.date)} />
                  <Bar yAxisId="loads" stackId="status" dataKey="reconciled" name="Reconciled" fill={STATUS_COLORS.reconciled} radius={[0, 0, 0, 0]} onClick={(payload) => setSingleDay(payload?.activePayload?.[0]?.payload?.date || payload?.date)} />
                  <Bar yAxisId="loads" stackId="status" dataKey="fillExceptions" name="Flagged Loads" fill={theme.palette.warning.main} radius={[8, 8, 0, 0]} onClick={(payload) => setSingleDay(payload?.activePayload?.[0]?.payload?.date || payload?.date)} />
                  <Line yAxisId="cost" type="monotone" dataKey="totalCost" name="Cost" stroke="#d6922f" strokeWidth={3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </Box>
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12, xl: 5 }}>
          <SectionCard title="Approval Workflow" subtitle="Follow eBOLs through the current status mix.">
            <Stack spacing={1.25}>
              {statusRows.length ? (
                [
                  { ...statusRows.find((row) => row.status === "approved"), key: "approved", checked: visibleSeries.approved },
                  { ...statusRows.find((row) => row.status === "reconciled"), key: "reconciled", checked: visibleSeries.reconciled },
                  { ...statusRows.find((row) => row.status === "flagged loads"), key: "exceptions", checked: visibleSeries.exceptions }
                ].map((row) => (
                  <Paper
                    key={row.key}
                    variant="outlined"
                    sx={{ p: 1.5 }}
                  >
                    <Stack direction="row" justifyContent="space-between" spacing={1}>
                      <Stack direction="row" spacing={1} alignItems="flex-start">
                        <Checkbox checked={row.checked} onChange={() => toggleSeries(row.key)} sx={{ p: 0.25, mt: -0.25 }} />
                        <Box>
                        <Typography fontWeight={700} sx={{ textTransform: "capitalize" }}>{row.status}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {row.isException ? `${row.count} loads flagged` : `${gallons(row.gallons)} gal | ${money(row.totalCost)}`}
                        </Typography>
                        </Box>
                      </Stack>
                      <Chip
                        label={`${row.count} loads`}
                        sx={{
                          backgroundColor: row.isException ? theme.palette.warning.main : (STATUS_COLORS[row.status] || STATUS_COLORS.unknown),
                          color: "#fff"
                        }}
                      />
                    </Stack>
                  </Paper>
                ))
              ) : (
                <Typography color="text.secondary">No status rows for the selected range.</Typography>
              )}
            </Stack>
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12, xl: 6 }}>
          <SectionCard
            title="Terminal Detail"
            subtitle="Select a terminal to see current period totals, prior-month comparison, and the fills delivered from that terminal."
            action={(
              <IconButton aria-label="Open price comparisons" onClick={() => setPriceDialogOpen(true)}>
                <InsightsIcon />
              </IconButton>
            )}
          >
            <Stack spacing={1.5}>
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1.5}>
                  <Box>
                    <Typography fontWeight={700}>{monthlyComparisons?.period || "Current period"}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {monthlyComparisons?.priorMonth?.month ? `Prior ${monthlyComparisons.priorMonth.month}` : "No prior month in current filter"}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <Chip size="small" variant="outlined" label={`Current ${money(monthlyComparisons?.currentMonth?.totalCost)}`} />
                    <Chip size="small" variant="outlined" label={`Current ${gallons(monthlyComparisons?.currentMonth?.gallons)} gal`} />
                    <Chip size="small" variant="outlined" label={`Prior ${money(monthlyComparisons?.priorMonth?.totalCost)}`} />
                  </Stack>
                </Stack>
              </Paper>
            {isMobile ? (
              <Stack spacing={1.25}>
                {terminalRows.map((row) => (
                  <Paper
                    key={row.terminalId || row.terminalName}
                    variant="outlined"
                    sx={{ p: 1.5, borderColor: (selectedTerminal?.terminalId || selectedTerminal?.terminalName) === (row.terminalId || row.terminalName) ? "primary.main" : "divider" }}
                    onClick={() => setSelectedTerminalId(row.terminalId || row.terminalName)}
                  >
                    <Stack spacing={1}>
                      <Typography fontWeight={700}>{row.terminalName}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {[row.city, row.state].filter(Boolean).join(", ") || "Location unavailable"}
                      </Typography>
                      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                        <Chip size="small" variant="outlined" label={`${row.loads} loads`} />
                        <Chip size="small" variant="outlined" label={`${gallons(row.gallons)} gal`} />
                        <Chip size="small" variant="outlined" label={price(row.avgPricePerGallon)} />
                        <Chip size="small" label={row.terminalStatus} sx={{ textTransform: "capitalize" }} />
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {row.latitude != null && row.longitude != null ? `${row.latitude}, ${row.longitude}` : "Coordinates unavailable"}
                      </Typography>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            ) : (
              <TanStackDataTable
                rows={terminalRows.map((row) => ({
                  ...row,
                  cityState: [row.city, row.state].filter(Boolean).join(", "),
                  coordinates: row.latitude != null && row.longitude != null ? `${row.latitude}, ${row.longitude}` : "-"
                }))}
                columns={terminalTableColumns}
                globalSearchPlaceholder="Search terminals..."
                initialPageSize={8}
                getRowId={(row) => row.terminalId || row.terminalName}
                isRowSelected={(row) => (selectedTerminal?.terminalId || selectedTerminal?.terminalName) === (row.terminalId || row.terminalName)}
                onRowClick={(row) => setSelectedTerminalId(row.terminalId || row.terminalName)}
              />
            )}
              {selectedTerminal ? (
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Stack spacing={1.25}>
                    <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1}>
                      <Box>
                        <Typography variant="subtitle1" fontWeight={700}>{selectedTerminal.terminalName}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {[selectedTerminal.address || selectedTerminal.city, selectedTerminal.state, selectedTerminal.postalCode].filter(Boolean).join(", ") || "Address unavailable"}
                        </Typography>
                      </Box>
                      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                        <Chip size="small" variant="outlined" label={`${selectedTerminal.loads} loads`} />
                        <Chip size="small" variant="outlined" label={`${gallons(selectedTerminal.gallons)} gal`} />
                        <Chip size="small" variant="outlined" label={money(selectedTerminal.totalCost)} />
                        <Chip size="small" variant="outlined" label={price(selectedTerminal.avgPricePerGallon)} />
                      </Stack>
                    </Stack>
                    <Typography variant="subtitle2">Fills</Typography>
                    {selectedTerminalFills.length ? (
                      <TanStackDataTable
                        rows={selectedTerminalFills}
                        columns={selectedTerminalFillColumns}
                        globalSearchPlaceholder="Search terminal fills..."
                        initialPageSize={8}
                        getRowId={(row) => `${selectedTerminal.terminalId || selectedTerminal.terminalName}-${row.bolNumber}`}
                        onRowClick={(row) => openStatusDialog(row.bolNumber)}
                      />
                    ) : (
                      <Typography color="text.secondary">No fills for this terminal in the current filter.</Typography>
                    )}
                  </Stack>
                </Paper>
              ) : null}
            </Stack>
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12, xl: 6 }}>
          <SectionCard title="Destination Sites" subtitle="California site numbers and locations tied to demo fill activity.">
            <Stack spacing={1.25}>
              {siteRows.length ? siteRows.map((row) => (
                <Paper key={row.siteId || row.siteCode} variant="outlined" sx={{ p: 1.5 }}>
                  <Stack direction="row" justifyContent="space-between" spacing={1.5}>
                    <Box>
                      <Typography fontWeight={700}>{row.siteCode} | {row.siteName}</Typography>
                      <Typography variant="body2" color="text.secondary">{row.address || "Address unavailable"}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {(row.tankLabels || []).slice(0, 2).join(", ") || "Tank labels unavailable"}
                      </Typography>
                    </Box>
                    <Stack alignItems="flex-end">
                      <Typography variant="h6">{row.loads} loads</Typography>
                      <Typography variant="caption" color="text.secondary">{gallons(row.gallons)} gal</Typography>
                      <Button size="small" onClick={() => updateFilter("siteId", filters.siteId === (row.siteId || row.siteCode) ? "" : (row.siteId || row.siteCode))}>Filter</Button>
                    </Stack>
                  </Stack>
                </Paper>
              )) : <Typography color="text.secondary">No destination sites available.</Typography>}
            </Stack>
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12, xl: 6 }}>
          <SectionCard title="Fill Exceptions" subtitle="Short loads, high trucking, and approvals still in flight.">
            <Stack spacing={1.25}>
              {exceptionRows.length ? exceptionRows.map((row) => (
                <Paper key={row.bolNumber} variant="outlined" sx={{ p: 1.5, cursor: "pointer" }} onClick={() => { setSelectedBol(row.bolNumber); setStatusDialogOpen(true); }}>
                  <Stack spacing={0.75}>
                    <Stack direction="row" justifyContent="space-between" spacing={1}>
                      <Typography fontWeight={700}>{row.bolNumber}</Typography>
                      <Chip size="small" label={row.status} sx={{ textTransform: "capitalize" }} />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {row.siteCode} | {row.siteName} | {row.tankLabel || row.terminalName}
                    </Typography>
                    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                      {row.reasons.map((reason) => <Chip key={reason} size="small" variant="outlined" label={reason} />)}
                    </Stack>
                  </Stack>
                </Paper>
              )) : <Typography color="text.secondary">No current exceptions in the selected range.</Typography>}
            </Stack>
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12, xl: 6 }}>
          <SectionCard title="Recent eBOLs" subtitle="Click a row to open status history for that eBOL.">
            {isMobile ? (
              <Stack spacing={1.25}>
                {(overview?.records || []).slice(0, 10).map((row) => (
                  <Card
                    key={row.bolNumber}
                    variant="outlined"
                    sx={{ borderColor: selectedBol === row.bolNumber ? "primary.main" : "divider", borderWidth: selectedBol === row.bolNumber ? 2 : 1 }}
                  >
                    <CardContent sx={{ pb: "16px !important" }}>
                      <Stack spacing={1}>
                        <Stack direction="row" justifyContent="space-between" spacing={1}>
                          <Box>
                            <Typography fontWeight={700}>{row.bolNumber}</Typography>
                            <Typography variant="caption" color="text.secondary">{dateTime(row.loadDate || row.createdAt)}</Typography>
                          </Box>
                          <Chip
                            label={row.status}
                            onClick={() => openStatusDialog(row.bolNumber)}
                            sx={{ textTransform: "capitalize", cursor: "pointer" }}
                          />
                        </Stack>
                        <Typography variant="body2" color="text.secondary">
                          {row.destinationSiteCode} | {row.destinationSiteName}
                        </Typography>
                        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                          <Chip size="small" variant="outlined" label={row.terminalName} />
                          <Chip size="small" variant="outlined" label={row.tankLabel || row.productName} />
                          <Chip size="small" variant="outlined" label={`${gallons(row.gallonsCorrected)} gal`} />
                          <Chip size="small" variant="outlined" label={money(row.totalCost)} />
                          <Chip size="small" variant="outlined" label={money(row.truckingCost)} />
                        </Stack>
                        <Button size="small" endIcon={<OpenInFullIcon />} onClick={() => openStatusDialog(row.bolNumber)}>View Status</Button>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            ) : (
              <TanStackDataTable
                rows={(overview?.records || []).slice(0, 12).map((row) => ({ ...row, loadedLabel: dateTime(row.loadDate || row.createdAt) }))}
                columns={recentEbolColumns}
                globalSearchPlaceholder="Search eBOLs..."
                initialPageSize={10}
                getRowId={(row) => row.bolNumber}
                isRowSelected={(row) => selectedBol === row.bolNumber}
                onRowClick={(row) => openStatusDialog(row.bolNumber)}
              />
            )}
          </SectionCard>
        </Grid>
      </Grid>

      <Dialog open={priceDialogOpen} onClose={() => setPriceDialogOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Price Comparisons</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.25}>
            {comparisonRows.length ? comparisonRows.map((row) => (
              <Paper key={`${row.type}-${row.product}-${row.supplier}-${row.terminalId || ""}`} variant="outlined" sx={{ p: 1.5 }}>
                <Stack direction="row" justifyContent="space-between" spacing={1.5}>
                  <Box>
                    <Typography fontWeight={700}>{row.product}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {row.supplier}{row.location ? ` | ${row.location}` : ""}
                    </Typography>
                  </Box>
                  <Stack alignItems="flex-end">
                    <Typography variant="h6">{price(row.referencePrice)}</Typography>
                    <Chip size="small" label={row.type === "terminal" ? "Terminal rack" : "Supplier delivered"} />
                  </Stack>
                </Stack>
              </Paper>
            )) : <Typography color="text.secondary">No comparison rows available for the selected filter.</Typography>}
          </Stack>
        </DialogContent>
      </Dialog>

      <Dialog open={statusDialogOpen} onClose={() => setStatusDialogOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>{selectedRecord ? `${selectedRecord.bolNumber} Status History` : "eBOL Status History"}</DialogTitle>
        <DialogContent dividers>
          {statusLoading ? <LinearProgress /> : null}
          {selectedRecord ? (
            <Stack spacing={1.5} sx={{ mt: statusLoading ? 1.5 : 0 }}>
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Stack spacing={1}>
                  <Typography variant="body2" color="text.secondary">
                    {selectedRecord.destinationSiteCode} | {selectedRecord.destinationSiteName}
                  </Typography>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <Chip size="small" variant="outlined" label={selectedRecord.terminalName} />
                    <Chip size="small" variant="outlined" label={selectedRecord.supplier} />
                    <Chip size="small" variant="outlined" label={selectedRecord.tankLabel || selectedRecord.productName} />
                    <Chip size="small" variant="outlined" label={`${gallons(selectedRecord.gallonsCorrected)} gal`} />
                    <Chip size="small" variant="outlined" label={money(selectedRecord.totalCost)} />
                    <Chip size="small" variant="outlined" label={money(selectedRecord.truckingCost)} />
                    <Chip size="small" label={selectedRecord.status} sx={{ textTransform: "capitalize" }} />
                  </Stack>
                </Stack>
              </Paper>

              {[
                ["Destination", selectedRecord.destinationAddress, false],
                ["Loaded", selectedRecord.loadDate || selectedRecord.createdAt, true],
                ["Delivered", selectedRecord.deliveryDate, true],
                ["Received", statusDetail?.receivedAt, true],
                ["Approved", statusDetail?.approvedAt, true],
                ["Reconciled", statusDetail?.reconciledAt, true],
                ["Rejected", statusDetail?.rejectedAt, true]
              ].map(([label, value, isDate]) => (
                <Paper key={label} variant="outlined" sx={{ p: 1.25 }}>
                  <Stack direction="row" justifyContent="space-between" spacing={1}>
                    <Typography fontWeight={700}>{label}</Typography>
                    <Typography color="text.secondary">{isDate ? dateTime(value) : (value || "n/a")}</Typography>
                  </Stack>
                </Paper>
              ))}

              {(statusDetail?.statusHistory || []).length ? (
                <Stack spacing={1}>
                  <Typography variant="subtitle2">Status History</Typography>
                  {statusDetail.statusHistory.map((item, index) => (
                    <Paper key={`${item.status}-${item.at || index}`} variant="outlined" sx={{ p: 1.25 }}>
                      <Stack direction="row" justifyContent="space-between" spacing={1}>
                        <Box>
                          <Typography fontWeight={700} sx={{ textTransform: "capitalize" }}>{item.status}</Typography>
                          <Typography variant="caption" color="text.secondary">{item.by || "System"}</Typography>
                        </Box>
                        <Typography variant="body2" color="text.secondary">{dateTime(item.at)}</Typography>
                      </Stack>
                      {item.note ? <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>{item.note}</Typography> : null}
                    </Paper>
                  ))}
                </Stack>
              ) : null}
            </Stack>
          ) : (
            <Typography color="text.secondary">Select an eBOL to inspect approval workflow detail.</Typography>
          )}
        </DialogContent>
      </Dialog>
    </Stack>
  );
}
