const Queue = require("bee-queue");

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function runBenchmark(jobCount, concurrency) {
    const queueName = `bench-${jobCount}-${concurrency}-${Date.now()}`;
    console.log(`Creating bee-queue '${queueName}' with concurrency=${concurrency}`);
    const q = new Queue(queueName, {
        redis: { host: "127.0.0.1", port: 6378 },
    });

    // Instrumentation / verbose logs for debugging
    // q.on('error', (err) => console.error(`[bee-queue:${queueName}] error:`, err && err.message ? err.message : err));
    q.on("ready", () => console.log(`[bee-queue:${queueName}] ready`));
    // q.on('succeeded', (job, result) => console.log(`[bee-queue:${queueName}] job succeeded id=${job.id}`));
    // q.on('failed', (job, err) => console.warn(`[bee-queue:${queueName}] job failed id=${job.id} err=${err && err.message ? err.message : err}`));
    // q.on('retrying', (job, err) => console.log(`[bee-queue:${queueName}] job retrying id=${job.id} err=${err && err.message ? err.message : err}`));
    // q.on('drain', () => console.log(`[bee-queue:${queueName}] drain`));
    // q.on('stalled', (jobId) => console.warn(`[bee-queue:${queueName}] stalled job id=${jobId}`));

    let completed = 0;

    // Minimal worker
    console.log(`[bee-queue:${queueName}] registering processor (concurrency=${concurrency})`);
    q.process(concurrency, async (job) => {
        // do minimal work
        return;
    });
    console.log(`[bee-queue:${queueName}] processor registered`);

    // Global succeeded event
    q.on("succeeded", () => {
        completed++;
    });

    const start = Date.now();

    // Add jobs (fire-and-forget style but await save to avoid overwhelming startup)
    console.log(`[bee-queue:${queueName}] adding ${jobCount} jobs`);
    const startAdd = Date.now();
    for (let i = 0; i < jobCount; i++) {
        await q.createJob({ value: i }).save();
    }
    const elapsedAdd = Date.now() - startAdd;
    console.log(`[bee-queue:${queueName}] finished adding ${jobCount} jobs in ${elapsedAdd} ms`);

    // wait until all completed or timeout (60s)
    const timeoutMs = 60000;
    const deadline = Date.now() + timeoutMs;
    while (completed < jobCount && Date.now() < deadline) {
        await sleep(1);
    }

    const elapsed = Date.now() - start;

    const startClose = Date.now();
    try {
        console.log(`[bee-queue:${queueName}] closing queue`);
        await q.close(1000);
        const elapsedClose = Date.now() - startClose;
        console.log(`[bee-queue:${queueName}] close took ${elapsedClose} ms`);
    } catch (e) {
        console.error(`[bee-queue:${queueName}] close error:`, e && e.message ? e.message : e);
    }

    return elapsed;
}

async function main() {
    const startTime = Date.now();

    const jobCounts = [10, 100, 1_000, 10_000];
    const concurrencies = [1, 5, 10];
    const results = [];

    for (const jobs of jobCounts) {
        for (const c of concurrencies) {
            console.log(`Running benchmark: jobs=${jobs} concurrency=${c}`);
            const ms = await runBenchmark(jobs, c);
            console.log(`-> ${ms} ms`);
            results.push({ jobs, concurrency: c, ms });
            // small pause between runs
            // await sleep(200);
        }
    }

    console.log("\nSummary:");
    console.table(results);

    const totalElapsed = Date.now() - startTime;
    console.log(`Total elapsed time: ${totalElapsed} ms`);

    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
