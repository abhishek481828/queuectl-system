# QueueCTL — Production Background Job Queue System

A production-grade, CLI-driven background job queue system built with **Node.js**, **SQLite (`better-sqlite3`)**, and **Commander.js**.

The system manages background shell execution jobs with parallel worker processes, retries failures with exponential backoff ($\text{delay} = \text{base}^{\text{attempts}}$ seconds), maintains a Dead Letter Queue (DLQ) for permanently failed jobs (`state = 'dead'`), and guarantees crash recovery under 60 seconds.

---

## Key Features

- ⚡ **Atomic Job Claim Reservation**: Single-query transaction reservation preventing duplicate execution race conditions across parallel OS worker processes.
- 🗄️ **ACID SQLite Persistence**: High-performance WAL mode (`PRAGMA journal_mode = WAL;`) with composite indexing (`(state, run_at)`).
- 🔄 **Exponential Backoff Retries**: Failed jobs automatically retry with exponential delay ($\text{delay} = \text{base}^{\text{attempts}}$ seconds, where base is configurable via CLI).
- 💀 **Dead Letter Queue (DLQ)**: Jobs exceeding `max_retries` transition to `dead` state for manual inspection and `queuectl dlq retry`.
- 🛑 **Cross-Process Worker Management & Graceful Teardown**: Cross-process signaling via `queuectl worker stop` and clean POSIX `SIGINT`/`SIGTERM` handling.
- 🧹 **Crash Recovery Sweeper (<60s Worst-Case)**: Automatic detection and restoration of zombie/orphaned jobs stuck in `processing` due to worker crashes (`SIGKILL`).
- 🖥️ **Commander.js CLI**: Full compliance with official assignment interface contract, supporting strict `--json` output.

---

## Installation & Setup

```bash
# 1. Install dependencies
npm install

# 2. Run test suite
npm test
```

---

## CLI Command Reference

### 1. Enqueue Jobs
```bash
# Enqueue shell command string
node src/cli/index.js enqueue 'echo "Hello World"'

# Enqueue JSON job specification
node src/cli/index.js enqueue '{"id":"job1","command":"sleep 2","max_retries":3}'
```

### 2. Manage Workers
```bash
# Start worker pool in the foreground (blocks until stopped)
node src/cli/index.js worker start --count 3

# Gracefully stop all running workers from another terminal session
node src/cli/index.js worker stop
```

### 3. Check Queue Status & List Jobs
```bash
# Print summary overview of job states and active worker counts
node src/cli/index.js status

# List jobs filtered by state (pending, processing, completed, failed, dead)
node src/cli/index.js list --state pending

# Output strict JSON array of job objects (contract compliant)
node src/cli/index.js list --state pending --json
```

### 4. Dead Letter Queue (DLQ) Operations
```bash
# List all dead jobs in DLQ
node src/cli/index.js dlq list

# Re-enqueue a dead job for execution (resets attempts to 0)
node src/cli/index.js dlq retry <jobId>
```

### 5. Configuration Management
```bash
# Configure maximum retry attempts
node src/cli/index.js config set max-retries 3

# Configure exponential backoff base
node src/cli/index.js config set backoff-base 2
```

---

## Automated Test Suite

Run the built-in Node test runner:
```bash
npm test
```

The test suite covers:
1. Basic shell job execution (`completed`).
2. Failing job retry backoff ($\text{base}^{\text{attempts}}$) and transition to DLQ (`dead`).
3. Multi-worker atomic claim reservation across concurrent executions.
4. Crash recovery under 60 seconds (`SIGKILL` simulation).
5. Persistence across process restarts.
6. Configuration management & cross-process `worker stop` signaling.

---

## System Architecture & Decisions

For in-depth explanations of system mechanics, atomic locking proofs, crash recovery walkthroughs, cross-process worker signaling trade-offs, and priority queue extensibility, see [DECISIONS.md](file:///home/nixos/Projects/new/queuectl-system/DECISIONS.md).
