-- Script to atomically complete a job and reschedule if recurring
-- KEYS[1]: Active Queue ZSet ({prefix:queue}:active)
-- KEYS[2]: Job Data Hash ({prefix:queue}:jobs:{jobId})
-- KEYS[3]: Delayed Queue ZSet ({prefix:queue}:delayed)

-- ARGV[1]: Job ID
-- ARGV[2]: Completed At Timestamp (ms)
-- ARGV[3]: Owner Token (optional)

local activeQueue = KEYS[1]
local jobKey = KEYS[2]
local delayedQueue = KEYS[3]

local jobId = ARGV[1]
local completedAt = tonumber(ARGV[2])
local expectedOwner = ARGV[3]

-- Verify lock owner if provided to avoid completing a stolen lock
if expectedOwner and expectedOwner ~= '' then
    local currentOwner = redis.call('HGET', jobKey, 'lock_owner')
    if currentOwner and currentOwner ~= expectedOwner then
        return -1 -- Lock mismatch
    end
end

-- Get recurrence metadata
local jobData = redis.call('HMGET', jobKey, 'repeat_every', 'repeat_limit', 'repeat_count')
local repeatEvery = tonumber(jobData[1])
local repeatLimit = tonumber(jobData[2])
local repeatCount = tonumber(jobData[3]) or 0

-- Remove from active queue
redis.call('ZREM', activeQueue, jobId)

local shouldReschedule = false
if repeatEvery and repeatEvery > 0 then
    if not repeatLimit or repeatCount < (repeatLimit - 1) then
        shouldReschedule = true
    end
end

if shouldReschedule then
    local newRepeatCount = repeatCount + 1
    local nextRun = completedAt + repeatEvery

    redis.call('HSET', jobKey, 'state', 'delayed', 'repeat_count', newRepeatCount, 'completed_at', completedAt)
    redis.call('HDEL', jobKey, 'lock_owner')
    redis.call('ZADD', delayedQueue, nextRun, jobId)
    return 0 -- Rescheduled
else
    redis.call('HSET', jobKey, 'state', 'completed', 'completed_at', completedAt)
    redis.call('HDEL', jobKey, 'lock_owner')
    return 1 -- Completed permanently
end
