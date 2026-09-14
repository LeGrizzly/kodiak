-- Script to atomically fail a job with retry and Dead-Letter Queue (DLQ) support
-- KEYS[1]: Active Queue ZSet ({prefix:queue}:active)
-- KEYS[2]: Job Data Hash ({prefix:queue}:jobs:{jobId})
-- KEYS[3]: Delayed Queue ZSet ({prefix:queue}:delayed)
-- KEYS[4]: Dead-Letter Queue / DLQ ZSet ({prefix:queue}:dead)

-- ARGV[1]: Job ID
-- ARGV[2]: Error Message
-- ARGV[3]: Failed At Timestamp (ms)
-- ARGV[4]: Forced Next Attempt (-1 if auto)
-- ARGV[5]: Owner Token (optional)
-- ARGV[6]: Error Stack Trace (optional)

local activeQueue = KEYS[1]
local jobKey = KEYS[2]
local delayedQueue = KEYS[3]
local deadQueue = KEYS[4]

local jobId = ARGV[1]
local errorMsg = ARGV[2]
local failedAt = tonumber(ARGV[3])
local forcedNextAttempt = tonumber(ARGV[4]) or -1
local expectedOwner = ARGV[5]
local errorStack = ARGV[6] or ''

-- Verify lock owner if provided
if expectedOwner and expectedOwner ~= '' then
    local currentOwner = redis.call('HGET', jobKey, 'lock_owner')
    if currentOwner and currentOwner ~= expectedOwner then
        return -1 -- Lock mismatch
    end
end

-- Get retry configuration and previous error
local jobData = redis.call('HMGET', jobKey, 'retry_count', 'max_attempts', 'backoff_type', 'backoff_delay', 'error', 'failed_at')
local retryCount = tonumber(jobData[1]) or 0
local maxAttempts = tonumber(jobData[2]) or 1
local backoffType = jobData[3]
local backoffDelay = tonumber(jobData[4]) or 0
local prevError = jobData[5]
local prevFailedAt = jobData[6]

-- Remove from active queue regardless of outcome
redis.call('ZREM', activeQueue, jobId)
redis.call('HDEL', jobKey, 'lock_owner')

local updateFields = {
    'error', errorMsg,
    'failed_at', failedAt,
    'error_stack', string.sub(errorStack, 1, 1024)
}

if prevError and prevError ~= '' and prevError ~= errorMsg then
    table.insert(updateFields, 'prev_error')
    table.insert(updateFields, prevError)
    if prevFailedAt then
        table.insert(updateFields, 'prev_failed_at')
        table.insert(updateFields, prevFailedAt)
    end
end

if retryCount < (maxAttempts - 1) then
    -- RETRY THE JOB
    local newRetryCount = retryCount + 1
    local nextAttempt = failedAt

    if forcedNextAttempt > 0 then
        nextAttempt = forcedNextAttempt
    else
        if backoffType == 'fixed' then
            nextAttempt = failedAt + backoffDelay
        elseif backoffType == 'exponential' then
            nextAttempt = failedAt + (backoffDelay * (2 ^ (newRetryCount - 1)))
        else
            nextAttempt = failedAt
        end
    end

    table.insert(updateFields, 'state')
    table.insert(updateFields, 'delayed')
    table.insert(updateFields, 'retry_count')
    table.insert(updateFields, newRetryCount)

    redis.call('HSET', jobKey, unpack(updateFields))
    redis.call('ZADD', delayedQueue, nextAttempt, jobId)
    return 0 -- Indicates job was scheduled for retry
else
    -- FAIL PERMANENTLY AND MOVE TO DLQ
    table.insert(updateFields, 'state')
    table.insert(updateFields, 'failed')

    redis.call('HSET', jobKey, unpack(updateFields))
    if deadQueue then
        redis.call('ZADD', deadQueue, failedAt, jobId)
    end
    return 1 -- Indicates job failed permanently
end
