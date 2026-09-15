# [1.2.0](https://github.com/LeGrizzly/kodiak/compare/v1.1.0...v1.2.0) (2026-09-15)


### Bug Fixes

* change outDir to rootDir in tsconfig.json for correct directory structure ([8dbd6de](https://github.com/LeGrizzly/kodiak/commit/8dbd6dea122fdb50681c9e7b3ae6796b0e0b4728))
* correct import order and add missing comma in worker options ([38a2699](https://github.com/LeGrizzly/kodiak/commit/38a26999af8b8ebd590b97711ca530fc96dd8989))
* correct repository URL in package.json ([5c85233](https://github.com/LeGrizzly/kodiak/commit/5c8523360b74117a7df7a2e3f266e6429fd26e10))
* **format:** standardize string quotes in simple.ts and redis-client.ts ([0e722ff](https://github.com/LeGrizzly/kodiak/commit/0e722ff0d64f6b2b6b25f04c9bc7eea365cdc5d4))
* **lint:** apply lint foramt ([232db2a](https://github.com/LeGrizzly/kodiak/commit/232db2abc4272511ed5611a3e9c32eba87fb11bc))
* **package:** update package name and repository URLs to reflect correct ownership ([c29b17e](https://github.com/LeGrizzly/kodiak/commit/c29b17e75e20be563a432159cbe5be7c1d968082))
* **queue:** implement recovery of stalled jobs in the queue processing - [#33](https://github.com/LeGrizzly/kodiak/issues/33) - [#32](https://github.com/LeGrizzly/kodiak/issues/32) ([7a469aa](https://github.com/LeGrizzly/kodiak/commit/7a469aad4eba838b72ca52c20c8a9633f49258c4))
* **tests:** add integration tests for stalled jobs recovery and enhance queue processing tests ([9cc46b6](https://github.com/LeGrizzly/kodiak/commit/9cc46b678708e72262305eb623106c231c932995))
* **tsconfig:** update sourceMap and declarationMap settings, refine include/exclude patterns ([426876d](https://github.com/LeGrizzly/kodiak/commit/426876d83c40a0de91003ac3f603566e4d81a29c))
* update repository URL format in package.json ([ee38de4](https://github.com/LeGrizzly/kodiak/commit/ee38de4491835b6166b40b96255f96457510d043))
* update schema version and correct file includes in biome configuration ([6758199](https://github.com/LeGrizzly/kodiak/commit/67581998e26858a998a7ccac5ee1296d92a6b229))
* **workflow:** add workflows key to workflow_run for clarity in publish.yml ([fed24b1](https://github.com/LeGrizzly/kodiak/commit/fed24b1111e101c55a348fc0780fc4b0bd61f9df))
* **workflow:** change trigger from push to workflow_run for npm publish ([95137c2](https://github.com/LeGrizzly/kodiak/commit/95137c205f191b0e6aa0a2265a45f8b6f925db72))


### Features

* add benchmark scripts and analysis for Kodiak and DragonflyDB ([f30283e](https://github.com/LeGrizzly/kodiak/commit/f30283e1dfb7a64c33a67ab49086710083441df3))
* add examples for advanced optimizations, modern task, simple job processing, and TCP broker demo ([56d5c1f](https://github.com/LeGrizzly/kodiak/commit/56d5c1fb8180ab741676adcbc5ae31bb326f0a6f))
* add exports field and update build script for improved module resolution ([2abb29c](https://github.com/LeGrizzly/kodiak/commit/2abb29c7d3d3d891aeee8828076059ba5e143978))
* add GitHub Actions workflow for npm package publishing and update repository type in package.json ([e2f1bc5](https://github.com/LeGrizzly/kodiak/commit/e2f1bc5802da4b0d822868e636b6541a87222b86))
* add MsgpackJobSerializer for efficient job serialization ([442b46c](https://github.com/LeGrizzly/kodiak/commit/442b46c1f418dff601b89c7334dad29bd3754fe5))
* add TypeScript configuration files for improved project structure and type safety ([1a21382](https://github.com/LeGrizzly/kodiak/commit/1a213825456a9de0c2c995453ebb55bcdbcd0d8c))
* **example:** update import paths and enhance job processing with error simulation ([dc80216](https://github.com/LeGrizzly/kodiak/commit/dc802163ce08a44a8eb4983247f9dccef3fb05c5))
* implement FetchJobsUseCase and integrate with RedisQueueRepository for job fetching ([d5cd370](https://github.com/LeGrizzly/kodiak/commit/d5cd370ec98f73b2782dacbe53c52940f909b4d2))
* implement RedisClient singleton for centralized Redis connection management ([d118dfc](https://github.com/LeGrizzly/kodiak/commit/d118dfc8438173cb88fbc6bef0b7e0af4ec6659c))
* migrate CI/CD workflows to use Bun for dependency management and script execution ([f39d49c](https://github.com/LeGrizzly/kodiak/commit/f39d49cf875d152ff8d41712e23c9e0ed8e5ea6e))
* **tests:** enhance unit tests for job processing and semaphore functionality ([3b4a078](https://github.com/LeGrizzly/kodiak/commit/3b4a07813e2e5c059f21a14f35e60b8b2dbb3ebd))
* **tests:** enhance unit tests for various components ([067ac44](https://github.com/LeGrizzly/kodiak/commit/067ac445e3a058e618d4ba9fe2abc872d2c1dc4f))
* **tests:** enhance worker and redis queue tests with error handling and heartbeat functionality ([f09b548](https://github.com/LeGrizzly/kodiak/commit/f09b548630d70705d031e251c4eff1a9662a0759))
* **tsconfig:** update TypeScript configuration for ES2024 and enhance module resolution ([a1a51c7](https://github.com/LeGrizzly/kodiak/commit/a1a51c7705f8050cf2744b0e42ccd22d1a2d47e0))
* **worker:** enhance worker options with heartbeat configuration ([c8a78a3](https://github.com/LeGrizzly/kodiak/commit/c8a78a33e291b23397251a4d6e757baa66d1fcfc))
* **worker:** implement heartbeat mechanism for job lock extension ([47d8a83](https://github.com/LeGrizzly/kodiak/commit/47d8a8363244a4eb0d7c20409d03c3f7a700cd45))

# [1.1.0](https://github.com/xalsie/kodiak/compare/v1.0.0...v1.1.0) (2026-01-16)


### Bug Fixes

* enhance type safety by adding type annotations for job data in simple.ts ([973c8d6](https://github.com/xalsie/kodiak/commit/973c8d676a42c8b50b7a3bf5e54f2183f1a4654d))
* enhance type safety in RedisQueueRepository and related tests by refining type assertions and removing unnecessary ignores ([5e9eb8f](https://github.com/xalsie/kodiak/commit/5e9eb8ff1991c5a8d69c6bb399eec1eb096e3922))
* heap out of memory ([f02114f](https://github.com/xalsie/kodiak/commit/f02114f156717c215535c0ae718e57ce842f897b))
* update authentication tokens for GitHub Packages in CI/CD and package configuration ([5408f58](https://github.com/xalsie/kodiak/commit/5408f58d63d86eaf6fc81e4b5bab2e4f0489bbc4))
* update failJobUseCase to use job ID instead of job object ([653a005](https://github.com/xalsie/kodiak/commit/653a00520fa445e05047b6c9e4dcf06ab87282da))
* update ioredis and @types/node dependencies to latest versions ([2263803](https://github.com/xalsie/kodiak/commit/226380306c73fb42f5d7445c8b45179480455ce9))
* update README with correct package name and logo URL, enhance type safety in examples ([8827835](https://github.com/xalsie/kodiak/commit/88278355fee8c2bd25774b913f8730cd0c67a9da))


### Features

* add GitHub Actions workflows for npm publishing and configure package settings ([d3dc7fa](https://github.com/xalsie/kodiak/commit/d3dc7fa7cf024def14f214afda69fe17b64c6ea6))
* add job progress tracking and update functionality ([7b3535b](https://github.com/xalsie/kodiak/commit/7b3535b267e950731d19c53be410cd85cd0d8e22))
* add support for recurring jobs with repeat options in job configurations and Lua scripts ([3a8674d](https://github.com/xalsie/kodiak/commit/3a8674d668b77338772b8af42181806d859e724a))
* add unit tests for AddJobUseCase and Queue, enhance RedisQueueRepository tests with timeout handling and backoff options ([139dd77](https://github.com/xalsie/kodiak/commit/139dd7765fef099eee239cd17892f3121d42cb9f))
* add updateProgress functionality to job handling and tests ([27e9e11](https://github.com/xalsie/kodiak/commit/27e9e1127728cff4eed14258e61ab8379d5a9ef0))
* enhance email worker to track and report job progress ([f427d14](https://github.com/xalsie/kodiak/commit/f427d1429123b1b6d36378139a93d898ce1c866e))
* implement automatic job retries with backoff strategy and promote delayed jobs - [#20](https://github.com/xalsie/kodiak/issues/20) ([6f383aa](https://github.com/xalsie/kodiak/commit/6f383aa4f7238325d3264158a4e906c601fcfc75))
* implement custom backoff strategy and recurring jobs - [#23](https://github.com/xalsie/kodiak/issues/23) ([8b1c433](https://github.com/xalsie/kodiak/commit/8b1c433f472877556e8145a7e6c8210aed4272f5))
* implement Fetch Job mechanism - [#3](https://github.com/xalsie/kodiak/issues/3) ([99573cd](https://github.com/xalsie/kodiak/commit/99573cdb5c0c452fb187cd6a316e6f849083d707)), closes [#4](https://github.com/xalsie/kodiak/issues/4) [#5](https://github.com/xalsie/kodiak/issues/5) [#6](https://github.com/xalsie/kodiak/issues/6) [#7](https://github.com/xalsie/kodiak/issues/7) [#8](https://github.com/xalsie/kodiak/issues/8) [#9](https://github.com/xalsie/kodiak/issues/9) [#17](https://github.com/xalsie/kodiak/issues/17) [#18](https://github.com/xalsie/kodiak/issues/18)

# 1.0.0 (2026-01-13)


### Bug Fixes

* trigger initial release ([6a3701f](https://github.com/xalsie/kodiak/commit/6a3701fdb78b9396537d3baf1df805cddde55fb0))
