# Architectural Decision Records (ADR) & Design Trade-offs — QueueCTL

This document provides explicit engineering justifications and answers the 5 mandatory design questions for the **QueueCTL** background job queue implementation.

---

## 1. Atomic Job Claim Reservation Across Processes

**Question**: *Which exact line(s) prevent two workers from claiming the same job, and why is that operation atomic across separate OS processes?*

### Exact Code Reference
- File: [src/storage/SqliteStore.js](file:///home/nixos/Projects/new/queuectl-system/src/storage/SqliteStore.js)
- Lines: [L113–L141](file:///home/nixos/Projects/new/queuectl-system/src/storage/SqliteStore.js#L113-L141)

```javascript
claimNextJob() {
  const now = new Date().toISOString();

  const claimTransaction = this.db.transaction(() => {
    const selectStmt = this.db.prepare(`
      SELECT id FROM jobs
      WHERE (state = 'pending' OR state = 'failed') AND run_at <= ?
      ORDER BY run_at ASC, created_at ASC
      LIMIT 1
    `);

    const candidate = selectStmt.get(now);
    if (!candidate) return null;

    const updateStmt = this.db.prepare(`
      UPDATE jobs
      SET state = 'processing',
          attempts = attempts + 1,
          updated_at = ?
      WHERE id = ? AND (state = 'pending' OR state = 'failed')
    `);

    const result = updateStmt.run(now, candidate.id);
    if (result.changes === 0) return null;

    return this.getJobById(candidate.id);
  });

  return claimTransaction();
}
```

### Why it is Atomic Across OS Processes
1. **SQLite Database Locking & WAL Mode**: SQLite operates with POSIX file locking mechanisms (`fcntl` / `flock`) and shared memory locks (`.db-shm`, `.db-wal`). When `claimTransaction()` executes, `better-sqlite3` wraps the query block in a native SQLite write transaction (`BEGIN IMMEDIATE` / `COMMIT`).
2. **Serializable Transaction Boundary**: Even when multiple worker engine processes (separate Node.js OS instances) poll concurrently:
   - Only **one** OS process acquires the database write lock at any given microsecond.
   - The first process executes `UPDATE ... WHERE id = ? AND (state = 'pending' OR state = 'failed')`. This modifies `state` to `'processing'` and increments `attempts`.
   - The second process, executing immediately after the lock is released, evaluates the `WHERE` clause condition `(state = 'pending' OR state = 'failed')`. Because the state is now `'processing'`, the `UPDATE` matches 0 rows (`result.changes === 0`).
3. **Locking Safeguards**: `PRAGMA busy_timeout = 5000;` prevents `SQLITE_BUSY` errors under high concurrent polling, ensuring candidate selection and state transition happen as a single indivisible unit.

---

## 2. SIGKILL Crash Recovery & Timing Walkthrough

**Question**: *A worker is SIGKILLed halfway through a job. Walk through, step by step, what state the job is in and how it eventually runs again. What is the worst-case delay before recovery?*

### Step-by-Step Crash & Recovery Lifecycle

1. **Pre-Crash State**: The job was claimed by Worker A. Its database record has `state = 'processing'`, `attempts = N`, and `updated_at = T_start`.
2. **The Crash (`SIGKILL`)**: A `SIGKILL` (signal 9) forcibly terminates Worker A's OS process instantaneously. Because `SIGKILL` cannot be caught or handled by process event listeners, no cleanup hooks or error handlers execute. The job record remains stuck in `state = 'processing'` with `updated_at = T_start`.
3. **Detection Mechanism**:
   - The system maintains a periodic sweeper in [WorkerPool.js:L28-L41](file:///home/nixos/Projects/new/queuectl-system/src/worker/WorkerPool.js#L28-L41) that runs every 5 seconds.
   - On startup or during periodic sweeps, [SqliteStore.recoverStaleJobs(20)](file:///home/nixos/Projects/new/queuectl-system/src/storage/SqliteStore.js#L182-L191) runs:
     ```sql
     UPDATE jobs
     SET state = 'pending',
         error = 'Recovered after worker crash / execution timeout',
         updated_at = CURRENT_TIMESTAMP
     WHERE state = 'processing' AND updated_at < ?
     ```
4. **Re-Execution**:
   - The stale job's `state` transitions back to `'pending'`, its `updated_at` is refreshed, and an error note is recorded.
   - On the next worker polling cycle (within 500ms), any active worker process claims the recovered job via `claimNextJob()` and executes it to completion.

### Worst-Case Recovery Delay Analysis
- **Sweeper Interval**: 5 seconds.
- **Stale Timeout Threshold**: 20 seconds.
- **Worker Poll Interval**: 0.5 seconds.
- **Worst-Case Total Delay**: $\text{Stale Threshold} + \text{Sweeper Interval} + \text{Poll Interval} = 20\text{s} + 5\text{s} + 0.5\text{s} = \mathbf{25.5\text{ seconds}}$.
- **Guarantee**: Well below the required **60-second limit** enforced by automated test suites.

---

## 3. DLQ Retry Attempt Reset Justification

**Question**: *Does `dlq retry` reset `attempts`? Why is that the right call?*

### Decision
`queuectl dlq retry <id>` **RESETS** `attempts` back to `0`.

### Reference Implementation
File: [src/storage/SqliteStore.js:L199-L215](file:///home/nixos/Projects/new/queuectl-system/src/storage/SqliteStore.js#L199-L215)
```javascript
dlqRetry(id, resetAttempts = true) {
  const job = this.getJobById(id);
  if (!job) throw new Error(`Job '${id}' not found`);
  if (job.state !== 'dead') throw new Error(`Job '${id}' is not in DLQ (current state: ${job.state})`);

  const now = new Date().toISOString();
  const attempts = resetAttempts ? 0 : job.attempts;
  const stmt = this.db.prepare(`
    UPDATE jobs
    SET state = 'pending',
        attempts = ?,
        error = null,
        run_at = ?,
        updated_at = ?
    WHERE id = ?
  `);
  stmt.run(attempts, now, now, id);
  return this.getJobById(id);
}
```

### Engineering Justification
1. **Fresh Retry Life-Cycle**: A job lands in the Dead Letter Queue (`state = 'dead'`) only after exhausting all `max_retries` automated attempts (e.g. due to a downstream API outage or bad database credential). When an operator manually investigates the failure, fixes the underlying root cause, and executes `dlq retry`, the job is intended to re-enter the production workflow with a full budget of retries.
2. **Avoiding Instant DLQ Re-entry**: If `attempts` were retained at `max_retries` (e.g. `attempts = 3`), a single transient glitch during its re-execution would immediately kick the job back into `dead` state without allowing exponential backoff retries.
3. **Audit Trail Preservation**: Historical failure records are logged in worker telemetry output, while resetting `attempts = 0` gives the job a fresh lifecycle.

---

## 4. Cross-Process Worker Stop Architecture & Trade-Offs

**Question**: *What designs did you consider and reject for `worker stop` (cross-process signaling), and why?*

### Designs Considered & Evaluated

#### Option A (Selected): Shared Database State Signaling (`workers` table)
- **Mechanism**: Workers register their `pid` and `id` in a `workers` database table upon startup and regularly update `last_heartbeat`. `queuectl worker stop` sets `stop_requested = 1` in the database. Active worker loops query `isStopRequested(workerId)` on each poll iteration and initiate graceful teardown.
- **Why Chosen**: 
  - Works universally across OS boundaries (Linux, macOS, Windows) without requiring platform-specific IPC facilities.
  - Zero risk of process ID reuse issues (killing wrong processes).
  - Cleanly decouples worker processes running in separate terminal sessions.

#### Option B (Rejected): OS POSIX Signals (`process.kill(pid, 'SIGTERM')` via PID Files)
- **Why Rejected**: PID files left on disk after a `SIGKILL` or unhandled crash become stale. If another unrelated system process reuses that PID, issuing `queuectl worker stop` could accidentally send `SIGTERM` to an un-associated system process. Additionally, Windows OS lacks native POSIX signal support.

#### Option C (Rejected): UNIX Domain Sockets / Local HTTP Control Server
- **Why Rejected**: Requires opening network ports or managing filesystem socket files (`/tmp/queuectl.sock`). Introduces socket binding conflicts if multiple worker pools run concurrently or if a previous run crashed without unlinking the socket file.

---

## 5. Extensibility Analysis: Adding Job Priorities

**Question**: *If priorities were added tomorrow (high-priority jobs jump the queue), which parts of your design survive unchanged and which break?*

### Parts That Survive Unchanged (90% of Architecture)
1. **Worker Processing Engine ([WorkerPool.js](file:///home/nixos/Projects/new/queuectl-system/src/worker/WorkerPool.js))**: Unchanged. Workers claim next job and execute commands regardless of how candidate selection was ordered.
2. **Exponential Backoff & Failure Logic**: Unchanged. `delay = base^attempts` logic remains identical.
3. **Dead Letter Queue (DLQ) & State Machine**: Unchanged. `pending` $\rightarrow$ `processing` $\rightarrow$ `completed`/`failed`/`dead` state machine remains intact.
4. **Graceful Shutdown & Signal Handling**: Unchanged.
5. **Cross-Process Worker Management**: Unchanged.

### Parts That Break / Require Modification

1. **Database Schema ([SqliteStore.js](file:///home/nixos/Projects/new/queuectl-system/src/storage/SqliteStore.js))**:
   - **Change Required**: Add a `priority` column (`INTEGER NOT NULL DEFAULT 0`) to the `jobs` table.
   - **Index Change**: Update composite index from `(state, run_at)` to `(state, priority DESC, run_at ASC)`.

2. **Job Claim Reservation Query ([SqliteStore.js:L116-L122](file:///home/nixos/Projects/new/queuectl-system/src/storage/SqliteStore.js#L116-L122))**:
   - **Change Required**: Modify `ORDER BY` clause inside `claimNextJob()`:
     ```sql
     SELECT id FROM jobs
     WHERE (state = 'pending' OR state = 'failed') AND run_at <= ?
     ORDER BY priority DESC, run_at ASC, created_at ASC
     LIMIT 1
     ```

3. **CLI Enqueue Parser ([src/cli/index.js:L18](file:///home/nixos/Projects/new/queuectl-system/src/cli/index.js#L18))**:
   - **Change Required**: Support `--priority <number>` option flag on `queuectl enqueue`.
