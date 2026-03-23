import type { ReactNode } from "react";

interface InsightCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function InsightCard({ title, subtitle, children }: InsightCardProps) {
  return (
    <section className="rounded-3xl border border-energy-border bg-white p-5 shadow-energy">
      <div className="mb-3">
        <h3 className="text-base font-semibold text-energy-ink">{title}</h3>
        {subtitle ? <p className="mt-1 text-sm text-energy-slate">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}
