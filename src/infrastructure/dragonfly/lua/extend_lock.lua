-- Script to atomically extend lock lease on an active job
-- KEYS[1] = Active Queue ZSet ({prefix:queue}:active)
-- KEYS[2] = Job Data Hash ({prefix:queue}:jobs:{jobId})

-- ARGV[1] = Job ID
-- ARGV[2] = New lock expiration timestamp (ms)
-- ARGV[3] = Owner Token (workerId:slot)

local activeQueue = KEYS[1]
local jobKey = KEYS[2]
local jobId = ARGV[1]
local newExpiry = tonumber(ARGV[2])
local ownerToken = ARGV[3]

-- Check if job is present in active set
local score = redis.call('ZSCORE', activeQueue, jobId)
if not score then
    return 0
end

-- If ownerToken provided, verify it matches job hash 'lock_owner'
if ownerToken and ownerToken ~= '' then
    local currentOwner = redis.call('HGET', jobKey, 'lock_owner')
    if not currentOwner or currentOwner ~= ownerToken then
        return 0
    end
end

redis.call('ZADD', activeQueue, newExpiry, jobId)
return 1
