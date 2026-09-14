-- Script to atomically update job progress
-- KEYS[1]: Job Data Hash ({prefix:queue}:jobs:{jobId})
-- ARGV[1]: Progress Value (number)

local jobKey = KEYS[1]
local progress = ARGV[1]

if redis.call('EXISTS', jobKey) == 1 then
    redis.call('HSET', jobKey, 'progress', progress)
    return 0
else
    return -1
end
