import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
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
import type { BenchmarkKey, OpisRawApiRecord, OpisRawApiResponse, OpisRawSection, PricingDashboardData } from "../types/market";
import {
  buildInventoryModeSeries,
  filterPriceHistory,
  formatDateLabel,
  getSeriesColor
} from "../utils/marketCalculations";
import { getOpisMarketData } from "../services/marketDataService";
import type { OpisFuelFilter, OpisMarketSnapshot, OpisSummaryRow } from "../types/market";
import { parseOpisRawReport } from "../utils/opisRawParser";
import opisRawReportSample from "../data/opisRawReportSample.txt?raw";

const PRICE_SERIES: Array<{ key: BenchmarkKey; label: string }> = [
  { key: "wti", label: "WTI" },
  { key: "brent", label: "Brent" },
  { key: "gasoline", label: "Gasoline" },
  { key: "diesel", label: "Diesel" }
];

const TIMEFRAME_OPTIONS = ["7D", "30D", "90D", "1Y"] as const;

function opisRawReadField(row: OpisRawApiRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value != null && value !== "") return value;
  }
  return null;
}

function opisRawLiveRowsFromPayload(payload: OpisRawApiResponse | null) {
  const rows =
    payload?.data?.supplierPrices ??
    payload?.data?.SupplierPrices ??
    payload?.Data?.supplierPrices ??
    payload?.Data?.SupplierPrices ??
    payload?.data?.summaries ??
    payload?.data?.Summaries ??
    payload?.Data?.summaries ??
    payload?.Data?.Summaries ??
    [];
  return Array.isArray(rows) ? rows : [];
}

function opisRawSummaryRowsFromPayload(payload: OpisRawApiResponse | null) {
  const rows =
    payload?.data?.summaries ??
    payload?.data?.Summaries ??
    payload?.Data?.summaries ??
    payload?.Data?.Summaries ??
    [];
  return Array.isArray(rows) ? rows : [];
}

function opisRawLiveMarketLabel(row: OpisRawApiRecord) {
  const city = String(opisRawReadField(row, "CityName", "cityName") || "").trim();
  const state = String(opisRawReadField(row, "StateAbbr", "stateAbbr") || "").trim();
  const market = [city, state].filter(Boolean).join(", ");
  if (market) return market;
  return String(opisRawReadField(row, "CityID", "cityId") || "Unknown market");
}

function opisRawLiveProductLabel(row: OpisRawApiRecord) {
  return String(opisRawReadField(row, "ProductName", "productName") || "Unknown product");
}

function opisRawLiveSupplierLabel(row: OpisRawApiRecord) {
  const supplier = String(opisRawReadField(row, "SupplierName", "supplierName") || "").trim();
  if (supplier) return supplier;
  const terminal = String(opisRawReadField(row, "TerminalAbbr", "terminalAbbr", "TerminalName", "terminalName") || "").trim();
  if (terminal) return terminal;
  return "Unknown supplier";
}

function opisRawLivePriceLabel(row: OpisRawApiRecord) {
  const price = opisRawReadField(row, "Price", "price");
  const unit = String(opisRawReadField(row, "CurrencyUnit", "currencyUnit") || "").trim();
  if (typeof price === "number") return `${price.toFixed(2)}${unit ? ` ${unit}` : ""}`;
  if (typeof price === "string" && price.trim()) return `${price.trim()}${unit ? ` ${unit}` : ""}`;
  return "n/a";
}

type GeneratedReportSegment = {
  text: string;
  uncertain?: boolean;
};

type GeneratedReportLine = GeneratedReportSegment[];

function reportSegment(text: string, uncertain = false): GeneratedReportSegment {
  return { text, uncertain };
}

function padReportValue(value: string, width: number, align: "left" | "right" = "left") {
  const normalized = String(value ?? "");
  if (normalized.length >= width) return normalized.slice(0, width);
  return align === "right" ? normalized.padStart(width, " ") : normalized.padEnd(width, " ");
}

function reportCell(value: string, width: number, options: { uncertain?: boolean; align?: "left" | "right" } = {}) {
  return reportSegment(padReportValue(value, width, options.align || "left"), !!options.uncertain);
}

function opisGeneratedSectionTitle(rows: OpisRawApiRecord[]) {
  const sample = rows[0] || {};
  const fuelType = String(opisRawReadField(sample, "FuelType", "fuelType") || "").toLowerCase();
  const productName = String(opisRawReadField(sample, "ProductName", "productName") || "").toUpperCase();
  if (fuelType.includes("distillate") || fuelType.includes("diesel")) {
    return "OPIS NET CARB ULTRA LOW SULFUR DISTILLATE PRICES WITHOUT CAR COST";
  }
  if (fuelType.includes("gas") || fuelType.includes("gasoline")) {
    return "OPIS NET CARFG ETHANOL (10%) PRICES WITHOUT CAR COST";
  }
  return `OPIS NET ${productName || "WHOLESALE"} PRICES`;
}

function opisGeneratedLabel(row: OpisRawApiRecord) {
  const supplier = opisRawLiveSupplierLabel(row);
  return supplier.length > 12 ? supplier.slice(0, 12) : supplier;
}

function opisGeneratedTerms(row: OpisRawApiRecord) {
  const terms = String(opisRawReadField(row, "Terms", "terms") || "").trim();
  if (terms) return terms;
  const branded = String(opisRawReadField(row, "Branded", "branded") || "").trim();
  const grossNet = String(opisRawReadField(row, "GrossNet", "grossNet") || "NET").trim();
  return [branded, grossNet].filter(Boolean).join(" ").trim() || "NET";
}

function opisGeneratedDateTime(row: OpisRawApiRecord) {
  const raw = String(opisRawReadField(row, "EffectiveDate", "effectiveDate", "MoveDate", "moveDate") || "").trim();
  if (!raw) {
    return { date: "n/a", time: "n/a", uncertain: true };
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return {
      date: raw.slice(0, 5) || "n/a",
      time: raw.slice(5, 10) || "n/a",
      uncertain: true
    };
  }
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return {
    date: `${month}/${day}`,
    time: `${hours}:${minutes}`,
    uncertain: false
  };
}

function opisRowPrice(row: OpisRawApiRecord) {
  const value = Number(opisRawReadField(row, "Price", "price"));
  return Number.isFinite(value) ? value : null;
}

function opisGeneratedMove(row: OpisRawApiRecord) {
  const moveDateRaw = String(opisRawReadField(row, "MoveDate", "moveDate") || "").trim();
  const effectiveDateRaw = String(opisRawReadField(row, "EffectiveDate", "effectiveDate") || "").trim();
  if (!moveDateRaw || !effectiveDateRaw) return { value: "n/a", uncertain: true };
  const moveDate = new Date(moveDateRaw);
  const effectiveDate = new Date(effectiveDateRaw);
  if (Number.isNaN(moveDate.getTime()) || Number.isNaN(effectiveDate.getTime())) {
    return { value: "n/a", uncertain: true };
  }
  const diffMinutes = Math.round((moveDate.getTime() - effectiveDate.getTime()) / 60000);
  if (!Number.isFinite(diffMinutes) || diffMinutes === 0) {
    return { value: "0", uncertain: false };
  }
  return {
    value: `${diffMinutes > 0 ? "+" : ""}${diffMinutes}`,
    uncertain: true
  };
}

function opisNormalizeMetricLabel(value: string) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function opisSummaryMetricValue(rows: OpisRawApiRecord[], matcher: RegExp) {
  const candidate = rows.find((row) => matcher.test(opisNormalizeMetricLabel(String(opisRawReadField(row, "BenchmarkTypeName", "benchmarkTypeName") || ""))));
  const price = candidate ? opisRowPrice(candidate) : null;
  if (price == null) {
    return null;
  }
  return price.toFixed(2);
}

function opisGeneratedMetricFromSummaryOrRows(
  label: string,
  supplierRows: OpisRawApiRecord[],
  summaryRows: OpisRawApiRecord[],
  filterFn?: (row: OpisRawApiRecord) => boolean
) {
  const scopedSummaryRows = filterFn ? summaryRows.filter(filterFn) : summaryRows;
  const normalizedLabel = opisNormalizeMetricLabel(label);
  let summaryValue = null;

  if (normalizedLabel === "LOW RACK") {
    summaryValue = opisSummaryMetricValue(scopedSummaryRows, /LOW/);
  } else if (normalizedLabel === "HIGH RACK") {
    summaryValue = opisSummaryMetricValue(scopedSummaryRows, /HIGH/);
  } else if (normalizedLabel === "RACK AVG") {
    summaryValue = opisSummaryMetricValue(scopedSummaryRows, /AVG|AVERAGE/);
  } else if (normalizedLabel === "BRD LOW RACK") {
    summaryValue = opisSummaryMetricValue(scopedSummaryRows, /BRAND.*LOW|LOW.*BRAND/);
  } else if (normalizedLabel === "BRD HIGH RACK") {
    summaryValue = opisSummaryMetricValue(scopedSummaryRows, /BRAND.*HIGH|HIGH.*BRAND/);
  } else if (normalizedLabel === "BRD RACK AVG") {
    summaryValue = opisSummaryMetricValue(scopedSummaryRows, /BRAND.*AVG|AVG.*BRAND|BRAND.*AVERAGE/);
  } else if (normalizedLabel === "UBD LOW RACK") {
    summaryValue = opisSummaryMetricValue(scopedSummaryRows, /UNBRAND.*LOW|LOW.*UNBRAND/);
  } else if (normalizedLabel === "UBD HIGH RACK") {
    summaryValue = opisSummaryMetricValue(scopedSummaryRows, /UNBRAND.*HIGH|HIGH.*UNBRAND/);
  } else if (normalizedLabel === "UBD RACK AVG") {
    summaryValue = opisSummaryMetricValue(scopedSummaryRows, /UNBRAND.*AVG|AVG.*UNBRAND|UNBRAND.*AVERAGE/);
  }

  if (summaryValue != null) {
    return { label, value: summaryValue, uncertain: false };
  }

  return opisGeneratedMetric(label, supplierRows, filterFn);
}

