-- token_bucket.lua
-- Atomic Token Bucket rate limiter for DragonflyDB and Redis
-- KEYS[1] = Rate limit hash ({prefix:queueName}:ratelimit)
-- ARGV[1] = capacity (maximum burst tokens)
-- ARGV[2] = refillRatePerMs (refill rate per millisecond)
-- ARGV[3] = now (current timestamp in milliseconds)
-- ARGV[4] = requested (number of tokens requested, default 1)

local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requested = tonumber(ARGV[4]) or 1

local limiter = redis.call('HMGET', key, 'tokens', 'last_refilled_at')
local tokens = tonumber(limiter[1])
local lastRefilled = tonumber(limiter[2])

if not tokens or not lastRefilled then
    tokens = capacity
    lastRefilled = now
else
    local elapsed = math.max(0, now - lastRefilled)
    local generated = elapsed * refillRate
    tokens = math.min(capacity, tokens + generated)
    lastRefilled = now
end

local allowed = 0
local delayNeeded = 0

if tokens >= requested then
    tokens = tokens - requested
    allowed = 1
else
    local needed = requested - tokens
    if refillRate > 0 then
        delayNeeded = math.ceil(needed / refillRate)
    else
        delayNeeded = 1000
    end
end

redis.call('HSET', key, 'tokens', tostring(tokens), 'last_refilled_at', tostring(lastRefilled))
redis.call('PEXPIRE', key, 86400000)

return {allowed, tostring(tokens), tostring(delayNeeded)}
