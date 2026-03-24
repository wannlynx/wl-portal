import type {
  BenchmarkKey,
  BenchmarkSnapshot,
  ConfidenceLevel,
  CurveStructure,
  CurveSummary,
  ForwardCurveSeries,
  InventorySeries,
  KpiCardModel,
  MarketInsightSummary,
  NarrativeDriverSet,
  OutlookBias,
  PriceHistoryPoint,
  TrendDirection
} from "../types/market";

const DAY_MS = 24 * 60 * 60 * 1000;

function round(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function parseDate(value: string) {
  return new Date(`${value}T00:00:00`);
}

function interpolateSeries(anchors: Array<{ date: string; value: number }>) {
  const sorted = [...anchors].sort((a, b) => parseDate(a.date).getTime() - parseDate(b.date).getTime());
  const values = new Map<string, number>();

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const current = sorted[index];
    const next = sorted[index + 1];
    const start = parseDate(current.date).getTime();
    const end = parseDate(next.date).getTime();
    const steps = Math.max(1, Math.round((end - start) / DAY_MS));

    for (let step = 0; step < steps; step += 1) {
      const ratio = step / steps;
      const date = new Date(start + step * DAY_MS).toISOString().slice(0, 10);
      values.set(date, round(current.value + (next.value - current.value) * ratio, 3));
    }
  }

  const last = sorted[sorted.length - 1];
  values.set(last.date, round(last.value, 3));
  return values;
}

export function buildPriceHistory(benchmarks: BenchmarkSnapshot[]): PriceHistoryPoint[] {
  const trackedKeys: BenchmarkKey[] = ["wti", "brent", "gasoline", "diesel"];
  const maps = new Map<BenchmarkKey, Map<string, number>>();

  trackedKeys.forEach((key) => {
    const benchmark = benchmarks.find((item) => item.key === key);
    maps.set(key, interpolateSeries(benchmark?.historyAnchors || []));
  });

  const allDates = [...new Set([...maps.values()].flatMap((series) => [...series.keys()]))].sort();

  return allDates.map((date) => ({
    date,
    wti: maps.get("wti")?.get(date) || 0,
    brent: maps.get("brent")?.get(date) || 0,
    gasoline: maps.get("gasoline")?.get(date) || 0,
    diesel: maps.get("diesel")?.get(date) || 0
  }));
}

export function getTrendDirection(change: number): TrendDirection {
  if (change > 0.15) return "Rising";
  if (change < -0.15) return "Falling";
  return "Stable";
}

export function buildBenchmarkCards(benchmarks: BenchmarkSnapshot[]): KpiCardModel[] {
  return benchmarks.map((item) => ({
    key: item.key,
    label: item.label,
    unit: item.unit,
    currentValue: item.current,
    dailyChange: round(item.current - item.dayAgo, 2),
    weeklyChange: round(item.current - item.weekAgo, 2),
    sparkline: item.sparkline,
    historyAnchors: item.historyAnchors,
    status: getTrendDirection(item.current - item.weekAgo),
    regionalSeries: item.regionalSeries,
    defaultRegion: item.defaultRegion
  }));
}

export function buildInventoryCards(inventorySeries: InventorySeries[]): KpiCardModel[] {
  return inventorySeries.slice(0, 2).map((series) => {
    const last = series.points[series.points.length - 1];
    const prior = series.points[series.points.length - 2] || last;
    const priorWeek = series.points[series.points.length - 3] || prior;

    return {
      key: series.key,
      label: `U.S. ${series.label}`,
      unit: series.unit,
      currentValue: last.value,
      dailyChange: round(last.value - prior.value, 2),
      weeklyChange: round(last.value - priorWeek.value, 2),
      sparkline: series.points.slice(-7).map((point) => point.value),
      historyAnchors: series.points.slice(-7).map((point) => ({ date: point.date, value: point.value })),
      status: getTrendDirection((last.value - prior.value) * -1)
    };
  });
}

export function getCurveStructure(series: ForwardCurveSeries): CurveSummary {
  const first = series.points[0]?.value || 0;
  const last = series.points[series.points.length - 1]?.value || 0;
  const spread = round(first - last, 3);

  let structure: CurveStructure = "Flat";
  if (spread > 0.04) structure = "Backwardation";
  if (spread < -0.04) structure = "Contango";

  const description =
    structure === "Backwardation"
      ? "Prompt pricing sits above deferred months, pointing to tighter near-term supply."
      : structure === "Contango"
        ? "Deferred pricing sits above prompt months, pointing to looser nearby balances."
        : "The curve is relatively flat, suggesting a more balanced prompt market.";

  return { market: series.key, label: series.label, structure, spread, description };
}

function inventorySignal(series: InventorySeries | undefined) {
  if (!series?.points?.length) return 0;
  const last = series.points[series.points.length - 1].value;
  const priorMonth = series.points[Math.max(0, series.points.length - 5)]?.value || last;
  return round(last - priorMonth, 2);
}

function percentChange(current: number, previous: number) {
  if (!previous) return 0;
  return round(((current - previous) / previous) * 100, 2);
}