function opisGeneratedMetric(label: string, rows: OpisRawApiRecord[], filterFn?: (row: OpisRawApiRecord) => boolean) {
  const scoped = filterFn ? rows.filter(filterFn) : rows;
  const prices = scoped.map(opisRowPrice).filter((value): value is number => value != null);
  if (!prices.length) {
    return { label, value: "n/a", uncertain: true };
  }
  if (/LOW/i.test(label)) return { label, value: prices.reduce((a, b) => Math.min(a, b), prices[0]).toFixed(2), uncertain: false };
  if (/HIGH/i.test(label)) return { label, value: prices.reduce((a, b) => Math.max(a, b), prices[0]).toFixed(2), uncertain: false };
  return { label, value: (prices.reduce((sum, value) => sum + value, 0) / prices.length).toFixed(2), uncertain: false };
}

function opisIsBranded(row: OpisRawApiRecord, target: "B" | "U") {
  const branded = String(opisRawReadField(row, "Branded", "branded") || "").trim().toUpperCase();
  return branded.startsWith(target);
}

function buildGeneratedOpisReport(rows: OpisRawApiRecord[], summaryRows: OpisRawApiRecord[], requestTimestamp: string) {
  const grouped = new Map<string, OpisRawApiRecord[]>();
  for (const row of rows) {
    const market = opisRawLiveMarketLabel(row);
    const product = opisRawLiveProductLabel(row);
    const key = `${market}__${product}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)?.push(row);
  }

  const lines: GeneratedReportLine[] = [];

  for (const [groupKey, marketRows] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const [market, product] = groupKey.split("__");
    const scopedSummaryRows = summaryRows.filter((row) => (
      opisRawLiveMarketLabel(row) === market &&
      opisRawLiveProductLabel(row) === product
    ));
    const sortedRows = [...marketRows].sort((a, b) => {
      const aPrice = opisRowPrice(a) ?? -Infinity;
      const bPrice = opisRowPrice(b) ?? -Infinity;
      return aPrice - bPrice;
    });

    lines.push([
      reportCell(market.toUpperCase(), 52),
      reportCell(requestTimestamp, 26, { uncertain: true })
    ]);
    lines.push([reportSegment("                   **OPIS CONTRACT BENCHMARK FILE**")]);
    lines.push([reportSegment(`       **${opisGeneratedSectionTitle(sortedRows).toUpperCase()}**`)]);
    lines.push([reportSegment(`       **${product.toUpperCase()}**`)]);
    lines.push([reportSegment("             Terms           Price   Move   Date  Time")]);

    sortedRows.slice(0, 16).forEach((row) => {
      const effective = opisGeneratedDateTime(row);
      const move = opisGeneratedMove(row);
      lines.push([
        reportCell(opisGeneratedLabel(row), 13),
        reportCell(opisGeneratedTerms(row), 16),
        reportCell(opisRawLivePriceLabel(row).replace(/\s+[A-Z]+$/i, ""), 8, { align: "right" }),
        reportCell(move.value, 7, { uncertain: move.uncertain, align: "right" }),
        reportCell(effective.date, 6, { uncertain: effective.uncertain, align: "right" }),
        reportSegment(" "),
        reportCell(effective.time, 5, { uncertain: effective.uncertain, align: "right" })
      ]);
    });

    const metrics = [
      opisGeneratedMetricFromSummaryOrRows("LOW RACK", sortedRows, scopedSummaryRows),
      opisGeneratedMetricFromSummaryOrRows("HIGH RACK", sortedRows, scopedSummaryRows),
      opisGeneratedMetricFromSummaryOrRows("RACK AVG", sortedRows, scopedSummaryRows),
      { label: "CAP-AT-THE-RACK", value: "n/a", uncertain: true },
      { label: "LCFS COST", value: "n/a", uncertain: true },
      { label: `FOB ${market.toUpperCase()}`, value: "n/a", uncertain: true },
      opisGeneratedMetricFromSummaryOrRows("BRD LOW RACK", sortedRows, scopedSummaryRows, (row) => opisIsBranded(row, "B")),
      opisGeneratedMetricFromSummaryOrRows("BRD HIGH RACK", sortedRows, scopedSummaryRows, (row) => opisIsBranded(row, "B")),
      opisGeneratedMetricFromSummaryOrRows("BRD RACK AVG", sortedRows, scopedSummaryRows, (row) => opisIsBranded(row, "B")),
      opisGeneratedMetricFromSummaryOrRows("UBD LOW RACK", sortedRows, scopedSummaryRows, (row) => opisIsBranded(row, "U")),
      opisGeneratedMetricFromSummaryOrRows("UBD HIGH RACK", sortedRows, scopedSummaryRows, (row) => opisIsBranded(row, "U")),
      opisGeneratedMetricFromSummaryOrRows("UBD RACK AVG", sortedRows, scopedSummaryRows, (row) => opisIsBranded(row, "U")),
      { label: "CONT AVG", value: opisGeneratedMetricFromSummaryOrRows("RACK AVG", sortedRows, scopedSummaryRows).value, uncertain: true },
      { label: "CONT NET AVG", value: opisGeneratedMetricFromSummaryOrRows("RACK AVG", sortedRows, scopedSummaryRows).value, uncertain: true },
      { label: "CONT NET LOW", value: opisGeneratedMetricFromSummaryOrRows("LOW RACK", sortedRows, scopedSummaryRows).value, uncertain: true },
      { label: "CONT NET HI", value: opisGeneratedMetricFromSummaryOrRows("HIGH RACK", sortedRows, scopedSummaryRows).value, uncertain: true }
    ];

    metrics.forEach((metric) => {
      lines.push([
        reportCell(metric.label, 18),
        reportCell(metric.value, 8, { uncertain: metric.uncertain, align: "right" })
      ]);
    });

    lines.push([]);
    lines.push([reportSegment(market.toUpperCase())]);
    ["LOW RETAIL", "AVG RETAIL", "LOW RETAIL EX-TAX", "AVG RETAIL EX-TAX"].forEach((label) => {
      lines.push([
        reportCell(label, 23),
        reportCell("n/a", 8, { uncertain: true, align: "right" })
      ]);
    });
    lines.push([]);
  }

  lines.push([reportSegment("Generated from OPIS SupplierPrices API. Red values are unavailable or derived rather than exact report fields.", true)]);
  return lines;
}

function generatedOpisReportToText(lines: GeneratedReportLine[]) {
  return lines.map((line) => line.map((segment) => segment.text).join("")).join("\n");
}

function opisSectionsToText(sections: OpisRawSection[], disclaimers: string[] = []) {
  const sectionText = sections
    .map((section) => section.rawLines.join("\n"))
    .filter(Boolean)
    .join("\n\n");
  const disclaimerText = disclaimers.filter(Boolean).join("\n");
  return [sectionText, disclaimerText].filter(Boolean).join("\n\n").trim();
}

function opisRawSectionTypeLabel(section: OpisRawSection) {
  const title = String(section.title || "").trim();
  if (title) {
    return title;
  }
  return section.sectionType === "retail" ? "Retail Summary" : "Unknown Type";
}

function GeneratedOpisReport({ lines }: { lines: GeneratedReportLine[] }) {
  return (
    <div className="mt-2 min-h-[320px] overflow-auto rounded-3xl border border-energy-border bg-slate-50 px-4 py-4 font-mono text-[11px] leading-6 text-energy-ink whitespace-pre">
      {lines.map((line, lineIndex) => (
        <div key={`report-line-${lineIndex}`}>
          {line.length
            ? line.map((segment, segmentIndex) => (
              <span key={`segment-${lineIndex}-${segmentIndex}`} className={segment.uncertain ? "text-rose-600" : undefined}>
                {segment.text}
              </span>
            ))
            : " "}
        </div>
      ))}
    </div>
  );
}

type PricingFormulaId = "regular" | "premium" | "diesel";

type PricingFormulaComponent = {
  key: string;
  label: string;
  inputValue: number | null;
  multiplier: number;
  notes: string;
  fallbackTo?: string;
  marketDriven?: boolean;
};

type PricingFormulaTemplate = {
  id: PricingFormulaId;
  label: string;
  totalLabel: string;
  productMatcher: RegExp;
  components: PricingFormulaComponent[];
};

type SitePricingConfig = {
  pricingKey: string;
  formulaId: string;
  fuelType?: string;
  productName: string;
  marketLabel: string;
  config: Record<string, { inputValue?: string; multiplier?: string }>;
  updatedAt?: string;
  updatedBy?: string;
};

const PRICING_FORMULA_TEMPLATES: PricingFormulaTemplate[] = [
  {
    id: "regular",
    label: "Regular Formula",
    totalLabel: "Regular Estimated Price",
    productMatcher: /regular|reg|87|carbob/i,
    components: [
      { key: "carbob", label: "CARBOB Spot Price (USD/gal)", inputValue: 2.8781, multiplier: 0.9, notes: "Pulled from OPIS market table", marketDriven: true },
      { key: "ethanol", label: "Ethanol Spot Price (USD/gal)", inputValue: 2.03, multiplier: 0.1, notes: "Pulled from OPIS market table when available", marketDriven: true },
      { key: "rin", label: "RIN Price (USD/gal)", inputValue: 1.075, multiplier: -0.09, notes: "Pulled from OPIS market table when available", marketDriven: true },
      { key: "terminal_adder", label: "Terminal Adder (USD/gal)", inputValue: 0.01, multiplier: 1, notes: "Editable adder" },
      { key: "lcfs", label: "LCFS (USD/gal)", inputValue: 0.16785, multiplier: 1, notes: "Editable variable" },
      { key: "ghg_term_c", label: "GHG - Term C (Preferred, USD/gal)", inputValue: 0.2211, multiplier: 1, notes: "Editable variable" },
      { key: "ghg_term_d", label: "GHG - Term D (Fallback, USD/gal)", inputValue: null, multiplier: 1, notes: "Editable fallback if Term C is blank", fallbackTo: "ghg_term_c" }
    ]
  },
  {
    id: "premium",
    label: "Premium Formula",
    totalLabel: "Premium Estimated Price",
    productMatcher: /premium|prem|91|93/i,
    components: [
      { key: "carbob", label: "CARBOB Spot Price (USD/gal)", inputValue: 3.0781, multiplier: 0.9, notes: "Pulled from OPIS market table", marketDriven: true },
      { key: "ethanol", label: "Ethanol Spot Price (USD/gal)", inputValue: 2.03, multiplier: 0.1, notes: "Pulled from OPIS market table when available", marketDriven: true },
      { key: "rin", label: "RIN Price (USD/gal)", inputValue: 1.075, multiplier: -0.09, notes: "Pulled from OPIS market table when available", marketDriven: true },
      { key: "terminal_adder", label: "Terminal Adder (USD/gal)", inputValue: 0.01, multiplier: 1, notes: "Editable adder" },
      { key: "lcfs", label: "LCFS (USD/gal)", inputValue: 0.16785, multiplier: 1, notes: "Editable variable" },
      { key: "ghg_term_c", label: "GHG - Term C (Preferred, USD/gal)", inputValue: 0.2204, multiplier: 1, notes: "Editable variable" },
      { key: "ghg_term_d", label: "GHG - Term D (Fallback, USD/gal)", inputValue: null, multiplier: 1, notes: "Editable fallback if Term C is blank", fallbackTo: "ghg_term_c" }
    ]
  },
  {
    id: "diesel",
    label: "Diesel Formula",
    totalLabel: "Diesel Estimated Price",
    productMatcher: /diesel|dsl|ulsd|carb/i,
    components: [
      { key: "spot", label: "Spot Price (USD/gal)", inputValue: 2.7561, multiplier: 1, notes: "Pulled from OPIS market table", marketDriven: true },
      { key: "ethanol", label: "Ethanol Spot Price (USD/gal)", inputValue: 2.03, multiplier: 0.1, notes: "Pulled from OPIS market table when available", marketDriven: true },
      { key: "rin", label: "RIN Price (USD/gal)", inputValue: 1.075, multiplier: 0, notes: "Pulled from OPIS market table when available", marketDriven: true },
      { key: "terminal_adder", label: "Terminal Adder (USD/gal)", inputValue: 0.012, multiplier: 1, notes: "Editable adder" },
      { key: "lcfs", label: "LCFS (USD/gal)", inputValue: 0.16785, multiplier: 1, notes: "Editable variable" },
      { key: "ghg_term_c", label: "GHG - Term C (Preferred, USD/gal)", inputValue: 0.2809, multiplier: 1, notes: "Editable variable" },
      { key: "ghg_term_d", label: "GHG - Term D (Fallback, USD/gal)", inputValue: null, multiplier: 1, notes: "Editable fallback if Term C is blank", fallbackTo: "ghg_term_c" }
    ]
  }
];

const PRICING_FORMULA_TEMPLATE_BY_ID = new Map(PRICING_FORMULA_TEMPLATES.map((template) => [template.id, template]));

function formatOpisPrice(value: number | null, unit = "USCPG") {
  if (value == null) return "n/a";
  return `${value.toFixed(2)} ${unit}`;
}

function formatOpisDateTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function opisRawRowNewestTimestamp(row: OpisRawApiRecord) {
  const candidates = [
    String(opisRawReadField(row, "EffectiveDate", "effectiveDate") || "").trim(),
    String(opisRawReadField(row, "MoveDate", "moveDate") || "").trim()
  ].filter(Boolean);

  const timestamps = candidates
    .map((candidate) => new Date(candidate))
    .filter((parsed) => !Number.isNaN(parsed.getTime()))
    .map((parsed) => parsed.getTime());

  if (!timestamps.length) return null;
  return Math.max(...timestamps);
}

function opisRawFreshnessLabel(newestTimestamp: number | null, fetchedTimestamp: number | null) {
  if (!newestTimestamp || !fetchedTimestamp) {
    return { status: "unknown", label: "Freshness unknown" };
  }

  const diffHours = (fetchedTimestamp - newestTimestamp) / (1000 * 60 * 60);
  if (diffHours <= 24) {
    return { status: "fresh", label: "Fresh within 24 hours" };
  }
  if (diffHours <= 48) {
    return { status: "aging", label: "Older than 24 hours" };
  }
  return { status: "stale", label: "Older than 48 hours" };
}

function opisRawStartOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

function opisRawIsSameDay(value: Date, target: Date) {
  return opisRawStartOfDay(value) === opisRawStartOfDay(target);
}

function opisRawParseDateField(row: OpisRawApiRecord, ...keys: string[]) {
  const raw = String(opisRawReadField(row, ...keys) || "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function opisRawCurrentPricingRow(row: OpisRawApiRecord, now = new Date()) {
  const effective = opisRawParseDateField(row, "EffectiveDate", "effectiveDate");
  const move = opisRawParseDateField(row, "MoveDate", "moveDate");
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const effectiveValid = effective && !Number.isNaN(effective.getTime()) ? effective : null;
  const moveValid = move && !Number.isNaN(move.getTime()) ? move : null;

  if (effectiveValid && opisRawIsSameDay(effectiveValid, today)) {
    return true;
  }

  if (moveValid && opisRawIsSameDay(moveValid, yesterday) && (!effectiveValid || opisRawIsSameDay(effectiveValid, today))) {
    return true;
  }

  return false;
}

function opisRawMatchesDateView(row: OpisRawApiRecord, dateView: "current" | "today" | "yesterday" | "all", now = new Date()) {
  if (dateView === "all") return true;
  if (dateView === "current") return opisRawCurrentPricingRow(row, now);

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const effective = opisRawParseDateField(row, "EffectiveDate", "effectiveDate");
  const move = opisRawParseDateField(row, "MoveDate", "moveDate");
  const target = dateView === "today" ? today : yesterday;

  return Boolean(
    (effective && opisRawIsSameDay(effective, target)) ||
    (move && opisRawIsSameDay(move, target))
  );
}

function averageOpisRows(rows: OpisSummaryRow[], fuelType?: string) {
  const filtered = fuelType ? rows.filter((row) => row.fuelType === fuelType) : rows;
  if (!filtered.length) return null;
  return filtered.reduce((sum, row) => sum + row.price, 0) / filtered.length;
}

function filterOpisRows(rows: OpisSummaryRow[], state: string, city: string) {
  return rows.filter((row) => {
    const stateMatch = state === "ALL" || row.stateAbbr === state;
    const cityLabel = `${row.cityName}, ${row.stateAbbr}`;
    const cityMatch = city === "ALL" || cityLabel === city;
    return stateMatch && cityMatch;
  });
}

function filterOpisRowsByFuelType(rows: OpisSummaryRow[], fuelType: OpisFuelFilter) {
  if (fuelType === "all") return rows;
  const normalizedTarget = fuelType.toLowerCase();
  return rows.filter((row) => String(row.fuelType || "").toLowerCase().includes(normalizedTarget));
}

function filterOpisRowsByProduct(rows: OpisSummaryRow[], productName: string) {
  if (productName === "ALL") return rows;
  return rows.filter((row) => row.productName === productName);
}

function fuelCardTone(label: string) {
  if (/diesel/i.test(label)) return "border-rose-200 bg-rose-50";
  if (/gasoline|premium|midgrade|regular/i.test(label)) return "border-amber-200 bg-amber-50";
  if (/crude|brent|wti/i.test(label)) return "border-blue-200 bg-blue-50";
  if (/stocks/i.test(label)) return "border-slate-200 bg-slate-50";
  return "border-energy-border bg-white";
}

function formatOpisChange(value: number | null) {
  if (value == null) return "n/a";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)} USCPG`;
}

function resolveFormulaId(productName: string): PricingFormulaId | null {
  const match = PRICING_FORMULA_TEMPLATES.find((template) => template.productMatcher.test(productName));
  return match?.id || null;
}

function formatCurrencyPerGallon(value: number | null) {
  if (value == null || Number.isNaN(value)) return "n/a";
  return `$${value.toFixed(4)}`;
}

function computeFormulaTotal(
  components: Array<PricingFormulaComponent & { inputValue: number | null; multiplier: number }>
) {
  const componentMap = new Map(components.map((component) => [component.key, component]));
  return components.reduce((sum, component) => {
    if (component.fallbackTo) {
      const primary = componentMap.get(component.fallbackTo);
      if (primary?.inputValue != null) return sum;
    }
    return sum + ((component.inputValue ?? 0) * component.multiplier);
  }, 0);
}

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

function WarningState({ messages }: { messages: string[] }) {
  if (!messages.length) return null;
  return (
    <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-energy">
      <div className="text-lg font-semibold text-amber-950">Market data warning</div>
      <div className="mt-2 space-y-2 text-sm text-amber-900">
        {messages.map((message) => (
          <p key={message}>{message}</p>
        ))}
      </div>
    </section>
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

function opisRawCompactColumns(columns: string[]) {
  const result: Array<{ key: string; label: string; indices: number[] }> = [];
  for (let index = 0; index < columns.length; index += 1) {
    const column = columns[index];
    if (/^terms$/i.test(column)) {
      result.push({ key: `terms-${index}`, label: "Terms", indices: [index] });
      continue;
    }
    if (/^date$/i.test(column) && /^time$/i.test(columns[index + 1] || "")) {
      result.push({ key: `datetime-${index}`, label: "Date / Time", indices: [index, index + 1] });
      index += 1;
      continue;
    }
    if (/^move$/i.test(column)) {
      continue;
    }
    if (/^(unl|mid|pre|no2|no\.2|rd|nrlm|jet|marine|culs)$/i.test(column)) {
      const indices = [index];
      if (/^move$/i.test(columns[index + 1] || "")) indices.push(index + 1);
      result.push({ key: `${column}-${index}`, label: column.replace(/^No\.?2$/i, "No2"), indices });
      continue;
    }
    result.push({ key: `${column}-${index}`, label: column, indices: [index] });
  }
  return result;
}

function opisRawTakeCell(tokens: string[], column: string, nextColumn?: string) {
  if (!tokens.length) return "";
  if (/^terms$/i.test(column)) {
    const parts = [tokens.shift() || ""];
    if (tokens.length && !/^[+-]$/.test(tokens[0]) && !/^\d/.test(tokens[0])) {
      parts.push(tokens.shift() || "");
    }
    return parts.filter(Boolean).join(" ").trim();
  }
  if (/^move$/i.test(column)) {
    if (tokens[0] === "--" && tokens[1] === "--") {
      tokens.shift();
      tokens.shift();
      return "-- --";
    }
    if (/^[+-]$/.test(tokens[0] || "")) {
      const sign = tokens.shift() || "";
      const value = tokens.shift() || "";
      return `${sign} ${value}`.trim();
    }
    return tokens.shift() || "";
  }
  if (/^date$/i.test(column) || /^time$/i.test(column)) {
    return tokens.shift() || "";
  }
  if (tokens[0] === "--" && tokens[1] === "--") {
    tokens.shift();
    tokens.shift();
    return "-- --";
  }
  if (/^\d/.test(tokens[0] || "") || /^--$/.test(tokens[0] || "")) {
    return tokens.shift() || "";
  }
  if (nextColumn && /^move$/i.test(nextColumn) && /^[+-]$/.test(tokens[0] || "")) {
    return "";
  }
  return tokens.shift() || "";
}

function opisRawMetricColumns(section: OpisRawSection) {
  return opisRawCompactColumns(section.supplierColumns)
    .filter((column) => !/^Terms$/i.test(column.label) && !/^Date \/ Time$/i.test(column.label));
}

function opisRawParseSupplierCells(raw: string, headerColumns: string[]) {
  const tokens = raw.trim().match(/\S+/g) || [];
  if (tokens.length <= 1) return [];
  const remaining = tokens.slice(1);
  return headerColumns.map((column, index) => opisRawTakeCell(remaining, column, headerColumns[index + 1]));
}

function opisRawParseMetricCells(rawLines: string[], label: string, headerColumns: string[]) {
  const line = rawLines.find((entry) => entry.trim().startsWith(label));
  if (!line) return [];
  const stripped = line.trim().slice(label.length).trim();
  const compactColumns = headerColumns.filter((column) => !/^terms$/i.test(column) && !/^date$/i.test(column) && !/^time$/i.test(column) && !/^move$/i.test(column));
  const tokens = stripped.match(/\S+/g) || [];
  const compactCells = compactColumns.map((column, index) => opisRawTakeCell(tokens, column, compactColumns[index + 1]));
  const values = [...compactCells];
  return headerColumns.map((column) => {
    if (/^terms$/i.test(column) || /^date$/i.test(column) || /^time$/i.test(column) || /^move$/i.test(column)) return "";
    return values.shift() || "";
  });
}

function opisRawFormatCellValue(values: string[], indices: number[]) {
  const primary = values[indices[0]] || "--";
  const secondary = indices.length > 1 ? values[indices[1]] || "" : "";
  if (indices.length > 1 && secondary && secondary !== "-- --") {
    return `${primary} (${secondary})`;
  }
  if (indices.length > 1 && (!secondary || secondary === "--")) {
    return primary;
  }
  if (indices.length > 1 && secondary === "-- --") {
    return primary === "-- --" ? "--" : primary;
  }
  return primary || "--";
}

function OpisRawSectionCard({ section }: { section: OpisRawSection }) {
  const metricGroups = section.metrics.reduce((groups, metric) => {
    const key = metric.subsection || "Primary";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)?.push(metric);
    return groups;
  }, new Map<string, typeof section.metrics>());
  const compactColumns = opisRawCompactColumns(section.supplierColumns);
  const metricColumns = opisRawMetricColumns(section);
  const hasCompactMatrix = metricColumns.length > 0;

  return (
    <section className="rounded-3xl border border-energy-border bg-white p-6 shadow-energy">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-energy-slate">{section.market || "OPIS Raw"}</div>
          <h3 className="mt-2 text-xl font-semibold text-energy-ink">{section.title}</h3>
          <div className="mt-2 text-sm text-energy-slate">
            {section.capturedAt ? `Captured ${section.capturedAt}` : "Pasted raw report section"}
          </div>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-energy-slate">
          {section.sectionType}
        </span>
      </div>

      {metricGroups.size ? (
        <div className="mt-5 space-y-5">
          {[...metricGroups.entries()].map(([subsection, metrics]) => (
            <div key={`${section.id}-${subsection}`}>
              {subsection !== "Primary" ? (
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-energy-slate">{subsection}</div>
              ) : null}
              {hasCompactMatrix ? (
                <div className="overflow-x-auto rounded-2xl border border-energy-border">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-energy-slate">
                        <th className="px-4 py-3 pr-4">Metric</th>
                        {metricColumns.map((column) => (
                          <th key={`${section.id}-${subsection}-${column.key}`} className="px-4 py-3 pr-4">{column.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.map((metric) => {
                        const metricCells = metric.cells.some(Boolean) ? metric.cells : opisRawParseMetricCells(section.rawLines, metric.label, section.supplierColumns);
                        return (
                        <tr key={`${section.id}-${metric.label}-${metricCells.join("-")}`} className="border-t border-slate-100 align-top">
                          <td className="px-4 py-3 pr-4 font-semibold text-energy-ink">{metric.label}</td>
                          {metricColumns.map((column) => (
                            <td key={`${section.id}-${metric.label}-${column.key}`} className="px-4 py-3 pr-4 font-mono text-xs text-energy-ink">
                              {opisRawFormatCellValue(metricCells, column.indices)}
                            </td>
                          ))}
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {metrics.map((metric) => (
                    <div key={`${section.id}-${metric.label}`} className="rounded-2xl border border-energy-border bg-slate-50 p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-energy-slate">{metric.label}</div>
                      <div className="mt-2 text-xl font-semibold text-energy-ink">{metric.values.filter(Boolean).join(" | ") || "n/a"}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {section.suppliers.length ? (
        <div className="mt-6 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-energy-border text-left text-[11px] uppercase tracking-[0.14em] text-energy-slate">
                <th className="pb-3 pr-4">Supplier</th>
                {compactColumns.map((column) => (
                  <th key={`${section.id}-${column.key}`} className="pb-3 pr-4">{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.suppliers.map((supplier) => {
                const supplierCells = supplier.cells.some(Boolean) ? supplier.cells : opisRawParseSupplierCells(supplier.raw, section.supplierColumns);
                return (
                <tr key={`${section.id}-${supplier.raw}`} className="border-b border-slate-100 align-top">
                  <td className="py-3 pr-4 font-semibold text-energy-ink">{supplier.supplier || "-"}</td>
                  {compactColumns.map((column) => (
                    <td
                      key={`${section.id}-${supplier.raw}-${column.key}`}
                      className={`py-3 pr-4 ${/^Date \/ Time$/i.test(column.label) ? "text-energy-slate" : /^Terms$/i.test(column.label) ? "text-energy-slate" : "font-mono text-xs text-energy-ink"}`}
                    >
                      {opisRawFormatCellValue(supplierCells, column.indices)}
                    </td>
                  ))}
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      ) : null}

      {section.notes.length ? (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {section.notes.map((note) => <p key={`${section.id}-${note}`}>{note}</p>)}
        </div>
      ) : null}
    </section>
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
  const [activeView, setActiveView] = useState<"prices" | "trends" | "opis" | "opisRaw">("prices");
  const [opisStatus, setOpisStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [opisData, setOpisData] = useState<OpisMarketSnapshot | null>(null);
  const [opisTiming, setOpisTiming] = useState("0");
  const [opisState, setOpisState] = useState("ALL");
  const [opisCity, setOpisCity] = useState("ALL");
  const [opisFuelType, setOpisFuelType] = useState<OpisFuelFilter>("all");
  const [opisProduct, setOpisProduct] = useState("ALL");
  const [opisErrorMessage, setOpisErrorMessage] = useState("");
  const [opisRawInput, setOpisRawInput] = useState(opisRawReportSample);
  const [opisRawLivePayload, setOpisRawLivePayload] = useState<OpisRawApiResponse | null>(null);
  const [opisRawMarket, setOpisRawMarket] = useState("ALL");
  const [opisRawType, setOpisRawType] = useState("ALL");
  const [opisRawStatus, setOpisRawStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [opisRawErrorMessage, setOpisRawErrorMessage] = useState("");
  const [opisRawFetchedAt, setOpisRawFetchedAt] = useState("");
  const [opisRawDateView, setOpisRawDateView] = useState<"current" | "today" | "yesterday" | "all">("current");
  const [pricingFormulaInputs, setPricingFormulaInputs] = useState<Record<string, { inputValue: string; multiplier: string }>>({});
  const [selectedPricingRowKey, setSelectedPricingRowKey] = useState<string | null>(null);
  const [currentJobber, setCurrentJobber] = useState<{ id: string; name: string; slug?: string } | null>(null);
  const [jobberPricingConfigs, setJobberPricingConfigs] = useState<Record<string, SitePricingConfig>>({});
  const [pricingSaveStatus, setPricingSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

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

  async function loadOpis(nextFilters = { timing: opisTiming, state: opisState, fuelType: opisFuelType }) {
    setOpisStatus("loading");
    try {
      const snapshot = await getOpisMarketData(nextFilters);
      setOpisData(snapshot);
      setOpisStatus("ready");
      setOpisErrorMessage("");
    } catch (error) {
      setOpisStatus("error");
      const message = error instanceof Error ? error.message : String(error || "");
      setOpisErrorMessage(message);
    }
  }

  async function loadOpisRawLive() {
    setOpisRawStatus("loading");
    try {
      const fetchedAtIso = new Date().toISOString();
      const payload = await api.getOpisRawSnapshot({
        timing: opisTiming,
        state: opisState,
        fuelType: opisFuelType
      });
      const liveRows = opisRawLiveRowsFromPayload(payload);
      const liveSummaryRows = opisRawSummaryRowsFromPayload(payload);
      const generatedText = generatedOpisReportToText(
        buildGeneratedOpisReport(liveRows, liveSummaryRows, formatOpisDateTime(fetchedAtIso))
      );
      setOpisRawLivePayload(payload);
      setOpisRawFetchedAt(fetchedAtIso);
      setOpisRawInput(generatedText);
      setOpisRawMarket("ALL");
      setOpisRawType("ALL");
      setOpisRawStatus("ready");
      setOpisRawErrorMessage("");
    } catch (error) {
      setOpisRawStatus("error");
      const message = error instanceof Error ? error.message : String(error || "");
      setOpisRawErrorMessage(message);
    }
  }

  useEffect(() => {
    if (activeView !== "opis") return;
    loadOpis();
  }, [activeView]);

  useEffect(() => {
    let cancelled = false;
    async function loadJobberPricingConfigs() {
      try {
        const [jobber, configs] = await Promise.all([
          api.getCurrentJobber(),
          api.getJobberPricingConfigs()
        ]);
        if (cancelled) return;
        setCurrentJobber(jobber);
        const nextConfigs = Object.fromEntries(configs.map((item) => [item.pricingKey, item]));
        setJobberPricingConfigs(nextConfigs);
      } catch (_error) {
        if (!cancelled) {
          setCurrentJobber(null);
          setJobberPricingConfigs({});
        }
      }
    }
    setPricingFormulaInputs({});
    setPricingSaveStatus("idle");
    loadJobberPricingConfigs();
    return () => {
      cancelled = true;
    };
  }, []);

  const opisCityOptions = useMemo(() => {
    if (!opisData) return [];
    const stateScopedRows = opisData.rows.filter((row) => opisState === "ALL" || row.stateAbbr === opisState);
    return [
      { value: "ALL", label: "All Cities" },
      ...[...new Map(stateScopedRows.map((row) => [`${row.cityName}, ${row.stateAbbr}`, { value: `${row.cityName}, ${row.stateAbbr}`, label: `${row.cityName}, ${row.stateAbbr}` }])).values()]
        .sort((a, b) => a.label.localeCompare(b.label))
    ];
  }, [opisData, opisState]);

  useEffect(() => {
    setOpisCity("ALL");
  }, [opisState]);

  const filteredOpisRows = useMemo(() => {
    if (!opisData) return [];
    return filterOpisRowsByProduct(
      filterOpisRowsByFuelType(filterOpisRows(opisData.rows, opisState, opisCity), opisFuelType),
      opisProduct
    );
  }, [opisData, opisState, opisCity, opisFuelType, opisProduct]);

  const opisProductOptions = useMemo(() => {
    if (!opisData) return [];
    const scopedRows = filterOpisRows(opisData.rows, opisState, opisCity);
    return [
      { value: "ALL", label: "All Products" },
      ...[...new Set(scopedRows.map((row) => row.productName))]
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value }))
    ];
  }, [opisData, opisState, opisCity]);

  useEffect(() => {
    setOpisProduct("ALL");
  }, [opisState, opisCity, opisFuelType]);

  const opisComparisonSnapshot = useMemo(
    () => opisData?.timingSnapshots.find((snapshot) => snapshot.timing !== opisData.appliedFilters.timing) || null,
    [opisData]
  );

  const opisTableRows = useMemo(() => {
    if (!opisData) return [];
    const comparisonRows = opisComparisonSnapshot
      ? filterOpisRows(opisComparisonSnapshot.rows, opisState, opisCity)
      : [];
    const filteredComparisonRows = filterOpisRowsByProduct(
      filterOpisRowsByFuelType(comparisonRows, opisFuelType),
      opisProduct
    );
    const comparisonByProduct = new Map<string, OpisSummaryRow[]>();
    filteredComparisonRows.forEach((row) => {
      const key = `${row.cityName}, ${row.stateAbbr}__${row.productName}`;
      if (!comparisonByProduct.has(key)) comparisonByProduct.set(key, []);
      comparisonByProduct.get(key)?.push(row);
    });

    const grouped = new Map<string, OpisSummaryRow[]>();
    filteredOpisRows.forEach((row) => {
      const key = `${row.cityName}, ${row.stateAbbr}__${row.productName}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)?.push(row);
    });

    return [...grouped.entries()]
      .map(([groupKey, rows]) => {
        const prices = rows.map((row) => row.price);
        const averagePrice = averageOpisRows(rows);
        const comparisonAverage = averageOpisRows(comparisonByProduct.get(groupKey) || []);
        const sample = rows[0];
        const productName = sample.productName;
        const formulaId = resolveFormulaId(productName);
        const pricingKey = `${sample.cityName}, ${sample.stateAbbr}__${formulaId || sample.fuelType}`;
        const rowKey = `${sample.cityName}, ${sample.stateAbbr}__${productName}`;
        return {
          key: rowKey,
          pricingKey,
          productName,
          fuelType: sample.fuelType,
          marketLabel: `${sample.cityName}, ${sample.stateAbbr}`,
          formulaId,
          formulaLabel: formulaId ? (PRICING_FORMULA_TEMPLATE_BY_ID.get(formulaId)?.label || "Custom") : "Custom",
          low: Math.min(...prices),
          high: Math.max(...prices),
          average: averagePrice,
          change: averagePrice != null && comparisonAverage != null ? averagePrice - comparisonAverage : null,
          estimatedPrice: null
        };
      })
      .sort((a, b) => a.marketLabel.localeCompare(b.marketLabel) || a.productName.localeCompare(b.productName));
  }, [opisData, opisComparisonSnapshot, filteredOpisRows, opisState, opisCity, opisFuelType, opisProduct]);

  const pricingCards = useMemo(() => {
    return opisTableRows.flatMap((row) => {
      if (!row.formulaId || row.average == null) return [];
      const template = PRICING_FORMULA_TEMPLATE_BY_ID.get(row.formulaId);
      if (!template) return [];
      const marketRackAverage = row.average / 100;
      const savedConfig = jobberPricingConfigs[row.pricingKey]?.config || {};
      const components = template.components.map((component) => {
        const stateKey = `${row.key}:${component.key}`;
        const override = pricingFormulaInputs[stateKey] || savedConfig[component.key] || {};
        const rawInput = component.marketDriven ? marketRackAverage : (override?.inputValue ?? component.inputValue ?? "");
        const inputValue = rawInput === "" || rawInput == null ? null : Number(rawInput);
        const multiplier = Number(override?.multiplier ?? component.multiplier);
        return {
          ...component,
          inputValue: Number.isFinite(inputValue) ? inputValue : null,
          multiplier: Number.isFinite(multiplier) ? multiplier : component.multiplier,
          stateKey
        };
      });

      return [{
        ...row,
        totalLabel: template.totalLabel,
        components,
        marketRackAverage,
        estimatedPrice: computeFormulaTotal(components)
      }];
    });
  }, [opisTableRows, pricingFormulaInputs, jobberPricingConfigs]);

  const pricingCardByRowKey = useMemo(
    () => new Map(pricingCards.map((card) => [card.key, card])),
    [pricingCards]
  );

  const opisDisplayRows = useMemo(
    () => opisTableRows.map((row) => ({
      ...row,
      estimatedPrice: pricingCardByRowKey.get(row.key)?.estimatedPrice ?? row.estimatedPrice
    })),
    [opisTableRows, pricingCardByRowKey]
  );
  const opisRawLiveRows = useMemo(() => opisRawLiveRowsFromPayload(opisRawLivePayload), [opisRawLivePayload]);
  const opisRawSummaryRows = useMemo(() => opisRawSummaryRowsFromPayload(opisRawLivePayload), [opisRawLivePayload]);
  const opisRawLiveNewestTimestamp = useMemo(() => {
    const timestamps = opisRawLiveRows
      .map((row) => opisRawRowNewestTimestamp(row))
      .filter((value): value is number => typeof value === "number");
    if (!timestamps.length) return null;
    return Math.max(...timestamps);
  }, [opisRawLiveRows]);
  const opisRawLiveMarkets = useMemo(
    () => [...new Set(opisRawLiveRows.map((row) => opisRawLiveMarketLabel(row)).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [opisRawLiveRows]
  );
  const opisRawLiveTypes = useMemo(
    () => [...new Set(opisRawLiveRows.map((row) => opisRawLiveProductLabel(row)).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [opisRawLiveRows]
  );
  const opisRawLiveFilteredRows = useMemo(
    () => opisRawLiveRows.filter((row) => (
      (opisRawMarket === "ALL" || opisRawLiveMarketLabel(row) === opisRawMarket) &&
      (opisRawType === "ALL" || opisRawLiveProductLabel(row) === opisRawType) &&
      opisRawMatchesDateView(row, opisRawDateView)
    )),
    [opisRawDateView, opisRawLiveRows, opisRawMarket, opisRawType]
  );
  const opisRawCurrentPricingRows = useMemo(() => {
    if (opisRawDateView === "current") {
      const rows = opisRawLiveFilteredRows.filter((row) => opisRawCurrentPricingRow(row));
      return rows.length ? rows : opisRawLiveFilteredRows;
    }
    return opisRawLiveFilteredRows;
  }, [opisRawDateView, opisRawLiveFilteredRows]);
  const opisRawLiveProductCount = useMemo(
    () => new Set(opisRawLiveRows.map((row) => String(opisRawReadField(row, "ProductID", "productId", "ProductName", "productName") || ""))).size,
    [opisRawLiveRows]
  );
  const opisRawLiveStatusCode = Number(opisRawLivePayload?.statusCode ?? opisRawLivePayload?.StatusCode ?? 0);
  const opisRawLiveRequestId = String(opisRawLivePayload?.requestId ?? opisRawLivePayload?.RequestId ?? "");
  const opisRawFetchedAtTimestamp = useMemo(() => {
    if (!opisRawFetchedAt) return null;
    const parsed = new Date(opisRawFetchedAt).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }, [opisRawFetchedAt]);
  const opisRawLiveFreshness = useMemo(
    () => opisRawFreshnessLabel(opisRawLiveNewestTimestamp, opisRawFetchedAtTimestamp),
    [opisRawFetchedAtTimestamp, opisRawLiveNewestTimestamp]
  );
  const opisRawSampleReport = useMemo(() => parseOpisRawReport(opisRawReportSample), []);
  const opisRawSampleLineCount = useMemo(() => opisRawReportSample.replace(/\r\n/g, "\n").split("\n").length, []);
  const opisRawLiveLineCount = useMemo(() => opisRawInput.replace(/\r\n/g, "\n").split("\n").length, [opisRawInput]);
  const opisRawGeneratedLines = useMemo(
    () => buildGeneratedOpisReport(opisRawCurrentPricingRows, opisRawSummaryRows, formatOpisDateTime(opisRawFetchedAt || new Date().toISOString())),
    [opisRawCurrentPricingRows, opisRawFetchedAt, opisRawSummaryRows]
  );
  const opisRawReport = useMemo(() => parseOpisRawReport(opisRawInput), [opisRawInput]);
  const opisRawSampleTypes = useMemo(
    () => [...new Set(opisRawSampleReport.sections.map((section) => opisRawSectionTypeLabel(section)).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [opisRawSampleReport]
  );
  const opisRawSections = useMemo(
    () => opisRawReport.sections.filter((section) => (
      (opisRawMarket === "ALL" || section.market === opisRawMarket) &&
      (opisRawType === "ALL" || opisRawSectionTypeLabel(section) === opisRawType)
    )),
    [opisRawMarket, opisRawReport, opisRawType]
  );
  const opisRawBenchmarkCount = opisRawSections.filter((section) => section.sectionType === "benchmark").length;
  const opisRawRetailCount = opisRawSections.filter((section) => section.sectionType === "retail").length;
  const opisRawSupplierCount = opisRawSections.reduce((sum, section) => sum + section.suppliers.length, 0);
  const opisRawDisplayedText = useMemo(() => {
    if (opisRawLivePayload) {
      return generatedOpisReportToText(opisRawGeneratedLines);
    }
    if (opisRawMarket === "ALL") {
      return opisRawInput;
    }
    return opisSectionsToText(opisRawSections, opisRawReport.disclaimers);
  }, [opisRawGeneratedLines, opisRawInput, opisRawLivePayload, opisRawMarket, opisRawReport.disclaimers, opisRawSections]);
  const opisRawSampleDisplayedText = useMemo(() => {
    if (opisRawMarket === "ALL" && opisRawType === "ALL") {
      return opisRawReportSample;
    }
    const filteredSampleSections = opisRawSampleReport.sections.filter((section) => (
      (opisRawMarket === "ALL" || section.market === opisRawMarket) &&
      (opisRawType === "ALL" || opisRawSectionTypeLabel(section) === opisRawType)
    ));
    return opisSectionsToText(filteredSampleSections, opisRawSampleReport.disclaimers);
  }, [opisRawMarket, opisRawSampleReport, opisRawType]);

  const opisRawTypeOptions = useMemo(() => {
    const values = opisRawLivePayload ? opisRawLiveTypes : opisRawSampleTypes;
    return ["ALL", ...values];
  }, [opisRawLivePayload, opisRawLiveTypes, opisRawSampleTypes]);

  useEffect(() => {
    if (!pricingCards.length) {
      setSelectedPricingRowKey(null);
      return;
    }
    if (!selectedPricingRowKey || !pricingCardByRowKey.has(selectedPricingRowKey)) {
      setSelectedPricingRowKey(pricingCards[0].key);
    }
  }, [pricingCards, pricingCardByRowKey, selectedPricingRowKey]);

  const selectedPricingCard = selectedPricingRowKey ? pricingCardByRowKey.get(selectedPricingRowKey) ?? null : null;
  const selectedSavedConfig = selectedPricingCard ? jobberPricingConfigs[selectedPricingCard.pricingKey]?.config || {} : {};
  const selectedPricingDirty = !!selectedPricingCard && selectedPricingCard.components.some((component) => {
    const saved = selectedSavedConfig[component.key] || {};
    const defaultInput = component.inputValue == null ? "" : String(component.inputValue);
    const defaultMultiplier = String(component.multiplier);
    const current = pricingFormulaInputs[component.stateKey];
    if (!current) return false;
    const baselineInput = saved.inputValue ?? (component.marketDriven ? defaultInput : (component.inputValue == null ? "" : String(PRICING_FORMULA_TEMPLATE_BY_ID.get(selectedPricingCard.formulaId)?.components.find((item) => item.key === component.key)?.inputValue ?? "")));
    const baselineMultiplier = saved.multiplier ?? defaultMultiplier;
    return current.inputValue !== baselineInput || current.multiplier !== baselineMultiplier;
  });

  async function saveSelectedPricingCard() {
    if (!selectedPricingCard) return;
    setPricingSaveStatus("saving");
    try {
      const config = Object.fromEntries(selectedPricingCard.components.map((component) => {
        const current = pricingFormulaInputs[component.stateKey];
        return [
          component.key,
          {
            inputValue: component.marketDriven ? (component.inputValue == null ? "" : String(component.inputValue)) : (current?.inputValue ?? (component.inputValue == null ? "" : String(component.inputValue))),
            multiplier: current?.multiplier ?? String(component.multiplier)
          }
        ];
      }));
      const saved = await api.saveJobberPricingConfig({
        pricingKey: selectedPricingCard.pricingKey,
        formulaId: selectedPricingCard.formulaId,
        fuelType: selectedPricingCard.fuelType,
        productName: selectedPricingCard.productName,
        marketLabel: selectedPricingCard.marketLabel,
        config
      });
      setJobberPricingConfigs((current) => ({
        ...current,
        [saved.pricingKey]: saved
      }));
      setPricingFormulaInputs((current) => {
        const next = { ...current };
        selectedPricingCard.components.forEach((component) => {
          delete next[component.stateKey];
        });
        return next;
      });
      setPricingSaveStatus("saved");
    } catch (_error) {
      setPricingSaveStatus("error");
    }
  }

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
  const pricingWarnings = data.warnings || [];

  return (
    <div className="pricing-shell min-h-full rounded-[32px] border border-energy-border p-4 md:p-6">
      <div className="space-y-6">
        <WarningState messages={pricingWarnings} />
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
                  onChange={(event) => setActiveView(event.target.value as "prices" | "trends" | "opis" | "opisRaw")}
                  className="w-full rounded-2xl border border-energy-border bg-white px-4 py-3 text-sm font-semibold text-energy-ink outline-none transition focus:border-energy-blue"
                >
                  <option value="prices">Prices</option>
                  <option value="trends">Trends</option>
                  <option value="opis">OPIS</option>
                  <option value="opisRaw">OPIS Raw</option>
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
              {data.benchmarkCards.map((card) => (
                <div key={card.key} className={`rounded-[28px] border p-[1px] ${fuelCardTone(card.label)}`}>
                  <KpiCard card={card} />
                </div>
              ))}
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
        ) : activeView === "trends" ? (
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
        ) : activeView === "opis" ? (
          <section className="space-y-6">
            <section className="rounded-3xl border border-energy-border bg-white p-6 shadow-energy">
              <div className="rounded-3xl border border-energy-border bg-slate-50 p-5">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-energy-slate">OPIS Market Monitor</div>
                    <h3 className="mt-2 text-2xl font-semibold text-energy-ink">Build a city market view</h3>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-energy-slate">
                      Choose the state, fuel type, city, and product grade, then refresh the rack feed to rebuild the wholesale product table below.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => loadOpis({ timing: opisTiming, state: opisState, fuelType: opisFuelType })}
                    className="rounded-full border border-energy-border bg-white px-5 py-3 text-sm font-semibold text-energy-ink transition hover:border-energy-blue hover:text-energy-blue disabled:cursor-wait disabled:opacity-70"
                    disabled={opisStatus === "loading"}
                  >
                    {opisStatus === "loading" ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
                <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <label className="block">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-energy-slate">State</div>
                    <select
                      value={opisState}
                      onChange={(event) => setOpisState(event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-energy-border bg-white px-4 py-3 text-sm font-semibold text-energy-ink outline-none transition focus:border-energy-blue"
                    >
                      {(opisData?.filterOptions.states || []).map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-energy-slate">Fuel Type</div>
                    <select
                      value={opisFuelType}
                      onChange={(event) => setOpisFuelType(event.target.value as OpisFuelFilter)}
                      className="mt-2 w-full rounded-2xl border border-energy-border bg-white px-4 py-3 text-sm font-semibold text-energy-ink outline-none transition focus:border-energy-blue"
                    >
                      {(opisData?.filterOptions.fuelTypes || []).map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-energy-slate">City</div>
                    <select
                      value={opisCity}
                      onChange={(event) => setOpisCity(event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-energy-border bg-white px-4 py-3 text-sm font-semibold text-energy-ink outline-none transition focus:border-energy-blue"
                    >
                      {opisCityOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-energy-slate">Product</div>
                    <select
                      value={opisProduct}
                      onChange={(event) => setOpisProduct(event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-energy-border bg-white px-4 py-3 text-sm font-semibold text-energy-ink outline-none transition focus:border-energy-blue"
                    >
                      {opisProductOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              <div className="mt-4 text-sm text-energy-slate">
                Source: <span className="font-medium text-energy-ink">OPIS Rack API</span>
                {opisData ? <span> | Last refreshed {formatOpisDateTime(opisData.lastUpdated)}</span> : null}
              </div>
            </section>

            {opisStatus === "loading" && !opisData ? (
              <section className="rounded-3xl border border-energy-border bg-white p-10 text-center text-energy-slate shadow-energy">
                Loading OPIS rack market data...
              </section>
            ) : null}

            {opisStatus === "error" ? (
              <section className="rounded-3xl border border-rose-200 bg-white p-10 text-center shadow-energy">
                <div className="text-lg font-semibold text-energy-ink">OPIS data is unavailable.</div>
                <p className="mt-2 text-sm text-energy-slate">
                  {opisErrorMessage.includes("Unsupported state or unable to authenticate data")
                    ? "The current jobber's OPIS credentials could not be authenticated. Re-save OPIS credentials in Admin for the active jobber, then refresh."
                    : opisErrorMessage.includes("Secret encryption key is missing")
                      ? "The API is missing PETROLEUM_SECRET_KEY / APP_ENCRYPTION_KEY, so saved OPIS credentials cannot be decrypted."
                      : "Save OPIS credentials for the current jobber in Admin, or start the API with OPIS credentials, then try again."}
                </p>
              </section>
            ) : null}

            {opisData ? (
              <>
                <section className="rounded-3xl border border-energy-border bg-white p-6 shadow-energy">
                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-energy-slate">Market Fuel And Prices</div>
                    <h3 className="mt-2 text-xl font-semibold text-energy-ink">
                      {opisCity === "ALL" ? (opisState === "ALL" ? "All returned markets" : `All cities in ${opisState}`) : opisCity}
                    </h3>
                    <p className="mt-2 text-sm text-energy-slate">
                      Products are grouped into a market table with low, high, average, and change versus{" "}
                      <span className="font-medium text-energy-ink">
                        {opisComparisonSnapshot?.label || "the comparison timing"}
                      </span>.
                    </p>
                  </div>
                  <div className="text-sm text-energy-slate">
                    Current timing: <span className="font-medium text-energy-ink">{(opisData.filterOptions.timing || []).find((option) => option.value === opisData.appliedFilters.timing)?.label || opisData.appliedFilters.timing}</span>
                  </div>
                </div>
                {opisDisplayRows.length ? (
                  <div className="mt-6 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-energy-border text-left text-[11px] uppercase tracking-[0.14em] text-energy-slate">
                          <th className="pb-3 pr-4">Market Fuel</th>
                          <th className="pb-3 pr-4">Market</th>
                          <th className="pb-3 pr-4">Formula</th>
                          <th className="pb-3 pr-4">Low</th>
                          <th className="pb-3 pr-4">High</th>
                          <th className="pb-3 pr-4">Avg</th>
                          <th className="pb-3 pr-4">Rack Avg</th>
                          <th className="pb-3 pr-4">Rack USD/gal</th>
                          <th className="pb-3 pr-4">Change</th>
                          <th className="pb-3">Est. Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {opisDisplayRows.map((row) => (
                          <tr key={`${row.marketLabel}-${row.productName}`} className="border-b border-slate-100 align-top">
                            <td className="py-4 pr-4">
                              <div className="font-semibold text-energy-ink">{row.productName}</div>
                              <div className="text-energy-slate">{row.fuelType}</div>
                            </td>
                            <td className="py-4 pr-4 text-energy-slate">{row.marketLabel}</td>
                            <td className="py-4 pr-4 text-energy-slate">{row.formulaLabel}</td>
                            <td className="py-4 pr-4 font-medium text-energy-ink">{formatOpisPrice(row.low)}</td>
                            <td className="py-4 pr-4 font-medium text-energy-ink">{formatOpisPrice(row.high)}</td>
                            <td className="py-4 pr-4 font-semibold text-energy-ink">{formatOpisPrice(row.average)}</td>
                            <td className="py-4 pr-4 font-semibold text-energy-ink">{formatCurrencyPerGallon(row.average != null ? row.average / 100 : null)}</td>
                            <td className="py-4 pr-4 font-semibold text-energy-ink">{formatCurrencyPerGallon(row.average != null ? row.average / 100 : null)}</td>
                            <td className={`py-4 pr-4 font-semibold ${row.change == null ? "text-energy-slate" : row.change >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                              {formatOpisChange(row.change)}
                            </td>
                            <td className="py-4 font-semibold text-energy-ink">
                              <button
                                type="button"
                                onClick={() => setSelectedPricingRowKey(row.key)}
                                className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                                  selectedPricingRowKey === row.key
                                    ? "bg-indigo-100 text-indigo-700"
                                    : "border border-energy-border bg-white text-energy-ink hover:border-energy-blue hover:text-energy-blue"
                                }`}
                              >
                                {formatCurrencyPerGallon(row.estimatedPrice)}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="mt-6 rounded-2xl border border-dashed border-energy-border bg-slate-50 p-8 text-center text-sm text-energy-slate">
                    No OPIS market rows matched the current state and city selection.
                  </div>
                )}
                </section>

                <section className="rounded-3xl border border-energy-border bg-white p-5 shadow-energy">
                {selectedPricingCard ? (
                  <div className="min-w-0">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                      <div className="space-y-2">
                        <div className="text-base font-semibold text-energy-ink">{selectedPricingCard.productName}</div>
                        <div className="text-sm text-energy-slate">{selectedPricingCard.marketLabel}</div>
                        <div className="text-sm text-energy-slate">
                          Rack conversion: <span className="font-medium text-energy-ink">{`${(selectedPricingCard.marketRackAverage * 100).toFixed(2)} USCPG / 100 = ${formatCurrencyPerGallon(selectedPricingCard.marketRackAverage)}`}</span>
                        </div>
                        <div className="text-sm text-energy-slate">
                          Saving for: <span className="font-medium text-energy-ink">{currentJobber?.name || "Current jobber"}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-energy-slate">{selectedPricingCard.totalLabel}</div>
                        <div className="mt-2 text-2xl font-semibold text-energy-ink">{formatCurrencyPerGallon(selectedPricingCard.estimatedPrice)}</div>
                        <div className={`mt-2 text-sm ${pricingSaveStatus === "error" ? "text-rose-600" : "text-energy-slate"}`}>
                          {pricingSaveStatus === "saved" ? "Saved for current jobber." : pricingSaveStatus === "error" ? "Save failed." : selectedPricingDirty ? "Unsaved changes." : "Saved values loaded."}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-energy-border text-left text-[11px] uppercase tracking-[0.14em] text-energy-slate">
                            <th className="pb-3 pr-4">Component</th>
                            <th className="pb-3 pr-4">Input</th>
                            <th className="pb-3 pr-4">Multiplier</th>
                            <th className="pb-3 pr-4">Value</th>
                            <th className="pb-3">Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedPricingCard.components.map((component) => {
                            const componentKey = component.stateKey;
                            const primaryComponent = component.fallbackTo
                              ? selectedPricingCard.components.find((item) => item.key === component.fallbackTo)
                              : null;
                            const contribution = component.fallbackTo && primaryComponent?.inputValue != null
                              ? null
                              : (component.inputValue ?? 0) * component.multiplier;
                            const savedComponentConfig = selectedSavedConfig[component.key] || {};
                            const inputFieldValue = pricingFormulaInputs[componentKey]?.inputValue
                              ?? savedComponentConfig.inputValue
                              ?? (component.inputValue == null ? "" : String(component.inputValue));
                            const multiplierFieldValue = pricingFormulaInputs[componentKey]?.multiplier
                              ?? savedComponentConfig.multiplier
                              ?? String(component.multiplier);
                            return (
                              <tr key={componentKey} className="border-b border-slate-100 align-top">
                                <td className="py-3 pr-4">
                                  <div className="font-medium text-energy-ink">{component.label}</div>
                                </td>
                                <td className="py-3 pr-4">
                                  {component.marketDriven ? (
                                    <div className="w-28 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-energy-ink">
                                      {formatCurrencyPerGallon(component.inputValue)}
                                    </div>
                                  ) : (
                                    <input
                                      type="number"
                                      step="0.0001"
                                      value={inputFieldValue}
                                      onChange={(event) => {
                                        const nextValue = event.target.value;
                                        setPricingSaveStatus("idle");
                                        setPricingFormulaInputs((current) => ({
                                          ...current,
                                          [componentKey]: {
                                            inputValue: nextValue,
                                            multiplier: current[componentKey]?.multiplier ?? String(component.multiplier)
                                          }
                                        }));
                                      }}
                                      className="w-28 rounded-xl border border-energy-border bg-white px-3 py-2 text-sm font-semibold text-energy-ink outline-none transition focus:border-energy-blue"
                                    />
                                  )}
                                </td>
                                <td className="py-3 pr-4">
                                  <input
                                    type="number"
                                    step="0.0001"
                                    value={multiplierFieldValue}
                                    onChange={(event) => {
                                      const nextValue = event.target.value;
                                      setPricingSaveStatus("idle");
                                      setPricingFormulaInputs((current) => ({
                                        ...current,
                                        [componentKey]: {
                                          inputValue: current[componentKey]?.inputValue ?? (component.inputValue == null ? "" : String(component.inputValue)),
                                          multiplier: nextValue
                                        }
                                      }));
                                    }}
                                    className="w-24 rounded-xl border border-energy-border bg-white px-3 py-2 text-sm font-semibold text-energy-ink outline-none transition focus:border-energy-blue"
                                  />
                                </td>
                                <td className="py-3 pr-4 font-semibold text-energy-ink">
                                  {contribution == null ? "Using Term C" : formatCurrencyPerGallon(contribution)}
                                </td>
                                <td className="py-3 text-energy-slate">{component.notes}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-6 flex justify-end">
                      <button
                        type="button"
                        onClick={saveSelectedPricingCard}
                        disabled={pricingSaveStatus === "saving"}
                        className="rounded-2xl border border-slate-900 bg-gradient-to-b from-white via-slate-100 to-slate-300 px-6 py-3 text-sm font-semibold text-slate-950 shadow-[0_6px_0_rgba(15,23,42,0.35)] transition active:translate-y-[2px] active:shadow-[0_3px_0_rgba(15,23,42,0.35)] disabled:cursor-wait disabled:opacity-70"
                      >
                        {pricingSaveStatus === "saving" ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-energy-border bg-slate-50 p-8 text-center text-sm text-energy-slate">
                    Click an estimated price in the market table to open its editable pricing breakdown.
                  </div>
                )}
                </section>
              </>
            ) : null}
          </section>
        ) : (
          <section className="space-y-6">
            <section className="rounded-3xl border border-energy-border bg-white p-6 shadow-energy">
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-energy-slate">OPIS Raw Report</div>
                  <h3 className="mt-2 text-2xl font-semibold text-energy-ink">Readable contract benchmark view</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-energy-slate">
                    {opisRawLivePayload
                      ? "Live OPIS supplier prices are loaded below. The text area renders those rows into an OPIS-style benchmark report so the live side reads like the bundled sample."
                      : "Paste the raw OPIS benchmark report into the text box and this view will split it into market sections, summary metrics, and supplier quote rows."}
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-energy-border bg-slate-50 p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-energy-slate">Markets</div>
                      <div className="mt-2 text-2xl font-semibold text-energy-ink">{opisRawLivePayload ? opisRawLiveMarkets.length : opisRawReport.markets.length}</div>
                    </div>
                    <div className="rounded-2xl border border-energy-border bg-slate-50 p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-energy-slate">{opisRawLivePayload ? "Returned Rows" : "Benchmark Sections"}</div>
                      <div className="mt-2 text-2xl font-semibold text-energy-ink">{opisRawLivePayload ? opisRawLiveRows.length : opisRawBenchmarkCount}</div>
                    </div>
                    <div className="rounded-2xl border border-energy-border bg-slate-50 p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-energy-slate">{opisRawLivePayload ? "Products" : "Supplier Rows"}</div>
                      <div className="mt-2 text-2xl font-semibold text-energy-ink">{opisRawLivePayload ? opisRawLiveProductCount : opisRawSupplierCount}</div>
                    </div>
                  </div>
                </div>
                <div className="rounded-3xl border border-energy-border bg-slate-50 p-5">
                  <label className="block">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-energy-slate">Market Filter</div>
                    <select
                      value={opisRawMarket}
                      onChange={(event) => setOpisRawMarket(event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-energy-border bg-white px-4 py-3 text-sm font-semibold text-energy-ink outline-none transition focus:border-energy-blue"
                    >
                      <option value="ALL">All Markets</option>
                      {(opisRawLivePayload ? opisRawLiveMarkets : opisRawReport.markets).map((market) => (
                        <option key={market} value={market}>{market}</option>
                      ))}
                    </select>
                  </label>
                  <label className="mt-4 block">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-energy-slate">Type Filter</div>
                    <select
                      value={opisRawType}
                      onChange={(event) => setOpisRawType(event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-energy-border bg-white px-4 py-3 text-sm font-semibold text-energy-ink outline-none transition focus:border-energy-blue"
                    >
                      {opisRawTypeOptions.map((type) => (
                        <option key={type} value={type}>
                          {type === "ALL" ? "All Types" : type}
                        </option>
                      ))}
                    </select>
                  </label>
                  {opisRawLivePayload ? (
                    <label className="mt-4 block">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-energy-slate">Date View</div>
                      <select
                        value={opisRawDateView}
                        onChange={(event) => setOpisRawDateView(event.target.value as "current" | "today" | "yesterday" | "all")}
                        className="mt-2 w-full rounded-2xl border border-energy-border bg-white px-4 py-3 text-sm font-semibold text-energy-ink outline-none transition focus:border-energy-blue"
                      >
                        <option value="current">Current Pricing Rows</option>
                        <option value="today">Today Rows</option>
                        <option value="yesterday">Yesterday Rows</option>
                        <option value="all">All Row Dates</option>
                      </select>
                    </label>
                  ) : null}
                  <div className="mt-4 text-sm text-energy-slate">
                    {opisRawLivePayload
                      ? `Live request status: ${opisRawLiveStatusCode || "n/a"}${opisRawLiveRequestId ? ` | Request ID: ${opisRawLiveRequestId}` : ""}`
                      : opisRawReport.generatedAt ? `Latest report timestamp found: ${opisRawReport.generatedAt}` : "No report timestamp detected yet."}
                  </div>
                  {opisRawLivePayload ? (
                    <div className="mt-4 rounded-2xl border border-energy-border bg-slate-50 px-4 py-3 text-sm text-energy-slate">
                      <div>
                        Live fetch time: <span className="font-medium text-energy-ink">{opisRawFetchedAt ? formatOpisDateTime(opisRawFetchedAt) : "n/a"}</span>
                      </div>
                      <div className="mt-1">
                        Freshest source row date: <span className="font-medium text-energy-ink">{opisRawLiveNewestTimestamp ? formatOpisDateTime(new Date(opisRawLiveNewestTimestamp).toISOString()) : "n/a"}</span>
                      </div>
                      <div className="mt-1">
                        Freshness status:{" "}
                        <span
                          className={
                            opisRawLiveFreshness.status === "fresh"
                              ? "font-medium text-emerald-700"
                              : opisRawLiveFreshness.status === "aging"
                                ? "font-medium text-amber-700"
                                : opisRawLiveFreshness.status === "stale"
                                  ? "font-medium text-rose-700"
                                  : "font-medium text-energy-ink"
                          }
                        >
                          {opisRawLiveFreshness.label}
                        </span>
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-4 text-sm text-energy-slate">
                    {opisRawLivePayload ? (
                      <>Current live filters: <span className="font-medium text-energy-ink">{opisTiming}</span> timing, <span className="font-medium text-energy-ink">{opisState}</span> state, <span className="font-medium text-energy-ink">{opisFuelType}</span> fuel, <span className="font-medium text-energy-ink">{opisRawDateView}</span> date view.</>
                    ) : (
                      <>Retail sections found: <span className="font-medium text-energy-ink">{opisRawRetailCount}</span></>
                    )}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setOpisRawInput(opisRawReportSample);
                        setOpisRawLivePayload(null);
                        setOpisRawFetchedAt("");
                        setOpisRawMarket("ALL");
                        setOpisRawType("ALL");
                        setOpisRawDateView("current");
                        setOpisRawStatus("idle");
                        setOpisRawErrorMessage("");
                      }}
                      className="rounded-full border border-energy-border bg-white px-4 py-2 text-sm font-semibold text-energy-ink transition hover:border-energy-blue hover:text-energy-blue"
                    >
                      Reset to sample report
                    </button>
                    <button
                      type="button"
                      onClick={loadOpisRawLive}
                      disabled={opisRawStatus === "loading"}
                      className="rounded-full border border-energy-blue bg-energy-blue px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-700 disabled:cursor-wait disabled:opacity-70"
                    >
                      {opisRawStatus === "loading" ? "Loading live data..." : "Live data"}
                    </button>
                  </div>
                  {opisRawStatus === "error" ? (
                    <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {opisRawErrorMessage || "Unable to load live OPIS raw data."}
                    </div>
                  ) : null}
                </div>
              </div>
              <label className="mt-6 block">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-energy-slate">Raw OPIS Report</div>
                <textarea
                  value={opisRawDisplayedText}
                  onChange={(event) => {
                    if (!opisRawLivePayload && opisRawMarket === "ALL") {
                      setOpisRawInput(event.target.value);
                    }
                  }}
                  className="mt-2 min-h-[260px] w-full rounded-3xl border border-energy-border bg-slate-50 px-4 py-4 font-mono text-xs leading-6 text-energy-ink outline-none transition focus:border-energy-blue"
                  spellCheck={false}
                  readOnly={!!opisRawLivePayload || opisRawMarket !== "ALL"}
                />
              </label>
            </section>

            {opisRawLivePayload ? (
              <section className="rounded-3xl border border-energy-border bg-white p-6 shadow-energy">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-energy-slate">Sample Vs Live</div>
                    <div className="mt-1 text-sm text-energy-slate">
                      Compare the bundled sample report against the live supplier-price feed rendered into the same report-style format.
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <div className="rounded-2xl border border-energy-border bg-slate-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-energy-slate">Sample Markets</div>
                    <div className="mt-2 text-2xl font-semibold text-energy-ink">{opisRawSampleReport.markets.length}</div>
                  </div>
                  <div className="rounded-2xl border border-energy-border bg-slate-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-energy-slate">Sample Lines</div>
                    <div className="mt-2 text-2xl font-semibold text-energy-ink">{opisRawSampleLineCount}</div>
                  </div>
                  <div className="rounded-2xl border border-energy-border bg-slate-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-energy-slate">Live Rows</div>
                    <div className="mt-2 text-2xl font-semibold text-energy-ink">{opisRawLiveRows.length}</div>
                  </div>
                  <div className="rounded-2xl border border-energy-border bg-slate-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-energy-slate">Generated Lines</div>
                    <div className="mt-2 text-2xl font-semibold text-energy-ink">{opisRawGeneratedLines.length}</div>
                  </div>
                </div>
                <div className="mt-6 grid gap-6 xl:grid-cols-2">
                  <label className="block">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-energy-slate">Sample Report</div>
                    <div className="mt-2 min-h-[320px] overflow-auto rounded-3xl border border-energy-border bg-slate-50 px-4 py-4 font-mono text-[11px] leading-6 text-energy-ink whitespace-pre">
                      {opisRawSampleDisplayedText}
                    </div>
                  </label>
                  <label className="block">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-energy-slate">Generated Live Report</div>
                    <div className="mt-1 text-sm text-energy-slate">
                      Generated from live supplier rows fetched {opisRawFetchedAt ? formatOpisDateTime(opisRawFetchedAt) : "just now"}. The trace now prefers rows that map to today&apos;s price date, which means yesterday&apos;s spot/effective rows are used for today pricing when OPIS reports that way.
                    </div>
                    <GeneratedOpisReport lines={opisRawGeneratedLines} />
                  </label>
                </div>
              </section>
            ) : null}

            {opisRawLivePayload ? (
              <section className="rounded-3xl border border-energy-border bg-white p-6 shadow-energy">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-energy-slate">Live OPIS Supplier Rows</div>
                    <div className="mt-1 text-sm text-energy-slate">
                      Showing {opisRawLiveFilteredRows.length} supplier rows from the live raw payload{opisRawMarket === "ALL" ? "" : ` for ${opisRawMarket}`}.
                    </div>
                  </div>
                  <div className="text-sm text-energy-slate">
                    Raw endpoint: <span className="font-medium text-energy-ink">`/market/opis/raw`</span>
                  </div>
                </div>
                {opisRawLiveFilteredRows.length ? (
                  <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-energy-border text-left text-[11px] uppercase tracking-[0.14em] text-energy-slate">
                          <th className="pb-3 pr-4">Market</th>
                          <th className="pb-3 pr-4">Supplier</th>
                          <th className="pb-3 pr-4">Product</th>
                          <th className="pb-3 pr-4">Terms</th>
                          <th className="pb-3 pr-4">Price</th>
                          <th className="pb-3 pr-4">Move Date</th>
                          <th className="pb-3">Effective</th>
                        </tr>
                      </thead>
                      <tbody>
                        {opisRawLiveFilteredRows.slice(0, 150).map((row, index) => (
                          <tr
                            key={`${opisRawLiveMarketLabel(row)}-${opisRawLiveProductLabel(row)}-${String(opisRawReadField(row, "SupplierName", "supplierName") || index)}`}
                            className="border-b border-slate-100 align-top"
                          >
                            <td className="py-3 pr-4 font-semibold text-energy-ink">{opisRawLiveMarketLabel(row)}</td>
                            <td className="py-3 pr-4 text-energy-ink">{opisRawLiveSupplierLabel(row)}</td>
                            <td className="py-3 pr-4 text-energy-ink">{opisRawLiveProductLabel(row)}</td>
                            <td className="py-3 pr-4 text-energy-slate">{String(opisRawReadField(row, "Terms", "terms", "GrossNet", "grossNet") || "n/a")}</td>
                            <td className="py-3 pr-4 font-semibold text-energy-ink">{opisRawLivePriceLabel(row)}</td>
                            <td className="py-3 pr-4 text-energy-slate">{String(opisRawReadField(row, "MoveDate", "moveDate") || "n/a")}</td>
                            <td className="py-3 text-energy-slate">{String(opisRawReadField(row, "EffectiveDate", "effectiveDate") || "n/a")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-energy-border bg-slate-50 p-6 text-center text-sm text-energy-slate">
                    No live OPIS rows matched the current market filter.
                  </div>
                )}
              </section>
            ) : opisRawRetailCount ? (
              <section className="rounded-3xl border border-energy-border bg-white p-6 shadow-energy">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-energy-slate">Retail Summary</div>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {opisRawSections
                    .filter((section) => section.sectionType === "retail")
                    .flatMap((section) =>
                      section.metrics.map((metric) => (
                        <div key={`${section.id}-${metric.label}`} className="rounded-2xl border border-energy-border bg-slate-50 p-4">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-energy-slate">{section.market}</div>
                          <div className="mt-1 text-sm text-energy-slate">{metric.label}</div>
                          <div className="mt-2 text-xl font-semibold text-energy-ink">{metric.cells.filter(Boolean).join(" | ") || "n/a"}</div>
                        </div>
                      ))
                    )}
                </div>
              </section>
            ) : null}

            {!opisRawLivePayload && opisRawSections.length ? (
              opisRawSections.map((section) => <OpisRawSectionCard key={section.id} section={section} />)
            ) : !opisRawLivePayload ? (
              <section className="rounded-3xl border border-energy-border bg-white p-10 text-center text-energy-slate shadow-energy">
                No raw OPIS sections matched the current market filter.
              </section>
            ) : null}

            {!opisRawLivePayload && opisRawReport.disclaimers.length ? (
              <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-energy">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-900">Source disclaimer</div>
                <div className="mt-3 space-y-2 text-sm text-amber-950">
                  {opisRawReport.disclaimers.map((line) => <p key={line}>{line}</p>)}
                </div>
              </section>
            ) : null}
          </section>
        )}
      </div>
    </div>
  );
}
