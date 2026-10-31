export type EventSummary = {
  id: string;
  name: string;
  venue: string;
  startsAt: string;
  saleOpensAt: string;
  status: 'UPCOMING' | 'LIVE' | 'PAUSED' | 'SOLD_OUT';
  admitPerSec: number;
  maxSeatsPerUser: number;
  totalSeats: number;
  availableSeats: number;
  minPrice: number;
  maxPrice: number;
};

export type QueueState = {
  joinNumber: number | null;
  joined: number;
  admitted: number;
  ahead: number;
  hasPass: boolean;
  passExpiresInSec: number | null;
  admitPerSec: number;
  status: EventSummary['status'];
  maxSeatsPerUser: number;
};

/** The one message the worker broadcasts per event per second. */
export type QueueTick = {
  type: 'queue';
  eventId: string;
  admitted: number;
  joined: number;
  admittedNow: number;
  admitPerSec: number;
  status: EventSummary['status'];
  at: number;
};
