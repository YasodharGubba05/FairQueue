import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

/**
 * The success moment. In a monochrome system a burst of coloured paper would
 * be the one piece of pure decoration in the product, so this is a single
 * hairline that draws itself across the page and fades — the same gesture as
 * the queue progress line, used once, to say the waiting is over.
 */
export function SuccessRule() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    setShow(true);
  }, []);

  if (!show) return null;

  return (
    <motion.span
      aria-hidden
      initial={{ scaleX: 0, opacity: 1 }}
      animate={{ scaleX: 1, opacity: 0 }}
      transition={{ duration: 1.1, ease: [0.22, 0.61, 0.36, 1] }}
      style={{ transformOrigin: 'left' }}
      className="absolute inset-x-0 top-0 h-px bg-foreground"
    />
  );
}
