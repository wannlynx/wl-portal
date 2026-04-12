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
  OpisFuelFilter,
  OpisMarketSnapshot,
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
  const warnings: string[] = [];

  try {
    const liveSnapshot = await api.getPricingSnapshot();
    benchmarkSnapshots = liveSnapshot.benchmarkSnapshots;
    inventorySeries = liveSnapshot.inventorySeries;
    lastUpdated = liveSnapshot.lastUpdated;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    if (message.includes("Secret encryption key is missing")) {
      warnings.push("Live EIA data is unavailable because the server encryption key is missing. Restart the API with PETROLEUM_SECRET_KEY or APP_ENCRYPTION_KEY and re-save jobber credentials if needed.");
    } else if (message.includes("Unsupported state or unable to authenticate data")) {
      warnings.push("Live EIA data is unavailable because the saved jobber credentials could not be authenticated. Re-save the EIA key for the active jobber in Admin.");
    } else if (message.includes("EIA_API_KEY is missing")) {
      warnings.push("Live EIA data is unavailable because no EIA key is configured for the active jobber.");
    } else {
      warnings.push("Live EIA data is unavailable, so the dashboard is showing fallback market data.");
    }
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
    sourceCoverage: drivers.sourceCoverage,
    warnings
  };
}

export async function getOpisMarketData(params: {
  timing?: string;
  state?: string;
  fuelType?: OpisFuelFilter;
} = {}): Promise<OpisMarketSnapshot> {
  return api.getOpisSnapshot(params);
}
