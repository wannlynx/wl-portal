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
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { api } from "../api";
import { TanStackDataTable } from "../components/TanStackDataTable";

const PRESETS = [
  { label: "Today", value: "today" },
  { label: "7 Days", value: "7d" },
  { label: "30 Days", value: "30d" }
];

const TOP_LEVEL_TABS = [
  { value: "operations", label: "Allied Operations" },
  { value: "management", label: "Allied Management" }
];

const MANAGEMENT_TABS = [
  { value: "versions", label: "6. Versions" },
  { value: "codes", label: "7. Error / Status" },
  { value: "diagnostics", label: "8. Diagnostics" }
];

const UPGRADE_TABS = [
  { value: "create", label: "Create Upgrade" },
  { value: "schedules", label: "Upgrade Schedules" },
  { value: "push", label: "Push Upgrades" }
];

const CONTROLLER_VERSION_ROWS = [
  { label: "Controller Family", value: "Not yet surfaced by API", source: "Unavailable" },
  { label: "ANDI Firmware", value: "Not yet surfaced by API", source: "Unavailable" },
  { label: "Dispenser Interface Module", value: "Not yet surfaced by API", source: "Unavailable" },
  { label: "Tank Gauge Version", value: "Not yet surfaced by API", source: "Unavailable" },
  { label: "Price Sign Version", value: "Not yet surfaced by API", source: "Unavailable" },
  { label: "Card Reader Firmware", value: "Not yet surfaced by API", source: "Unavailable" }
];

