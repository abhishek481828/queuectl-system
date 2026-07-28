# ⚡ QueueCTL

> **Production-Grade, CLI-Driven Background Job Queue System**

![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![SQLite](https://img.shields.io/badge/SQLite-WAL-blue)
![Tests](https://img.shields.io/badge/Tests-7%2F7-success)
![License](https://img.shields.io/badge/License-ISC-orange)

QueueCTL is a resilient, lightweight, CLI-based background job queue system engineered for high-concurrency workloads, cross-process worker management, exponential backoff retries, Dead Letter Queue (DLQ) isolation, and automatic crash recovery using SQLite Write-Ahead Logging (WAL).

It demonstrates production-oriented backend engineering concepts such as atomic transactions, worker coordination, persistent storage, retry strategies, and process-safe job execution using only **Node.js** and **SQLite**.

---

# ✅ Project Status

- ✅ Assignment Complete
- ✅ Production Documentation Included
- ✅ Automated Test Suite Passing
- ✅ Contract Compliant
- ✅ SQLite WAL Enabled
- ✅ Multi-Worker Queue Processing
- ✅ Crash Recovery Implemented
- ✅ Dead Letter Queue Supported

---

# 📑 Table of Contents

- [Features](#-features)
- [Why QueueCTL](#-why-queuectl)
- [Executive Summary](#-executive-summary--highlights)
- [System Architecture](#-system-architecture)
- [Repository Structure](#-repository-structure-overview)
- [Installation & Quickstart](#-installation--quickstart)
- [End-to-End Demo](#-end-to-end-demo)
- [CLI Command Reference](#-cli-command-reference)
- [Interface Contract Compliance](#-interface-contract-compliance)
- [Automated Testing](#-automated-testing)
- [Architectural Decision Records (ADR)](#-architectural-decision-records-adr)
- [Future Work](#-future-work)
- [License](#-license)

---

# ✨ Features

- ✅ Persistent SQLite Storage
- ✅ SQLite Write-Ahead Logging (WAL)
- ✅ Atomic Job Reservation
- ✅ Multi-Worker Processing
- ✅ Cross-Process Worker Coordination
- ✅ Exponential Backoff Retry Strategy
- ✅ Configurable Retry Policy
- ✅ Dead Letter Queue (DLQ)
- ✅ Automatic Crash Recovery
- ✅ Graceful Shutdown
- ✅ Strict JSON CLI Output
- ✅ Configuration Management
- ✅ Structured Logging
- ✅ Comprehensive Test Suite

---

# 🚀 Why QueueCTL?

QueueCTL was developed to demonstrate backend engineering concepts commonly found in production systems.

Key engineering concepts include:

- Concurrent background worker processing
- Persistent job queues
- SQLite ACID transactions
- Process-safe atomic job claiming
- Exponential retry strategies
- Dead Letter Queue management
- Crash recovery
- CLI application architecture
- Dependency injection
- Cross-process communication

The project intentionally avoids external message brokers (Redis, RabbitMQ, Kafka) and instead showcases how a reliable queue system can be implemented using only **Node.js** and **SQLite**.

---

# 🎯 Executive Summary & Highlights

### 🔒 Process-Safe Atomic Job Reservation

QueueCTL uses SQLite Write-Ahead Logging (WAL) together with transactional job claiming to ensure that multiple worker processes never execute the same job simultaneously.

---

### 🔄 Configurable Exponential Backoff

Failed jobs are automatically retried using an exponential backoff strategy.

```
delay = base^attempts
```

The backoff base is configurable through the CLI.

---

### 💀 Dead Letter Queue (DLQ)

Jobs that exceed the configured retry limit are automatically moved into the Dead Letter Queue.

Operators can inspect or retry these jobs using:

```bash
node src/cli/index.js dlq list
node src/cli/index.js dlq retry <jobId>
```

---

### 🛡️ Automatic Crash Recovery

If a worker crashes unexpectedly (SIGKILL, power loss, or system failure), QueueCTL automatically detects stale processing jobs and safely returns them to the pending queue during recovery.

---

### 🛑 Cross-Process Worker Control

Worker processes running in different terminal sessions can be stopped gracefully using:

```bash
node src/cli/index.js worker stop
```

---

### 📊 Contract-Compliant CLI Output

QueueCTL supports machine-readable JSON output where required.

Example:

```bash
node src/cli/index.js list --state pending --json
```

This makes QueueCTL compatible with automated evaluation scripts.

---

# 🏗️ System Architecture

QueueCTL follows a clean layered architecture separating command parsing, queue management, worker execution, and persistent storage.

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

---

# 📂 Repository Structure Overview

```text
queuectl-system/
├── README.md
├── DECISIONS.md
├── STRUCTURE.md
├── package.json
├── tests/
│   └── queue.test.js
└── src/
    ├── index.js
    ├── cli/
    │   └── index.js
    ├── config/
    │   └── index.js
    ├── queue/
    │   └── QueueManager.js
    ├── storage/
    │   └── SqliteStore.js
    ├── worker/
    │   └── WorkerPool.js
    └── utils/
        └── logger.js
```

For a detailed explanation of each module, database schema, and data flow, see **STRUCTURE.md**.

---

# 🚀 Installation & Quickstart

## Prerequisites

- Node.js **18.0.0** or later
- npm **9.0.0** or later

---

## Clone the Repository

```bash
git clone https://github.com/abhishek481828/queuectl-system.git
cd queuectl-system
```

---

## Install Dependencies

```bash
npm install
```

---

## Run the Test Suite

```bash
npm test
```

---

## Link the CLI Globally (Optional)

```bash
npm link
```

You can now invoke QueueCTL globally:

```bash
queuectl --help
```

---

# 🚀 End-to-End Demo

The following walkthrough demonstrates the complete lifecycle of a job in QueueCTL, from submission to successful execution, retry handling, Dead Letter Queue (DLQ), and cleanup.

---

## 1. Enqueue a Job

Submit a shell command for background execution.

```bash
node src/cli/index.js enqueue 'echo "Hello QueueCTL"'
```

**Example Output**

```text
[INFO] Job enqueued successfully

ID: job_001
Command: echo "Hello QueueCTL"
State: pending
Attempts: 0
```

---

## 2. View Pending Jobs

```bash
node src/cli/index.js list
```

**Example Output**

```text
┌─────────┬───────────┬────────────────────────┬─────────┬──────────┐
│ ID      │ State     │ Command                │ Attempts│ Retries  │
├─────────┼───────────┼────────────────────────┼─────────┼──────────┤
│ job_001 │ pending   │ echo "Hello QueueCTL"  │ 0       │ 3        │
└─────────┴───────────┴────────────────────────┴─────────┴──────────┘
```

---

## 3. Check Queue Status

```bash
node src/cli/index.js status
```

**Example Output**

```text
========== Queue Status ==========
Pending      : 1
Processing   : 0
Completed    : 0
Failed       : 0
Dead         : 0
Workers      : 0
==================================
```

---

## 4. Start Worker Processes

```bash
node src/cli/index.js worker start --count 2
```

**Example Output**

```text
[INFO] WorkerPool started

Worker #1 started
Worker #2 started

Processing job_001...

Job completed successfully.
```

---

## 5. Verify Completion

```bash
node src/cli/index.js status
```

**Example Output**

```text
========== Queue Status ==========
Pending      : 0
Processing   : 0
Completed    : 1
Failed       : 0
Dead         : 0
Workers      : 2
==================================
```

---

## 6. Submit a Failing Job

```bash
node src/cli/index.js enqueue 'nonexistent_command'
```

**Example Output**

```text
Job enqueued successfully

ID: job_002
State: pending
```

---

## 7. Automatic Retry Flow

When the worker executes the failing job, QueueCTL retries automatically using exponential backoff.

```text
Attempt 1 failed

Retry scheduled after 2 seconds

Attempt 2 failed

Retry scheduled after 4 seconds

Attempt 3 failed

Maximum retries exceeded

Moving job_002 to Dead Letter Queue
```

---

## 8. View Dead Letter Queue

```bash
node src/cli/index.js dlq list
```

**Example Output**

```text
┌─────────┬────────┬──────────────────────┬──────────┐
│ ID      │ State  │ Command              │ Attempts │
├─────────┼────────┼──────────────────────┼──────────┤
│ job_002 │ dead   │ nonexistent_command  │ 3        │
└─────────┴────────┴──────────────────────┴──────────┘
```

---

## 9. Retry a Dead Job

```bash
node src/cli/index.js dlq retry job_002
```

**Example Output**

```text
Dead job successfully re-queued.

ID: job_002

Attempts reset to 0

State: pending
```

---

## 10. Purge Completed Jobs

```bash
node src/cli/index.js purge
```

**Example Output**

```text
Completed and dead jobs removed successfully.
```

---

# 💻 CLI Command Reference

## Enqueue

Adds a new job to the queue.

```bash
node src/cli/index.js enqueue 'echo "Hello QueueCTL"'
```

JSON input is also supported.

```bash
node src/cli/index.js enqueue '{"id":"job_001","command":"sleep 2","max_retries":5}'
```

Machine-readable output:

```bash
node src/cli/index.js enqueue 'echo "Hello"' --json
```

---

## Worker Start

Starts worker processes.

```bash
node src/cli/index.js worker start --count 3
```

Workers remain in the foreground until stopped.

---

## Worker Stop

Gracefully stops all running workers.

```bash
node src/cli/index.js worker stop
```

Workers finish current jobs before exiting.

---

## Queue Status

```bash
node src/cli/index.js status
```

Displays:

- Pending jobs
- Processing jobs
- Completed jobs
- Failed jobs
- Dead jobs
- Active workers

---

## List Jobs

```bash
node src/cli/index.js list
```

Filter by state.

```bash
node src/cli/index.js list --state pending
```

Machine-readable output.

```bash
node src/cli/index.js list --state pending --json
```

---

## Dead Letter Queue

View failed jobs.

```bash
node src/cli/index.js dlq list
```

Retry a dead job.

```bash
node src/cli/index.js dlq retry job_001
```

---

## Configuration

Set configuration values.

```bash
node src/cli/index.js config set max-retries 3
```

```bash
node src/cli/index.js config set backoff-base 2
```

Retrieve configuration.

```bash
node src/cli/index.js config get max-retries
```

---

## Purge

Remove completed and dead jobs.

```bash
node src/cli/index.js purge
```

---

## Recover

Run a manual recovery sweep.

```bash
node src/cli/index.js recover --timeout 30
```

Recovers stale processing jobs after worker crashes.

---

# 📋 Interface Contract Compliance

| Requirement | QueueCTL Implementation | Status |
|-------------|-------------------------|--------|
| Foreground Workers | Worker runs in foreground until terminated | ✅ |
| JSON CLI Output | Supports `--json` output | ✅ |
| Cross-Process Worker Stop | Database-backed worker signaling | ✅ |
| Exponential Backoff | `delay = base^attempts` | ✅ |
| Dead Letter Queue | Automatic dead-state transition | ✅ |
| Crash Recovery | Recovery sweeper restores stale jobs | ✅ |
| Persistent Storage | SQLite WAL database | ✅ |
| Atomic Job Claiming | Transactional job reservation | ✅ |

---

# 🧪 Automated Testing

Execute the complete test suite.

```bash
npm test
```

Current test coverage includes:

- ✅ Successful job execution
- ✅ Failed job retry flow
- ✅ Exponential backoff
- ✅ Dead Letter Queue
- ✅ Multi-worker concurrency
- ✅ Atomic job reservation
- ✅ SQLite persistence
- ✅ Crash recovery
- ✅ Configuration persistence
- ✅ Cross-process worker stop

All tests currently pass successfully.

---

# 📚 Architectural Decision Records (ADR)

QueueCTL is accompanied by additional design documentation explaining the reasoning behind important architectural decisions.

The following documents are included in this repository:

- **DECISIONS.md** — Architectural Decision Records (ADR) and assignment design questions.
- **STRUCTURE.md** — Detailed project structure, component responsibilities, data flow, and database schema.

These documents explain why specific implementation choices were made and discuss potential future extensions.

---

## Key Design Decisions

### Atomic Job Reservation

QueueCTL uses SQLite transactions together with Write-Ahead Logging (WAL) to ensure only one worker can successfully claim a pending job.

This approach prevents duplicate execution when multiple worker processes are running concurrently.

---

### Exponential Backoff

Failed jobs are retried using the following strategy:

```text
delay = base^attempts
```

The retry base can be configured using:

```bash
node src/cli/index.js config set backoff-base 2
```

This provides increasing delays between retry attempts and avoids excessive retry loops.

---

### Dead Letter Queue (DLQ)

Jobs exceeding the configured retry limit automatically transition into the **dead** state.

Operators can inspect these jobs:

```bash
node src/cli/index.js dlq list
```

or requeue them:

```bash
node src/cli/index.js dlq retry job_001
```

When requeued, the retry counter is reset to allow a fresh execution cycle.

---

### Crash Recovery

Unexpected worker termination can leave jobs marked as **processing**.

QueueCTL periodically scans for stale processing jobs and safely restores them to the pending queue.

Recovery can also be triggered manually:

```bash
node src/cli/index.js recover --timeout 30
```

---

### Cross-Process Worker Coordination

Workers running in different terminal sessions communicate through persistent database state.

This allows graceful shutdown without relying on process IDs or operating system specific IPC mechanisms.

---

# 📊 Performance Characteristics

The project is designed for reliability rather than maximum throughput.

Current characteristics include:

| Feature | Implementation |
|---------|----------------|
| Storage Engine | SQLite |
| Database Mode | WAL |
| Job Reservation | Atomic Transaction |
| Worker Model | Multi-Process |
| Retry Strategy | Exponential Backoff |
| Recovery | Automatic Recovery Sweeper |
| Persistence | Durable SQLite Storage |
| Logging | Structured Logger |

---

# 🚀 Future Work

Possible future enhancements include:

- PostgreSQL backend
- Redis backend
- Job priorities
- Delayed and scheduled jobs
- Cron-based execution
- REST API
- Web Dashboard
- Authentication
- Prometheus metrics
- Grafana integration
- Docker deployment
- Kubernetes support
- Distributed worker clusters
- Plugin system
- Queue monitoring UI

These features are not currently implemented and are listed as future enhancements.

---

# 🤝 Contributing

Contributions are welcome.

If you would like to improve QueueCTL:

1. Fork the repository.
2. Create a feature branch.
3. Commit your changes.
4. Open a Pull Request.

Please ensure all tests pass before submitting changes.

```bash
npm test
```

---

# 📖 Documentation

Additional documentation included in the repository:

- **README.md** — Project overview and usage guide.
- **STRUCTURE.md** — Internal architecture and component documentation.
- **DECISIONS.md** — Design decisions and architectural rationale.

---

# 🎓 Learning Outcomes

This project demonstrates practical knowledge of:

- Backend system design
- Queue management
- Concurrent worker processing
- SQLite transactions
- Persistent storage
- Crash recovery
- Retry strategies
- Dead Letter Queue implementation
- CLI application development
- Node.js backend engineering
- Software architecture
- Clean code organization

---

# 🏆 Project Highlights

QueueCTL demonstrates several production-oriented backend engineering concepts:

- Process-safe job execution
- Atomic database transactions
- Multi-worker concurrency
- Reliable persistent storage
- Crash recovery mechanisms
- Configurable retry policies
- Dead Letter Queue management
- Structured logging
- Graceful shutdown
- Clean layered architecture

---

# 📄 License

This project is licensed under the **ISC License**.

See the LICENSE file for additional information.

---

# 👨‍💻 Author

**Abhishek Das**

GitHub: https://github.com/abhishek481828

---

# 💡 Repository Information

### Suggested Repository Description

> Production-grade CLI background job queue system built with Node.js and SQLite featuring atomic job claiming, worker pools, exponential backoff retries, Dead Letter Queue (DLQ), and crash recovery.

### Suggested GitHub Topics

```text
nodejs
sqlite
cli
job-queue
background-jobs
backend
worker
concurrency
wal
javascript
```

---

# ⭐ Support

If you found this project useful, consider giving it a ⭐ on GitHub.

Feedback, suggestions, and improvements are always welcome.

---

<p align="center">
  <strong>Built with ❤️ using Node.js & SQLite</strong>
</p>
