export type BenchmarkKey = "wti" | "brent" | "gasoline" | "diesel";
export type InventoryKey = "crude" | "gasoline" | "distillate";
export type CurveStructure = "Backwardation" | "Contango" | "Flat";
export type TrendDirection = "Rising" | "Falling" | "Stable";
export type OutlookBias = "Tightening" | "Neutral" | "Loosening";
export type ConfidenceLevel = "Low" | "Medium" | "High";

export interface BenchmarkHistoryAnchor {
  date: string;
  value: number;
}

export interface BenchmarkSnapshot {
  key: string;
  label: string;
  unit: string;
  current: number;
  dayAgo: number;
  weekAgo: number;
  sparkline: number[];
  historyAnchors?: BenchmarkHistoryAnchor[];
}

export interface PriceHistoryPoint {
  date: string;
  wti: number;
  brent: number;
  gasoline: number;
  diesel: number;
}

export interface InventoryPoint {
  date: string;
  value: number;
}

export interface InventoryAnnotation {
  date: string;
  label: string;
  detail: string;
}

export interface InventorySeries {
  key: InventoryKey;
  label: string;
  unit: string;
  points: InventoryPoint[];
  annotations: InventoryAnnotation[];
}

export interface ForwardCurvePoint {
  month: string;
  value: number;
}

export interface ForwardCurveSeries {
  key: BenchmarkKey;
  label: string;
  unit: string;
  points: ForwardCurvePoint[];
}

export interface SourceCoverageItem {
  source: string;
  description: string;
}

export interface NarrativeDriverSet {
  lastUpdated: string;
  macroTone: string;
  refineryUtilization: number;
  exportSignal: string;
  weatherSignal: string;
  sourceCoverage: SourceCoverageItem[];
}

export interface KpiCardModel {
  key: string;
  label: string;
  unit: string;
  currentValue: number;
  dailyChange: number;
  weeklyChange: number;
  sparkline: number[];
  status: TrendDirection;
}

export interface CurveSummary {
  market: BenchmarkKey;
  label: string;
  structure: CurveStructure;
  spread: number;
  description: string;
}

export interface MarketInsightSummary {
  narrativeBullets: string[];
  outlookTitle: OutlookBias;
  outlookBody: string[];
  confidence: ConfidenceLevel;
  curveSummaries: CurveSummary[];
}

export interface PricingDashboardData {
  lastUpdated: string;
  sourceBadges: string[];
  priceHistory: PriceHistoryPoint[];
  benchmarkCards: KpiCardModel[];
  inventorySeries: InventorySeries[];
  forwardCurves: ForwardCurveSeries[];
  insightSummary: MarketInsightSummary;
  sourceCoverage: SourceCoverageItem[];
}
