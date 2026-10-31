import { ExternalLink } from 'lucide-react';
import { Label } from '@/components/ui/label';
import type { EventSummary } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * Says whether an event is real.
 *
 * The distinction this draws is narrow and worth being precise about: it is
 * about the *event*, never the tickets. A verified event is one whose name,
 * venue and date came from a source you can open and check — and FairQueue
 * still sells simulated seats for it, exactly as it does for the invented
 * ones. SimulatedInventoryNote below says that part, and goes on every event.
 */
export function ProvenanceLabel({
  event,
  className,
}: {
  event: Pick<EventSummary, 'verified' | 'sourceLabel' | 'sourceName' | 'sourceUrl'>;
  className?: string;
}) {
  if (!event.verified) {
    return (
      <span className={cn('inline-flex items-center gap-2', className)}>
        <span aria-hidden className="size-1.5 rounded-pill bg-muted" />
        <Label>Simulated event</Label>
      </span>
    );
  }

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      <span className="inline-flex items-center gap-2">
        <span aria-hidden className="size-1.5 rounded-pill bg-success" />
        <Label tone="live">Verified real event</Label>
      </span>

      {/* The link is the whole point of the claim: without somewhere to check
          it, "verified" is just a word we wrote. */}
      {event.sourceUrl ? (
        <a
          href={event.sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 rounded-sm text-xs text-muted transition-colors duration-[var(--dur-fast)] hover:text-foreground"
        >
          {event.sourceName ?? event.sourceLabel}
          <ExternalLink className="size-3" aria-hidden />
          <span className="sr-only">(opens the source in a new tab)</span>
        </a>
      ) : (
        <span className="text-xs text-muted">{event.sourceName ?? event.sourceLabel}</span>
      )}
    </span>
  );
}

/**
 * The standing disclaimer, shown on every event without exception.
 *
 * Real event, invented event, it makes no difference: nothing here is a ticket
 * anyone can use. This is the sentence that keeps a working checkout under a
 * real artist's name from being a lie.
 */
export function SimulatedInventoryNote({
  className,
  verbose = false,
}: {
  className?: string;
  verbose?: boolean;
}) {
  return (
    <p className={cn('max-w-reading text-xs leading-relaxed text-faint', className)}>
      {verbose
        ? 'FairQueue is a demonstration. The seats, prices, availability, payment and tickets on this page are simulated and have no connection to this event’s real organiser or ticket seller. Nothing is charged and no ticket you can use is issued.'
        : 'Seats, prices, payment and tickets are simulated. Nothing is charged.'}
    </p>
  );
}
