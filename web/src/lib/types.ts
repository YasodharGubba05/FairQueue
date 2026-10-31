export type EventSourceKind = 'SEEDED' | 'TICKETMASTER' | 'VERIFIED';

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

  // Where the real-world details came from. The seats, prices, payment and
  // tickets below are simulated regardless of what this says.
  source: EventSourceKind;
  sourceLabel: string;
  sourceName: string | null;
  sourceUrl: string | null;
  verified: boolean;
  verifiedAt: string | null;
  lastSyncedAt: string | null;
  category: string | null;
  city: string | null;
  country: string | null;
};

export type EventFacets = { categories: string[]; cities: string[] };

export type EventsResponse = { events: EventSummary[]; facets: EventFacets };

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

export type SeatStatus = 'available' | 'held' | 'sold';

export type Seat = {
  id: string;
  section: string;
  row: string;
  number: number;
  price: number;
  x: number;
  y: number;
  status: SeatStatus;
};

/** A batch of seat changes, sent at most four times a second. */
export type SeatsUpdate = {
  type: 'seats';
  eventId: string;
  seats: { id: string; status: SeatStatus }[];
};

export type HoldState = { seatIds: string[]; expiresAt: number | null };

export type OrderDetail = {
  id: string;
  total: number;
  createdAt: string;
  event: { id: string; name: string; venue: string; startsAt: string };
  tickets: {
    id: string;
    seat: { id: string; section: string; row: string; number: number; price: number };
  }[];
};

/** One Mission Control reading, broadcast by the worker once a second. */
export type StatsTick = {
  type: 'stats';
  eventId: string;
  status: EventSummary['status'];
  joined: number;
  admitted: number;
  inQueue: number;
  admitPerSec: number;
  admittedRate: number;
  purchaseRate: number;
  ticketRate: number;
  seatsLeft: number;
  totalSeats: number;
  holds: number;
  purchases: number;
  ticketsSold: number;
  blocked: number;
  noPass: number;
  livePods: number;
  /** Counted in Postgres. The whole project is the claim that this stays 0. */
  oversold: number;
  at: number;
};
