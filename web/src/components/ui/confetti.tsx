import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

/**
 * A short, quiet burst for the moment the tickets are yours. Deliberately
 * small: a dozen pieces, one and a half seconds, and nothing at all if the
 * reader has asked their system to reduce motion.
 */
const PIECES = 14;
const COLORS = ['var(--accent)', 'var(--highlight)', 'var(--tier-1)', 'var(--tier-4)'];

export function Confetti() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    setShow(true);
    const id = setTimeout(() => setShow(false), 1800);
    return () => clearTimeout(id);
  }, []);

  if (!show) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-40 overflow-hidden" aria-hidden>
      {Array.from({ length: PIECES }, (_, i) => {
        const left = (i / PIECES) * 100 + (i % 3) * 4;
        return (
          <motion.span
            key={i}
            initial={{ y: -20, opacity: 1, rotate: 0 }}
            animate={{ y: 160, opacity: 0, rotate: i % 2 ? 220 : -220 }}
            transition={{ duration: 1.4, delay: i * 0.035, ease: 'easeOut' }}
            className="absolute block size-1.5 rounded-[1px]"
            style={{ left: `${left}%`, background: `hsl(${COLORS[i % COLORS.length]})` }}
          />
        );
      })}
    </div>
  );
}
