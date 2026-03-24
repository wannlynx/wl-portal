import { api } from "../../api";
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
  const fallbackBenchmarks = benchmarkPrices.benchmarks as BenchmarkSnapshot[];
  const fallbackInventory = inventoryTrends.series as InventorySeries[];
  const curveSeries = forwardCurves.curves as ForwardCurveSeries[];
  const drivers = narrativeDrivers as NarrativeDriverSet;

  let benchmarkSnapshots = fallbackBenchmarks;
  let inventorySeries = fallbackInventory;
  let lastUpdated = benchmarkPrices.lastUpdated;

  try {
    const liveSnapshot = await api.getPricingSnapshot();
    benchmarkSnapshots = liveSnapshot.benchmarkSnapshots;
    inventorySeries = liveSnapshot.inventorySeries;
    lastUpdated = liveSnapshot.lastUpdated;
  } catch (_error) {
    // TODO: When live EIA is required in all environments, surface this instead of silently falling back.
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const priceHistory = buildPriceHistory(benchmarkSnapshots);
  const cardSnapshots = benchmarkSnapshots.filter((item) => ["wti", "brent", "regular", "midgrade", "premium", "diesel"].includes(item.key));
  const benchmarkCards = [
    ...buildBenchmarkCards(cardSnapshots),
    ...buildInventoryCards(inventorySeries)
  ];

  return {
    lastUpdated,
    sourceBadges: benchmarkPrices.sourceBadges,
    priceHistory,
    benchmarkCards,
    inventorySeries,
    forwardCurves: curveSeries,
    insightSummary: buildInsightSummary(benchmarkCards, inventorySeries, curveSeries, drivers),
    sourceCoverage: drivers.sourceCoverage
  };
}
