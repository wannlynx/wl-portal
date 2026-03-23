import type { SourceCoverageItem } from "../types/market";

interface SourceBadgeRowProps {
  badges: string[];
  coverage: SourceCoverageItem[];
}

export function SourceBadgeRow({ badges, coverage }: SourceBadgeRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {badges.map((badge) => (
        <div key={badge} className="group relative">
          <button
            type="button"
            className="rounded-full border border-energy-border bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-energy-slate shadow-energy"
          >
            {badge}
          </button>
          <div className="pointer-events-none absolute right-0 top-full z-10 mt-2 w-64 rounded-2xl border border-energy-border bg-white p-3 text-left opacity-0 shadow-energy transition group-hover:opacity-100 group-focus-within:opacity-100">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-energy-slate">{badge}</div>
            <div className="mt-1 text-sm leading-5 text-energy-ink">
              {coverage.find((item) => item.source === badge)?.description || "Source mapping placeholder."}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
