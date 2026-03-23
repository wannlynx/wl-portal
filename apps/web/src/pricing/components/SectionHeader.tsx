import type { ReactNode } from "react";

interface SectionHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function SectionHeader({ eyebrow, title, description, actions }: SectionHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        {eyebrow ? <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-energy-slate">{eyebrow}</div> : null}
        <h2 className="text-lg font-semibold text-energy-ink">{title}</h2>
        {description ? <p className="mt-1 max-w-3xl text-sm text-energy-slate">{description}</p> : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}
