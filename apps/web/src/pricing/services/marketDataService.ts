import benchmarkPrices from "../data/benchmarkPrices.json";
import inventoryTrends from "../data/inventoryTrends.json";
import forwardCurves from "../data/forwardCurves.json";
import narrativeDrivers from "../data/narrativeDrivers.json";
import type {
  BenchmarkSnapshot,
  ForwardCurveSeries,
  InventorySeries,
  NarrativeDriverSet,
  PricingDashboardData
} from "../types/market";
import {
  buildBenchmarkCards,
  buildInsightSummary,
  buildInventoryCards,
  buildPriceHistory
} from "../utils/marketCalculations";

export async function getPricingDashboardData(): Promise<PricingDashboardData> {
  // TODO: Replace these mock imports with live EIA, CME, ICE, and NRCan requests.
  // Keep cross-source aggregation in this service layer so the page remains presentation-focused.
  await new Promise((resolve) => setTimeout(resolve, 250));

  const benchmarkSnapshots = benchmarkPrices.benchmarks as BenchmarkSnapshot[];
  const inventorySeries = inventoryTrends.series as InventorySeries[];
  const curveSeries = forwardCurves.curves as ForwardCurveSeries[];
  const drivers = narrativeDrivers as NarrativeDriverSet;

  const priceHistory = buildPriceHistory(benchmarkSnapshots);
  const benchmarkCards = [
    ...buildBenchmarkCards(benchmarkSnapshots.slice(0, 4)),
    ...buildInventoryCards(inventorySeries)
  ];

  return {
    lastUpdated: benchmarkPrices.lastUpdated,
    sourceBadges: benchmarkPrices.sourceBadges,
    priceHistory,
    benchmarkCards,
    inventorySeries,
    forwardCurves: curveSeries,
    insightSummary: buildInsightSummary(benchmarkCards, inventorySeries, curveSeries, drivers),
    sourceCoverage: drivers.sourceCoverage
  };
}
