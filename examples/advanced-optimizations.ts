import { jobOptions, Kodiak, task, workerOptions } from "../src/presentation/index.js";

// 1. Initialiser Kodiak avec Auto-Pipelining adaptatif
const kodiak = new Kodiak({
    connection: { host: "localhost", port: 6379 },
    prefix: "opt-demo",
    pipelining: {
        maxBatch: 50,
        maxWaitMs: 1, // micro-intervalle 1ms
    },
});

interface InvoicePayload {
    invoiceId: string;
    amount: number;
    currency: string;
}

const invoiceTask = task<InvoicePayload>("generate-invoice")
    .attempts(3)
    .backoff("exponential", 500);

// 2. Déclaration du worker utilisant le nouveau JobContext enrichi ({ data, logger, updateProgress, heartbeat })
const worker = kodiak.worker(
    invoiceTask,
    async ({ data, logger, updateProgress }) => {
        logger.info(`Processing invoice ${data.invoiceId} for ${data.amount} ${data.currency}`);
        await updateProgress(50);
        await new Promise((resolve) => setTimeout(resolve, 50));
        await updateProgress(100);
        logger.info(`Invoice ${data.invoiceId} generated successfully.`);
    },
    workerOptions().concurrency(5).prefetch(10).heartbeat(true),
);

await worker.start();

// 3. Insertion par micro-batching pipelined avec propagation du W3C traceparent
const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

console.log("Adding 10 jobs in a single tick (auto-pipelined)...");
const pushPromises = Array.from({ length: 10 }).map((_, i) =>
    kodiak.push(
        invoiceTask,
        {
            invoiceId: `INV-2026-00${i + 1}`,
            amount: 150 * (i + 1),
            currency: "EUR",
        },
        jobOptions().traceparent(traceparent),
    ),
);

await Promise.all(pushPromises);
console.log("All 10 jobs queued in pipelined batches!");

await new Promise((resolve) => setTimeout(resolve, 1500));

await worker.stop();
await kodiak.close();
console.log("Demo completed cleanly!");
process.exit(0);
