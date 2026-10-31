/**
 * Releasing holds that ran out, as one atomic Redis script.
 *
 * A seat hold is a Redis key with a TTL, and Redis does not tell anyone when a
 * key expires. If we left it at that, a seat would quietly become free with no
 * seat map anywhere noticing, and the buyer staring at it would keep seeing
 * grey. So every hold is also indexed in a sorted set scored by the moment it
 * runs out, and the worker sweeps that index once a second.
 *
 * The lock key is set to outlive its logical expiry by a grace period, so the
 * sweep can still read who held the seat and take it out of their seat count.
 *
 * KEYS: live-hold index
 * ARGV: eventId, nowMs, limit
 *
 * Returns the seat ids released, so the caller can tell every browser.
 */
export const EXPIRE_HOLDS_LUA = `
local holdsKey = KEYS[1]

local eventId = ARGV[1]
local nowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])

-- Everything scored at or before now has run out. The limit keeps one tick
-- bounded, so a huge backlog is worked through over several ticks instead of
-- blocking Redis in a single script.
local expired = redis.call('ZRANGEBYSCORE', holdsKey, '-inf', nowMs, 'LIMIT', 0, limit)

local released = {}
for i = 1, #expired do
  local seatId = expired[i]
  local holdKey = 'hold:' .. eventId .. ':' .. seatId

  local holder = redis.call('GET', holdKey)
  if holder then
    redis.call('DEL', holdKey)
    -- The seat no longer counts against whoever was holding it.
    redis.call('SREM', 'userseats:' .. eventId .. ':' .. holder, seatId)
  end

  redis.call('ZREM', holdsKey, seatId)
  released[#released + 1] = seatId
end

return released
`;
