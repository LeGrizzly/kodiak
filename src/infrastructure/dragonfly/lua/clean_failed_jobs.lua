-- Script to atomically clean/purge jobs from the Dead-Letter Queue (DLQ)
-- KEYS[1]: Dead Queue ZSet ({prefix:queue}:dead)

-- ARGV[1]: Max failed_at timestamp (remove jobs with score <= maxTimestamp, or '+inf' for all)
-- ARGV[2]: Job key prefix ({prefix:queue}:jobs:)
-- ARGV[3]: Limit (max jobs to purge in a single invocation)

local deadQueue = KEYS[1]
local maxTimestamp = ARGV[1]
local prefix = ARGV[2]
local limit = tonumber(ARGV[3]) or 500

local jobIds
if maxTimestamp == '+inf' then
    jobIds = redis.call('ZRANGE', deadQueue, 0, limit - 1)
else
    local maxTs = tonumber(maxTimestamp) or 0
    jobIds = redis.call('ZRANGEBYSCORE', deadQueue, '-inf', maxTs, 'LIMIT', 0, limit)
end

if not jobIds or #jobIds == 0 then
    return 0
end

local count = 0
for _, jobId in ipairs(jobIds) do
    redis.call('ZREM', deadQueue, jobId)
    redis.call('DEL', prefix .. jobId)
    count = count + 1
end

return count
