import type { JobOptions } from "../application/dtos/job-options.dto.js";

export interface TaskDefinition<T> {
    name: string;
    options?: JobOptions;
    schema?: { parse: (input: unknown) => T } | ((input: unknown) => T);
}

/**
 * Declares a typed Kodiak task with optional schema validation and default options.
 */
export function task<T>(definition: TaskDefinition<T>): TaskDefinition<T> {
    return definition;
}
