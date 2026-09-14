-- Script to atomically promote delayed jobs to waiting queue
-- KEYS[1]: Delayed Queue ZSet ({prefix:queue}:delayed)
-- KEYS[2]: Waiting Queue ZSet ({prefix:queue}:waiting)
-- KEYS[3]: Notification List ({prefix:queue}:notify)

-- ARGV[1]: Current Timestamp
-- ARGV[2]: Limit (Max jobs to move at once)

local delayedQueue = KEYS[1]
local waitingQueue = KEYS[2]
local notificationQueue = KEYS[3]
local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2]) or 50

local jobs = redis.call('ZRANGEBYSCORE', delayedQueue, '-inf', now, 'LIMIT', 0, limit)
if not jobs or #jobs == 0 then
    return {}
end

for _, jobId in ipairs(jobs) do
    redis.call('ZREM', delayedQueue, jobId)
    local defaultScore = 10 * 10000000000000 + now
    redis.call('ZADD', waitingQueue, defaultScore, jobId)
    if notificationQueue then
        redis.call('LPUSH', notificationQueue, '1')
    end
end

return jobs
