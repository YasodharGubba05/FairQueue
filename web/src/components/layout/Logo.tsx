/**
 * The mark: the word, and a row of four ticks that stand for a queue with one
 * person at the front. No gradient tile, no icon in a rounded square.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={className}>
      <span className="flex items-center gap-2.5">
        <svg width="22" height="10" viewBox="0 0 22 10" fill="none" aria-hidden>
          <rect x="0" y="0" width="2" height="10" fill="currentColor" />
          <rect x="6" y="2" width="2" height="6" fill="currentColor" opacity="0.5" />
          <rect x="12" y="2" width="2" height="6" fill="currentColor" opacity="0.32" />
          <rect x="18" y="2" width="2" height="6" fill="currentColor" opacity="0.18" />
        </svg>
        <span className="font-display text-base font-normal tracking-tight">FairQueue</span>
      </span>
      <span className="sr-only">FairQueue home</span>
    </span>
  );
}
