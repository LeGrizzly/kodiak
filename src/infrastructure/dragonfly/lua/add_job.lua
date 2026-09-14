-- Script to atomically add a job
-- KEYS[1]: Waiting Queue ZSet ({prefix:queue}:waiting)
-- KEYS[2]: Delayed Queue ZSet ({prefix:queue}:delayed)
-- KEYS[3]: Job Data Hash ({prefix:queue}:jobs:{jobId})
-- KEYS[4]: Notification List ({prefix:queue}:notify)

-- ARGV[1]: Job ID
-- ARGV[2]: Score (priority/timestamp)
-- ARGV[3]: Is Delayed ('1' or '0')
-- ARGV[4...]: Field, Value pairs for Job Hash

local jobId = ARGV[1]
local score = tonumber(ARGV[2])
local isDelayed = ARGV[3]

-- Atomically set job state and fields
redis.call('HSET', KEYS[3], 'state', isDelayed == '1' and 'delayed' or 'waiting', unpack(ARGV, 4))

if isDelayed == '1' then
    redis.call('ZADD', KEYS[2], score, jobId)
else
    redis.call('ZADD', KEYS[1], score, jobId)
    redis.call('LPUSH', KEYS[4], '1')
end

return jobId
