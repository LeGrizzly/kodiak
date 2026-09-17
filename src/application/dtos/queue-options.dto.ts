import type { IJobSerializer } from "../../domain/serializers/job-serializer.interface.js";
import type { PipeliningOptions } from "../../infrastructure/dragonfly/dragonfly-queue.repository.js";
import type { RateLimiterOptions } from "./rate-limiter-options.dto.js";

/**
 * Options for configuring a Kodiak Queue instance.
 */
export interface QueueOptions {
    serializer?: IJobSerializer;
    pipelining?: PipeliningOptions;
    rateLimiter?: RateLimiterOptions;
    limiter?: RateLimiterOptions;
}
