import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Seat, SeatStatus } from '@/lib/types';
import {
  SEAT_RADIUS,
  buildGrid,
  computeLayout,
  isPickable,
  priceTiers,
  seatFill,
  tierForPrice,
} from '@/lib/seatmap';
import { formatPrice } from '@/lib/utils';

const MIN_SCALE = 1;
const MAX_SCALE = 6;

/**
 * One seat. Memoised on exactly what can change it, so a batch of seat updates
 * only re-renders the seats in that batch rather than all 2,000.
 */
const SeatDot = memo(function SeatDot({
  seat,
  status,
  selected,
  focused,
  tier,
  onPick,
}: {
  seat: Seat;
  status: SeatStatus;
  selected: boolean;
  focused: boolean;
  tier: number;
  onPick: (seat: Seat) => void;
}) {
  const pickable = isPickable(status, selected);

  return (
    <circle
      cx={seat.x}
      cy={seat.y}
      r={selected || focused ? SEAT_RADIUS + 1.1 : SEAT_RADIUS}
      fill={seatFill(status, selected, tier)}
      opacity={status === 'sold' ? 0.55 : 1}
      stroke={focused ? 'hsl(var(--foreground))' : 'none'}
      strokeWidth={focused ? 1.6 : 0}
      className={pickable ? 'cursor-pointer' : 'cursor-not-allowed'}
      style={{ transition: 'fill 160ms ease, r 120ms ease' }}
      onClick={() => pickable && onPick(seat)}
      data-seat={seat.id}
    />
  );
});

type Tooltip = { seat: Seat; status: SeatStatus; left: number; top: number };

