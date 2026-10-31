import { motion } from 'framer-motion';

const SIZE = 260;
const STROKE = 12;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * The big number with a ring around it. `progress` is 0 when you joined and 1
 * when it is your turn, so the ring fills as the line moves.
 */
export function PositionRing({
  ahead,
  progress,
  admitted,
}: {
  ahead: number;
  progress: number;
  admitted: boolean;
}) {
  const clamped = Math.min(1, Math.max(0, progress));

  return (
    <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }}>
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="-rotate-90"
        aria-hidden
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="hsl(var(--border))"
          strokeWidth={STROKE}
        />
        <defs>
          <linearGradient id="ring-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="hsl(var(--accent))" />
            <stop offset="100%" stopColor="hsl(var(--highlight))" />
          </linearGradient>
        </defs>
        <motion.circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="url(#ring-gradient)"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          initial={false}
          animate={{ strokeDashoffset: CIRCUMFERENCE * (1 - clamped) }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </svg>

      {/* A soft pulse behind the number, so the screen never feels frozen. */}
      <span className="pointer-events-none absolute inset-8 rounded-full bg-accent/20 animate-pulse-ring" />

      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {admitted ? (
          <>
            <span className="font-display text-display-md text-gradient">You're in</span>
            <span className="mt-1 text-sm text-muted">Taking you to the seats</span>
          </>
        ) : (
          <>
            <span className="text-xs uppercase tracking-[0.18em] text-muted">Ahead of you</span>
            {/* Changing the key remounts the number, so it slides in on every
                tick. No exit animation, so two values can never overlap. The
                height is fixed so the layout does not shift as digits drop. */}
            <motion.span
              key={ahead}
              initial={{ opacity: 0.35, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="flex h-[4.5rem] items-center justify-center font-display text-display-lg tabular-nums"
            >
              {ahead.toLocaleString()}
            </motion.span>
            <span className="text-sm text-muted">
              {ahead === 1 ? 'person' : 'people'} in front
            </span>
          </>
        )}
      </div>
    </div>
  );
}
