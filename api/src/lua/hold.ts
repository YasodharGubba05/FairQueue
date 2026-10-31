/**
 * Seat holds, as atomic Redis scripts.
 *
 * Why Lua at all: holding seats is check-then-claim. "Are these four seats all
 * free? Yes? Take them." Between the check and the claim, a thousand other
 * buyers are doing the same thing, and any gap there is a double-sell. Redis
 * runs a script start to finish with nothing interleaved, so the check and the
 * claim cannot come apart.
 *
 * Why all-or-nothing: someone asking for four seats together wants four seats
 * together. Handing them two and failing on the rest would leave them holding
 * seats they do not want while blocking somebody who could use them. So the
 * scripts below check every seat first and only then write anything.
 *
 * The hold keys are built inside the script rather than passed in KEYS, because
 * the seat list is variable length. That is fine on a single Redis; on a
 * cluster these keys would need a hash tag so they all land on one node.
 */

/**
 * Hold every requested seat, or none of them.
 *
 * KEYS: sold set, user's seat set, admission pass, live-hold index
 * ARGV: eventId, userId, maxSeats, holdSeconds, graceSeconds, expiresAtMs,
 *       userSeatsTtl, seatCount, then one argument per seat id
 *
 * Returns { 'OK', count } or { reason, detail }.
 */
export const HOLD_SEATS_LUA = `
local soldKey = KEYS[1]
local userSeatsKey = KEYS[2]
local passKey = KEYS[3]
local holdsKey = KEYS[4]

local eventId = ARGV[1]
local userId = ARGV[2]
local maxSeats = tonumber(ARGV[3])
local holdSeconds = tonumber(ARGV[4])
local graceSeconds = tonumber(ARGV[5])
local expiresAtMs = tonumber(ARGV[6])
local userSeatsTtl = tonumber(ARGV[7])
local seatCount = tonumber(ARGV[8])
local SEATS_START = 8

-- 1. No pass, no seats. This is what stops a bot skipping the line: it can
--    call this endpoint all it likes, but without a pass it gets nothing.
if redis.call('EXISTS', passKey) == 0 then
  return { 'NO_PASS', '' }
end

-- 2. Check every seat before claiming any of them.
local newSeats = 0
for i = 1, seatCount do
  local seatId = ARGV[SEATS_START + i]

  if redis.call('SISMEMBER', soldKey, seatId) == 1 then
    return { 'SOLD', seatId }
  end

  local holder = redis.call('GET', 'hold:' .. eventId .. ':' .. seatId)
  if holder and holder ~= userId then
    return { 'HELD', seatId }
  end

  -- Re-holding a seat you already have must not count against you twice.
  if redis.call('SISMEMBER', userSeatsKey, seatId) == 0 then
    newSeats = newSeats + 1
  end
end

-- 3. The per-user cap counts seats held and seats already bought.
local currentSeats = redis.call('SCARD', userSeatsKey)
if (currentSeats + newSeats) > maxSeats then
  return { 'MAX_SEATS', tostring(maxSeats) }
end

-- 4. Every check passed, so now claim them all.
for i = 1, seatCount do
  local seatId = ARGV[SEATS_START + i]
  -- The lock outlives the logical hold by the grace period, so the worker can
  -- still read the holder when it releases the seat.
  redis.call('SET', 'hold:' .. eventId .. ':' .. seatId, userId, 'EX', holdSeconds + graceSeconds)
  redis.call('ZADD', holdsKey, expiresAtMs, seatId)
  redis.call('SADD', userSeatsKey, seatId)
end
redis.call('EXPIRE', userSeatsKey, userSeatsTtl)

return { 'OK', tostring(seatCount) }
`;

/**
 * Give back seats this user is holding. Seats held by somebody else are left
 * alone, so a stale or malicious request cannot free another buyer's seats.
 *
 * KEYS: user's seat set, live-hold index
 * ARGV: eventId, userId, seatCount, then one argument per seat id
 *
 * Returns the seat ids actually released.
 */
export const RELEASE_SEATS_LUA = `
local userSeatsKey = KEYS[1]
local holdsKey = KEYS[2]

local eventId = ARGV[1]
local userId = ARGV[2]
local seatCount = tonumber(ARGV[3])
local SEATS_START = 3

local released = {}
for i = 1, seatCount do
  local seatId = ARGV[SEATS_START + i]
  local holdKey = 'hold:' .. eventId .. ':' .. seatId
  if redis.call('GET', holdKey) == userId then
    redis.call('DEL', holdKey)
    redis.call('ZREM', holdsKey, seatId)
    redis.call('SREM', userSeatsKey, seatId)
    released[#released + 1] = seatId
  end
end

return released
`;

/**
 * Turn holds into a sale. Called only after the tickets are safely in Postgres:
 * marks the seats sold and drops the holds, so every other buyer's seat map
 * updates and nobody can hold them again.
 *
 * The user's seat set keeps these seats, because seats you have bought still
 * count against your per-user cap.
 *
 * KEYS: sold set, live-hold index
 * ARGV: eventId, seatCount, then one argument per seat id
 */
export const MARK_SOLD_LUA = `
local soldKey = KEYS[1]
local holdsKey = KEYS[2]

local eventId = ARGV[1]
local seatCount = tonumber(ARGV[2])
local SEATS_START = 2

for i = 1, seatCount do
  local seatId = ARGV[SEATS_START + i]
  redis.call('SADD', soldKey, seatId)
  redis.call('DEL', 'hold:' .. eventId .. ':' .. seatId)
  redis.call('ZREM', holdsKey, seatId)
end

return seatCount
`;

/**
 * Confirm this user still holds every one of these seats and that none of them
 * has been sold. Run immediately before writing tickets, so a hold that expired
 * while the buyer was filling in the payment form is caught rather than sold.
 *
 * KEYS: sold set
 * ARGV: eventId, userId, nowMs, seatCount, then one argument per seat id
 */
export const VERIFY_HOLDS_LUA = `
local soldKey = KEYS[1]

local eventId = ARGV[1]
local userId = ARGV[2]
local seatCount = tonumber(ARGV[3])
local SEATS_START = 3

for i = 1, seatCount do
  local seatId = ARGV[SEATS_START + i]

  if redis.call('SISMEMBER', soldKey, seatId) == 1 then
    return { 'SOLD', seatId }
  end

  local holder = redis.call('GET', 'hold:' .. eventId .. ':' .. seatId)
  if not holder then
    return { 'EXPIRED', seatId }
  end
  if holder ~= userId then
    return { 'HELD', seatId }
  end
end

return { 'OK', '' }
`;
