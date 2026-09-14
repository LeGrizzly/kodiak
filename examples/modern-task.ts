import { Kodiak, task } from "../src/presentation/index.js";

// 1. Initialiser Kodiak
const kodiak = new Kodiak({
    connection: { host: "localhost", port: 6379 },
    prefix: "demo-app",
});

// 2. Définir le contrat fortement typé avec options de retries
interface UserWelcomePayload {
    userId: string;
    email: string;
}

export const welcomeEmailTask = task<UserWelcomePayload>({
    name: "welcome-email",
    options: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
    },
});

// 3. Déclaration du worker fluide et sans boilerplate
const worker = kodiak.worker(
    welcomeEmailTask,
    async (job) => {
        console.log(`[Task: ${job.id}] Sending email to ${job.data.email}...`);
        await new Promise((resolve) => setTimeout(resolve, 200));
        console.log(`[Task: ${job.id}] Email sent!`);
    },
    { concurrency: 5, prefetch: 10, heartbeatEnabled: true },
);

await worker.start();

// 4. Production typée (inférence complète du payload)
await kodiak.push(welcomeEmailTask, {
    userId: "user-123",
    email: "mathilde@kodiak.io",
});

await new Promise((resolve) => setTimeout(resolve, 1000));

await worker.stop();
await kodiak.close();
console.log("Worker and connections closed cleanly.");
process.exit(0);
