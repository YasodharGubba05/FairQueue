/**
 * Rate limiting, as one atomic Redis script.
 *
 * A fixed window counter: the key carries the window it belongs to, so it ages
 * out on its own and there is no sweeping to do. Crude compared to a sliding
 * window, but it is two integers and anyone can see what it does — which is
 * the right trade for a limiter that runs in front of every write.
 *
 * Why Lua: INCR then EXPIRE as two commands leaves a window where the counter
 * exists with no expiry. Crash there and that key never resets — the user is
 * rate limited forever. In a script the two cannot come apart.
 *
 * Both the account and the IP are checked in one round trip. The account limit
 * does the real work; the IP limit is a backstop and is deliberately loose,
 * because a whole office or phone network shares one address.
 *
 * KEYS: user counter, ip counter
 * ARGV: userLimit, ipLimit, windowSeconds
 *
 * Returns { blocked, scope } where scope says which limit tripped.
 */
export const RATE_LIMIT_LUA = `
local userKey = KEYS[1]
local ipKey = KEYS[2]
local userLimit = tonumber(ARGV[1])
local ipLimit = tonumber(ARGV[2])
local windowSeconds = tonumber(ARGV[3])

local userCount = redis.call('INCR', userKey)
if userCount == 1 then
  redis.call('EXPIRE', userKey, windowSeconds)
end

local ipCount = redis.call('INCR', ipKey)
if ipCount == 1 then
  redis.call('EXPIRE', ipKey, windowSeconds)
end

if userCount > userLimit then
  return { 1, 'user' }
end
if ipCount > ipLimit then
  return { 1, 'ip' }
end

return { 0, '' }
`;
