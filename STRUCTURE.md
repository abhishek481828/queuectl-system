# QueueCTL System — Architecture & File Structure Specification

This document provides a detailed technical description of the repository layout, database schemas, data flow pipelines, process lifecycle mechanics, and component responsibilities for **QueueCTL**.

---

## 📁 Repository File Layout

```
queuectl-system/
├── README.md               # Production documentation, quickstart & CLI command reference
├── DECISIONS.md            # Architectural Decision Records (ADR) & 5 Design Questions
├── STRUCTURE.md            # System layout, database schemas & data flow specs
├── package.json            # ES Module manifest, dependencies & bin link (queuectl)
├── package-lock.json       # Locked dependency tree
├── .gitignore              # Ignored files (node_modules, data/*.db, logs)
├── tests/
│   └── queue.test.js       # Automated integration & unit test suite (7/7 passing)
└── src/
    ├── index.js            # Library entry point & public exports
    ├── cli/
    │   └── index.js        # Commander.js CLI parser & contract router
    ├── config/
    │   └── index.js        # Default paths, backoff parameters & environment configs
    ├── queue/
    │   └── QueueManager.js # Job lifecycle manager & storage dependency injection
    ├── storage/
    │   └── SqliteStore.js  # ACID SQLite engine, WAL pragmas, schemas & atomic claims
    ├── worker/
    │   └── WorkerPool.js   # Parallel worker execution engine, backoff calculator & signals
    └── utils/
        └── logger.js       # Structured JSON logger & stream routing (stdout/stderr)
```

---

## 🗄️ Database Schemas & Index Specifications

QueueCTL uses embedded SQLite with Write-Ahead Logging (`PRAGMA journal_mode = WAL;`) and synchronous normal mode (`PRAGMA synchronous = NORMAL;`).

### 1. `jobs` Table
Stores background job definitions, status lifecycle, execution attempts, backoff schedules, and error logs.

```sql
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  command TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  run_at TEXT NOT NULL
);

-- Index for O(1) pending job polling
CREATE INDEX IF NOT EXISTS idx_jobs_state_run_at ON jobs (state, run_at);

-- Index for chronological listing
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs (created_at);
```

### 2. `config` Table
Persists system configuration parameters updated via `queuectl config set`.

```sql
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```
*Default Seed Values*:
- `max-retries` = `'3'`
- `backoff-base` = `'2'`

### 3. `workers` Table
Tracks active worker engine processes across separate OS terminal sessions for heartbeat tracking and cross-process `worker stop` signal delivery.

```sql
CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY,
  pid INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_heartbeat TEXT NOT NULL,
  stop_requested INTEGER NOT NULL DEFAULT 0
);
```

---

## 🔄 Component Responsibilities & Data Flow

```
 ┌────────────────┐
 │ User / CLI     │
 └───────┬────────┘
         │
         │  1. CLI Command Invocation (enqueue, worker start, list, dlq)
         ▼
 ┌────────────────┐
 │  src/cli/      │  Parses options (--json, --count, --state)
 │   index.js     │  Routes inputs to QueueManager or WorkerPool
 └───────┬────────┘
         │
         │  2. Direct API Dispatch
         ▼
 ┌────────────────┐
 │  src/queue/    │  Implements business logic (enqueue, dlqRetry, configSet)
 │ QueueManager.js│  Acts as facade over SqliteStore
 └───────┬────────┘
         │
         │  3. Transactional Operations
         ▼
 ┌────────────────┐         4. Atomic Claim / Heartbeat / Status Update
 │  src/storage/  │◄─────────────────────────────────────────────┐
 │ SqliteStore.js │                                              │
 └───────┬────────┘                                              │
         │                                                       │
         │  5. ACID File I/O                                     │
         ▼                                                       │
 ┌────────────────┐                                              │
 │  SQLite WAL DB │                                              │
 │queuectl.db     │                                              │
 └────────────────┘                                              │
                                                                 │
 ┌────────────────┐                                              │
 │  src/worker/   │  Polled Execution Loop (claimNextJob)        │
 │ WorkerPool.js  ├──────────────────────────────────────────────┘
 └───────┬────────┘
         │
         │  6. Shell Command Execution (child_process.exec)
         ▼
 ┌────────────────┐
 │ OS Child Proc  │  Returns Exit Code 0 (success) or Non-Zero (failure)
 └────────────────┘
```

---

## 🔒 Process Concurrency & Atomic Claim Mechanics

1. **Atomic Transactional Reservation**:
   - `SqliteStore.claimNextJob()` executes inside `db.transaction(...)`.
   - Performs `SELECT id FROM jobs WHERE (state = 'pending' OR state = 'failed') AND run_at <= ? ORDER BY run_at ASC, created_at ASC LIMIT 1`.
   - Executes immediate atomic update `UPDATE jobs SET state = 'processing', attempts = attempts + 1, updated_at = ? WHERE id = ? AND (state = 'pending' OR state = 'failed')`.
   - If Worker 1 claims the job, `result.changes` is 1. If Worker 2 attempts concurrent claim, SQLite serializability forces Worker 2's query to return `result.changes === 0` (job claimed).

2. **Crash Recovery Sweeper**:
   - Sweeper interval runs every 5 seconds checking for tasks stuck in `processing` whose `updated_at` timestamp is older than 20 seconds.
   - Restores stale jobs to `state = 'pending'` with error annotation `Recovered after worker crash / execution timeout`.
   - **Worst-case recovery delay**: $20\text{s} + 5\text{s} + 0.5\text{s} = \mathbf{25.5\text{ seconds}}$ (guaranteed under 60s).

---

## 🧪 Testing Architecture

- **File**: `tests/queue.test.js`
- **Framework**: Node.js Native Test Runner (`node:test`, `node:assert/strict`)
- **Isolation**: Each test suite initializes a temporary test database (`test_queue.db`) and cleans up WAL/SHM handles upon completion.
