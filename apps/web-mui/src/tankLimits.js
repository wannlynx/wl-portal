export const TANK_LIMIT_FAMILIES = [
  { key: "regular", label: "Regular" },
  { key: "mid", label: "Mid" },
  { key: "premium", label: "Premium" },
  { key: "diesel", label: "Diesel" },
  { key: "def", label: "DEF" },
  { key: "unknown", label: "Unknown" }
];

export const DEFAULT_TANK_LIMITS = {
  regular: { lowRedMax: 10, lowYellowMax: 15, highYellowMin: 80, highRedMin: 90 },
  mid: { lowRedMax: 10, lowYellowMax: 15, highYellowMin: 80, highRedMin: 90 },
  premium: { lowRedMax: 12, lowYellowMax: 18, highYellowMin: 82, highRedMin: 92 },
  diesel: { lowRedMax: 12, lowYellowMax: 18, highYellowMin: 85, highRedMin: 93 },
  def: { lowRedMax: 8, lowYellowMax: 14, highYellowMin: 88, highRedMin: 95 },
  unknown: { lowRedMax: 10, lowYellowMax: 15, highYellowMin: 80, highRedMin: 90 }
};

function clampPercent(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, numeric));
}

export function normalizeTankLimits(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    Object.entries(DEFAULT_TANK_LIMITS).map(([key, defaults]) => {
      const current = source[key] && typeof source[key] === "object" ? source[key] : {};
      const lowRedMax = clampPercent(current.lowRedMax, defaults.lowRedMax);
      const lowYellowMax = clampPercent(current.lowYellowMax, defaults.lowYellowMax);
      const highYellowMin = clampPercent(current.highYellowMin, defaults.highYellowMin);
      const highRedMin = clampPercent(current.highRedMin, defaults.highRedMin);
      return [
        key,
        {
          lowRedMax: Math.min(lowRedMax, lowYellowMax),
          lowYellowMax: Math.max(lowRedMax, lowYellowMax),
          highYellowMin: Math.min(highYellowMin, highRedMin),
          highRedMin: Math.max(highYellowMin, highRedMin)
        }
      ];
    })
  );
}

export function tankFamilyFromProduct(product) {
  const normalized = String(product || "").trim().toLowerCase();
  if (normalized.includes("diesel")) return "diesel";
  if (normalized.includes("premium")) return "premium";
  if (normalized.includes("mid")) return "mid";
  if (normalized.includes("regular") || normalized.includes("unleaded")) return "regular";
  if (normalized.includes("def")) return "def";
  return "unknown";
}

export function resolveTankLimits(limits, product) {
  const normalized = normalizeTankLimits(limits);
  return normalized[tankFamilyFromProduct(product)] || normalized.unknown;
}

export function tankLevelTone(fillPercent, limits, product) {
  const value = Math.max(0, Math.min(100, Number(fillPercent) || 0));
  const resolved = resolveTankLimits(limits, product);
  if (value <= resolved.lowRedMax || value >= resolved.highRedMin) return "error";
  if (value <= resolved.lowYellowMax || value >= resolved.highYellowMin) return "warning";
  return "success";
}

export function gaugeColorStops(limits, product) {
  const resolved = resolveTankLimits(limits, product);
  return [
    [Math.max(0, Math.min(1, resolved.lowRedMax / 100)), "#d14343"],
    [Math.max(0, Math.min(1, resolved.lowYellowMax / 100)), "#c77700"],
    [Math.max(0, Math.min(1, resolved.highYellowMin / 100)), "#2e7d32"],
    [Math.max(0, Math.min(1, resolved.highRedMin / 100)), "#c77700"],
    [1, "#d14343"]
  ];
}

export function gaugeBandRanges(limits, product) {
  const resolved = resolveTankLimits(limits, product);
  return [
    { start: 0, end: resolved.lowRedMax, color: "#c84232" },
    { start: resolved.lowRedMax, end: resolved.lowYellowMax, color: "#d6a63f" },
    { start: resolved.lowYellowMax, end: resolved.highYellowMin, color: "#4c9a63" },
    { start: resolved.highYellowMin, end: resolved.highRedMin, color: "#d6a63f" },
    { start: resolved.highRedMin, end: 100, color: "#c84232" }
  ].filter((range) => range.end > range.start);
}
