-- Script to atomically fetch a single job (Wait -> Active)
-- KEYS[1]: Waiting Queue ZSet ({prefix:queue}:waiting)
-- KEYS[2]: Active Queue ZSet ({prefix:queue}:active)
-- KEYS[3]: Notification List ({prefix:queue}:notify)

-- ARGV[1]: Current timestamp
-- ARGV[2]: Lock duration (ms, default 30000)
-- ARGV[3]: Should Pop Token ('1' = yes, '0' = no)

local result = redis.call('ZPOPMIN', KEYS[1], 1)
if not result or #result == 0 then
    return nil
end

local jobId = result[1]
local now = tonumber(ARGV[1])
local lockDuration = tonumber(ARGV[2]) or 30000
local lockExpiresAt = now + lockDuration
redis.call('ZADD', KEYS[2], lockExpiresAt, jobId)

if ARGV[3] == '1' and KEYS[3] then
    redis.call('LPOP', KEYS[3])
end

return jobId
