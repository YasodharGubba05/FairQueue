import { useRef, useState } from 'react';
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * A surface that responds to the cursor.
 *
 * Two things happen at once, and the balance between them is the whole design:
 *
 *   The tilt is deliberately small — six degrees at the very corner. A card
 *   that pitches twenty degrees is the thing every generated portfolio does,
 *   and it reads as an effect applied to a page rather than a property of the
 *   object. Six degrees reads as weight.
 *
 *   The light does the rest. A soft pool follows the pointer across the
 *   surface, so the card appears to be lit by the cursor rather than animated
 *   by it. In an interface with no accent colour, light is what is left to
 *   make something feel alive, and it is also what makes this look expensive
 *   instead of templated.
 *
 * Motion values drive the transform directly, so none of this re-renders
 * React on mouse move — which matters on a page holding twenty of them.
 */
const MAX_TILT_DEGREES = 6;

export function TiltCard({
  children,
  className,
  disabled = false,
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const [lit, setLit] = useState(false);

  // -0.5 … 0.5 across the card in each axis.
  const px = useMotionValue(0);
  const py = useMotionValue(0);

  // Springs rather than raw values, so the card settles instead of snapping,
  // and so leaving it animates back rather than cutting.
  const spring = { stiffness: 180, damping: 22, mass: 0.6 };
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [MAX_TILT_DEGREES, -MAX_TILT_DEGREES]), spring);
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-MAX_TILT_DEGREES, MAX_TILT_DEGREES]), spring);

  // Where the light pools, in per-cent of the card.
  const lightX = useSpring(useTransform(px, [-0.5, 0.5], [0, 100]), spring);
  const lightY = useSpring(useTransform(py, [-0.5, 0.5], [0, 100]), spring);

  // Composed at the top level, never inside the render branch below: a hook
  // called conditionally breaks the moment `active` changes.
  const light = useTransform(
    [lightX, lightY],
    ([x, y]) =>
      `radial-gradient(420px circle at ${x}% ${y}%, hsl(var(--cursor-light) / var(--cursor-light-alpha)), transparent 70%)`,
  );

  const active = !disabled && !reduceMotion;

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!active) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    px.set((e.clientX - rect.left) / rect.width - 0.5);
    py.set((e.clientY - rect.top) / rect.height - 0.5);
  }

  function onPointerLeave() {
    setLit(false);
    px.set(0);
    py.set(0);
  }

  return (
    <motion.div
      ref={ref}
      onPointerMove={onPointerMove}
      onPointerEnter={() => active && setLit(true)}
      onPointerLeave={onPointerLeave}
      style={
        active
          ? {
              rotateX,
              rotateY,
              // Perspective on the element itself, so each card has its own
              // vanishing point rather than sharing one across the grid —
              // which is what makes a row of them look like a sheet bending.
              transformPerspective: 900,
              transformStyle: 'preserve-3d',
            }
          : undefined
      }
      className={cn(
        'group relative isolate overflow-hidden rounded bg-surface shadow-lift',
        'transition-[box-shadow,background-color] duration-[var(--dur)]',
        active && 'hover:bg-surface-raised hover:shadow-lift-hover',
        className,
      )}
    >
      {/* The cursor light. Sits above the surface and below the content, so it
          lights the card without washing out the text. */}
      {active ? (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 transition-opacity duration-[var(--dur)]"
          style={{ background: light, opacity: lit ? 1 : 0 }}
        />
      ) : null}

      {children}
    </motion.div>
  );
}
