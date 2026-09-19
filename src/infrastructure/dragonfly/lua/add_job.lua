-- Script to atomically add a job with optional deduplication
-- KEYS[1]: Waiting Queue ZSet ({prefix:queue}:waiting)
-- KEYS[2]: Delayed Queue ZSet ({prefix:queue}:delayed)
-- KEYS[3]: Job Data Hash ({prefix:queue}:jobs:{jobId})
-- KEYS[4]: Notification List ({prefix:queue}:notify)
-- KEYS[5]: Deduplication Key ({prefix:queue}:dedup:{dedupId}) [Optional]

-- ARGV[1]: Job ID
-- ARGV[2]: Score (priority/timestamp)
-- ARGV[3]: Is Delayed ('1' or '0')
-- If #KEYS >= 5 and KEYS[5] ~= '':
--   ARGV[4]: Deduplication TTL in ms ('0' or empty for no expiration)
--   ARGV[5...]: Field, Value pairs for Job Hash
-- Else:
--   ARGV[4...]: Field, Value pairs for Job Hash

local jobId = ARGV[1]
local score = tonumber(ARGV[2])
local isDelayed = ARGV[3]

local hasDedup = #KEYS >= 5 and KEYS[5] ~= ''
local fieldsStart = 4

if hasDedup then
    local dedupKey = KEYS[5]
    local dedupTtl = tonumber(ARGV[4])
    fieldsStart = 5

    local acquired = false
    if dedupTtl and dedupTtl > 0 then
        acquired = redis.call('SET', dedupKey, jobId, 'NX', 'PX', dedupTtl)
    else
        acquired = redis.call('SET', dedupKey, jobId, 'NX')
    end

    if not acquired then
        local existingJobId = redis.call('GET', dedupKey)
        return { 0, existingJobId or jobId }
    end
end

-- Atomically set job state and fields
redis.call('HSET', KEYS[3], 'state', isDelayed == '1' and 'delayed' or 'waiting', unpack(ARGV, fieldsStart))

if isDelayed == '1' then
    redis.call('ZADD', KEYS[2], score, jobId)
else
    redis.call('ZADD', KEYS[1], score, jobId)
    redis.call('LPUSH', KEYS[4], '1')
end

if hasDedup then
    return { 1, jobId }
else
    return jobId
end
