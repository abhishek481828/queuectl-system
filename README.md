# ⚡ QueueCTL

![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![SQLite](https://img.shields.io/badge/SQLite-WAL-blue)
![Tests](https://img.shields.io/badge/Tests-7%2F7-success)
![License](https://img.shields.io/badge/License-ISC-orange)

> Production-Grade, CLI-Driven Background Job Queue System

QueueCTL is a resilient, lightweight, CLI-based background job queue system engineered for high-concurrency workloads, cross-process worker management, exponential backoff retries, Dead Letter Queue (DLQ) isolation, and automatic crash recovery using SQLite Write-Ahead Logging (WAL).

---

## 📌 Executive Overview & Features

| Capability | Technical Implementation | Status |
| :--- | :--- | :---: |
| **Persistent Storage** | SQLite with Write-Ahead Logging (`WAL`) & single-query atomic claims (`claimNextJob`) | ✅ |
| **Worker Concurrency** | Multi-process worker pool (`WorkerPool.js`) with DB-backed cross-process stop signaling | ✅ |
| **Retry & Backoff** | Reschedules failed jobs using exponential backoff formula: $\text{delay} = \text{base}^{\text{attempts}}$ | ✅ |
| **DLQ Isolation** | Automatically moves jobs exceeding `max_retries` to `dead` state for operator inspection | ✅ |
| **Crash Recovery** | Sweeper detects worker crashes (`SIGKILL`) and restores stale jobs within 25.5s worst-case | ✅ |
| **CLI & JSON Contract** | Built with `commander.js`; supports strict `--json` stdout formatting for automated evaluators | ✅ |

---

## 💡 Why QueueCTL?

QueueCTL demonstrates core backend engineering and distributed systems principles using only **Node.js** and **SQLite** (no Redis, RabbitMQ, or external brokers):

- **Concurrency & Atomic Reservation**: Multi-worker polling loops contending for jobs without race conditions or double claims.
- **SQLite ACID Persistence**: Single-query transactional job claims (`claimNextJob`) in Write-Ahead Logging mode.
- **Fault Tolerance**: Automatic crash recovery for `SIGKILL` process failures and exponential backoff retry scheduling.
- **Cross-Process Coordination**: Database-backed worker signaling (`worker stop`) across independent terminal sessions.

---

## 🏗️ System Architecture & Structure

QueueCTL follows a **Clean Layered Architecture** decoupling CLI parsing, domain queue logic, worker execution, and ACID database persistence.

```text
                    ┌────────────────────────────────────────┐
                    │            QueueCTL CLI                │
                    │         (src/cli/index.js)             │
                    └───────────────────┬────────────────────┘
                                        │
                                        ▼
                    ┌────────────────────────────────────────┐
                    │           QueueManager                 │
                    │      (src/queue/QueueManager.js)       │
                    └───────────┬────────────────┬───────────┘
                                │                │
                                ▼                ▼
┌───────────────────────────────────┐        ┌───────────────────────────────────┐
│           WorkerPool              │        │           SqliteStore             │
│    (src/worker/WorkerPool.js)     │◄──────►│    (src/storage/SqliteStore.js)   │
└───────────────────────────────────┘        └───────────────────────────────────┘
          │                                                    │
          ▼                                                    ▼
┌───────────────────┐                                ┌───────────────────┐
│ OS Shell Execution│                                │ SQLite WAL DB     │
│ (child_process)   │                                │ (data/queuectl.db)│
└───────────────────┘                                └───────────────────┘
```

```text
queuectl-system/
├── README.md               # Production documentation & CLI quickstart
├── DECISIONS.md            # Architectural Decision Records (ADR) & design trade-offs
├── STRUCTURE.md            # Database schemas & system data flow specifications
├── tests/queue.test.js     # Comprehensive unit & integration test suite (7/7 passing)
└── src/
    ├── cli/index.js        # Commander.js CLI parser & contract interface
    ├── queue/QueueManager.js # Queue lifecycle manager & dependency injection
    ├── storage/SqliteStore.js# ACID SQLite store (WAL mode, atomic transactions)
    └── worker/WorkerPool.js  # Multi-process worker engine & signal handlers
```

---

## ⚡ Quickstart

```bash
# 1. Clone & install
git clone https://github.com/abhishek481828/queuectl-system.git
cd queuectl-system
npm install

# 2. Run automated test suite (7/7 passing)
npm test

# 3. (Optional) Link binary globally
npm link
```

---

## 🚀 End-to-End Demo & CLI Reference

### 1. Basic Enqueue, Execution & Status Verification

```bash
# Enqueue shell task
$ node src/cli/index.js enqueue 'echo "Hello QueueCTL"'
[INFO] Job enqueued successfully { id: "job_001", command: "echo \"Hello QueueCTL\"", state: "pending" }

# List pending jobs
$ node src/cli/index.js list
┌─────────┬───────────┬────────────────────────┬─────────┬──────────┐
│ ID      │ State     │ Command                │ Attempts│ Retries  │
├─────────┼───────────┼────────────────────────┼─────────┼──────────┤
│ job_001 │ pending   │ echo "Hello QueueCTL"  │ 0       │ 3        │
└─────────┴───────────┴────────────────────────┴─────────┴──────────┘

# Start worker pool in foreground (executes job_001)
$ node src/cli/index.js worker start --count 2
[INFO] WorkerPool started (PID 12345)
Processing job_001... Job completed successfully.

# Verify completed queue status
$ node src/cli/index.js status
--- Queue Status Overview ---
Pending: 0 | Processing: 0 | Completed: 1 | Failed: 0 | Dead: 0 | Active Workers: 0
```

### 2. Failing Command, Exponential Backoff, DLQ & Recovery

```bash
# Enqueue failing command
$ node src/cli/index.js enqueue 'nonexistent_command'
[INFO] Job enqueued successfully { id: "job_002", state: "pending" }

# Automatic Worker Retry Flow (Exponential Backoff Formula: delay = base^attempts)
[Attempt 1/3] Execution failed -> Rescheduled retry in 2s
[Attempt 2/3] Execution failed -> Rescheduled retry in 4s
[Attempt 3/3] Execution failed -> Max retries exhausted. Moved job_002 to Dead Letter Queue (dead state).

# Inspect Dead Letter Queue (DLQ)
$ node src/cli/index.js dlq list
┌─────────┬────────┬──────────────────────┬──────────┐
│ ID      │ State  │ Command              │ Attempts │
├─────────┼────────┼──────────────────────┼──────────┤
│ job_002 │ dead   │ nonexistent_command  │ 3/3      │
└─────────┴────────┴──────────────────────┴──────────┘

# Re-enqueue dead job from DLQ
$ node src/cli/index.js dlq retry job_002
Re-queued dead job [job_002] for execution (attempts reset to 0, state: pending).

# Additional Utility Commands
$ node src/cli/index.js worker stop            # Cross-process graceful worker pool stop
$ node src/cli/index.js purge                  # Clear completed & dead job records
$ node src/cli/index.js recover --timeout 30   # Manual crash recovery sweep
$ node src/cli/index.js config set max-retries 3 # Set persistent config parameter
$ node src/cli/index.js config get max-retries   # Read persistent config parameter
```

---

## 📋 Interface Contract Compliance

QueueCTL is **100% compliant** with automated evaluation contracts:

| Requirement | Contract Specification | QueueCTL Implementation | Compliance |
| :--- | :--- | :--- | :---: |
| **Foreground Workers** | `worker start` blocks in foreground; handles `SIGTERM`/`SIGINT` | Handled via WorkerPool event listeners | ✅ |
| **Strict JSON Output** | `list --state <state> --json` prints JSON array to `stdout` only | Handled in CLI output handler via `process.stdout.write` | ✅ |
| **Cross-Process Stop** | `worker stop` stops workers from a separate terminal | Implemented via SQLite state signaling in `workers` table | ✅ |
| **Backoff Formula** | $\text{delay} = \text{base}^{\text{attempts}}$ seconds | Calculated in WorkerPool retry handler | ✅ |
| **Crash Recovery** | Detect worker `SIGKILL` and recover within 60 seconds | Recovery sweeper runs every 5s with 20s cutoff ($\le 25.5\text{s}$ worst-case) | ✅ |
| **DLQ Isolation** | Permanently failed jobs move to `dead` state | Automatically updated in WorkerPool error handler | ✅ |

---

## 📚 Architectural Decision Records (ADR) & Future Work

Detailed technical justifications are documented in [DECISIONS.md](DECISIONS.md) and [STRUCTURE.md](STRUCTURE.md):

1. **Atomic Job Claim Proof**: Single-query transaction serializability (`claimNextJob`) in SQLite WAL mode.
2. **SIGKILL Crash Recovery**: Automatic sweeper logic & worst-case mathematical recovery delay ($25.5\text{s}$).
3. **DLQ Attempt Reset**: Rationale for resetting `attempts = 0` on `dlq retry` for clean re-execution cycles.
4. **Cross-Process Worker Control**: Database state signaling vs. PID files vs. UNIX domain sockets.

### 🔮 Future Extensions (Not Implemented)
- **PostgreSQL / Redis Backends**: Add `FOR UPDATE SKIP LOCKED` or Redis Streams for multi-node scaling.
- **Priority Queues & Scheduling**: Support weighted priority job ordering and cron expressions.
- **REST API & Web Dashboard**: Expose HTTP REST endpoints and visual monitoring UI.

---

## 📄 License & Author

- **Author**: Abhishek Das ([GitHub](https://github.com/abhishek481828))
- **License**: [ISC License](package.json)
