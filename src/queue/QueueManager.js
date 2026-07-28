import { SqliteStore } from '../storage/SqliteStore.js';

export class QueueManager {
  constructor(store = new SqliteStore()) {
    this.store = store;
  }

  /**
   * Enqueue a new job. Input can be:
   * 1. A raw command string (e.g. "echo 'Hello World'")
   * 2. A JSON string (e.g. '{"id":"job1","command":"sleep 2","max_retries":3}')
   * 3. An object (e.g. { id: 'job1', command: 'sleep 2' })
   */
  enqueue(jobInput, options = {}) {
    let id;
    let command;
    let maxRetries = options.maxRetries;

    const defaultMaxRetriesStr = this.store.configGet('max-retries', '3');
    const defaultMaxRetries = parseInt(defaultMaxRetriesStr, 10) || 3;

    if (typeof jobInput === 'string') {
      const trimmed = jobInput.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const parsed = JSON.parse(trimmed);
          id = parsed.id;
          command = parsed.command;
          if (parsed.max_retries !== undefined) maxRetries = parsed.max_retries;
          if (parsed.maxRetries !== undefined) maxRetries = parsed.maxRetries;
        } catch {
          command = trimmed;
        }
      } else {
        command = trimmed;
      }
    } else if (typeof jobInput === 'object' && jobInput !== null) {
      id = jobInput.id;
      command = jobInput.command;
      if (jobInput.max_retries !== undefined) maxRetries = jobInput.max_retries;
      if (jobInput.maxRetries !== undefined) maxRetries = jobInput.maxRetries;
    }

    if (!command || typeof command !== 'string' || command.trim() === '') {
      throw new Error('Job command must be a non-empty string');
    }

    if (!id || typeof id !== 'string' || id.trim() === '') {
      id = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    } else {
      id = id.trim();
    }

    if (maxRetries === undefined || maxRetries === null) {
      maxRetries = defaultMaxRetries;
    } else {
      maxRetries = parseInt(maxRetries, 10);
      if (isNaN(maxRetries) || maxRetries < 0) {
        throw new Error('max_retries must be a non-negative integer');
      }
    }

    const now = new Date().toISOString();

    const newJob = {
      id,
      command: command.trim(),
      state: 'pending',
      attempts: 0,
      max_retries: maxRetries,
      created_at: now,
      updated_at: now,
      run_at: options.runAt || now,
      error: null
    };

    return this.store.insertJob(newJob);
  }

  list(stateFilter = null) {
    return this.store.getJobs(stateFilter);
  }

  getJob(id) {
    return this.store.getJobById(id);
  }

  claimNextJob() {
    return this.store.claimNextJob();
  }

  updateJobStatus(id, state, error = null, runAt = null) {
    return this.store.updateStatus(id, state, error, runAt);
  }

  retry(id) {
    const job = this.getJob(id);
    if (!job) throw new Error(`Job '${id}' not found`);
    const now = new Date().toISOString();
    return this.store.updateStatus(id, 'pending', null, now);
  }

  purge() {
    return this.store.purgeCompletedAndDead();
  }

  recoverStaleJobs(timeoutSeconds = 30) {
    return this.store.recoverStaleJobs(timeoutSeconds);
  }

  dlqList() {
    return this.store.dlqList();
  }

  dlqRetry(id) {
    return this.store.dlqRetry(id, true);
  }

  configSet(key, value) {
    return this.store.configSet(key, value);
  }

  configGet(key, defaultValue = null) {
    return this.store.configGet(key, defaultValue);
  }

  registerWorker(pid = process.pid) {
    return this.store.registerWorker(pid);
  }

  heartbeatWorker(workerId) {
    return this.store.heartbeatWorker(workerId);
  }

  unregisterWorker(workerId) {
    return this.store.unregisterWorker(workerId);
  }

  requestStopWorkers() {
    return this.store.requestStopWorkers();
  }

  isStopRequested(workerId) {
    return this.store.isStopRequested(workerId);
  }

  getActiveWorkersCount() {
    return this.store.getActiveWorkersCount();
  }
}
