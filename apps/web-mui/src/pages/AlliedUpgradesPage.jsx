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
import { alpha } from "@mui/material/styles";
import { api } from "../api";
import { TanStackDataTable } from "../components/TanStackDataTable";

const UPGRADE_TABS = [
  { value: "create", label: "Create Upgrade" },
  { value: "schedules", label: "Upgrade Schedules" },
  { value: "push", label: "Push Upgrades" }
];

const CARD_STORAGE_KEY = "petroleum.allied-upgrades.cards";

function count(value, digits = 0) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
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

function statusTone(label) {
  if (label === "Successful") return "success";
  if (label === "Failed") return "error";
  if (label === "Cancelled") return "default";
  return "warning";
}

function cardTone(index) {
  const tones = ["primary", "secondary", "success", "warning", "info", "error"];
  return tones[index % tones.length];
}

function resolveCardSet(cardIds, cards) {
  return (cardIds || [])
    .map((cardId) => cards.find((card) => card.id === cardId))
    .filter(Boolean);
}

function safeReadCards() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CARD_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((card) => card && card.id && card.name) : [];
  } catch {
    return [];
  }
}

function parseScheduledAt(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

function NoticeDialog({ noticeDialog, onClose }) {
  return (
    <Dialog open={Boolean(noticeDialog)} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{noticeDialog?.title || "Notice"}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          {(noticeDialog?.lines || []).map((line, index) => (
            <Typography key={`${index}-${line}`} variant="body2" color="text.secondary">
              {line}
            </Typography>
          ))}
          <Button variant="contained" onClick={onClose}>Close</Button>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

function ScheduleEditorDialog({ batch, siteRow, open, onClose, onSaveSchedule, onDeletePending }) {
  const [scheduledFor, setScheduledFor] = useState(batch?.scheduledFor ? localDateTimeValue(new Date(batch.scheduledFor)) : "");

  useEffect(() => {
    setScheduledFor(batch?.scheduledFor ? localDateTimeValue(new Date(batch.scheduledFor)) : "");
  }, [batch]);

  if (!batch || !siteRow) return null;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{siteRow.siteCode} - Edit Schedule</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">
            {(batch.cards || []).map((card) => card.name).join(", ")}
          </Typography>
          <TextField label="Scheduled Time" type="datetime-local" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} InputLabelProps={{ shrink: true }} />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <Button variant="contained" onClick={() => onSaveSchedule(scheduledFor)}>Save Schedule</Button>
            <Button variant="outlined" color="error" onClick={onDeletePending}>Delete Pending Update</Button>
            <Button variant="outlined" onClick={onClose}>Close</Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

function PushCardDialog({ actionDialog, onClose, onDeletePending, onChangeSchedule }) {
  const batch = actionDialog?.batch || null;
  const siteRow = actionDialog?.siteRow || null;
  const card = actionDialog?.card || null;

  if (!batch || !siteRow || !card) return null;

  return (
    <Dialog open={Boolean(actionDialog)} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{siteRow.siteCode} - {card.name}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">
            Scheduled for {dateTime(batch.scheduledFor, siteRow.timezone)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {siteRow.region}
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <Button variant="contained" color="error" onClick={onDeletePending}>Delete Pending Update</Button>
            <Button variant="outlined" onClick={onChangeSchedule}>Change Schedule</Button>
            <Button variant="outlined" onClick={onClose}>Close</Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

export function AlliedUpgradesPage() {
  const [sites, setSites] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("create");
  const [regionFilter, setRegionFilter] = useState("");
  const [siteSearch, setSiteSearch] = useState("");
  const [selectedSiteIds, setSelectedSiteIds] = useState([]);
  const [selectedCardIds, setSelectedCardIds] = useState([]);
  const [cards, setCards] = useState([]);
  const [draftCard, setDraftCard] = useState({ name: "", commandsText: "" });
  const [scheduleTime, setScheduleTime] = useState(localDateTimeValue(new Date(Date.now() + 60 * 60000)));
  const [batches, setBatches] = useState([]);
  const [logDialog, setLogDialog] = useState(null);
  const [noticeDialog, setNoticeDialog] = useState(null);
  const [pushActionDialog, setPushActionDialog] = useState(null);
  const [cardDialogCardId, setCardDialogCardId] = useState("");
  const [scheduleDialog, setScheduleDialog] = useState({ open: false, batchId: "", siteId: "" });
  const legacyCards = useMemo(() => safeReadCards(), []);

  async function refreshUpgradeData() {
    const [cardRows, batchRows] = await Promise.all([
      api.getAlliedUpgradeCards().catch(() => []),
      api.getAlliedUpgradeBatches().catch(() => [])
    ]);
    let nextCards = cardRows || [];
    if (!nextCards.length && legacyCards.length) {
      await Promise.all(
        legacyCards.map((card) =>
          api.createAlliedUpgradeCard({
            name: card.name,
            commands: card.commands || [],
            source: card.source || "Typed"
          }).catch(() => null)
        )
      );
      nextCards = await api.getAlliedUpgradeCards().catch(() => []);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(CARD_STORAGE_KEY);
      }
    }
    setCards(nextCards || []);
    setBatches(batchRows || []);
  }

  useEffect(() => {
    let ignore = false;
    async function load() {
      setLoading(true);
      try {
        const [siteRows, alertRows] = await Promise.all([
          api.getSites(),
          api.getAlerts().catch(() => [])
        ]);
        if (ignore) return;
        setSites(siteRows || []);
        setAlerts(alertRows || []);
        setSelectedSiteIds((current) => current.filter((siteId) => (siteRows || []).some((site) => site.id === siteId)));
        await refreshUpgradeData();
        setError("");
      } catch (nextError) {
        if (!ignore) setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to load Allied Upgrades"));
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, []);

  const regionOptions = useMemo(
    () => [...new Set((sites || []).map((site) => site.region || "Unassigned"))].sort((a, b) => a.localeCompare(b)),
    [sites]
  );

  const alertBySiteId = useMemo(() => {
    const next = new Map();
    for (const alert of alerts || []) {
      if (!alert?.siteId) continue;
      if (!next.has(alert.siteId)) next.set(alert.siteId, []);
      next.get(alert.siteId).push(alert);
    }
    return next;
  }, [alerts]);

  const siteRows = useMemo(() => {
    const query = siteSearch.trim().toLowerCase();
    return (sites || []).filter((site) => {
      if (regionFilter && (site.region || "Unassigned") !== regionFilter) return false;
      if (!query) return true;
      return [site.siteCode, site.name, site.region || "Unassigned"].some((value) => String(value || "").toLowerCase().includes(query));
    }).map((site) => {
      const siteAlerts = alertBySiteId.get(site.id) || [];
      const topSeverity = siteAlerts.some((alert) => alert.severity === "critical") ? "critical" : siteAlerts.some((alert) => alert.severity === "warning") ? "warning" : "info";
      return {
        siteId: site.id,
        siteCode: site.siteCode || site.id,
        siteName: site.name || "Unnamed site",
        region: site.region || "Unassigned",
        timezone: site.timezone || "America/New_York",
        controllerEndpoint: site.integration ? `${site.integration.atgHost || "host not set"}:${site.integration.atgPort || "n/a"}` : "No site integration configured",
        alertCount: siteAlerts.length,
        topSeverity
      };
    });
  }, [alertBySiteId, regionFilter, siteSearch, sites]);

  const selectedSites = useMemo(
    () => siteRows.filter((row) => selectedSiteIds.includes(row.siteId)),
    [selectedSiteIds, siteRows]
  );

  const batchRows = useMemo(() => {
    return batches
      .slice()
      .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
      .map((batch, index) => {
        const batchCards = (batch.cards && batch.cards.length ? batch.cards : resolveCardSet(batch.cardIds, cards)) || [];
        const batchLabel = batchCards.map((card) => card.name).join(", ") || "Upgrade batch";
        const targets = batch.siteIds
          .map((siteId) => {
            const siteRow = siteRows.find((row) => row.siteId === siteId);
            if (!siteRow) return null;
            const cancelled = batch.cancelledAt || (batch.cancelledSiteIds || []).includes(siteId);
            const scheduledAt = parseScheduledAt(batch.scheduledFor);
            const label = cancelled
              ? "Cancelled"
              : scheduledAt && scheduledAt.getTime() > Date.now()
                ? "Pending"
                : siteRow.topSeverity === "critical"
                  ? "Failed"
                  : "Successful";
            return {
              siteId,
              siteRow,
              label,
              logLines: [
                `Batch #${index + 1}: ${batchLabel}`,
                `Scheduled for ${dateTime(batch.scheduledFor, siteRow.timezone)}`,
                `Site ${siteRow.siteCode} in ${siteRow.region}`,
                `Status ${label}`,
                cancelled ? "This target was cancelled before execution." : "Target remains active."
              ]
            };
          })
          .filter(Boolean);
        return { ...batch, cards: batchCards, sequence: index + 1, targets, batchLabel };
      });
  }, [batches, cards, siteRows]);

  const selectedCard = useMemo(
    () => cards.find((card) => card.id === cardDialogCardId) || null,
    [cardDialogCardId, cards]
  );

  useEffect(() => {
    if (!selectedCard) {
      if (!cardDialogCardId) setDraftCard({ name: "", commandsText: "" });
      return;
    }
    setDraftCard({
      name: selectedCard.name || "",
      commandsText: (selectedCard.commands || []).join("\n")
    });
  }, [cardDialogCardId, selectedCard]);

  const selectedScheduleEntry = useMemo(() => {
    if (!scheduleDialog.batchId || !scheduleDialog.siteId) return { batch: null, siteRow: null, target: null };
    const batch = batchRows.find((item) => item.id === scheduleDialog.batchId) || null;
    const siteRow = siteRows.find((item) => item.siteId === scheduleDialog.siteId) || null;
    const target = batch?.targets.find((item) => item.siteId === scheduleDialog.siteId) || null;
    return { batch, siteRow, target };
  }, [batchRows, scheduleDialog.batchId, scheduleDialog.siteId, siteRows]);

  const pushRows = useMemo(() => {
    return siteRows.map((siteRow) => {
      const rows = batchRows
        .flatMap((batch) => batch.targets.filter((target) => target.siteId === siteRow.siteId).map((target) => ({ batch, target })));
      return { siteRow, rows };
    });
  }, [batchRows, siteRows]);

  function toggleSite(siteId) {
    setSelectedSiteIds((current) => current.includes(siteId) ? current.filter((value) => value !== siteId) : [...current, siteId]);
  }

  function selectVisibleSites() {
    setSelectedSiteIds((current) => [...new Set([...current, ...siteRows.map((row) => row.siteId)])]);
  }

  function clearVisibleSites() {
    const visible = new Set(siteRows.map((row) => row.siteId));
    setSelectedSiteIds((current) => current.filter((siteId) => !visible.has(siteId)));
  }

  async function createCard() {
    const name = draftCard.name.trim();
    const commands = draftCard.commandsText.trim();
    if (!name || !commands) {
      setError("Card name and ANDI commands are required.");
      return;
    }
    try {
      const created = await api.createAlliedUpgradeCard({ name, commands: commands.split(/\r?\n/).map((line) => line.trim()).filter(Boolean), source: "Typed" });
      await refreshUpgradeData();
      setSelectedCardIds((current) => [...new Set([...current, created.id])]);
      setCardDialogCardId(created.id);
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to save card"));
    }
  }

  async function handleUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const text = String(reader.result || "");
      try {
        const created = await api.createAlliedUpgradeCard({
          name: file.name.replace(/\.[^.]+$/, ""),
          commands: text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
          source: "Uploaded"
        });
        await refreshUpgradeData();
        setSelectedCardIds((current) => [...new Set([...current, created.id])]);
        setCardDialogCardId(created.id);
        setError("");
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to save uploaded card"));
      }
    };
    reader.onerror = () => setError("Unable to read the selected file.");
    reader.readAsText(file);
    event.target.value = "";
  }

  async function deleteCard(cardId) {
    try {
      await api.deleteAlliedUpgradeCard(cardId);
      await refreshUpgradeData();
      setSelectedCardIds((current) => current.filter((value) => value !== cardId));
      if (cardDialogCardId === cardId) setCardDialogCardId("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to delete card"));
    }
  }

  function toggleCard(cardId) {
    setSelectedCardIds((current) => current.includes(cardId) ? current.filter((value) => value !== cardId) : [...current, cardId]);
  }

  async function queueBatch() {
    if (!selectedCardIds.length) {
      setError("Select at least one upgrade card.");
      return;
    }
    if (!selectedSiteIds.length) {
      setError("Select at least one site.");
      return;
    }
    const scheduledAt = parseScheduledAt(scheduleTime);
    if (!scheduledAt) {
      setError("Enter a valid schedule time.");
      return;
    }
    try {
      const created = await api.createAlliedUpgradeBatch({
        cardIds: selectedCardIds,
        siteIds: selectedSiteIds,
        scheduledFor: scheduledAt.toISOString()
      });
      await refreshUpgradeData();
      setNoticeDialog({
        title: "Scheduled Push Created",
        lines: [
          `Cards: ${(created.cards || []).map((card) => card.name).join(", ")}`,
          `Sites: ${selectedSiteIds.length}`,
          `Time: ${dateTime(created.scheduledFor)}`,
          "The scheduled push was created successfully."
        ]
      });
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to create scheduled push"));
    }
  }

  async function cancelBatch(batchId) {
    try {
      await api.updateAlliedUpgradeBatch(batchId, { cancelBatch: true });
      await refreshUpgradeData();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to cancel batch"));
    }
  }

  async function cancelTarget(batchId, siteId) {
    try {
      await api.updateAlliedUpgradeBatch(batchId, { cancelSiteId: siteId });
      await refreshUpgradeData();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to cancel pending update"));
    }
  }

  function openLogs(title, lines) {
    setLogDialog({ title, lines });
  }

  function openPushAction(batch, siteRow, card) {
    setPushActionDialog({ batch, siteRow, card });
  }

  function openCard(cardId) {
    setCardDialogCardId(cardId);
  }

  async function saveCard(nextCard) {
    if (!selectedCard) return;
    const name = String(nextCard.name || "").trim();
    const commandsText = String(nextCard.commandsText || "").trim();
    if (!name || !commandsText) {
      setError("Card name and ANDI commands are required.");
      return;
    }
    const commands = commandsText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    try {
      await api.updateAlliedUpgradeCard(selectedCard.id, { name, commands, source: selectedCard.source });
      await refreshUpgradeData();
      setCardDialogCardId(selectedCard.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to save card"));
    }
  }

  function startNewCard() {
    setCardDialogCardId("");
    setDraftCard({ name: "", commandsText: "" });
  }

  async function saveSchedule(nextScheduledFor) {
    const scheduledAt = parseScheduledAt(nextScheduledFor);
    if (!selectedScheduleEntry.batch || !scheduledAt) {
      setError("Enter a valid schedule time.");
      return;
    }
    try {
      await api.updateAlliedUpgradeBatch(selectedScheduleEntry.batch.id, { scheduledFor: scheduledAt.toISOString() });
      await refreshUpgradeData();
      setScheduleDialog({ open: false, batchId: "", siteId: "" });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to save schedule"));
    }
  }

  function openCardStatusDialog(siteRow, batch) {
    const lines = (batch.cards || []).map((card) => `${card.name} - ${dateTime(batch.scheduledFor, siteRow.timezone)}`);
    setLogDialog({
      title: `${siteRow.siteCode} Active Cards`,
      lines: lines.length ? lines : ["No active cards."]
    });
  }

  return (
    <Stack spacing={2.5}>
      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="overline" color="text.secondary">Allied Upgrades</Typography>
            <Typography variant="h4">Upgrade Orchestration</Typography>
            <Typography color="text.secondary">
              Create ANDI command cards, schedule them to filtered sites, and review or cancel pending store updates.
            </Typography>
            <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
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
                placeholder="Code, name, region"
                sx={{ minWidth: { xs: "100%", md: 220 } }}
              />
              <Chip label={`Visible sites ${count(siteRows.length)}`} />
              <Chip label={`Selected sites ${count(selectedSiteIds.length)}`} color="primary" />
              <Chip label={`Selected cards ${count(selectedCardIds.length)}`} color="secondary" />
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}

      <Tabs value={tab} onChange={(_event, value) => setTab(value)} variant="scrollable" allowScrollButtonsMobile>
        {UPGRADE_TABS.map((item) => <Tab key={item.value} value={item.value} label={item.label} />)}
      </Tabs>

      {tab === "create" ? (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, xl: 5 }}>
            <SectionCard
              title={selectedCard ? "Edit Card" : "Create Upgrade Card"}
              subtitle={selectedCard ? "Update the saved card, then reuse it in schedules and push batches." : "Type ANDI commands or upload a file, then save each change as its own card."}
              action={selectedCard ? <Button variant="outlined" onClick={startNewCard}>New Card</Button> : null}
            >
              <Stack spacing={1.5}>
                <TextField label="Card Name" value={draftCard.name} onChange={(event) => setDraftCard((current) => ({ ...current, name: event.target.value }))} />
                <TextField
                  label="ANDI Commands"
                  value={draftCard.commandsText}
                  onChange={(event) => setDraftCard((current) => ({ ...current, commandsText: event.target.value }))}
                  multiline
                  minRows={8}
                  placeholder="One command per line"
                />
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                  <Button variant="contained" onClick={selectedCard ? () => saveCard(draftCard) : createCard}>
                    {selectedCard ? "Save Card" : "Add Card"}
                  </Button>
                  <Button variant="outlined" component="label">
                    Upload From Computer
                    <input hidden type="file" accept=".txt,.cmd,.json,.andi" onChange={handleUpload} />
                  </Button>
                  {selectedCard ? <Button variant="outlined" color="error" onClick={() => deleteCard(selectedCard.id)}>Delete Card</Button> : null}
                </Stack>
              </Stack>
            </SectionCard>
          </Grid>
          <Grid size={{ xs: 12, xl: 7 }}>
            <SectionCard title="Upgrade Cards" subtitle="Small cards are saved automatically. Click a card to edit it in the work area or select it for scheduling.">
              <Stack direction="row" spacing={1.25} useFlexGap flexWrap="wrap">
                {cards.length ? cards.map((card, index) => (
                  <Card
                    key={card.id}
                    variant="outlined"
                    sx={{
                      width: 172,
                      borderWidth: 2,
                      borderColor: `${cardTone(index)}.main`,
                      backgroundColor: (theme) => alpha(theme.palette[cardTone(index)].main, 0.08),
                      cursor: "pointer"
                    }}
                    onClick={() => openCard(card.id)}
                  >
                    <CardContent sx={{ p: 1.25, "&:last-child": { pb: 1.25 } }}>
                      <Stack spacing={1}>
                        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="subtitle2" noWrap>{card.name}</Typography>
                            <Typography variant="caption" color="text.secondary">{card.commands.length} cmds</Typography>
                          </Box>
                        </Stack>
                        <Stack direction="row" spacing={0.75} justifyContent="flex-end">
                          <Button size="small" variant="text" color="error" onClick={(event) => { event.stopPropagation(); deleteCard(card.id); }}>
                            Delete
                          </Button>
                        </Stack>
                      </Stack>
                    </CardContent>
                  </Card>
                )) : <Typography color="text.secondary">No upgrade cards yet.</Typography>}
              </Stack>
            </SectionCard>
          </Grid>
        </Grid>
      ) : null}

      {tab === "schedules" ? (
        <Stack spacing={2}>
          <SectionCard title="Selected Cards" subtitle="Pick the cards to push first, then target sites." action={<Chip label={cards.filter((card) => selectedCardIds.includes(card.id)).map((card) => card.name).join(", ") || "None"} />}>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              {cards.length ? cards.map((card, index) => {
                const selected = selectedCardIds.includes(card.id);
                return (
                <Button
                  key={card.id}
                  variant="contained"
                  color={cardTone(index)}
                  onClick={() => toggleCard(card.id)}
                  sx={{
                    minWidth: 140,
                    boxShadow: selected ? "0 4px 0 rgba(0,0,0,0.35)" : 1,
                    transform: selected ? "translateY(-2px)" : "translateY(0)",
                    border: selected ? "2px solid rgba(255,255,255,0.7)" : "1px solid transparent",
                    opacity: selected ? 1 : 0.88
                  }}
                >
                  {card.name}
                </Button>
              );
              }) : <Typography color="text.secondary">No upgrade cards available.</Typography>}
            </Stack>
          </SectionCard>

          <SectionCard title="Filter And Target Sites" subtitle="Use the filter bar above, then select multiple stores or all visible stores before scheduling.">
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <Button variant="outlined" onClick={selectVisibleSites}>Select Visible Sites</Button>
              <Button variant="outlined" onClick={clearVisibleSites}>Clear Visible Sites</Button>
            </Stack>
            <TanStackDataTable
              rows={siteRows.map((row) => ({
                ...row,
                selected: selectedSiteIds.includes(row.siteId)
              }))}
              columns={[
                { accessorKey: "selected", header: "Select", cell: (info) => <Checkbox checked={info.row.original.selected} onChange={() => toggleSite(info.row.original.siteId)} />, meta: { minWidth: 80 } },
                { accessorKey: "siteCode", header: "Site", cell: (info) => info.getValue(), meta: { minWidth: 100 } },
                { accessorKey: "region", header: "Region", cell: (info) => info.getValue(), meta: { minWidth: 120 } }
              ]}
              globalSearchPlaceholder="Search upgrade targets..."
              initialPageSize={10}
              getRowId={(row) => row.siteId}
            />
          </SectionCard>

          <SectionCard title="Upgrade Schedules" subtitle="Schedule the selected cards to the selected sites. Sequence order follows schedule time.">
            <Stack spacing={1.5}>
              <TextField label="Schedule Time" type="datetime-local" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} InputLabelProps={{ shrink: true }} sx={{ maxWidth: 280 }} />
              <Button variant="contained" onClick={queueBatch}>Create Scheduled Push</Button>
              <Stack spacing={1.5}>
                {batchRows.length ? batchRows.map((batch) => (
                  <Card key={batch.id} variant="outlined">
                    <CardContent>
                      <Stack spacing={1.25}>
                        <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1}>
                          <Box>
                            <Typography variant="h6">#{batch.sequence} | {batch.batchLabel}</Typography>
                            <Typography variant="caption" color="text.secondary">{dateTime(batch.scheduledFor)} | {batch.targets.length} sites</Typography>
                          </Box>
                          <Button variant="outlined" disabled={Boolean(batch.cancelledAt)} onClick={() => cancelBatch(batch.id)}>Cancel Pending Batch</Button>
                        </Stack>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          {(batch.cards || []).map((card) => <Chip key={card.id} label={card.name} color="primary" />)}
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

      {tab === "push" ? (
        <SectionCard title="Push Upgrades" subtitle="Each store appears as its own row so you can monitor multiple upgrades and remove any pending store update.">
          <TanStackDataTable
            rows={pushRows.map(({ siteRow, rows }) => ({
              siteId: siteRow.siteId,
              siteCode: siteRow.siteCode,
              region: siteRow.region,
              siteRow,
              rows,
              cardCount: rows.reduce((total, row) => total + (row.batch.cards || []).length, 0)
            }))}
            columns={[
              { accessorKey: "siteCode", header: "Site", cell: (info) => (
                <Stack spacing={0.25}>
                  <Typography fontWeight={700}>{info.getValue()}</Typography>
                  <Typography variant="caption" color="text.secondary">{info.row.original.siteRow.siteName}</Typography>
                </Stack>
              ), meta: { minWidth: 140 } },
              { accessorKey: "region", header: "Region", cell: (info) => info.getValue(), meta: { minWidth: 120 } },
              { accessorKey: "cards", header: "Upgrade Cards", cell: (info) => {
                const rows = info.row.original.rows || [];
                if (!rows.length) return <Typography variant="body2" color="text.secondary">No upgrades queued.</Typography>;
                return (
                  <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                    {rows.flatMap(({ batch, target }) => (batch.cards || []).map((card, index) => (
                      <Button
                        key={`${batch.id}-${card.id}-${target.siteId}`}
                        size="small"
                        variant="contained"
                        color={cardTone(index)}
                        onClick={() => openPushAction(batch, info.row.original.siteRow, card)}
                      >
                        {card.name}
                      </Button>
                    )))}
                  </Stack>
                );
              }, meta: { minWidth: 260 } },
              { accessorKey: "status", header: "Status", cell: (info) => {
                const rows = info.row.original.rows || [];
                if (!rows.length) return <Typography variant="body2" color="text.secondary">No active cards.</Typography>;
                return (
                  <Button variant="contained" color="secondary" onClick={() => {
                    const lines = rows.flatMap(({ batch }) => (batch.cards || []).map((card) => `${card.name} - ${dateTime(batch.scheduledFor, info.row.original.siteRow.timezone)}`));
                    setLogDialog({
                      title: `${info.row.original.siteCode} Active Cards`,
                      lines: lines.length ? lines : ["No active cards."]
                    });
                  }}>
                    Active Cards ({rows.reduce((total, row) => total + (row.batch.cards || []).length, 0)})
                  </Button>
                );
              }, meta: { minWidth: 170 } }
            ]}
            globalSearchPlaceholder="Search stores..."
            initialPageSize={10}
            getRowId={(row) => row.siteId}
          />
        </SectionCard>
      ) : null}

      <ScheduleEditorDialog
        batch={selectedScheduleEntry.batch}
        siteRow={selectedScheduleEntry.siteRow}
        open={scheduleDialog.open}
        onClose={() => setScheduleDialog({ open: false, batchId: "", siteId: "" })}
        onSaveSchedule={saveSchedule}
        onDeletePending={() => selectedScheduleEntry.batch && selectedScheduleEntry.siteRow && cancelTarget(selectedScheduleEntry.batch.id, selectedScheduleEntry.siteRow.siteId)}
      />

      <PushCardDialog
        actionDialog={pushActionDialog}
        onClose={() => setPushActionDialog(null)}
        onDeletePending={() => {
          if (!pushActionDialog) return;
          cancelTarget(pushActionDialog.batch.id, pushActionDialog.siteRow.siteId);
          setPushActionDialog(null);
        }}
        onChangeSchedule={() => {
          if (!pushActionDialog) return;
          setScheduleDialog({ open: true, batchId: pushActionDialog.batch.id, siteId: pushActionDialog.siteRow.siteId });
          setPushActionDialog(null);
        }}
      />

      <NoticeDialog
        noticeDialog={noticeDialog}
        onClose={() => setNoticeDialog(null)}
      />

      <StatusLogDialog logDialog={logDialog} onClose={() => setLogDialog(null)} />
    </Stack>
  );
}
