-- Script to atomically detect and recover stalled jobs
-- A job is stalled if its lock expiration timestamp (score) in active ZSet is <= now
-- KEYS[1]: Active Queue ZSet ({prefix:queue}:active)
-- KEYS[2]: Waiting Queue ZSet ({prefix:queue}:waiting)
-- KEYS[3]: Notification List ({prefix:queue}:notify)

-- ARGV[1]: Current timestamp (ms)
-- ARGV[2]: Limit (max stalled jobs to check, default 100)

local activeQueue = KEYS[1]
local waitingQueue = KEYS[2]
local notifyQueue = KEYS[3]
local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2]) or 100

local stalled = redis.call('ZRANGEBYSCORE', activeQueue, '-inf', now, 'LIMIT', 0, limit)
if not stalled or #stalled == 0 then
    return {}
end

local recovered = {}
for _, jobId in ipairs(stalled) do
    redis.call('ZREM', activeQueue, jobId)
    local defaultScore = 10 * 10000000000000 + now
    redis.call('ZADD', waitingQueue, defaultScore, jobId)
    if notifyQueue then
        redis.call('LPUSH', notifyQueue, '1')
    end
    table.insert(recovered, jobId)
end

return recovered
