import { EventStatus, Prisma } from '@prisma/client';

/**
 * When an event is visible, and when it can be sold.
 *
 * Both questions are answered here and nowhere else. The rule lives in a
 * Prisma `where` clause rather than in the frontend, because a listing filter
 * that only exists in React is not a rule — anyone can call the API directly.
 *
 * All comparisons are against UTC instants. Postgres stores timestamps without
 * a zone and Prisma hands them over as UTC Dates, so "now" means the same
 * thing in every query regardless of where the server is.
 */

/** Terminal: the event is over or called off, and never comes back. */
export const TERMINAL_STATUSES: EventStatus[] = [EventStatus.COMPLETED, EventStatus.CANCELLED];

export function isTerminal(status: EventStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * The visibility rule for every public listing, search and filter.
 *
 * Keyed on endsAt rather than startsAt: a show that began an hour ago is still
 * on, and dropping it from the listing while people are walking in would be
 * wrong. An event disappears when it is actually over.
 */
export function publicEventFilter(now: Date = new Date()): Prisma.EventWhereInput {
  return {
    status: { notIn: TERMINAL_STATUSES },
    endsAt: { gt: now },
  };
}

/**
 * Whether a sale can take money right now.
 *
 * Separate from visibility on purpose: an event can be visible and not
 * sellable (a sale that has not opened), and an event can be sellable while
 * no longer worth listing. Every booking path asks this one question.
 */
export type BookableRefusal = { status: number; error: string };

export function refusalFor(event: {
  status: EventStatus;
  endsAt: Date;
}): BookableRefusal | null {
  if (event.status === EventStatus.CANCELLED) {
    return { status: 409, error: 'This event has been cancelled' };
  }
  if (event.status === EventStatus.COMPLETED || event.endsAt.getTime() <= Date.now()) {
    // The endsAt check matters as well as the status: the worker sweeps events
    // to COMPLETED on a tick, so for a few seconds an event can be over
    // without being marked yet. Nobody should be able to buy in that window.
    return { status: 409, error: 'This event has already taken place' };
  }
  if (event.status === EventStatus.UPCOMING) {
    return { status: 409, error: 'The sale has not opened yet' };
  }
  if (event.status === EventStatus.SOLD_OUT) {
    return { status: 409, error: 'This event is sold out' };
  }
  return null;
}

/** A show with no published end time is assumed to run for this long. */
export const DEFAULT_DURATION_MS = 3 * 60 * 60 * 1000;

export function defaultEndsAt(startsAt: Date): Date {
  return new Date(startsAt.getTime() + DEFAULT_DURATION_MS);
}
