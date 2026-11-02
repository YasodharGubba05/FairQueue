import { motion } from 'framer-motion';
import { Label, StatusLabel } from '@/components/ui/label';
import type { SectionSummary } from '@/lib/demand';
import { cn, formatPrice } from '@/lib/utils';

/**
 * How the venue is filling up, section by section.
 *
 * The bar is the share of a section already sold or held, so a nearly-full
 * section reads as nearly full at a glance. The rate beside it is the live
 * figure from the worker and only appears while something is actually moving —
 * a static "0/s" on every row is noise pretending to be data.
 */
export function DemandPanel({
  sections,
  tierFor,
  hottest,
  buyersInQueue,
}: {
  sections: SectionSummary[];
  tierFor: (price: number) => number;
  hottest: string | null;
  buyersInQueue: number | null;
}) {
  if (sections.length === 0) return null;

  return (
    <section
      aria-label="Section demand"
      className="mx-auto flex w-full max-w-[680px] flex-col gap-5 rounded bg-surface p-6 shadow-lift"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Label>Demand</Label>
        {buyersInQueue !== null && buyersInQueue > 0 ? (
          <StatusLabel tone="live" pulse>
            {buyersInQueue.toLocaleString()} waiting
          </StatusLabel>
        ) : null}
      </div>

      <ul className="flex flex-col gap-4">
        {sections.map((s) => {
          const isHottest = s.section === hottest;
          return (
            <li key={s.section} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <span className="flex items-center gap-2.5">
                  <span
                    className="size-2 shrink-0 rounded-pill"
                    style={{ background: `hsl(var(--tier-${tierFor(s.price)}))` }}
                    aria-hidden
                  />
                  <span className={cn(isHottest && 'text-foreground')}>{s.section}</span>
                  {isHottest ? <Label tone="warning">Going fastest</Label> : null}
                </span>

                <span className="flex items-baseline gap-4 whitespace-nowrap">
                  {s.claimRate !== null && s.claimRate > 0 ? (
                    <span data-numeral className="text-xs text-warning">
                      {s.claimRate}/s
                    </span>
                  ) : null}
                  <span data-numeral className="text-xs text-muted">
                    {s.available.toLocaleString()} of {s.total.toLocaleString()} left
                  </span>
                </span>
              </div>

              {/* Share taken. Hairline track, so a full section is a full line
                  rather than a filled box. */}
              <div className="h-px w-full bg-[hsl(var(--line)/var(--line-alpha))]">
                <motion.div
                  className="h-px"
                  style={{ background: `hsl(var(--tier-${tierFor(s.price)}))` }}
                  initial={false}
                  animate={{ width: `${Math.round(s.takenShare * 100)}%` }}
                  transition={{ duration: 0.68, ease: [0.22, 0.61, 0.36, 1] }}
                />
              </div>

              <div className="flex justify-between gap-4 text-xs text-faint">
                <span data-numeral>{formatPrice(s.price)}</span>
                <span data-numeral>
                  {Math.round(s.takenShare * 100)}% taken
                  {s.held > 0 ? ` · ${s.held.toLocaleString()} on hold` : ''}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-xs leading-relaxed text-faint">
        Counts come from the seat map on this page; the per-second rates come from the server, so
        everybody watching this sale sees the same figures.
      </p>
    </section>
  );
}
