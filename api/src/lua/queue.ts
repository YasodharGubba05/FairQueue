/**
 * Joining the queue, as one atomic Redis script.
 *
 * Why Lua: handing out a join number is read-then-write (does this user already
 * have one? no? take the next one). Two requests from the same user arriving at
 * the same time would both read "no" and both take a number. Inside a script
 * Redis runs the whole thing with nothing else interleaved, so a user can only
 * ever end up with one number — refresh and reconnect never lose your place.
 */
export const JOIN_QUEUE_LUA = `
local memberKey = KEYS[1]
local nextKey = KEYS[2]
local queueKey = KEYS[3]
local userId = ARGV[1]

-- Already in line: hand back the same number.
local existing = redis.call('GET', memberKey)
if existing then
  return tonumber(existing)
end

-- New joiner: take the next number and record it in join order.
local number = redis.call('INCR', nextKey)
redis.call('SET', memberKey, number)
redis.call('ZADD', queueKey, number, userId)
return number
`;
