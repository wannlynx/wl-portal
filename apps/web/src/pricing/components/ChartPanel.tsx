import type { ReactNode } from "react";

interface ChartPanelProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
  titlePopover?: ReactNode;
}

export function ChartPanel({ title, description, actions, children, bodyClassName = "h-[320px] w-full", titlePopover }: ChartPanelProps) {
  return (
    <section className="rounded-3xl border border-energy-border bg-energy-panel p-5 shadow-energy">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="group relative inline-flex items-center gap-2">
            <h3 className="text-base font-semibold text-energy-ink">{title}</h3>
            {titlePopover ? (
              <>
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-energy-border bg-white text-[11px] font-semibold text-energy-slate">
                  i
                </span>
                <div className="pointer-events-none absolute left-0 top-full z-10 mt-2 hidden w-[340px] rounded-2xl border border-energy-border bg-white p-4 text-sm leading-6 text-energy-ink shadow-energy group-hover:block">
                  {titlePopover}
                </div>
              </>
            ) : null}
          </div>
          {description ? <p className="mt-1 text-sm text-energy-slate">{description}</p> : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