export function buildInsightSummary(
  benchmarkCards: KpiCardModel[],
  inventorySeries: InventorySeries[],
  forwardCurves: ForwardCurveSeries[],
  drivers: NarrativeDriverSet
): MarketInsightSummary {
  const curves = forwardCurves.map(getCurveStructure);
  const wti = benchmarkCards.find((item) => item.key === "wti");
  const gasoline = benchmarkCards.find((item) => item.key === "gasoline")
    || benchmarkCards.find((item) => item.key === "regular");
  const diesel = benchmarkCards.find((item) => item.key === "diesel");
  const crudeInventorySignal = inventorySignal(inventorySeries.find((item) => item.key === "crude"));
  const gasolineInventorySignal = inventorySignal(inventorySeries.find((item) => item.key === "gasoline"));
  const distillateInventorySignal = inventorySignal(inventorySeries.find((item) => item.key === "distillate"));
  const backwardatedCurves = curves.filter((curve) => curve.structure === "Backwardation");

  const narrativeBullets: string[] = [];
  if (wti && gasoline && wti.weeklyChange > 0 && gasolineInventorySignal < 0) {
    narrativeBullets.push("Crude is rising while gasoline inventories continue to draw, keeping prompt supply tight.");
  }
  if (diesel && diesel.weeklyChange > 0 && distillateInventorySignal < 0) {
    narrativeBullets.push("Diesel remains firm because middle-distillate stocks are still drifting lower.");
  }
  if (backwardatedCurves.length >= 2) {
    narrativeBullets.push("Forward curves remain in backwardation, which usually points to tighter near-term balances.");
  }
  if (crudeInventorySignal < 0 && gasolineInventorySignal < 0) {
    narrativeBullets.push("Crude and gasoline stocks are both lower than a month ago, reinforcing a constructive near-term tone.");
  } else if (crudeInventorySignal > 0 && gasolineInventorySignal > 0) {
    narrativeBullets.push("Inventory builds across crude and gasoline are softening the market’s near-term tone.");
  }
  narrativeBullets.push(drivers.exportSignal);

  let biasScore = 0;
  if (backwardatedCurves.length >= 2) biasScore += 2;
  if (crudeInventorySignal < 0) biasScore += 1;
  if (gasolineInventorySignal < 0) biasScore += 1;
  if (distillateInventorySignal < 0) biasScore += 1;
  if ((wti?.weeklyChange || 0) < 0) biasScore -= 1;

  let outlookTitle: OutlookBias = "Neutral";
  if (biasScore >= 3) outlookTitle = "Tightening";
  if (biasScore <= 0) outlookTitle = "Loosening";

  let confidence: ConfidenceLevel = "Medium";
  if (Math.abs(biasScore) <= 1) confidence = "Low";
  if (Math.abs(biasScore) >= 4) confidence = "High";

  const leadCurve = curves[0];
  const crudePercent = wti ? percentChange(wti.currentValue, wti.currentValue - wti.weeklyChange) : 0;
  const gasolinePercent = gasoline ? percentChange(gasoline.currentValue, gasoline.currentValue - gasoline.weeklyChange) : 0;

  const outlookBody = [
    `${leadCurve.label} is ${leadCurve.structure.toLowerCase()}, with the front month about ${Math.abs(leadCurve.spread).toFixed(2)} ${leadCurve.market === "wti" || leadCurve.market === "brent" ? "USD/bbl" : "USD/gal"} above later months. That usually signals a market that still values prompt barrels more than deferred supply.`,
    outlookTitle === "Tightening"
      ? `Inventories are broadly supportive: crude stocks are down ${Math.abs(crudeInventorySignal).toFixed(1)} MMbbl over the past month, gasoline stocks are down ${Math.abs(gasolineInventorySignal).toFixed(1)} MMbbl, and recent price momentum remains constructive. Near-term conditions look tighter, but this remains an interpretation rather than a hard forecast.`
      : outlookTitle === "Loosening"
        ? "Inventory direction and the futures curve both point to a softer nearby market. Recent price action has cooled, and the balance of signals suggests a more comfortable supply picture in the near term."
        : `Signals are mixed. Crude is up about ${crudePercent}% week over week and gasoline is up about ${gasolinePercent}% over the same period, but inventory trends and curve shape are not uniformly strong enough to argue for a one-way view. The market reads as balanced to slightly constructive for now.`
  ];

  return {
    narrativeBullets: narrativeBullets.slice(0, 5),
    outlookTitle,
    outlookBody,
    confidence,
    curveSummaries: curves
  };
}

export function filterPriceHistory(history: PriceHistoryPoint[], range: "7D" | "30D" | "90D" | "1Y") {
  const windowDays = range === "7D" ? 7 : range === "30D" ? 30 : range === "90D" ? 90 : 365;
  const lastDate = parseDate(history[history.length - 1]?.date || new Date().toISOString().slice(0, 10)).getTime();
  const cutoff = lastDate - (windowDays - 1) * DAY_MS;
  return history.filter((point) => parseDate(point.date).getTime() >= cutoff);
}

export function buildInventoryModeSeries(series: InventorySeries[], mode: "absolute" | "wow") {
  if (mode === "absolute") return series;

  return series.map((item) => ({
    ...item,
    unit: `WoW ${item.unit}`,
    points: item.points.map((point, index) => ({
      date: point.date,
      value: index === 0 ? 0 : round(point.value - item.points[index - 1].value, 2)
    }))
  }));
}

export function getSeriesColor(key: string) {
  switch (key) {
    case "wti":
    case "crude":
      return "#275df5";
    case "brent":
      return "#0f8d8d";
    case "regular":
      return "#bb7a12";
    case "midgrade":
      return "#d49022";
    case "premium":
      return "#8a5c0c";
    case "gasoline":
    case "gasolineStocks":
      return "#bb7a12";
    case "distillate":
    case "diesel":
      return "#c44f4f";
    default:
      return "#275df5";
  }
}

export function formatValue(value: number, unit: string) {
  const digits = unit.includes("USD/gal") ? 3 : unit.includes("USD/bbl") ? 2 : 1;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value);
}

export function formatDateLabel(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric"
  });
}
