Benchmark bee-queue

1) Start a Redis 2.8 instance with Docker (PowerShell / cmd):

```powershell
docker run -d --name redis-2.8 -p 6379:6379 redis:2.8
```

2) From `examples/benchmark_beequeue` install deps and run:

```powershell
npm install
npm run bench
```

Notes:
- The script `benchmark.js` runs the same scenarios as the Kodiak benchmark: combinations of job counts and concurrencies.
- If Docker is not available, point Redis to another host by editing `benchmark.js` Redis connection.
