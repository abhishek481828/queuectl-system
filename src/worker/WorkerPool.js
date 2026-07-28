import { exec } from 'child_process';
import { QueueManager } from '../queue/QueueManager.js';
import { logger as defaultLogger } from '../utils/logger.js';
import { CONFIG } from '../config/index.js';

export class WorkerPool {
  constructor(queueManager = new QueueManager(), logger = defaultLogger, options = {}) {
    this.queue = queueManager;
    this.logger = logger;
    this.concurrency = options.concurrency || options.count || CONFIG.defaultConcurrency;
    this.staleTimeoutSeconds = options.staleTimeoutSeconds || 20;
    this.pollIntervalMs = options.pollIntervalMs || 500;
    this.isRunning = false;
    this.activeWorkers = 0;
    this.inFlightPromises = new Set();
    this.workerId = null;
    this._bindSignalHandlers();
  }

  async start() {
    this.isRunning = true;
    this.workerId = this.queue.registerWorker(process.pid);
    this.logger.info(`WorkerPool started`, { pid: process.pid, workerId: this.workerId, concurrency: this.concurrency });

    // Perform startup recovery for any zombie jobs left over from process crash / SIGKILL
    const recoveredCount = this.queue.recoverStaleJobs(this.staleTimeoutSeconds);
    if (recoveredCount > 0) {
      this.logger.warn(`Recovered stale jobs on worker startup`, { count: recoveredCount });
    }

    // Periodic stale job sweeper interval (runs every 10s to guarantee <60s recovery)
    this.sweeperInterval = setInterval(() => {
      if (!this.isRunning) return;
      this.queue.heartbeatWorker(this.workerId);

      // Check if cross-process stop signal was requested via queuectl worker stop
      if (this.queue.isStopRequested(this.workerId)) {
        this.logger.info(`Received cross-process stop signal. Initiating graceful shutdown...`);
        this.stop('WORKER_STOP_SIGNAL');
        return;
      }

      const count = this.queue.recoverStaleJobs(this.staleTimeoutSeconds);
      if (count > 0) {
        this.logger.warn(`Periodic sweeper recovered stale jobs`, { count });
      }
    }, 5000);

    while (this.isRunning) {
      // Check cross-process stop signal on loop iteration
      if (this.queue.isStopRequested(this.workerId)) {
        this.logger.info(`Cross-process stop signal detected.`);
        await this.stop('WORKER_STOP_SIGNAL');
        break;
      }

      if (this.activeWorkers < this.concurrency) {
        const job = this.queue.claimNextJob();
        if (job) {
          const promise = this.processJob(job);
          this.inFlightPromises.add(promise);
          promise.finally(() => this.inFlightPromises.delete(promise));
        }
      }
      await new Promise(r => setTimeout(r, this.pollIntervalMs));
    }
  }

  async stop(signal = 'MANUAL') {
    if (!this.isRunning) return;
    this.logger.info(`Graceful shutdown initiated (${signal})`, { activeWorkers: this.activeWorkers });
    this.isRunning = false;
    if (this.sweeperInterval) clearInterval(this.sweeperInterval);

    if (this.inFlightPromises.size > 0) {
      this.logger.info(`Waiting for in-flight tasks to complete...`, { count: this.inFlightPromises.size });
      await Promise.all(Array.from(this.inFlightPromises));
    }

    if (this.workerId && this.queue) {
      this.queue.unregisterWorker(this.workerId);
    }

    if (this.queue && this.queue.store) {
      this.queue.store.close();
    }
    this.logger.info(`WorkerPool shutdown clean complete`);
  }

  async processJob(job) {
    this.activeWorkers++;
    this.logger.info(`Processing job`, { jobId: job.id, command: job.command, attempt: job.attempts });

    try {
      // Execute command in shell
      await this._executeCommand(job.command);

      this.queue.updateJobStatus(job.id, 'completed');
      this.logger.info(`Job completed successfully`, { jobId: job.id });
    } catch (err) {
      const errMsg = err.message || 'Execution failed';
      this.logger.error(`Job execution failed`, { jobId: job.id, error: errMsg });

      const backoffBaseStr = this.queue.configGet('backoff-base', '2');
      const backoffBase = parseFloat(backoffBaseStr) || 2;

      const maxRetries = job.max_retries !== undefined ? job.max_retries : (job.maxRetries || 3);

      if (job.attempts < maxRetries) {
        // Formula: delay = base ^ attempts seconds
        const delaySeconds = Math.pow(backoffBase, job.attempts);
        const nextRunAt = new Date(Date.now() + delaySeconds * 1000).toISOString();

        this.queue.updateJobStatus(job.id, 'failed', errMsg, nextRunAt);
        this.logger.info(`Scheduled retry with exponential backoff`, {
          jobId: job.id,
          nextAttempt: job.attempts + 1,
          maxRetries,
          delaySeconds,
          nextRunAt
        });
      } else {
        // Retries exhausted -> Move to DLQ (dead state)
        this.queue.updateJobStatus(job.id, 'dead', errMsg);
        this.logger.error(`Job max retries exhausted. Moved to DLQ (dead state).`, { jobId: job.id });
      }
    } finally {
      this.activeWorkers--;
    }
  }

  _executeCommand(commandString) {
    return new Promise((resolve, reject) => {
      exec(commandString, { env: process.env }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Command exited with code ${error.code || 1}: ${stderr || error.message}`));
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  }

  _bindSignalHandlers() {
    const handleSignal = async (signal) => {
      await this.stop(signal);
      process.exit(0);
    };

    process.once('SIGINT', () => handleSignal('SIGINT'));
    process.once('SIGTERM', () => handleSignal('SIGTERM'));
  }
}
