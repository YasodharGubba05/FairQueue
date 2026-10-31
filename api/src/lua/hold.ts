/**
 * Atomic seat hold in Redis via Lua script.
 * Guarantees:
 * 1. User must have an active admission pass.
 * 2. Checks that none of the seats are sold.
 * 3. Checks that none of the seats are held by someone else.
 * 4. Checks maxSeatsPerUser limit.
 * 5. ALL-OR-NOTHING: If all checks pass, holds every seat with 5-minute TTL.
 *    If any check fails, holds none.
 */
export const HOLD_SEATS_LUA = `
local eventId = ARGV[1]
local userId = ARGV[2]
local maxSeats = tonumber(ARGV[3])
local ttlSeconds = tonumber(ARGV[4])
local numSeats = tonumber(ARGV[5])

local soldKey = KEYS[1]
local userSeatsKey = KEYS[2]
local passKey = KEYS[3]

-- 1. Validate admission pass
if redis.call('EXISTS', passKey) == 0 then
  return redis.error_reply('PASS_REQUIRED')
end

-- 2. Validate max seats per user
local currentSeats = tonumber(redis.call('GET', userSeatsKey) or '0')
if (currentSeats + numSeats) > maxSeats then
  return redis.error_reply('MAX_SEATS_EXCEEDED')
end

-- 3. Check every seat: must NOT be sold, and must NOT be held by another user
for i = 1, numSeats do
  local seatId = ARGV[5 + i]
  
  -- Check sold set
  if redis.call('SISMEMBER', soldKey, seatId) == 1 then
    return redis.error_reply('SEAT_SOLD:' .. seatId)
  end
  
  -- Check existing hold
  local holdKey = 'hold:' .. eventId .. ':' .. seatId
  local holder = redis.call('GET', holdKey)
  if holder and holder ~= userId then
    return redis.error_reply('SEAT_HELD:' .. seatId)
  end
end

-- 4. All checks passed: atomically claim all seats
for i = 1, numSeats do
  local seatId = ARGV[5 + i]
  local holdKey = 'hold:' .. eventId .. ':' .. seatId
  redis.call('SET', holdKey, userId, 'EX', ttlSeconds)
end

-- Update user held seats counter with TTL
redis.call('INCRBY', userSeatsKey, numSeats)
redis.call('EXPIRE', userSeatsKey, ttlSeconds)

return 'OK'
`;