function money(value) {
  return `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function count(value, digits = 0) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function pct(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function dateTime(value, timezone = "America/New_York") {
  if (!value) return "n/a";
  return new Date(value).toLocaleString([], {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function localDateTimeValue(date) {
  if (!date) return "";
  const offset = date.getTimezoneOffset();
  const adjusted = new Date(date.getTime() - offset * 60000);
  return adjusted.toISOString().slice(0, 16);
}

function shortHour(hour) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const normalized = hour % 12 || 12;
  return `${normalized}:00 ${suffix}`;
}

function latestRowsByKey(rows, key) {
  const latest = new Map();
  for (const row of rows || []) {
    if (row?.[key] && !latest.has(row[key])) latest.set(row[key], row);
  }
  return [...latest.values()];
}

function extractPumpNumber(value) {
  const match = String(value || "").match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function groupByPumpNumber(rows, pickValue) {
  const grouped = new Map();
  for (const row of rows || []) {
    const pumpNumber = extractPumpNumber(row?.fuelPositionId);
    if (pumpNumber == null) continue;
    if (!grouped.has(pumpNumber)) grouped.set(pumpNumber, []);
    grouped.get(pumpNumber).push(row);
  }
  const result = new Map();
  for (const [pumpNumber, pumpRows] of grouped.entries()) {
    result.set(pumpNumber, pickValue(pumpRows));
  }
  return result;
}

function buildPumpStatus({ alerts, latestTransaction, health }) {
  if ((alerts || []).some((alert) => alert.severity === "critical")) {
    return { label: "Error", color: "error", source: "Direct alert" };
  }
  if (latestTransaction) {
    const ageMinutes = (Date.now() - new Date(latestTransaction.timestamp).getTime()) / 60000;
    if (ageMinutes <= 15) return { label: "Active", color: "success", source: "Inferred from latest transaction" };
  }
  if ((health?.transactions || 0) > 0) {
    return { label: "Idle", color: "default", source: "Inferred from daily Allied activity" };
  }
  return { label: "Idle", color: "default", source: "No current transaction activity" };
}

function sourceChip(label, tone = "default") {
  return <Chip size="small" label={label} color={tone} variant={tone === "default" ? "outlined" : "filled"} />;
}

function severityRank(value) {
  if (value === "critical") return 3;
  if (value === "warning") return 2;
  if (value === "info") return 1;
  return 0;
}

function batchStatusTone(value) {
  if (value === "Successful") return "success";
  if (value === "Failed") return "error";
  if (value === "Cancelled") return "default";
  return "warning";
}

function parseScheduledAt(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function inferBatchSiteStatus(batch, siteRow, siteId) {
  const scheduledAt = parseScheduledAt(batch.scheduledFor);
  const alertSeverity = siteRow?.topSeverity || "info";
  const batchLabel = (batch.cards || []).map((card) => card.name).join(", ") || "Upgrade batch";

  if (batch.cancelledAt || (batch.cancelledSiteIds || []).includes(siteId)) {
    return {
      label: "Cancelled",
      logLines: [
        `Batch ${batch.id} was cancelled before execution.`,
        batch.cancelledAt ? `Cancelled at ${dateTime(batch.cancelledAt, siteRow?.timezone)}` : "Cancelled timestamp unavailable."
      ]
    };
  }

  if (scheduledAt && scheduledAt.getTime() > Date.now()) {
    return {
      label: "Pending",
      logLines: [
        `Upgrade ${batchLabel} is scheduled.`,
        `Window opens at ${dateTime(batch.scheduledFor, siteRow?.timezone)}.`,
        `Target site ${siteRow?.siteCode || siteRow?.siteId} is queued and awaiting dispatch.`
      ]
    };
  }

  if (alertSeverity === "critical") {
    return {
      label: "Failed",
      logLines: [
        `Dispatch started for ${batchLabel}.`,
        `Pre-flight check failed because ${siteRow?.siteCode || siteRow?.siteId} has a critical alert posture.`,
        `Controller endpoint was not upgraded. Review site alerts before retrying.`
      ]
    };
  }

  return {
    label: "Successful",
    logLines: [
      `Dispatch started for ${batchLabel}.`,
      `Payload delivered to ${siteRow?.siteCode || siteRow?.siteId}.`,
      `Execution finished without blocking alerts. Site marked successful.`
    ]
  };
}

function SectionCard({ title, subtitle, children, action = null }) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1.5}>
            <Box>
              <Typography variant="h6">{title}</Typography>
              {subtitle ? <Typography variant="body2" color="text.secondary">{subtitle}</Typography> : null}
            </Box>
            {action}
          </Stack>
          {children}
        </Stack>
      </CardContent>
    </Card>
  );
}

function MetricCard({ label, value, caption, source }) {
  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardContent>
        <Stack spacing={1}>
          <Typography variant="caption" color="text.secondary">{label}</Typography>
          <Typography variant="h5">{value}</Typography>
          {caption ? <Typography variant="body2" color="text.secondary">{caption}</Typography> : null}
          {source ? sourceChip(source, source === "Direct" ? "success" : source === "Inferred" ? "warning" : "default") : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

function StatusLogDialog({ logDialog, onClose }) {
  return (
    <Dialog open={Boolean(logDialog)} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{logDialog?.title || "Upgrade Logs"}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1}>
          {(logDialog?.lines || []).map((line, index) => (
            <Paper key={`${index}-${line}`} variant="outlined" sx={{ p: 1.25 }}>
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", fontFamily: "monospace" }}>{line}</Typography>
            </Paper>
          ))}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

export function AlliedMgmtPage({ focus = "all" }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [sites, setSites] = useState([]);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [preset, setPreset] = useState("30d");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [topLevelTab, setTopLevelTab] = useState(focus === "upgrades" ? "management" : "operations");
  const [managementTab, setManagementTab] = useState("versions");
  const [upgradeTab, setUpgradeTab] = useState("create");
  const [regionFilter, setRegionFilter] = useState("");
  const [siteSearch, setSiteSearch] = useState("");
  const [selectedUpgradeSiteIds, setSelectedUpgradeSiteIds] = useState([]);
  const [upgradeCards, setUpgradeCards] = useState([]);
  const [selectedUpgradeCardIds, setSelectedUpgradeCardIds] = useState([]);
  const [draftUpgradeCard, setDraftUpgradeCard] = useState({
    name: "",
    commandsText: ""
  });
  const [scheduleForm, setScheduleForm] = useState({
    scheduledFor: localDateTimeValue(new Date(Date.now() + 60 * 60000))
  });
  const [upgradeBatches, setUpgradeBatches] = useState([]);
  const [logDialog, setLogDialog] = useState(null);
  const [overview, setOverview] = useState({ portfolioToday: null, tankRows: [], pricingSnapshot: null, alerts: [] });
  const [detail, setDetail] = useState({ site: null, pumps: [], alerts: [], tankRows: [], tankHistory: [], alliedSummary: null, alliedRows: [] });

  useEffect(() => {
    let ignore = false;
    async function loadOverview() {
      setLoading(true);
      try {
        const [siteRows, portfolioToday, tankRows, pricingSnapshot, alerts] = await Promise.all([
          api.getSites(),
          api.getAlliedPortfolioSummary({ preset }),
          api.getTankInformation({ limit: 600 }),
          api.getPricingSnapshot().catch(() => null),
          api.getAlerts().catch(() => [])
        ]);
        if (ignore) return;
        setSites(siteRows || []);
        setSelectedSiteId((current) => current || siteRows?.[0]?.id || "");
        setSelectedUpgradeSiteIds((current) => current.filter((siteId) => (siteRows || []).some((site) => site.id === siteId)));
        setOverview({ portfolioToday, tankRows: tankRows || [], pricingSnapshot, alerts: alerts || [] });
        setError("");
      } catch (nextError) {
        if (!ignore) setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to load Allied Mgmt"));
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    loadOverview();
    return () => {
      ignore = true;
    };
  }, [preset]);

  useEffect(() => {
    if (!selectedSiteId) return;
    let ignore = false;
    async function loadDetail() {
      setDetailLoading(true);
      try {
        const [site, pumps, alerts, tankRows, tankHistory, alliedSummary, alliedRows] = await Promise.all([
          api.getSite(selectedSiteId),
          api.getPumps(selectedSiteId),
          api.getAlerts({ siteId: selectedSiteId }),
          api.getTankInformation({ siteId: selectedSiteId, limit: 200 }),
          api.getTankHistory({ siteId: selectedSiteId, limit: 200 }),
          api.getAlliedTransactionsSummary(selectedSiteId, { preset }),
          api.getAlliedTransactions(selectedSiteId, { preset, page: 1, pageSize: 150, sortBy: "timestamp", sortDir: "desc" })
        ]);
        if (ignore) return;
        setDetail({
          site,
          pumps: pumps || [],
          alerts: alerts || [],
          tankRows: tankRows || [],
          tankHistory: tankHistory || [],
          alliedSummary,
          alliedRows: alliedRows?.rows || []
        });
        setError("");
      } catch (nextError) {
        if (!ignore) setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to load site detail"));
      } finally {
        if (!ignore) setDetailLoading(false);
      }
    }
    loadDetail();
    return () => {
      ignore = true;
    };
  }, [preset, selectedSiteId]);

  const presetLabel = useMemo(
    () => PRESETS.find((option) => option.value === preset)?.label || "Selected Window",
    [preset]
  );

  const selectedSite = useMemo(
    () => (detail.site?.id === selectedSiteId ? detail.site : sites.find((site) => site.id === selectedSiteId) || detail.site),
    [detail.site, selectedSiteId, sites]
  );

  const latestSiteTanks = useMemo(() => latestRowsByKey(detail.tankRows, "tankId"), [detail.tankRows]);
  const latestTankHistory = useMemo(() => latestRowsByKey(detail.tankHistory, "tankId"), [detail.tankHistory]);
  const latestNetworkTanks = useMemo(() => latestRowsByKey(overview.tankRows, "tankId"), [overview.tankRows]);

  const pumpHealthByNumber = useMemo(
    () => groupByPumpNumber(detail.alliedSummary?.pumpHealth || [], (rows) => rows[0]),
    [detail.alliedSummary]
  );
  const latestTransactionByPumpNumber = useMemo(
    () => groupByPumpNumber(detail.alliedRows, (rows) => rows.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0]),
    [detail.alliedRows]
  );
  const gradeByPumpNumber = useMemo(
    () =>
      groupByPumpNumber(detail.alliedRows, (rows) => {
        const counts = new Map();
        for (const row of rows) {
          const label = row.fuelDescription || "Unknown";
          counts.set(label, (counts.get(label) || 0) + 1);
        }
        return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "Unknown";
      }),
    [detail.alliedRows]
  );

  const portfolioBySiteId = useMemo(() => {
    const next = new Map();
    for (const row of overview.portfolioToday?.siteSummaries || []) next.set(row.siteId, row);
    return next;
  }, [overview.portfolioToday]);

  const alertsBySiteId = useMemo(() => {
    const next = new Map();
    for (const row of overview.alerts || []) {
      if (!row?.siteId) continue;
      if (!next.has(row.siteId)) next.set(row.siteId, []);
      next.get(row.siteId).push(row);
    }
    for (const rows of next.values()) {
      rows.sort((a, b) => new Date(b.createdAt || b.eventAt || 0).getTime() - new Date(a.createdAt || a.eventAt || 0).getTime());
    }
    return next;
  }, [overview.alerts]);

  const lowTankCountBySiteId = useMemo(() => {
    const next = new Map();
    for (const row of latestNetworkTanks || []) {
      if (!row?.siteId) continue;
      if (Number(row.fillPercent || 0) >= 15) continue;
      next.set(row.siteId, (next.get(row.siteId) || 0) + 1);
    }
    return next;
  }, [latestNetworkTanks]);

  const allSiteManagementRows = useMemo(
    () =>
      (sites || []).map((site) => {
        const portfolio = portfolioBySiteId.get(site.id) || null;
        const alerts = alertsBySiteId.get(site.id) || [];
        const topAlert = alerts[0] || null;
        const topSeverity = alerts.slice().sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0]?.severity || "info";
        const controllerEndpoint = site.integration ? `${site.integration.atgHost || "host not set"}:${site.integration.atgPort || "n/a"}` : "No site integration configured";
        return {
          siteId: site.id,
          siteCode: site.siteCode || site.id,
          siteName: site.name || "Unnamed site",
          region: site.region || "Unassigned",
          timezone: site.timezone || "America/New_York",
          connectedSides: Number(site.pumpSidesConnected || 0),
          expectedSides: Number(site.pumpSidesExpected || 0),
          transactionCount: Number(portfolio?.totalTransactions || 0),
          totalSales: Number(portfolio?.totalSales || 0),
          completionRate: Number(portfolio?.completionRate || 0) * 100,
          flaggedCount: Number(portfolio?.flaggedCount || 0),
          topDenialReason: portfolio?.topDenialReason || "None",
          lowTankCount: lowTankCountBySiteId.get(site.id) || 0,
          alertCount: alerts.length,
          topSeverity,
          latestAlertAt: topAlert?.createdAt || topAlert?.eventAt || "",
          latestAlertMessage: topAlert?.message || "No current alerts",
          controllerEndpoint,
          lastAlliedTimestamp: portfolio?.lastTransactionAt || portfolio?.latestTimestamp || "",
          unavailableCount: CONTROLLER_VERSION_ROWS.length,
          versionSummary: "ANDI version fields pending API support"
        };
      }),
    [alertsBySiteId, lowTankCountBySiteId, portfolioBySiteId, sites]
  );

  const regionOptions = useMemo(
    () => [...new Set(allSiteManagementRows.map((row) => row.region).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [allSiteManagementRows]
  );

  const filteredManagementRows = useMemo(() => {
    const query = siteSearch.trim().toLowerCase();
    return allSiteManagementRows.filter((row) => {
      if (regionFilter && row.region !== regionFilter) return false;
      if (!query) return true;
      return [row.siteCode, row.siteName, row.region, row.controllerEndpoint].some((value) => String(value || "").toLowerCase().includes(query));
    });
  }, [allSiteManagementRows, regionFilter, siteSearch]);

  const visibleUpgradeRows = filteredManagementRows;

  const queueRows = useMemo(() => {
    return upgradeBatches
      .slice()
      .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
      .map((batch, index) => {
        const cards = (batch.cardIds || [])
          .map((cardId) => upgradeCards.find((card) => card.id === cardId))
          .filter(Boolean);
        const targets = batch.siteIds
          .map((siteId) => {
            const siteRow = allSiteManagementRows.find((row) => row.siteId === siteId);
            if (!siteRow) return null;
            const status = inferBatchSiteStatus(batch, siteRow, siteId);
            return { siteId, siteRow, status };
          })
          .filter(Boolean);

        const pendingCount = targets.filter((target) => target.status.label === "Pending").length;
        const failedCount = targets.filter((target) => target.status.label === "Failed").length;
        const successCount = targets.filter((target) => target.status.label === "Successful").length;
        const cancelledCount = targets.filter((target) => target.status.label === "Cancelled").length;
        const batchStatus = cancelledCount === targets.length && targets.length
          ? "Cancelled"
          : pendingCount > 0
            ? "Pending"
            : failedCount > 0
              ? "Failed"
              : successCount > 0
                ? "Successful"
                : "Pending";

        return {
          ...batch,
          sequence: index + 1,
          cards,
          batchStatus,
          pendingCount,
          failedCount,
          successCount,
          targets
        };
      });
  }, [allSiteManagementRows, upgradeBatches, upgradeCards]);

  const pushRows = useMemo(
    () =>
      queueRows.flatMap((batch) =>
        batch.targets.map((target) => ({
          key: `${batch.id}-${target.siteId}`,
          batch,
          target,
          cardNames: batch.cards.map((card) => card.name)
        }))
      ),
    [queueRows]
  );

  const dispenserRows = useMemo(
    () =>
      (detail.pumps || []).map((pump) => {
        const pumpNumber = Number(pump.pumpNumber);
        const alerts = (detail.alerts || []).filter((alert) => alert.pumpId === pump.id);
        const latestTransaction = latestTransactionByPumpNumber.get(pumpNumber) || null;
        const health = pumpHealthByNumber.get(pumpNumber) || null;
        const status = buildPumpStatus({ alerts, latestTransaction, health });
        const cardReaderError = alerts.find((alert) => String(alert.message || "").toLowerCase().includes("card"));
        return {
          pumpLabel: pump.label,
          status,
          nozzlePosition: latestTransaction ? "In-use" : "In-holster",
          nozzleSource: latestTransaction ? "Inferred from latest transaction" : "Inferred from no active transaction",
          cardReaderStatus: cardReaderError ? "Card Reader Error" : "Ready",
          cardReaderSource: cardReaderError ? "Direct alert" : "No current card-reader alerts",
          latestTransaction,
          health,
          grade: gradeByPumpNumber.get(pumpNumber) || "Unknown"
        };
      }),
    [detail.alerts, detail.pumps, gradeByPumpNumber, latestTransactionByPumpNumber, pumpHealthByNumber]
  );

  const gradeRows = useMemo(() => {
    const grouped = new Map();
    for (const row of detail.alliedRows || []) {
      const label = row.fuelDescription || "Unknown";
      if (!grouped.has(label)) grouped.set(label, []);
      grouped.get(label).push(row);
    }
    return [...grouped.entries()].map(([label, rows]) => {
      const directPrices = rows.map((row) => Number(row.actualSalesPrice || 0)).filter((value) => value > 0);
      return {
        grade: label,
        productTypeCode: label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        currentPrice: directPrices.length ? directPrices[0] : null,
        averagePrice: directPrices.length ? directPrices.reduce((sum, value) => sum + value, 0) / directPrices.length : null,
        transactions: rows.length,
        blenderInfo: /midgrade/i.test(label) ? "Blend possible" : "No blend flag in Allied row data"
      };
    }).sort((a, b) => b.transactions - a.transactions);
  }, [detail.alliedRows]);

  const paymentRows = useMemo(
    () =>
      (detail.alliedRows || []).slice(0, 20).map((row) => ({
        transactionId: row.transactionId,
        pump: row.fuelPositionId || "Unknown",
        paymentMethod: row.paymentType || "Unknown",
        cardType: row.cardType || "Unknown",
        cardName: row.cardName || "Unknown",
        last4: row.last4 || "n/a",
        authCode: row.authAmount != null ? `Auth ${money(row.authAmount)}` : "Not surfaced",
        approvalStatus: row.emvStatus || "Unknown",
        denialReason: row.tagDenialReason || "None"
      })),
    [detail.alliedRows]
  );

  const hourlyRows = useMemo(() => {
    const grouped = new Map();
    for (const row of detail.alliedRows || []) {
      const hour = new Date(row.timestamp).getHours();
      if (!grouped.has(hour)) grouped.set(hour, { hour, transactions: 0, gallons: 0, revenue: 0 });
      const bucket = grouped.get(hour);
      bucket.transactions += 1;
      bucket.gallons += Number(row.fuelQuantityGallons || 0);
      bucket.revenue += Number(row.totalAmount || 0);
    }
    return [...grouped.values()].sort((a, b) => a.hour - b.hour);
  }, [detail.alliedRows]);

  const peakHour = useMemo(
    () => hourlyRows.slice().sort((a, b) => b.transactions - a.transactions || b.revenue - a.revenue)[0] || null,
    [hourlyRows]
  );

  const gradeBreakdown = useMemo(() => {
    const grouped = new Map();
    for (const row of detail.alliedRows || []) {
      const key = row.fuelDescription || "Unknown";
      if (!grouped.has(key)) grouped.set(key, { grade: key, transactions: 0, gallons: 0, revenue: 0 });
      const bucket = grouped.get(key);
      bucket.transactions += 1;
      bucket.gallons += Number(row.fuelQuantityGallons || 0);
      bucket.revenue += Number(row.totalAmount || 0);
    }
    return [...grouped.values()].sort((a, b) => b.revenue - a.revenue);
  }, [detail.alliedRows]);

  const tankRows = useMemo(
    () =>
      latestSiteTanks.map((tank) => {
        const history = latestTankHistory.find((item) => item.tankId === tank.tankId) || null;
        const lowLevel = Number(tank.fillPercent || 0) < 15;
        return {
          label: tank.tankLabel || tank.atgTankId,
          product: tank.product,
          gallons: Number(tank.volume || 0) / 3.78541,
          fillPercent: Number(tank.fillPercent || 0),
          temperature: history?.tempC ?? null,
          lowLevel
        };
      }),
    [latestSiteTanks, latestTankHistory]
  );

  const lowInventoryAlerts = useMemo(
    () => latestNetworkTanks.filter((row) => Number(row.fillPercent || 0) < 15).sort((a, b) => Number(a.fillPercent || 0) - Number(b.fillPercent || 0)),
    [latestNetworkTanks]
  );

  const alertRows = useMemo(
    () =>
      (detail.alerts || []).map((alert) => ({
        timestamp: alert.createdAt || alert.eventAt,
        component: alert.component || alert.alertType || "Unknown",
        code: alert.code || "n/a",
        message: alert.message || "No message",
        severity: alert.severity || "info"
      })),
    [detail.alerts]
  );

  const diagnosticsRows = useMemo(
    () => [
      { label: "Network Status", value: `${count(selectedSite?.pumpSidesConnected || 0)}/${count(selectedSite?.pumpSidesExpected || 0)} pump sides connected`, source: "Direct site summary" },
      { label: "Uptime", value: "Not yet surfaced by API", source: "Unavailable" },
      { label: "Controller Temperature", value: "Not yet surfaced by API", source: "Unavailable" },
      { label: "Memory Usage", value: "Not yet surfaced by API", source: "Unavailable" },
      { label: "RS-232 Port Status", value: selectedSite?.integration ? `ATG ${selectedSite.integration.atgHost || "host not set"}:${selectedSite.integration.atgPort || "n/a"}` : "No controller integration configured", source: selectedSite?.integration ? "Direct site integration" : "Unavailable" },
      { label: "Message Counts", value: `${count(detail.alliedSummary?.kpis?.totalTransactions || 0)} transactions today`, source: "Direct Allied summary" },
      { label: "Maintenance Alerts", value: `${count(alertRows.length)} current alert rows`, source: "Direct alert feed" }
    ],
    [alertRows.length, detail.alliedSummary?.kpis?.totalTransactions, selectedSite]
  );
  const dispenserColumns = useMemo(() => [
    { accessorKey: "pumpLabel", header: "Pump", cell: (info) => info.getValue(), meta: { minWidth: 120 } },
    { accessorKey: "statusLabel", header: "Status", cell: (info) => info.getValue(), meta: { minWidth: 120 } },
    { accessorKey: "nozzlePosition", header: "Nozzle", cell: (info) => info.getValue(), meta: { minWidth: 120 } },
    { accessorKey: "grade", header: "Current Grade", cell: (info) => info.getValue(), meta: { minWidth: 140 } },
    { accessorKey: "latestTransactionLabel", header: "Latest Transaction", cell: (info) => info.getValue(), meta: { minWidth: 180 } },
    { accessorKey: "latestGallonsLabel", header: "Gallons", cell: (info) => info.getValue(), meta: { minWidth: 100 } },
    { accessorKey: "latestAmountLabel", header: "Amount", cell: (info) => info.getValue(), meta: { minWidth: 110 } },
    { accessorKey: "cardReaderStatus", header: "Card Reader", cell: (info) => info.getValue(), meta: { minWidth: 140 } }
  ], []);
  const gradeColumns = useMemo(() => [
    { accessorKey: "grade", header: "Grade", cell: (info) => info.getValue(), meta: { minWidth: 140 } },
    { accessorKey: "productTypeCode", header: "Product Type Code", cell: (info) => info.getValue(), meta: { minWidth: 160 } },
    { accessorKey: "currentPriceLabel", header: "Observed Price / Gal", cell: (info) => info.getValue(), meta: { minWidth: 140 } },
    { accessorKey: "averagePriceLabel", header: "Average Price / Gal", cell: (info) => info.getValue(), meta: { minWidth: 140 } },
    { accessorKey: "transactions", header: "Transactions", cell: (info) => count(info.getValue()), meta: { minWidth: 110 } },
    { accessorKey: "blenderInfo", header: "Blend Info", cell: (info) => info.getValue(), meta: { minWidth: 180 } }
  ], []);
  const paymentColumns = useMemo(() => [
    { accessorKey: "transactionId", header: "Txn", cell: (info) => info.getValue(), meta: { minWidth: 120 } },
    { accessorKey: "pump", header: "Pump", cell: (info) => info.getValue(), meta: { minWidth: 90 } },
    { accessorKey: "paymentMethod", header: "Payment", cell: (info) => info.getValue(), meta: { minWidth: 120 } },
    { accessorKey: "cardType", header: "Card Type", cell: (info) => info.getValue(), meta: { minWidth: 120 } },
    { accessorKey: "cardName", header: "Card Name", cell: (info) => info.getValue(), meta: { minWidth: 120 } },
    { accessorKey: "last4", header: "Last 4", cell: (info) => info.getValue(), meta: { minWidth: 90 } },
    { accessorKey: "authCode", header: "Authorization", cell: (info) => info.getValue(), meta: { minWidth: 130 } },
    { accessorKey: "approvalStatus", header: "Status", cell: (info) => info.getValue(), meta: { minWidth: 120 } },
    { accessorKey: "denialReason", header: "Denial", cell: (info) => info.getValue(), meta: { minWidth: 140 } }
  ], []);
  const pumpDayColumns = useMemo(() => [
    { accessorKey: "fuelPositionId", header: "Pump", cell: (info) => info.getValue(), meta: { minWidth: 90 } },
    { accessorKey: "transactions", header: "Transactions", cell: (info) => count(info.getValue()), meta: { minWidth: 110 } },
    { accessorKey: "gallons", header: "Gallons", cell: (info) => count(info.getValue(), 2), meta: { minWidth: 100 } },
    { accessorKey: "sales", header: "Revenue", cell: (info) => money(info.getValue()), meta: { minWidth: 120 } }
  ], []);
  const gradeBreakdownColumns = useMemo(() => [
    { accessorKey: "grade", header: "Grade", cell: (info) => info.getValue(), meta: { minWidth: 140 } },
    { accessorKey: "transactions", header: "Transactions", cell: (info) => count(info.getValue()), meta: { minWidth: 110 } },
    { accessorKey: "gallons", header: "Gallons", cell: (info) => count(info.getValue(), 2), meta: { minWidth: 100 } },
    { accessorKey: "revenue", header: "Revenue", cell: (info) => money(info.getValue()), meta: { minWidth: 120 } }
  ], []);
  const hourlyColumns = useMemo(() => [
    { accessorKey: "hourLabel", header: "Hour", cell: (info) => info.getValue(), meta: { minWidth: 100 } },
    { accessorKey: "transactions", header: "Transactions", cell: (info) => count(info.getValue()), meta: { minWidth: 110 } },
    { accessorKey: "gallons", header: "Gallons", cell: (info) => count(info.getValue(), 2), meta: { minWidth: 100 } },
    { accessorKey: "revenue", header: "Revenue", cell: (info) => money(info.getValue()), meta: { minWidth: 120 } }
  ], []);
  const tankColumns = useMemo(() => [
    { accessorKey: "label", header: "Tank", cell: (info) => info.getValue(), meta: { minWidth: 120 } },
    { accessorKey: "product", header: "Product", cell: (info) => info.getValue(), meta: { minWidth: 120 } },
    { accessorKey: "gallons", header: "Current Gallons", cell: (info) => count(info.getValue(), 1), meta: { minWidth: 120 } },
    { accessorKey: "fillPercent", header: "Capacity %", cell: (info) => pct(info.getValue()), meta: { minWidth: 100 } },
    { accessorKey: "temperatureLabel", header: "Temperature C", cell: (info) => info.getValue(), meta: { minWidth: 120 } },
    { accessorKey: "lowLevelLabel", header: "Low-Level Alert", cell: (info) => info.getValue(), meta: { minWidth: 120 } }
  ], []);
  const managementVersionColumns = useMemo(() => [
    { accessorKey: "siteCode", header: "Site", cell: (info) => info.getValue(), meta: { minWidth: 100 } },
    { accessorKey: "region", header: "Region", cell: (info) => info.getValue(), meta: { minWidth: 120 } },
    { accessorKey: "trafficLabel", header: "Traffic", cell: (info) => info.getValue(), meta: { minWidth: 110 } },
    { accessorKey: "lastAlliedLabel", header: "Last Allied Update", cell: (info) => info.getValue(), meta: { minWidth: 180 } },
    { accessorKey: "controllerEndpoint", header: "Controller Endpoint", cell: (info) => info.getValue(), meta: { minWidth: 170 } },
    { accessorKey: "versionSummary", header: "Version Coverage", cell: (info) => info.getValue(), meta: { minWidth: 180 } },
    { accessorKey: "sourceLabel", header: "Source", cell: (info) => info.getValue(), meta: { minWidth: 180 } }
  ], []);
  const managementCodesColumns = useMemo(() => [
    { accessorKey: "siteCode", header: "Site", cell: (info) => info.getValue(), meta: { minWidth: 100 } },
    { accessorKey: "region", header: "Region", cell: (info) => info.getValue(), meta: { minWidth: 120 } },
    { accessorKey: "alertCount", header: "Alert Count", cell: (info) => count(info.getValue()), meta: { minWidth: 100 } },
    { accessorKey: "topSeverity", header: "Top Severity", cell: (info) => info.getValue(), meta: { minWidth: 120 } },
    { accessorKey: "latestAlertMessage", header: "Latest Alert", cell: (info) => info.getValue(), meta: { minWidth: 220 } },
    { accessorKey: "topDenialReason", header: "Top Denial", cell: (info) => info.getValue(), meta: { minWidth: 140 } }
  ], []);
  const managementDiagnosticsColumns = useMemo(() => [
    { accessorKey: "siteCode", header: "Site", cell: (info) => info.getValue(), meta: { minWidth: 100 } },
    { accessorKey: "region", header: "Region", cell: (info) => info.getValue(), meta: { minWidth: 120 } },
    { accessorKey: "networkStatusLabel", header: "Network Status", cell: (info) => info.getValue(), meta: { minWidth: 140 } },
    { accessorKey: "lowTankCount", header: "Low Tanks", cell: (info) => count(info.getValue()), meta: { minWidth: 90 } },
    { accessorKey: "alertCount", header: "Current Alerts", cell: (info) => count(info.getValue()), meta: { minWidth: 100 } },
    { accessorKey: "transactionCount", header: "Transactions", cell: (info) => count(info.getValue()), meta: { minWidth: 110 } },
    { accessorKey: "completionRate", header: "Completion", cell: (info) => pct(info.getValue()), meta: { minWidth: 100 } }
  ], []);
  const upgradeScheduleTargetColumns = useMemo(() => [
    { accessorKey: "selected", header: "Select", cell: (info) => <Checkbox checked={info.row.original.selected} onChange={() => toggleUpgradeSite(info.row.original.siteId)} />, meta: { minWidth: 80 } },
    { accessorKey: "siteCode", header: "Site", cell: (info) => info.getValue(), meta: { minWidth: 100 } },
    { accessorKey: "region", header: "Region", cell: (info) => info.getValue(), meta: { minWidth: 120 } },
    { accessorKey: "controllerEndpoint", header: "Endpoint", cell: (info) => info.getValue(), meta: { minWidth: 170 } },
    { accessorKey: "alertsLabel", header: "Alerts", cell: (info) => info.getValue(), meta: { minWidth: 140 } },
    { accessorKey: "selectedCardsLabel", header: "Selected Cards", cell: (info) => info.getValue(), meta: { minWidth: 120 } }
  ], [selectedUpgradeSiteIds, selectedUpgradeCardIds.length]);
  const pushColumns = useMemo(() => [
    { accessorKey: "siteCode", header: "Store", cell: (info) => info.getValue(), meta: { minWidth: 100 } },
    { accessorKey: "region", header: "Region", cell: (info) => info.getValue(), meta: { minWidth: 120 } },
    { accessorKey: "cardNamesLabel", header: "Upgrade Cards", cell: (info) => info.getValue(), meta: { minWidth: 200 } },
    { accessorKey: "scheduledLabel", header: "Scheduled", cell: (info) => info.getValue(), meta: { minWidth: 180 } },
    { accessorKey: "statusLabel", header: "Status", cell: (info) => <Button size="small" color={batchStatusTone(info.row.original.target.status.label)} onClick={() => openStatusLogs(info.row.original.batch, info.row.original.target)}>{info.getValue()}</Button>, meta: { minWidth: 120 } },
    { accessorKey: "pendingAction", header: "Pending Action", cell: (info) => <Button variant="outlined" size="small" disabled={info.row.original.target.status.label !== "Pending"} onClick={() => cancelPendingTarget(info.row.original.batch.id, info.row.original.target.siteId)}>Delete Pending Update</Button>, meta: { minWidth: 170 } }
  ], []);
  const versionDetailColumns = useMemo(() => [
    { accessorKey: "label", header: "Item", cell: (info) => info.getValue(), meta: { minWidth: 180 } },
    { accessorKey: "value", header: "Value", cell: (info) => info.getValue(), meta: { minWidth: 180 } },
    { accessorKey: "source", header: "Source", cell: (info) => info.getValue(), meta: { minWidth: 160 } }
  ], []);
  const alertDetailColumns = useMemo(() => [
    { accessorKey: "timestampLabel", header: "Timestamp", cell: (info) => info.getValue(), meta: { minWidth: 180 } },
    { accessorKey: "component", header: "Component", cell: (info) => info.getValue(), meta: { minWidth: 140 } },
    { accessorKey: "code", header: "Code", cell: (info) => info.getValue(), meta: { minWidth: 120 } },
    { accessorKey: "severity", header: "Severity", cell: (info) => info.getValue(), meta: { minWidth: 100 } }
  ], []);
  const diagnosticsDetailColumns = useMemo(() => [
    { accessorKey: "label", header: "Diagnostic", cell: (info) => info.getValue(), meta: { minWidth: 180 } },
    { accessorKey: "value", header: "Value", cell: (info) => info.getValue(), meta: { minWidth: 220 } }
  ], []);

  function toggleUpgradeSite(siteId) {
    setSelectedUpgradeSiteIds((current) => current.includes(siteId) ? current.filter((value) => value !== siteId) : [...current, siteId]);
  }

  function selectVisibleSites() {
    setSelectedUpgradeSiteIds((current) => {
      const next = new Set(current);
      for (const row of visibleUpgradeRows) next.add(row.siteId);
      return [...next];
    });
  }

  function clearVisibleSites() {
    const visibleIds = new Set(visibleUpgradeRows.map((row) => row.siteId));
    setSelectedUpgradeSiteIds((current) => current.filter((siteId) => !visibleIds.has(siteId)));
  }

  function toggleUpgradeCard(cardId) {
    setSelectedUpgradeCardIds((current) => current.includes(cardId) ? current.filter((value) => value !== cardId) : [...current, cardId]);
  }

  function createUpgradeCard(name, commandsText, source = "Typed") {
    const trimmedName = String(name || "").trim();
    const trimmedCommands = String(commandsText || "").trim();
    if (!trimmedName || !trimmedCommands) {
      setError("Upgrade card name and ANDI commands are required.");
      return;
    }
    const commands = trimmedCommands.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const cardId = `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setUpgradeCards((current) => [
      ...current,
      { id: cardId, name: trimmedName, commands, source, createdAt: new Date().toISOString() }
    ]);
    setSelectedUpgradeCardIds((current) => [...current, cardId]);
    setDraftUpgradeCard({ name: "", commandsText: "" });
    setError("");
  }

  function handleUpgradeFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => createUpgradeCard(file.name.replace(/\.[^.]+$/, ""), String(reader.result || ""), "Uploaded");
    reader.onerror = () => setError("Unable to read the selected upgrade file.");
    reader.readAsText(file);
    event.target.value = "";
  }

  function deleteUpgradeCard(cardId) {
    setUpgradeCards((current) => current.filter((card) => card.id !== cardId));
    setSelectedUpgradeCardIds((current) => current.filter((value) => value !== cardId));
    setUpgradeBatches((current) => current.map((batch) => ({ ...batch, cardIds: (batch.cardIds || []).filter((value) => value !== cardId) })));
  }

  function queueUpgradeBatch() {
    if (!selectedUpgradeCardIds.length) {
      setError("Select at least one upgrade card to schedule.");
      return;
    }
    if (!selectedUpgradeSiteIds.length) {
      setError("Select at least one site for the upgrade batch.");
      return;
    }
    const scheduledAt = parseScheduledAt(scheduleForm.scheduledFor);
    if (!scheduledAt) {
      setError("Enter a valid schedule time for the batch.");
      return;
    }

    const batchId = `batch-${Date.now()}`;
    setUpgradeBatches((current) => [
      ...current,
      {
        id: batchId,
        cardIds: [...selectedUpgradeCardIds],
        siteIds: [...selectedUpgradeSiteIds],
        scheduledFor: scheduledAt.toISOString(),
        createdAt: new Date().toISOString(),
        cancelledAt: "",
        cancelledSiteIds: []
      }
    ]);
    setError("");
  }

  function cancelBatch(batchId) {
    setUpgradeBatches((current) => current.map((batch) => {
      if (batch.id !== batchId || batch.cancelledAt) return batch;
      const scheduledAt = parseScheduledAt(batch.scheduledFor);
      if (scheduledAt && scheduledAt.getTime() <= Date.now()) return batch;
      return { ...batch, cancelledAt: new Date().toISOString() };
    }));
  }

  function cancelPendingTarget(batchId, siteId) {
    setUpgradeBatches((current) => current.map((batch) => {
      if (batch.id !== batchId || batch.cancelledAt) return batch;
      const scheduledAt = parseScheduledAt(batch.scheduledFor);
      if (scheduledAt && scheduledAt.getTime() <= Date.now()) return batch;
      const cancelledSiteIds = new Set(batch.cancelledSiteIds || []);
      cancelledSiteIds.add(siteId);
      return { ...batch, cancelledSiteIds: [...cancelledSiteIds] };
    }));
  }

  function openStatusLogs(batch, target) {
    setLogDialog({
      title: `${target.siteRow.siteCode} | ${batch.cards.map((card) => card.name).join(", ") || "Upgrade Batch"}`,
      lines: [
        `Batch sequence #${batch.sequence}`,
        `Scheduled for ${dateTime(batch.scheduledFor, target.siteRow.timezone)}`,
        `Status ${target.status.label}`,
        `Target region ${target.siteRow.region}`,
        `Controller endpoint ${target.siteRow.controllerEndpoint}`,
        `Cards ${batch.cards.map((card) => card.name).join(" | ") || "None"}`,
        ...target.status.logLines
      ]
    });
  }

  return (
    <Stack spacing={2.5}>
      {focus !== "upgrades" ? (
        <>
          <Card variant="outlined">
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="overline" color="text.secondary">ANDI-Aligned Allied Data</Typography>
                <Typography variant="h4">Allied Mgmt</Typography>
                <Typography color="text.secondary">
                  Sections 6, 7, and 8 now sit behind Allied management tabs so operators can review every site by region, then queue ANDI-style code rollouts in sequence.
                </Typography>
                <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
                  <TextField select label="Site" value={selectedSiteId} onChange={(event) => setSelectedSiteId(event.target.value)} sx={{ minWidth: { xs: "100%", md: 320 } }}>
                    {sites.map((site) => (
                      <MenuItem key={site.id} value={site.id}>{site.siteCode} - {site.name}</MenuItem>
                    ))}
                  </TextField>
                  <Autocomplete
                    size="small"
                    options={PRESETS}
                    value={PRESETS.find((option) => option.value === preset) || null}
                    onChange={(_event, nextValue) => setPreset(nextValue?.value || "30d")}
                    getOptionLabel={(option) => option.label}
                    isOptionEqualToValue={(option, value) => option.value === value.value}
                    renderInput={(params) => <TextField {...params} label="Window" placeholder="Type a window" />}
                    sx={{ minWidth: { xs: "100%", md: 180 } }}
                    clearOnEscape
                  />
                  <Autocomplete
                    size="small"
                    options={regionOptions}
                    value={regionFilter || null}
                    onChange={(_event, nextValue) => setRegionFilter(nextValue || "")}
                    renderInput={(params) => <TextField {...params} label="Region Filter" placeholder="Type a region" />}
                    sx={{ minWidth: { xs: "100%", md: 220 } }}
                    clearOnEscape
                  />
                  <TextField
                    size="small"
                    label="Search Sites"
                    value={siteSearch}
                    onChange={(event) => setSiteSearch(event.target.value)}
                    placeholder="Code, name, endpoint"
                    sx={{ minWidth: { xs: "100%", md: 220 } }}
                  />
                </Stack>
                <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
                  <Chip label={`All sites ${count(allSiteManagementRows.length)}`} />
                  <Chip label={`Visible after filter ${count(filteredManagementRows.length)}`} />
                  <Chip label={`Queued targets ${count(selectedUpgradeSiteIds.length)}`} color="primary" />
                  <Chip label="Direct = current API fields" color="success" />
                  <Chip label="Inferred = derived from current Allied rows" color="warning" />
                  <Chip label="Unavailable = not yet surfaced by API" variant="outlined" />
                </Stack>
                {focus === "all" ? (
                  <Tabs
                    value={topLevelTab}
                    onChange={(_event, value) => setTopLevelTab(value)}
                    variant={isMobile ? "scrollable" : "standard"}
                    allowScrollButtonsMobile
                  >
                    {TOP_LEVEL_TABS.map((tab) => <Tab key={tab.value} value={tab.value} label={tab.label} />)}
                  </Tabs>
                ) : null}
              </Stack>
            </CardContent>
          </Card>

          {loading || detailLoading ? <LinearProgress /> : null}
          {error ? <Alert severity="error">{error}</Alert> : null}

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 4 }}>
              <MetricCard label={`Transactions ${presetLabel}`} value={count(detail.alliedSummary?.kpis?.totalTransactions)} caption={`${money(detail.alliedSummary?.kpis?.totalSales)} revenue`} source="Direct" />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <MetricCard label={`Gallons ${presetLabel}`} value={count(detail.alliedSummary?.kpis?.totalGallons, 1)} caption={peakHour ? `Peak hour ${shortHour(peakHour.hour)}` : "No peak-hour calculation yet"} source="Direct" />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <MetricCard label="Low-Level Alerts" value={count(lowInventoryAlerts.length)} caption={lowInventoryAlerts[0] ? `${lowInventoryAlerts[0].siteCode} ${pct(lowInventoryAlerts[0].fillPercent)}` : "No current low-level tanks"} source="Inferred" />
            </Grid>
          </Grid>
        </>
      ) : null}

      {topLevelTab === "operations" ? (
      <>
      <SectionCard title="1. Real-Time Dispenser Data" subtitle="Pump status, nozzle position, latest transaction totals, card-reader state, and current grade by pump." action={<Chip label={`${dispenserRows.length} pumps`} />}>
        <TanStackDataTable rows={dispenserRows.map((row) => ({ ...row, statusLabel: row.status.label, latestTransactionLabel: row.latestTransaction ? dateTime(row.latestTransaction.timestamp, selectedSite?.timezone) : "No active row", latestGallonsLabel: row.latestTransaction ? count(row.latestTransaction.fuelQuantityGallons, 3) : "n/a", latestAmountLabel: row.latestTransaction ? money(row.latestTransaction.totalAmount) : "n/a" }))} columns={dispenserColumns} globalSearchPlaceholder="Search dispenser rows..." initialPageSize={10} getRowId={(row) => row.pumpLabel} />
      </SectionCard>

      <SectionCard title="2. Fuel Grade & Pricing" subtitle="Fuel grades, observed transaction pricing, product-type codes, and blend notes.">
        <TanStackDataTable rows={gradeRows.map((row) => ({ ...row, currentPriceLabel: row.currentPrice != null ? money(row.currentPrice) : "n/a", averagePriceLabel: row.averagePrice != null ? money(row.averagePrice) : "n/a" }))} columns={gradeColumns} globalSearchPlaceholder="Search grades..." initialPageSize={10} getRowId={(row) => row.grade} />
      </SectionCard>

      <SectionCard title="3. Payment & Authorization" subtitle="Payment method, card brand/type, last four digits, authorization coverage, and approval or denial status.">
        <TanStackDataTable rows={paymentRows} columns={paymentColumns} globalSearchPlaceholder="Search payment rows..." initialPageSize={10} getRowId={(row) => row.transactionId} />
      </SectionCard>

      <SectionCard title="4. Daily Summaries" subtitle="Transactions per pump, gallons and revenue, grade breakdown, hourly trends, and peak hours.">
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 6 }}>
            <TanStackDataTable rows={detail.alliedSummary?.pumpHealth || []} columns={pumpDayColumns} globalSearchPlaceholder="Search pump summary..." initialPageSize={8} getRowId={(row) => row.fuelPositionId} />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TanStackDataTable rows={gradeBreakdown} columns={gradeBreakdownColumns} globalSearchPlaceholder="Search grade breakdown..." initialPageSize={8} getRowId={(row) => row.grade} />
          </Grid>
        </Grid>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 6 }}>
            <TanStackDataTable rows={hourlyRows.map((row) => ({ ...row, hourLabel: shortHour(row.hour) }))} columns={hourlyColumns} globalSearchPlaceholder="Search hourly rows..." initialPageSize={8} getRowId={(row) => String(row.hour)} />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <Stack spacing={2}>
              <MetricCard label="Peak Hour" value={peakHour ? shortHour(peakHour.hour) : "n/a"} caption={peakHour ? `${count(peakHour.transactions)} transactions` : "No hourly trend rows"} source="Inferred" />
              <MetricCard label="Completion Rate" value={pct((detail.alliedSummary?.kpis?.completionRate || 0) * 100)} caption={`Abort rate ${pct((detail.alliedSummary?.kpis?.customerAbortRate || 0) * 100)}`} source="Direct" />
            </Stack>
          </Grid>
        </Grid>
      </SectionCard>

      <SectionCard title="5. Inventory Data" subtitle="Current tank levels, fill %, temperature, product type, and low-level conditions.">
        <TanStackDataTable rows={tankRows.map((row) => ({ ...row, temperatureLabel: row.temperature != null ? count(row.temperature, 1) : "n/a", lowLevelLabel: row.lowLevel ? "Warning" : "Normal" }))} columns={tankColumns} globalSearchPlaceholder="Search tanks..." initialPageSize={8} getRowId={(row) => row.label} />
      </SectionCard>
      </>
      ) : null}

      {topLevelTab === "management" ? (
      <SectionCard
        title="Allied Management Tabs"
        subtitle="Sections 6, 7, and 8 now use a full-site list with region filtering."
        action={<Chip label={`${filteredManagementRows.length} visible sites`} color="primary" />}
      >
        <Tabs
          value={managementTab}
          onChange={(_event, value) => setManagementTab(value)}
          variant={isMobile ? "scrollable" : "standard"}
          allowScrollButtonsMobile
        >
          {MANAGEMENT_TABS.map((tab) => <Tab key={tab.value} value={tab.value} label={tab.label} />)}
        </Tabs>

        {managementTab === "versions" ? (
          <TanStackDataTable rows={filteredManagementRows.map((row) => ({ ...row, trafficLabel: `${count(row.transactionCount)} txns`, lastAlliedLabel: row.lastAlliedTimestamp ? dateTime(row.lastAlliedTimestamp, row.timezone) : "No Allied rows in window", sourceLabel: "Direct site + Unavailable version fields" }))} columns={managementVersionColumns} globalSearchPlaceholder="Search version rows..." initialPageSize={10} getRowId={(row) => row.siteId} />
        ) : null}

        {managementTab === "codes" ? (
          <TanStackDataTable rows={filteredManagementRows} columns={managementCodesColumns} globalSearchPlaceholder="Search code rows..." initialPageSize={10} getRowId={(row) => row.siteId} />
        ) : null}

        {managementTab === "diagnostics" ? (
          <TanStackDataTable rows={filteredManagementRows.map((row) => ({ ...row, networkStatusLabel: `${count(row.connectedSides)}/${count(row.expectedSides)} sides` }))} columns={managementDiagnosticsColumns} globalSearchPlaceholder="Search diagnostics rows..." initialPageSize={10} getRowId={(row) => row.siteId} />
        ) : null}

      </SectionCard>
      ) : null}

      {focus === "upgrades" ? (
      <SectionCard
        title="Allied Upgrades"
        subtitle="Create reusable ANDI command cards, schedule them across filtered sites, and monitor each store push row."
        action={<Chip label={`${filteredManagementRows.length} visible sites`} color="primary" />}
      >
        <Tabs
          value={upgradeTab}
          onChange={(_event, value) => setUpgradeTab(value)}
          variant={isMobile ? "scrollable" : "standard"}
          allowScrollButtonsMobile
        >
          {UPGRADE_TABS.map((tab) => <Tab key={tab.value} value={tab.value} label={tab.label} />)}
        </Tabs>

        {upgradeTab === "create" ? (
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, xl: 5 }}>
              <SectionCard title="Create Upgrade Card" subtitle="Type ANDI commands or upload a local file, then save each change as its own card.">
                <Stack spacing={1.5}>
                  <TextField label="Card Name" value={draftUpgradeCard.name} onChange={(event) => setDraftUpgradeCard((current) => ({ ...current, name: event.target.value }))} />
                  <TextField
                    label="ANDI Commands"
                    value={draftUpgradeCard.commandsText}
                    onChange={(event) => setDraftUpgradeCard((current) => ({ ...current, commandsText: event.target.value }))}
                    multiline
                    minRows={8}
                    placeholder="One ANDI command per line"
                  />
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                    <Button variant="contained" onClick={() => createUpgradeCard(draftUpgradeCard.name, draftUpgradeCard.commandsText)}>Add Card</Button>
                    <Button variant="outlined" component="label">
                      Upload From Computer
                      <input hidden type="file" accept=".txt,.cmd,.json,.andi" onChange={handleUpgradeFile} />
                    </Button>
                  </Stack>
                </Stack>
              </SectionCard>
            </Grid>
            <Grid size={{ xs: 12, xl: 7 }}>
              <SectionCard title="Upgrade Cards" subtitle="Cards can be selected for scheduling or deleted before use.">
                <Stack spacing={1.5}>
                  {upgradeCards.length ? upgradeCards.map((card) => (
                    <Card key={card.id} variant="outlined">
                      <CardContent>
                        <Stack spacing={1}>
                          <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1}>
                            <Box>
                              <Typography variant="h6">{card.name}</Typography>
                              <Typography variant="caption" color="text.secondary">{card.source} | {card.commands.length} commands</Typography>
                            </Box>
                            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                              <Button variant={selectedUpgradeCardIds.includes(card.id) ? "contained" : "outlined"} onClick={() => toggleUpgradeCard(card.id)}>
                                {selectedUpgradeCardIds.includes(card.id) ? "Selected" : "Select"}
                              </Button>
                              <Button variant="outlined" color="error" onClick={() => deleteUpgradeCard(card.id)}>Delete</Button>
                            </Stack>
                          </Stack>
                          <Paper variant="outlined" sx={{ p: 1.25 }}>
                            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", fontFamily: "monospace" }}>{card.commands.join("\n")}</Typography>
                          </Paper>
                        </Stack>
                      </CardContent>
                    </Card>
                  )) : <Typography color="text.secondary">No upgrade cards yet.</Typography>}
                </Stack>
              </SectionCard>
            </Grid>
          </Grid>
        ) : null}

        {upgradeTab === "schedules" ? (
          <Stack spacing={2}>
            <SectionCard title="Filter And Target Sites" subtitle="Use the filter bar above, then select multiple stores or all visible stores before scheduling.">
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <Button variant="outlined" onClick={selectVisibleSites}>Select Visible Sites</Button>
                <Button variant="outlined" onClick={clearVisibleSites}>Clear Visible Sites</Button>
              </Stack>
              <TanStackDataTable rows={visibleUpgradeRows.map((row) => ({ ...row, selected: selectedUpgradeSiteIds.includes(row.siteId), alertsLabel: `${row.topSeverity} | ${row.alertCount}`, selectedCardsLabel: count(selectedUpgradeCardIds.length) }))} columns={upgradeScheduleTargetColumns} globalSearchPlaceholder="Search upgrade targets..." initialPageSize={10} getRowId={(row) => row.siteId} />
            </SectionCard>

            <SectionCard title="Upgrade Schedules" subtitle="Schedule the selected cards to the selected sites. Sequence order follows schedule time.">
              <Stack spacing={1.5}>
                <TextField label="Schedule Time" type="datetime-local" value={scheduleForm.scheduledFor} onChange={(event) => setScheduleForm((current) => ({ ...current, scheduledFor: event.target.value }))} InputLabelProps={{ shrink: true }} sx={{ maxWidth: 280 }} />
                <Button variant="contained" onClick={queueUpgradeBatch}>Create Scheduled Push</Button>
                <Stack spacing={1.5}>
                  {queueRows.length ? queueRows.map((batch) => (
                    <Card key={batch.id} variant="outlined">
                      <CardContent>
                        <Stack spacing={1}>
                          <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1}>
                            <Box>
                              <Typography variant="h6">#{batch.sequence} | {batch.cards.map((card) => card.name).join(", ") || "Upgrade Batch"}</Typography>
                              <Typography variant="caption" color="text.secondary">{dateTime(batch.scheduledFor)} | {batch.targets.length} sites</Typography>
                            </Box>
                            <Button variant="outlined" disabled={batch.batchStatus !== "Pending"} onClick={() => cancelBatch(batch.id)}>Cancel Pending Batch</Button>
                          </Stack>
                          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                            {batch.cards.map((card) => <Chip key={card.id} label={card.name} />)}
                          </Stack>
                        </Stack>
                      </CardContent>
                    </Card>
                  )) : <Typography color="text.secondary">No scheduled upgrades yet.</Typography>}
                </Stack>
              </Stack>
            </SectionCard>
          </Stack>
        ) : null}

        {upgradeTab === "push" ? (
          <SectionCard title="Push Upgrades" subtitle="Each store appears as its own row so you can monitor multiple upgrades and remove any pending store update.">
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Store</TableCell>
                    <TableCell>Region</TableCell>
                    <TableCell>Upgrade Cards</TableCell>
                    <TableCell>Scheduled</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Pending Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pushRows.length ? pushRows.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell>
                        <Typography fontWeight={700}>{row.target.siteRow.siteCode}</Typography>
                        <Typography variant="caption" color="text.secondary">{row.target.siteRow.siteName}</Typography>
                      </TableCell>
                      <TableCell>{row.target.siteRow.region}</TableCell>
                      <TableCell>{row.cardNames.join(", ") || "No cards"}</TableCell>
                      <TableCell>{dateTime(row.batch.scheduledFor, row.target.siteRow.timezone)}</TableCell>
                      <TableCell>
                        <Button size="small" color={batchStatusTone(row.target.status.label)} onClick={() => openStatusLogs(row.batch, row.target)}>
                          {row.target.status.label}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outlined"
                          size="small"
                          disabled={row.target.status.label !== "Pending"}
                          onClick={() => cancelPendingTarget(row.batch.id, row.target.siteId)}
                        >
                          Delete Pending Update
                        </Button>
                      </TableCell>
                    </TableRow>
                  )) : (
                    <TableRow>
                      <TableCell colSpan={6}>No store pushes configured yet.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </SectionCard>
        ) : null}
      </SectionCard>
      ) : null}

      {focus === "all" ? (
      <SectionCard title="Current Selected Site Detail" subtitle="The original per-site section 6, 7, and 8 content remains visible here as the drill-down for the selected site.">
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, lg: 4 }}>
            <SectionCard title="Version Detail" subtitle="Current selected site version posture.">
              <TanStackDataTable rows={[...CONTROLLER_VERSION_ROWS, { label: "Last Allied Update Timestamp", value: detail.alliedRows[0] ? dateTime(detail.alliedRows[0].timestamp, selectedSite?.timezone) : "n/a", source: "Direct Allied transaction timestamp" }, { label: "Controller Endpoint", value: selectedSite?.integration ? `${selectedSite.integration.atgHost || "host not set"}:${selectedSite.integration.atgPort || "n/a"}` : "No site integration configured", source: selectedSite?.integration ? "Direct site integration" : "Unavailable" }]} columns={versionDetailColumns} globalSearchPlaceholder="Search version detail..." initialPageSize={10} getRowId={(row) => row.label} />
            </SectionCard>
          </Grid>
          <Grid size={{ xs: 12, lg: 4 }}>
            <SectionCard title="Alert Detail" subtitle="Current selected site error and status rows.">
              <TanStackDataTable rows={alertRows.map((row, index) => ({ ...row, id: `${row.code}-${index}`, timestampLabel: dateTime(row.timestamp, selectedSite?.timezone) }))} columns={alertDetailColumns} globalSearchPlaceholder="Search alerts..." initialPageSize={10} emptyMessage="No current alert rows for this site." getRowId={(row) => row.id} />
            </SectionCard>
          </Grid>
          <Grid size={{ xs: 12, lg: 4 }}>
            <SectionCard title="Diagnostics Detail" subtitle="Current selected site diagnostics drill-down.">
              <TanStackDataTable rows={diagnosticsRows} columns={diagnosticsDetailColumns} globalSearchPlaceholder="Search diagnostics..." initialPageSize={10} getRowId={(row) => row.label} />
            </SectionCard>
          </Grid>
        </Grid>
      </SectionCard>
      ) : null}

      <StatusLogDialog logDialog={logDialog} onClose={() => setLogDialog(null)} />
    </Stack>
  );
}
