import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.API_URL || 'http://localhost:4000';
const EVENT_ID = 'evt_headline';

export const options = {
  scenarios: {
    hot_seats: {
      executor: 'shared-iterations',
      vus: 100,
      iterations: 500,
      maxDuration: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<1.0'], // allow failures since seats will run out
  },
};

// Target the first 50 floor seats
const HOT_SEATS = [
  ...Array.from({ length: 24 }, (_, i) => `s_evt-headline_floor_A${i + 1}`),
  ...Array.from({ length: 26 }, (_, i) => `s_evt-headline_floor_B${i + 1}`),
];

export function setup() {
  // Pre-authenticate 50 sample buyers to get JWT tokens
  const tokens = [];
  for (let i = 1; i <= 50; i++) {
    const num = String(i).padStart(4, '0');
    const email = `buyer${num}@fairqueue.dev`;
    const res = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({ email, password: 'password123' }),
      { headers: { 'Content-Type': 'application/json' } }
    );
    if (res.status === 200) {
      tokens.push(res.json('token'));
    }
  }
  return { tokens };
}

export default function (data) {
  const token = data.tokens[__VU % data.tokens.length];
  const seatId = HOT_SEATS[Math.floor(Math.random() * HOT_SEATS.length)];

  const res = http.post(
    `${BASE_URL}/api/events/${EVENT_ID}/checkout`,
    JSON.stringify({ seatIds: [seatId] }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    }
  );

  check(res, {
    'status is 201 or 409': (r) => r.status === 201 || r.status === 409,
  });
}
