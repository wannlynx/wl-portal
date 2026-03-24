import { useState } from "react";
import { Area, AreaChart, TooltipProps, ResponsiveContainer, Tooltip, YAxis, XAxis } from "recharts";
import type { KpiCardModel } from "../types/market";
import { formatDateLabel, formatValue, getSeriesColor } from "../utils/marketCalculations";

interface KpiCardProps {
  card: KpiCardModel;
}

function SparklineTooltip({
  active,
  payload,
  label,
  unit
}: TooltipProps<number, string> & { unit: string }) {
  if (!active || !payload?.length) return null;
  return (
      <div className="rounded-2xl border border-energy-border bg-white px-3 py-2 text-sm shadow-energy">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-energy-slate">
        {typeof label === "string" && /^\d{4}-\d{2}-\d{2}$/.test(label) ? formatDateLabel(label) : String(label)}
      </div>
      <div className="mt-1 text-energy-ink">{formatValue(Number(payload[0].value || 0), unit)}</div>
    </div>
  );
}

function changeTone(value: number) {
  if (value > 0) return "text-emerald-700";
  if (value < 0) return "text-rose-700";
  return "text-energy-slate";
}

function statusTone(status: KpiCardModel["status"]) {
  if (status === "Rising") return "bg-emerald-50 text-emerald-700";
  if (status === "Falling") return "bg-rose-50 text-rose-700";
  return "bg-slate-100 text-slate-600";
}

export function KpiCard({ card }: KpiCardProps) {
  const regionEntries = Object.entries(card.regionalSeries || {});
  const [selectedRegion, setSelectedRegion] = useState(card.defaultRegion || regionEntries[0]?.[0] || "");
  const regional = selectedRegion ? card.regionalSeries?.[selectedRegion] : null;
  const currentValue = regional ? regional.current : card.currentValue;
  const dailyChange = regional ? regional.current - regional.dayAgo : card.dailyChange;
  const weeklyChange = regional ? regional.current - regional.weekAgo : card.weeklyChange;
  const sparkline = regional ? regional.sparkline : card.sparkline;
  const historyAnchors = regional?.historyAnchors || card.historyAnchors || [];
  const status = regional ? (weeklyChange > 0.15 ? "Rising" : weeklyChange < -0.15 ? "Falling" : "Stable") : card.status;
  const sparklineData = sparkline.map((value, index) => ({
    label: historyAnchors[index]?.date || `${index + 1}`,
    value
  }));
  const color = getSeriesColor(card.key as never);

  return (
    <article className="rounded-3xl border border-energy-border bg-white p-4 shadow-energy">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-energy-slate">{card.label}</div>
          {regionEntries.length ? (
            <select
              value={selectedRegion}
              onChange={(event) => setSelectedRegion(event.target.value)}
              className="mt-2 rounded-xl border border-energy-border bg-slate-50 px-2 py-1 text-xs font-semibold text-energy-ink outline-none"
            >
              {regionEntries.map(([regionKey, regionValue]) => (
                <option key={regionKey} value={regionKey}>{regionValue.label}</option>
              ))}
            </select>
          ) : null}
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-energy-ink">{formatValue(currentValue, card.unit)}</span>
            <span className="text-xs uppercase tracking-[0.14em] text-energy-slate">{card.unit}</span>
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusTone(status)}`}>
          {status}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-energy-slate">Daily</div>
          <div className={`mt-1 font-semibold ${changeTone(dailyChange)}`}>
            {dailyChange > 0 ? "+" : ""}{formatValue(dailyChange, card.unit)}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-energy-slate">Weekly</div>
          <div className={`mt-1 font-semibold ${changeTone(weeklyChange)}`}>
            {weeklyChange > 0 ? "+" : ""}{formatValue(weeklyChange, card.unit)}
          </div>
        </div>
      </div>
      <div className="mt-4 h-16">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={sparklineData}>
            <defs>
              <linearGradient id={`spark-${card.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" hide />
            <YAxis hide domain={["dataMin - 0.5", "dataMax + 0.5"]} />
            <Tooltip content={<SparklineTooltip unit={card.unit} />} />
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              fill={`url(#spark-${card.key})`}
              fillOpacity={1}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}
