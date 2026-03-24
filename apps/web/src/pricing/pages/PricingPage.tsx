import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { ChartPanel } from "../components/ChartPanel";
import { KpiCard } from "../components/KpiCard";
import { SectionHeader } from "../components/SectionHeader";
import { SourceBadgeRow } from "../components/SourceBadgeRow";
import { getPricingDashboardData } from "../services/marketDataService";
import type { BenchmarkKey, PricingDashboardData } from "../types/market";
import {
  buildInventoryModeSeries,
  filterPriceHistory,
  formatDateLabel,
  getSeriesColor
} from "../utils/marketCalculations";

const PRICE_SERIES: Array<{ key: BenchmarkKey; label: string }> = [
  { key: "wti", label: "WTI" },
  { key: "brent", label: "Brent" },
  { key: "gasoline", label: "Gasoline" },
  { key: "diesel", label: "Diesel" }
];

const TIMEFRAME_OPTIONS = ["7D", "30D", "90D", "1Y"] as const;

function ToggleGroup({
  options,
  selected,
  onChange
}: {
  options: readonly string[];
  selected: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-energy-border bg-slate-50 p-1">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${selected === option ? "bg-white text-energy-ink shadow-sm" : "text-energy-slate"}`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="pricing-shell min-h-full rounded-[32px] border border-energy-border p-6">
      <div className="rounded-3xl border border-energy-border bg-white p-10 text-center text-energy-slate shadow-energy">
        Loading pricing dashboard...
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="pricing-shell min-h-full rounded-[32px] border border-energy-border p-6">
      <div className="rounded-3xl border border-rose-200 bg-white p-10 text-center shadow-energy">
        <div className="text-lg font-semibold text-energy-ink">Pricing data is unavailable.</div>
        <p className="mt-2 text-sm text-energy-slate">The mock service did not return a usable dashboard payload.</p>
        <button type="button" onClick={onRetry} className="mt-4 rounded-full bg-energy-blue px-4 py-2 text-sm font-semibold text-white">
          Try again
        </button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="pricing-shell min-h-full rounded-[32px] border border-energy-border p-6">
      <div className="rounded-3xl border border-energy-border bg-white p-10 text-center text-energy-slate shadow-energy">
        No pricing data is available for the selected view.
      </div>
    </div>
  );
}

function PriceTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="rounded-2xl border border-energy-border bg-white p-3 shadow-energy">
      <div className="space-y-1 text-sm">
        {payload.map((item) => (
          <div key={item.dataKey} className="flex items-center justify-between gap-4">
            <span className="font-medium" style={{ color: item.color }}>
              {String(item.dataKey).toUpperCase()} | {formatDateLabel(label)}
            </span>
            <span className="text-energy-ink">{item.value.toFixed(item.dataKey === "gasoline" || item.dataKey === "diesel" ? 3 : 2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InventoryTooltip({
  active,
  payload,
  label,
  mode
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
  mode: "absolute" | "wow";
}) {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="rounded-2xl border border-energy-border bg-white p-3 shadow-energy">
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-energy-slate">{formatDateLabel(label)}</div>
      <div className="space-y-1 text-sm">
        {payload.map((item) => (
          <div key={item.name} className="flex items-center justify-between gap-4">
            <span className="font-medium" style={{ color: item.color }}>{item.name}</span>
            <span className="text-energy-ink">{mode === "wow" && item.value > 0 ? "+" : ""}{item.value.toFixed(1)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PricingPage() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [data, setData] = useState<PricingDashboardData | null>(null);
  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAME_OPTIONS)[number]>("30D");
  const [inventoryMode, setInventoryMode] = useState<"absolute" | "wow">("absolute");
  const [selectedSeries, setSelectedSeries] = useState<Record<BenchmarkKey, boolean>>({
    wti: true,
    brent: true,
    gasoline: true,
    diesel: true
  });
  const [activeView, setActiveView] = useState<"prices" | "trends">("prices");

  async function load() {
    setStatus("loading");
    try {
      setData(await getPricingDashboardData());
      setStatus("ready");
    } catch (_error) {
      setStatus("error");
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filteredHistory = useMemo(() => (data ? filterPriceHistory(data.priceHistory, timeframe) : []), [data, timeframe]);
  const inventorySeries = useMemo(() => (data ? buildInventoryModeSeries(data.inventorySeries, inventoryMode) : []), [data, inventoryMode]);

  const inventoryChartData = useMemo(() => (
    inventorySeries.length
      ? inventorySeries[0].points.map((point, index) => ({
          date: point.date,
          crude: inventorySeries.find((item) => item.key === "crude")?.points[index]?.value ?? null,
          gasoline: inventorySeries.find((item) => item.key === "gasoline")?.points[index]?.value ?? null,
          distillate: inventorySeries.find((item) => item.key === "distillate")?.points[index]?.value ?? null
        }))
      : []
  ), [inventorySeries]);

  const forwardCurveData = useMemo(() => (
    data
      ? data.forwardCurves[0].points.map((point, index) => ({
          month: point.month,
          wti: data.forwardCurves.find((item) => item.key === "wti")?.points[index]?.value ?? null,
          brent: data.forwardCurves.find((item) => item.key === "brent")?.points[index]?.value ?? null,
          gasoline: data.forwardCurves.find((item) => item.key === "gasoline")?.points[index]?.value ?? null,
          diesel: data.forwardCurves.find((item) => item.key === "diesel")?.points[index]?.value ?? null
        }))
      : []
  ), [data]);

  if (status === "loading") return <LoadingState />;
  if (status === "error") return <ErrorState onRetry={load} />;
  if (!data || !data.benchmarkCards.length) return <EmptyState />;

  const lastUpdatedLabel = new Date(data.lastUpdated).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });

  const priceDrivers = data.insightSummary.narrativeBullets.slice(0, 3);
  const inventoryDrivers = data.insightSummary.narrativeBullets.slice(1, 4);
  const curveDrivers = data.insightSummary.curveSummaries;

  return (
    <div className="pricing-shell min-h-full rounded-[32px] border border-energy-border p-4 md:p-6">
      <div className="space-y-6">
        <section className="rounded-[28px] border border-energy-border bg-white p-6 shadow-energy">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div>
              <SectionHeader eyebrow="Market Monitor" title="Energy Market Dashboard" description="Crude, gasoline, diesel, inventories, and forward outlook" />
              <div className="mt-3 text-sm text-energy-slate">Last updated: <span className="font-medium text-energy-ink">{lastUpdatedLabel}</span></div>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={load}
                  disabled={status === "loading"}
                  className="rounded-full border border-energy-border bg-white px-4 py-2 text-sm font-semibold text-energy-ink transition hover:border-energy-blue hover:text-energy-blue disabled:cursor-wait disabled:opacity-60"
                >
                  {status === "loading" ? "Updating..." : "Update now"}
                </button>
              </div>
            </div>
            <div className="rounded-3xl border border-energy-border bg-slate-50 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-energy-slate">Market Monitor</div>
              <div className="mt-4">
                <label className="sr-only" htmlFor="pricing-section">Section</label>
                <select
                  id="pricing-section"
                  value={activeView}
                  onChange={(event) => setActiveView(event.target.value as "prices" | "trends")}
                  className="w-full rounded-2xl border border-energy-border bg-white px-4 py-3 text-sm font-semibold text-energy-ink outline-none transition focus:border-energy-blue"
                >
                  <option value="prices">Prices</option>
                  <option value="trends">Trends</option>
                </select>
              </div>
              <div className="mt-4">
                <SourceBadgeRow badges={data.sourceBadges} coverage={data.sourceCoverage} />
              </div>
              <div className="mt-4 rounded-2xl border border-energy-border bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-energy-slate">
                    {data.insightSummary.outlookTitle}
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-energy-slate">
                    {data.insightSummary.confidence}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-energy-ink">{data.insightSummary.narrativeBullets[0]}</p>
              </div>
            </div>
          </div>
        </section>

        {activeView === "prices" ? (
          <section className="space-y-6">
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
              {data.benchmarkCards.map((card) => <KpiCard key={card.key} card={card} />)}
            </section>

            <section className="rounded-3xl border border-energy-border bg-white p-6 shadow-energy">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.95fr)]">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-energy-slate">Price Snapshot</div>
                  <h3 className="mt-2 text-xl font-semibold text-energy-ink">What matters in the current market</h3>
                  <div className="mt-4 space-y-4 text-sm leading-6 text-energy-ink">
                    {priceDrivers.map((bullet) => (
                      <div key={bullet} className="flex gap-3">
                        <span className="mt-2 h-2 w-2 rounded-full bg-energy-blue" />
                        <span>{bullet}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl border border-energy-border bg-slate-50 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-energy-slate">
                      {data.insightSummary.outlookTitle}
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-energy-slate">
                      Confidence: {data.insightSummary.confidence}
                    </span>
                  </div>
                  <div className="mt-4 space-y-3 text-sm leading-6 text-energy-ink">
                    {data.insightSummary.outlookBody.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                  </div>
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Interpretation only. This dashboard is not trading advice.
                  </div>
                </div>
              </div>
            </section>
          </section>
        ) : (
          <section className="space-y-6">
            <ChartPanel
              title="Price Trends"
              description="Benchmark prices across crude and refined products."
              actions={<ToggleGroup options={TIMEFRAME_OPTIONS} selected={timeframe} onChange={(value) => setTimeframe(value as (typeof TIMEFRAME_OPTIONS)[number])} />}
              bodyClassName="min-h-[460px] w-full overflow-hidden"
              titlePopover={
                <div className="space-y-3">
                  {priceDrivers.map((bullet) => <p key={bullet}>{bullet}</p>)}
                  <p>{data.insightSummary.outlookBody[0]}</p>
                </div>
              }
            >
              <div className="min-w-0">
                <div className="mb-4 flex flex-wrap gap-2">
                  {PRICE_SERIES.map((series) => (
                    <button
                      key={series.key}
                      type="button"
                      onClick={() => setSelectedSeries((current) => ({ ...current, [series.key]: !current[series.key] }))}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${selectedSeries[series.key] ? "border-transparent text-white" : "border-energy-border bg-white text-energy-slate"}`}
                      style={selectedSeries[series.key] ? { backgroundColor: getSeriesColor(series.key) } : undefined}
                    >
                      {series.label}
                    </button>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={380}>
                  <LineChart data={filteredHistory} margin={{ top: 12, right: 20, left: 90, bottom: 4 }}>
                    <CartesianGrid stroke="#e6edf3" strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={formatDateLabel} tick={{ fontSize: 12, fill: "#5f7389" }} minTickGap={24} />
                    <YAxis tick={{ fontSize: 12, fill: "#5f7389" }} width={60} />
                    <Tooltip content={<PriceTooltip />} />
                    <Legend layout="vertical" align="left" verticalAlign="middle" wrapperStyle={{ left: 0 }} />
                    {PRICE_SERIES.map((series) => selectedSeries[series.key] ? (
                      <Line key={series.key} type="monotone" dataKey={series.key} name={series.label} stroke={getSeriesColor(series.key)} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                    ) : null)}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </ChartPanel>

            <ChartPanel
              title="Inventory Trends"
              description="Weekly U.S. stock context across crude and major transport fuels."
              actions={<ToggleGroup options={["absolute", "wow"]} selected={inventoryMode} onChange={(value) => setInventoryMode(value as "absolute" | "wow")} />}
              bodyClassName="min-h-[460px] w-full overflow-hidden"
              titlePopover={
                <div className="space-y-3">
                  {inventoryDrivers.map((bullet) => <p key={bullet}>{bullet}</p>)}
                  <p>{data.insightSummary.outlookBody[1]}</p>
                </div>
              }
            >
              <div className="min-w-0">
                <ResponsiveContainer width="100%" height={400}>
                  <LineChart data={inventoryChartData} margin={{ top: 12, right: 20, left: 120, bottom: 4 }}>
                    <CartesianGrid stroke="#e6edf3" strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={formatDateLabel} tick={{ fontSize: 12, fill: "#5f7389" }} minTickGap={18} />
                    <YAxis tick={{ fontSize: 12, fill: "#5f7389" }} width={60} />
                    <Tooltip content={<InventoryTooltip mode={inventoryMode} />} />
                    <Legend layout="vertical" align="left" verticalAlign="middle" wrapperStyle={{ left: 0 }} />
                    {(["crude", "gasoline", "distillate"] as const).map((key) => (
                      <Line key={key} type="monotone" dataKey={key} name={inventorySeries.find((series) => series.key === key)?.label || key} stroke={getSeriesColor(key)} strokeWidth={2.4} dot={false} activeDot={{ r: 4 }} />
                    ))}
                    {inventoryMode === "wow" ? <ReferenceLine y={0} stroke="#9fb0bf" strokeDasharray="4 4" /> : null}
                    {data.inventorySeries.flatMap((series) => series.annotations.map((annotation) => (
                      <ReferenceLine key={`${series.key}-${annotation.date}`} x={annotation.date} stroke={getSeriesColor(series.key)} strokeDasharray="2 6" label={{ value: annotation.label, position: "top", fill: getSeriesColor(series.key), fontSize: 11 }} />
                    )))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </ChartPanel>

            <ChartPanel
              title="Futures / Forward Curve"
              description="Prompt versus deferred pricing across the major contracts."
              bodyClassName="min-h-[460px] w-full overflow-hidden"
              titlePopover={
                <div className="space-y-3">
                  {curveDrivers.map((curve) => (
                    <div key={curve.market}>
                      <div className="font-semibold text-energy-ink">{curve.label}</div>
                      <p className="mt-1">{curve.description}</p>
                    </div>
                  ))}
                </div>
              }
            >
              <div className="min-w-0">
                <ResponsiveContainer width="100%" height={400}>
                  <LineChart data={forwardCurveData} margin={{ top: 12, right: 20, left: 90, bottom: 4 }}>
                    <CartesianGrid stroke="#e6edf3" strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#5f7389" }} />
                    <YAxis tick={{ fontSize: 12, fill: "#5f7389" }} width={60} />
                    <Tooltip />
                    <Legend layout="vertical" align="left" verticalAlign="middle" wrapperStyle={{ left: 0 }} />
                    {PRICE_SERIES.map((series) => (
                      <Line key={series.key} type="monotone" dataKey={series.key} name={series.label} stroke={getSeriesColor(series.key)} strokeWidth={2.5} dot={{ r: 3 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </ChartPanel>
          </section>
        )}
      </div>
    </div>
  );
}
