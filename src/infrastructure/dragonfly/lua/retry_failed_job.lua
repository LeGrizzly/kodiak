-- Script to atomically retry a failed job from the Dead-Letter Queue (DLQ)
-- KEYS[1]: Dead Queue ZSet ({prefix:queue}:dead)
-- KEYS[2]: Waiting Queue ZSet ({prefix:queue}:waiting)
-- KEYS[3]: Notification List ({prefix:queue}:notify)
-- KEYS[4]: Job Data Hash ({prefix:queue}:jobs:{jobId})

-- ARGV[1]: Job ID
-- ARGV[2]: Current Timestamp (ms)

local deadQueue = KEYS[1]
local waitingQueue = KEYS[2]
local notifyQueue = KEYS[3]
local jobKey = KEYS[4]

local jobId = ARGV[1]
local now = tonumber(ARGV[2])

-- Verify job exists in the dead-letter queue
local score = redis.call('ZSCORE', deadQueue, jobId)
if not score then
    return 0
end

-- Atomically remove from dead-letter queue
redis.call('ZREM', deadQueue, jobId)

-- Compute waiting priority score
local priority = tonumber(redis.call('HGET', jobKey, 'priority')) or 10
local waitingScore = priority * 10000000000000 + now

-- Reset state and error metadata on the job hash
redis.call('HSET', jobKey, 'state', 'waiting', 'retry_count', '0')
redis.call('HDEL', jobKey, 'error', 'error_stack', 'failed_at', 'prev_error', 'prev_failed_at', 'lock_owner')

-- Re-enqueue to waiting queue
redis.call('ZADD', waitingQueue, waitingScore, jobId)

-- Wake up waiting consumers
if notifyQueue and notifyQueue ~= '' then
    redis.call('LPUSH', notifyQueue, '1')
end

return 1
