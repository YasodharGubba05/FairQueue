import { motion } from 'framer-motion';
import { Label } from '@/components/ui/label';

/**
 * The number, and almost nothing else.
 *
 * A progress ring would be an ornament drawing a shape around information that
 * is already a number. Instead the progress is a single hairline that fills —
 * readable at a glance, and silent when there is nothing to say.
 */
export function PositionNumber({
  ahead,
  progress,
  admitted,
}: {
  ahead: number;
  progress: number;
  admitted: boolean;
}) {
  const clamped = Math.min(1, Math.max(0, progress));

  if (admitted) {
    return (
      <div className="flex flex-col items-center gap-5 text-center">
        <Label tone="live">Your turn</Label>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: [0.22, 0.61, 0.36, 1] }}
          className="font-display text-display-lg sm:text-display-xl"
        >
          You&rsquo;re in
        </motion.p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <Label>Ahead of you</Label>

      {/* Fixed height, tabular figures: the number changes every second and
          must not move anything around it when a digit drops. */}
      <div className="relative h-[clamp(5rem,18vw,9rem)] w-full">
        <motion.p
          key={ahead}
          initial={{ opacity: 0.4, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.26, ease: [0.22, 0.61, 0.36, 1] }}
          data-numeral
          className="absolute inset-0 flex items-center justify-center font-display text-[clamp(4.5rem,16vw,7.5rem)] font-light leading-none tracking-[-0.045em]"
        >
          {ahead.toLocaleString()}
        </motion.p>
      </div>

      {/* The whole progress indicator: one hairline. */}
      <div
        className="h-px w-full max-w-sm bg-[hsl(var(--line)/var(--line-alpha))]"
        role="progressbar"
        aria-valuenow={Math.round(clamped * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progress through the queue"
      >
        <motion.div
          className="h-px bg-foreground"
          initial={false}
          animate={{ width: `${clamped * 100}%` }}
          transition={{ duration: 0.68, ease: [0.22, 0.61, 0.36, 1] }}
        />
      </div>
    </div>
  );
}
