import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { QueueManager } from '../src/queue/QueueManager.js';
import { SqliteStore } from '../src/storage/SqliteStore.js';
import { WorkerPool } from '../src/worker/WorkerPool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testDbPath = path.join(__dirname, 'test_queue.db');

function cleanupTestDb() {
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);
  if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
}

test('QueueCTL Full Assignment Specification Test Suite', async (t) => {
  cleanupTestDb();

  let store;
  let queue;

  t.beforeEach(() => {
    cleanupTestDb();
    store = new SqliteStore(testDbPath);
    queue = new QueueManager(store);
  });

  t.afterEach(() => {
    if (store) store.close();
    cleanupTestDb();
  });

  await t.test('1. Scenario 1: A basic job completes successfully via shell execution', async () => {
    const job = queue.enqueue('echo "Hello World"');
    assert.equal(job.command, 'echo "Hello World"');
    assert.equal(job.state, 'pending');

    const claimed = queue.claimNextJob();
    assert.equal(claimed.id, job.id);
    assert.equal(claimed.state, 'processing');
    assert.equal(claimed.attempts, 1);

    const pool = new WorkerPool(queue, { info: () => {}, error: () => {} });
    await pool.processJob(claimed);

    const finished = queue.getJob(job.id);
    assert.equal(finished.state, 'completed');
    assert.equal(finished.error, null);
  });

  await t.test('2. Scenario 2: A failing job retries with backoff and lands in DLQ (dead state)', async () => {
    const job = queue.enqueue('non_existent_command_xyz_123', { maxRetries: 2 });
    assert.equal(job.max_retries, 2);

    const pool = new WorkerPool(queue, { info: () => {}, error: () => {} });

    // Attempt 1: Fails -> Schedules retry with backoff (state = failed)
    const claimed1 = queue.claimNextJob();
    assert.equal(claimed1.attempts, 1);
    await pool.processJob(claimed1);
    const stateAfterAttempt1 = queue.getJob(job.id);
    assert.equal(stateAfterAttempt1.state, 'failed');

    // Manually force run_at to past ISO string for test speed
    const pastIso = new Date(Date.now() - 60000).toISOString();
    store.db.prepare("UPDATE jobs SET run_at = ? WHERE id = ?").run(pastIso, job.id);

    // Attempt 2: Max retries (2) reached -> Moves to DLQ (state = dead)
    const claimed2 = queue.claimNextJob();
    assert.equal(claimed2.attempts, 2);
    await pool.processJob(claimed2);
    const stateAfterAttempt2 = queue.getJob(job.id);
    assert.equal(stateAfterAttempt2.state, 'dead');

    // Verify DLQ list
    const dlq = queue.dlqList();
    assert.equal(dlq.length, 1);
    assert.equal(dlq[0].id, job.id);

    // Test DLQ Retry
    const retried = queue.dlqRetry(job.id);
    assert.equal(retried.state, 'pending');
    assert.equal(retried.attempts, 0);
  });

  await t.test('3. Scenario 3: Parallel worker execution - atomic claim prevents double execution', async () => {
    queue.enqueue('echo "Job 1"');
    queue.enqueue('echo "Job 2"');

    const claimResults = await Promise.all([
      Promise.resolve(queue.claimNextJob()),
      Promise.resolve(queue.claimNextJob()),
      Promise.resolve(queue.claimNextJob())
    ]);

    const claimedJobs = claimResults.filter(Boolean);
    const uniqueIds = new Set(claimedJobs.map(j => j.id));

    assert.equal(claimedJobs.length, 2);
    assert.equal(uniqueIds.size, 2);
  });

  await t.test('4. Scenario 4: Worker crash recovery under 60 seconds', async () => {
    const job = queue.enqueue('sleep 10');
    const claimed = queue.claimNextJob();
    assert.equal(claimed.state, 'processing');

    // Simulate worker crash / SIGKILL 30 seconds ago
    const pastIso = new Date(Date.now() - 30000).toISOString();
    store.db.prepare("UPDATE jobs SET updated_at = ? WHERE id = ?").run(pastIso, job.id);

    const recoveredCount = queue.recoverStaleJobs(20);
    assert.equal(recoveredCount, 1);

    const recoveredJob = queue.getJob(job.id);
    assert.equal(recoveredJob.state, 'pending');
  });

  await t.test('5. Scenario 5: Persistence across restarts', async () => {
    queue.enqueue('echo "Persistent Job"');
    store.close();

    // Reopen store from disk
    const reloadedStore = new SqliteStore(testDbPath);
    const reloadedQueue = new QueueManager(reloadedStore);
    const jobs = reloadedQueue.list();

    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].command, 'echo "Persistent Job"');
    reloadedStore.close();
  });

  await t.test('6. Configuration management & cross-process worker stop signal', async () => {
    queue.configSet('max-retries', '5');
    assert.equal(queue.configGet('max-retries'), '5');

    const workerId = queue.registerWorker(1234);
    assert.equal(queue.isStopRequested(workerId), false);

    queue.requestStopWorkers();
    assert.equal(queue.isStopRequested(workerId), true);
    queue.unregisterWorker(workerId);
  });
});
