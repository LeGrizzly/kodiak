-- Script to atomically release active jobs back to waiting queue on worker stop
-- KEYS[1]: Active Queue ZSet ({prefix:queue}:active)
-- KEYS[2]: Waiting Queue ZSet ({prefix:queue}:waiting)
-- KEYS[3]: Notification List ({prefix:queue}:notify)

-- ARGV[1]: Current timestamp (ms)
-- ARGV[2...]: Job IDs to release

local activeQueue = KEYS[1]
local waitingQueue = KEYS[2]
local notifyQueue = KEYS[3]
local now = tonumber(ARGV[1])

local count = 0
for i = 2, #ARGV do
    local jobId = ARGV[i]
    local removed = redis.call('ZREM', activeQueue, jobId)
    if removed == 1 then
        local score = 10 * 10000000000000 + now
        redis.call('ZADD', waitingQueue, score, jobId)
        if notifyQueue then
            redis.call('LPUSH', notifyQueue, '1')
        end
        count = count + 1
    end
end

return count
