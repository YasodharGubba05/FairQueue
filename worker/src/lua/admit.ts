/**
 * Letting the next batch of people in, as one atomic Redis script.
 *
 * `admitted:{event}` is a watermark over join numbers: every number up to and
 * including it has been let in. Admitting means moving the watermark forward by
 * at most `admitPerSec` and giving a pass to whoever sits in the gap. Because
 * the watermark only ever moves forward, and the gap is read by score, people
 * are admitted strictly in the order they joined, and a worker restart in the
 * middle cannot skip anyone or admit the same person twice.
 *
 * Returns { newWatermark, joined, admittedNow }.
 */
export const ADMIT_LUA = `
local admittedKey = KEYS[1]
local nextKey = KEYS[2]
local queueKey = KEYS[3]
local eventId = ARGV[1]
local batch = tonumber(ARGV[2])
local passTtl = tonumber(ARGV[3])

local joined = tonumber(redis.call('GET', nextKey) or '0')
local admitted = tonumber(redis.call('GET', admittedKey) or '0')

-- Nobody waiting: the watermark has already caught up with the last joiner.
if admitted >= joined then
  return { admitted, joined, 0 }
end

local target = math.min(admitted + batch, joined)

-- The gap is (admitted, target]: exclusive on the low end so nobody is
-- admitted twice, inclusive on the high end so nobody is skipped.
local users = redis.call('ZRANGEBYSCORE', queueKey, '(' .. admitted, target)
for i = 1, #users do
  redis.call('SET', 'pass:' .. eventId .. ':' .. users[i], '1', 'EX', passTtl)
end

redis.call('SET', admittedKey, target)
return { target, joined, #users }
`;
