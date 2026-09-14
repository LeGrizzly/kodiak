-- Script to atomically multi-pop jobs from waiting to active with lock expiration
-- KEYS[1] = Waiting ZSet ({prefix:queue}:waiting)
-- KEYS[2] = Active ZSet ({prefix:queue}:active)

-- ARGV[1] = Batch count
-- ARGV[2] = Lock expiration timestamp (ms)

local count = tonumber(ARGV[1]) or 1
local lockExpiresAt = tonumber(ARGV[2])

if count <= 0 then
    return {}
end

-- Use native ZPOPMIN with count supported by Dragonfly
local popped = redis.call('ZPOPMIN', KEYS[1], count)
if not popped or #popped == 0 then
    return {}
end

local jobIds = {}
for i = 1, #popped, 2 do
    local jobId = popped[i]
    redis.call('ZADD', KEYS[2], lockExpiresAt, jobId)
    table.insert(jobIds, jobId)
end

return jobIds
