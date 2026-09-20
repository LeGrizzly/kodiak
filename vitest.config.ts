import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        include: ["tests/**/*.test.ts"],
        testTimeout: 15000,
        coverage: {
            provider: "v8",
            reporter: ["text", "json", "html", "lcov"],
            include: ["src/**/*.ts"],
            exclude: [
                "src/**/*.interface.ts",
                "src/**/*.dto.ts",
                "src/domain/entities/job.entity.ts",
                "src/domain/strategies/backoff.strategy.ts",
                "src/domain/repositories/queue.repository.ts",
                "src/infrastructure/dragonfly/index.ts",
                "src/presentation/index.ts",
            ],
            thresholds: {
                branches: 100,
                functions: 100,
                lines: 100,
                statements: 100,
            },
        },
    },
});