export function SeatMapCanvas({
  seats,
  statuses,
  selected,
  onPick,
}: {
  seats: Seat[];
  statuses: Record<string, SeatStatus>;
  selected: Set<string>;
  onPick: (seat: Seat) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const dragging = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const { viewBox, stage } = useMemo(() => computeLayout(seats), [seats]);
  const tiers = useMemo(() => priceTiers(seats), [seats]);
  const grid = useMemo(() => buildGrid(seats), [seats]);

  // Keep the pan inside the map, so the venue can never be dragged off screen.
  const clampPan = useCallback(
    (next: { x: number; y: number }, atScale: number) => {
      const limitX = (viewBox.width * (atScale - 1)) / (2 * atScale);
      const limitY = (viewBox.height * (atScale - 1)) / (2 * atScale);
      return {
        x: Math.max(-limitX, Math.min(limitX, next.x)),
        y: Math.max(-limitY, Math.min(limitY, next.y)),
      };
    },
    [viewBox.width, viewBox.height],
  );

  const zoomTo = useCallback(
    (next: number) => {
      const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));
      setScale(clamped);
      setPan((p) => clampPan(p, clamped));
    },
    [clampPan],
  );

  const reset = useCallback(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Wheel zoom, bound manually because React's onWheel is passive and so
  // cannot preventDefault the page scroll.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomTo(scale * (e.deltaY < 0 ? 1.12 : 0.89));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scale, zoomTo]);

  const focusedSeat = focusedId ? seats.find((s) => s.id === focusedId) ?? null : null;

  /** Arrow keys walk the seat grid; Enter or Space picks the seat. */
  function onKeyDown(e: React.KeyboardEvent) {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' '];
    if (!keys.includes(e.key)) return;
    e.preventDefault();

    if (!focusedId) {
      setFocusedId(grid.rows[0]?.[0]?.id ?? null);
      return;
    }
    const at = grid.indexOf.get(focusedId);
    if (!at) return;
    const [r, c] = at;

    if (e.key === 'Enter' || e.key === ' ') {
      const seat = grid.rows[r][c];
      if (isPickable(statuses[seat.id] ?? seat.status, selected.has(seat.id))) onPick(seat);
      return;
    }

    let next = grid.rows[r][c];
    if (e.key === 'ArrowLeft') next = grid.rows[r][Math.max(0, c - 1)];
    if (e.key === 'ArrowRight') next = grid.rows[r][Math.min(grid.rows[r].length - 1, c + 1)];
    if (e.key === 'Home') next = grid.rows[r][0];
    if (e.key === 'End') next = grid.rows[r][grid.rows[r].length - 1];
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const nextRow = grid.rows[e.key === 'ArrowUp' ? r - 1 : r + 1];
      // Rows differ in length, so land on the nearest seat across rather than
      // dropping focus when the row below is shorter.
      if (nextRow) next = nextRow[Math.min(c, nextRow.length - 1)];
    }
    setFocusedId(next.id);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (scale <= 1) return;
    dragging.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragging.current;
    if (!drag) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Screen pixels to view-box units, so a drag tracks the cursor exactly.
    const perPx = viewBox.width / rect.width / scale;
    setPan(
      clampPan(
        {
          x: drag.panX + (e.clientX - drag.x) * perPx,
          y: drag.panY + (e.clientY - drag.y) * perPx,
        },
        scale,
      ),
    );
  }

  function endDrag() {
    dragging.current = null;
  }

  function showTooltip(e: React.MouseEvent, seat: Seat) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({
      seat,
      status: statuses[seat.id] ?? seat.status,
      left: e.clientX - rect.left,
      top: e.clientY - rect.top,
    });
  }

  const cx = viewBox.x + viewBox.width / 2;
  const cy = viewBox.y + viewBox.height / 2;

  return (
    <div className="relative">
      {/* The venue is taller than it is wide, so the map is capped and centred
          rather than stretched across a desktop window with empty bands down
          both sides. No frame around it: the map sits on the page. */}
      <div
        ref={wrapRef}
        className="relative mx-auto w-full max-w-[680px] overflow-hidden"
        onMouseLeave={() => setTooltip(null)}
      >
        <svg
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
          className="block h-[clamp(420px,66svh,760px)] w-full touch-none select-none"
          role="application"
          aria-label={
            focusedSeat
              ? `Seat map. Focused: ${focusedSeat.section} row ${focusedSeat.row} seat ${focusedSeat.number}, ${formatPrice(focusedSeat.price)}, ${statuses[focusedSeat.id] ?? focusedSeat.status}. Arrow keys to move, Enter to select.`
              : 'Seat map. Press an arrow key to start choosing a seat.'
          }
          tabIndex={0}
          onKeyDown={onKeyDown}
          onFocus={() => !focusedId && setFocusedId(grid.rows[0]?.[0]?.id ?? null)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          style={{ cursor: scale > 1 ? (dragging.current ? 'grabbing' : 'grab') : 'default' }}
        >
          {/* Zoom and pan are one transform about the centre, so the map scales
              from the middle rather than the top-left corner. */}
          <g transform={`translate(${cx} ${cy}) scale(${scale}) translate(${-cx + pan.x} ${-cy + pan.y})`}>
            <g>
              <rect
                x={stage.x}
                y={stage.y}
                width={stage.width}
                height={stage.height}
                rx={6}
                fill="none"
                stroke="hsl(var(--line) / var(--line-strong-alpha))"
              />
              <text
                x={stage.x + stage.width / 2}
                y={stage.y + stage.height / 2 + 4}
                textAnchor="middle"
                fontSize="11"
                letterSpacing="4"
                fill="hsl(var(--muted))"
              >
                STAGE
              </text>
            </g>

            {seats.map((seat) => (
              <g
                key={seat.id}
                onMouseEnter={(e) => showTooltip(e, seat)}
                onMouseMove={(e) => showTooltip(e, seat)}
              >
                <SeatDot
                  seat={seat}
                  status={statuses[seat.id] ?? seat.status}
                  selected={selected.has(seat.id)}
                  focused={focusedId === seat.id}
                  tier={tierForPrice(tiers, seat.price)}
                  onPick={onPick}
                />
              </g>
            ))}
          </g>
        </svg>

        {tooltip ? (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+14px)] whitespace-nowrap border bg-background px-3 py-2 text-xs"
            style={{ left: tooltip.left, top: tooltip.top }}
            role="presentation"
          >
            <span className="text-foreground">
              {tooltip.seat.section} · Row {tooltip.seat.row} · Seat {tooltip.seat.number}
            </span>
            <span className="ml-3 text-muted" data-numeral>
              {formatPrice(tooltip.seat.price)}
            </span>
            {tooltip.status !== 'available' ? (
              <span className="ml-3 text-faint">
                {tooltip.status === 'sold' ? 'sold' : 'on hold'}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="absolute bottom-2 right-2 flex flex-col">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => zoomTo(scale * 1.4)}
            disabled={scale >= MAX_SCALE}
            aria-label="Zoom in"
          >
            <Plus aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => zoomTo(scale / 1.4)}
            disabled={scale <= MIN_SCALE}
            aria-label="Zoom out"
          >
            <Minus aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={reset}
            disabled={scale === 1 && pan.x === 0 && pan.y === 0}
            aria-label="Reset zoom"
          >
            <Maximize2 aria-hidden />
          </Button>
        </div>
      </div>

      <Legend tiers={tiers} />
    </div>
  );
}

function Legend({ tiers }: { tiers: ReturnType<typeof priceTiers> }) {
  return (
    <ul className="mx-auto mt-6 flex max-w-[680px] flex-wrap items-center gap-x-6 gap-y-3 border-t pt-5">
      {tiers.map((t) => (
        <li key={t.price} className="flex items-center gap-2">
          <span
            className="size-2 rounded-pill"
            style={{ background: `hsl(var(--tier-${t.tier}))` }}
            aria-hidden
          />
          <span className="text-xs text-foreground" data-numeral>
            {formatPrice(t.price)}
          </span>
          <span className="text-xs text-faint">{t.sections.join(', ')}</span>
        </li>
      ))}
      <li className="flex items-center gap-2">
        <span className="size-2 rounded-pill bg-foreground" aria-hidden />
        <span className="text-xs text-muted">Yours</span>
      </li>
      <li className="flex items-center gap-2">
        <span className="size-2 rounded-pill bg-seat-held" aria-hidden />
        <span className="text-xs text-muted">On hold</span>
      </li>
      <li className="flex items-center gap-2">
        <span className="size-2 rounded-pill bg-seat-sold" aria-hidden />
        <span className="text-xs text-muted">Sold</span>
      </li>
    </ul>
  );
}
