export type BenchmarkKey = "wti" | "brent" | "gasoline" | "diesel" | "regular" | "midgrade" | "premium";
export type InventoryKey = "crude" | "gasoline" | "distillate";
export type CurveStructure = "Backwardation" | "Contango" | "Flat";
export type TrendDirection = "Rising" | "Falling" | "Stable";
export type OutlookBias = "Tightening" | "Neutral" | "Loosening";
export type ConfidenceLevel = "Low" | "Medium" | "High";
export type OpisFuelFilter = "all" | "gasoline" | "diesel" | "biodiesel";

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
  regionalSeries?: Record<string, {
    label: string;
    current: number;
    dayAgo: number;
    weekAgo: number;
    sparkline: number[];
    historyAnchors?: BenchmarkHistoryAnchor[];
  }>;
  defaultRegion?: string;
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
  historyAnchors?: BenchmarkHistoryAnchor[];
  status: TrendDirection;
  regionalSeries?: Record<string, {
    label: string;
    current: number;
    dayAgo: number;
    weekAgo: number;
    sparkline: number[];
    historyAnchors?: BenchmarkHistoryAnchor[];
  }>;
  defaultRegion?: string;
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
  warnings?: string[];
}

export interface OpisFilterOption {
  value: string;
  label: string;
}

export interface OpisSummaryRow {
  cityId: number;
  cityName: string;
  stateAbbr: string;
  stateName: string;
  countryName: string;
  productId: number;
  productName: string;
  fuelType: string;
  branded: string;
  grossNet: string;
  price: number;
  currencyUnit: string;
  effectiveDate: string;
  benchmarkTypeName: string;
  benchmarkTimingType: string;
}

export interface OpisMarketSnapshot {
  lastUpdated: string;
  appliedFilters: {
    timing: string;
    state: string;
    fuelType: OpisFuelFilter;
  };
  filterOptions: {
    timing: OpisFilterOption[];
    states: OpisFilterOption[];
    fuelTypes: OpisFilterOption[];
  };
  coverage: {
    countries: number;
    cities: number;
    products: number;
    benchmarkTypes: number;
  };
  metrics: {
    rowCount: number;
    stateCount: number;
    cityCount: number;
    averagePrice: number | null;
    gasolineAverage: number | null;
    dieselAverage: number | null;
    biodieselAverage: number | null;
    effectiveDate: string | null;
  };
  highlights: {
    lowest: OpisSummaryRow[];
    highest: OpisSummaryRow[];
  };
  charts: {
    timingComparison: Array<{
      timing: string;
      label: string;
      averagePrice: number | null;
      gasolineAverage: number | null;
      dieselAverage: number | null;
      rowCount: number;
    }>;
    stateAverages: Array<{
      stateAbbr: string;
      averagePrice: number;
      gasolineAverage: number | null;
      dieselAverage: number | null;
      rowCount: number;
    }>;
    productAverages: Array<{
      productName: string;
      fuelType: string;
      averagePrice: number;
      rowCount: number;
    }>;
  };
  timingSnapshots: Array<{
    timing: string;
    label: string;
    rows: OpisSummaryRow[];
  }>;
  commentary: {
    summary: string[];
    outlook: string[];
  };
  rows: OpisSummaryRow[];
  notes: string[];
}

export interface OpisRawSupplierRow {
  supplier: string;
  cells: string[];
  raw: string;
}

export interface OpisRawMetricRow {
  label: string;
  cells: string[];
  values: string[];
  subsection: string;
}

export interface OpisRawSection {
  id: string;
  market: string;
  capturedAt: string;
  title: string;
  sectionType: "benchmark" | "retail" | "note";
  headerLine: string;
  supplierColumns: string[];
  suppliers: OpisRawSupplierRow[];
  metrics: OpisRawMetricRow[];
  notes: string[];
  rawLines: string[];
}

export interface OpisRawReport {
  generatedAt: string;
  markets: string[];
  sections: OpisRawSection[];
  disclaimers: string[];
}

export type OpisRawApiRecord = Record<string, unknown>;

export interface OpisRawApiData {
  summaries?: OpisRawApiRecord[] | null;
  Summaries?: OpisRawApiRecord[] | null;
  supplierPrices?: OpisRawApiRecord[] | null;
  SupplierPrices?: OpisRawApiRecord[] | null;
}

export interface OpisRawApiResponse {
  statusCode?: number;
  StatusCode?: number;
  requestId?: string | null;
  RequestId?: string | null;
  additionalInfo?: string | null;
  AdditionalInfo?: string | null;
  errorMessage?: string | null;
  ErrorMessage?: string | null;
  data?: OpisRawApiData | null;
  Data?: OpisRawApiData | null;
}
