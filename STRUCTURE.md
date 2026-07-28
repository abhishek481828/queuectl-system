# QueueCTL System - Project Structure & Architecture

```
queuectl-system/
├── STRUCTURE.md             # Production architecture & component layout specifications
├── README.md                # System documentation, CLI command reference & quickstart
├── package.json             # ES Module manifest & binary dependency definitions
├── tests/
│   └── queue.test.js        # Automated unit & integration test suite
├── src/
│   ├── index.js             # Public API entry point
│   ├── cli/
│   │   └── index.js         # Commander.js CLI interface parser (queuectl)
│   ├── config/
│   │   └── index.js         # Configuration defaults & SQLite paths
│   ├── queue/
│   │   └── QueueManager.js  # Core job queue logic with DI & atomic state transitions
│   ├── storage/
│   │   └── SqliteStore.js   # SQLite persistence engine with WAL mode, indexes & transactions
│   ├── worker/
│   │   └── WorkerPool.js    # Resilient worker engine with atomic claim, backoff & signals
│   └── utils/
│       └── logger.js        # Structured JSON logger & telemetry output module
└── data/
    └── queuectl.db          # SQLite production database file
```

---

## Architectural Highlights

1. **ACID Storage (`SqliteStore.js`)**:
   - Uses `better-sqlite3` with Write-Ahead Logging (`PRAGMA journal_mode = WAL`).
   - Indexes on `(status, run_at)` for $O(1)$ pending job queries.
   - Atomic job reservation transactions eliminate double-claiming race conditions.

2. **Resilient Worker Engine (`WorkerPool.js`)**:
   - Atomic claim reservation (`claimNextJob`).
   - Exponential Backoff with Jitter for transient retries (`run_at` scheduling).
   - Startup and periodic stale job recovery for zombie task restoration.
   - POSIX Signal Handlers (`SIGINT`, `SIGTERM`) for graceful in-flight task draining.

3. **Production CLI (`src/cli/index.js`)**:
   - Commander.js command routing with flag parsing (`-c`, `-r`, `--json`, `--verbose`).
   - Structured JSON logging and standardized process exit codes.
