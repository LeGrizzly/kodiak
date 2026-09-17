-- move_waiting_to_delayed.lua
-- Atomically pops the next job from waiting ZSet and moves it to delayed ZSet
-- KEYS[1] = Waiting ZSet ({prefix:queueName}:waiting)
-- KEYS[2] = Delayed ZSet ({prefix:queueName}:delayed)
-- ARGV[1] = Next attempt timestamp in milliseconds

local waitingKey = KEYS[1]
local delayedKey = KEYS[2]
local nextAttempt = tonumber(ARGV[1])

local popped = redis.call('ZPOPMIN', waitingKey, 1)
if not popped or #popped == 0 then
    return nil
end

local jobId = popped[1]
redis.call('ZADD', delayedKey, nextAttempt, jobId)

return {jobId, tostring(nextAttempt)}
