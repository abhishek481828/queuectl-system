#!/usr/bin/env node

import { Command } from 'commander';
import { QueueManager } from '../queue/QueueManager.js';
import { WorkerPool } from '../worker/WorkerPool.js';
import { Logger } from '../utils/logger.js';

const program = new Command();

program
  .name('queuectl')
  .description('Production-grade CLI Background Job Queue System')
  .version('1.0.0')
  .option('--json', 'Output results in strict JSON format')
  .option('--verbose', 'Enable verbose logging output');

// 1. Enqueue Command
program
  .command('enqueue')
  .description('Submit a new job to the queue')
  .argument('<jobInput>', 'JSON string specification or raw shell command string')
  .action((jobInput) => {
    try {
      const parentOpts = program.opts();
      const queue = new QueueManager();
      const job = queue.enqueue(jobInput);

      if (parentOpts.json) {
        process.stdout.write(JSON.stringify(job, null, 2) + '\n');
      } else {
        const logger = new Logger({ json: false, level: parentOpts.verbose ? 'debug' : 'info' });
        logger.info(`Job enqueued successfully`, { id: job.id, command: job.command, state: job.state });
      }
    } catch (err) {
      process.stderr.write(`Enqueue Error: ${err.message}\n`);
      process.exit(1);
    }
  });

// 2. List Command
program
  .command('list')
  .description('List jobs filtered by state (pending, processing, completed, failed, dead)')
  .argument('[stateFilter]', 'State filter positional argument')
  .option('-s, --state <state>', 'State filter flag')
  .action((stateFilterArg, options) => {
    try {
      const parentOpts = program.opts();
      const stateFilter = options.state || stateFilterArg || null;
      const queue = new QueueManager();
      const jobs = queue.list(stateFilter);

      if (parentOpts.json) {
        // Contract Requirement: Print JSON array to stdout and nothing else on stdout
        process.stdout.write(JSON.stringify(jobs, null, 2) + '\n');
        return;
      }

      if (jobs.length === 0) {
        console.log('No jobs found.');
        return;
      }

      console.table(
        jobs.map(j => ({
          ID: j.id,
          Command: j.command.length > 30 ? j.command.slice(0, 27) + '...' : j.command,
          State: j.state,
          Attempts: `${j.attempts}/${j.max_retries}`,
          Created: j.created_at.split('T')[1].slice(0, 8),
          Error: j.error || '-'
        }))
      );
    } catch (err) {
      process.stderr.write(`List Error: ${err.message}\n`);
      process.exit(1);
    }
  });

// 3. Status Command
program
  .command('status')
  .description('Display detailed job state metrics and active workers')
  .argument('[jobId]', 'Specific Job ID')
  .action((jobId) => {
    try {
      const parentOpts = program.opts();
      const queue = new QueueManager();

      if (jobId) {
        const job = queue.getJob(jobId);
        if (!job) {
          process.stderr.write(`Error: Job '${jobId}' not found.\n`);
          process.exit(1);
        }
        if (parentOpts.json) {
          process.stdout.write(JSON.stringify(job, null, 2) + '\n');
        } else {
          console.dir(job, { depth: null });
        }
      } else {
        const jobs = queue.list();
        const activeWorkers = queue.getActiveWorkersCount();
        const counts = jobs.reduce((acc, j) => {
          acc[j.state] = (acc[j.state] || 0) + 1;
          return acc;
        }, {});

        const summary = {
          activeWorkers,
          totalJobs: jobs.length,
          pending: counts.pending || 0,
          processing: counts.processing || 0,
          completed: counts.completed || 0,
          failed: counts.failed || 0,
          dead: counts.dead || 0
        };

        if (parentOpts.json) {
          process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
        } else {
          console.log('\n--- Queue Status Overview ---');
          console.log(`Active Workers: ${summary.activeWorkers}`);
          console.log(`Total Jobs:     ${summary.totalJobs}`);
          console.log(`Pending:        ${summary.pending}`);
          console.log(`Processing:     ${summary.processing}`);
          console.log(`Completed:      ${summary.completed}`);
          console.log(`Failed:         ${summary.failed}`);
          console.log(`Dead (DLQ):     ${summary.dead}\n`);
        }
      }
    } catch (err) {
      process.stderr.write(`Status Error: ${err.message}\n`);
      process.exit(1);
    }
  });

// 4. Worker Command Suite
const workerCmd = program.command('worker').description('Manage worker execution engine');

workerCmd
  .command('start')
  .description('Start worker pool in the foreground (blocks until stopped)')
  .option('-c, --count <number>', 'Number of worker threads/processes', '3')
  .option('--concurrency <number>', 'Alias for --count')
  .action(async (options) => {
    try {
      const parentOpts = program.opts();
      const countVal = options.count !== undefined ? options.count : options.concurrency;
      const count = parseInt(countVal, 10);
      if (isNaN(count) || count <= 0) {
        throw new Error('Option --count must be a positive integer.');
      }

      const logger = new Logger({ json: parentOpts.json, level: parentOpts.verbose ? 'debug' : 'info' });
      const queue = new QueueManager();
      const pool = new WorkerPool(queue, logger, { concurrency: count });

      await pool.start();
    } catch (err) {
      process.stderr.write(`Worker Error: ${err.message}\n`);
      process.exit(1);
    }
  });

workerCmd
  .command('stop')
  .description('Gracefully stop all running workers across processes')
  .action(() => {
    try {
      const queue = new QueueManager();
      const count = queue.requestStopWorkers();
      console.log(`Sent graceful stop signal to ${count} active worker process(es).`);
    } catch (err) {
      process.stderr.write(`Worker Stop Error: ${err.message}\n`);
      process.exit(1);
    }
  });

// 5. DLQ Command Suite
const dlqCmd = program.command('dlq').description('Dead Letter Queue (DLQ) operations');

dlqCmd
  .command('list')
  .description('List all permanently failed jobs in the DLQ')
  .action(() => {
    try {
      const parentOpts = program.opts();
      const queue = new QueueManager();
      const deadJobs = queue.dlqList();

      if (parentOpts.json) {
        process.stdout.write(JSON.stringify(deadJobs, null, 2) + '\n');
        return;
      }

      if (deadJobs.length === 0) {
        console.log('No dead jobs in DLQ.');
        return;
      }

      console.table(
        deadJobs.map(j => ({
          ID: j.id,
          Command: j.command,
          State: j.state,
          Attempts: `${j.attempts}/${j.max_retries}`,
          Error: j.error || '-'
        }))
      );
    } catch (err) {
      process.stderr.write(`DLQ List Error: ${err.message}\n`);
      process.exit(1);
    }
  });

dlqCmd
  .command('retry')
  .description('Re-enqueue a dead job from DLQ for execution')
  .argument('<jobId>', 'Job ID to retry')
  .action((jobId) => {
    try {
      const parentOpts = program.opts();
      const queue = new QueueManager();
      const job = queue.dlqRetry(jobId);

      if (parentOpts.json) {
        process.stdout.write(JSON.stringify(job, null, 2) + '\n');
      } else {
        console.log(`Re-queued dead job [${job.id}] for execution.`);
      }
    } catch (err) {
      process.stderr.write(`DLQ Retry Error: ${err.message}\n`);
      process.exit(1);
    }
  });

// 6. Config Command Suite
const configCmd = program.command('config').description('Manage system configuration');

configCmd
  .command('set')
  .description('Set a configuration parameter (max-retries, backoff-base)')
  .argument('<key>', 'Configuration key (e.g. max-retries, backoff-base)')
  .argument('<value>', 'Configuration value')
  .action((key, value) => {
    try {
      const queue = new QueueManager();
      queue.configSet(key, value);
      console.log(`Configuration updated: ${key} = ${value}`);
    } catch (err) {
      process.stderr.write(`Config Set Error: ${err.message}\n`);
      process.exit(1);
    }
  });

configCmd
  .command('get')
  .description('Get configuration parameter value')
  .argument('<key>', 'Configuration key')
  .action((key) => {
    try {
      const queue = new QueueManager();
      const val = queue.configGet(key);
      console.log(`${key} = ${val}`);
    } catch (err) {
      process.stderr.write(`Config Get Error: ${err.message}\n`);
      process.exit(1);
    }
  });

// 7. Utility Maintenance Commands
program
  .command('retry')
  .description('Re-queue a failed job')
  .argument('<jobId>', 'Job ID to retry')
  .action((jobId) => {
    try {
      const parentOpts = program.opts();
      const queue = new QueueManager();
      const job = queue.retry(jobId);

      if (parentOpts.json) {
        process.stdout.write(JSON.stringify(job, null, 2) + '\n');
      } else {
        console.log(`Re-queued job [${job.id}] for retry.`);
      }
    } catch (err) {
      process.stderr.write(`Retry Error: ${err.message}\n`);
      process.exit(1);
    }
  });

program
  .command('purge')
  .description('Clear all completed and dead tasks from storage')
  .action(() => {
    try {
      const queue = new QueueManager();
      const removedCount = queue.purge();
      console.log(`Successfully purged ${removedCount} finished job record(s).`);
    } catch (err) {
      process.stderr.write(`Purge Error: ${err.message}\n`);
      process.exit(1);
    }
  });

program
  .command('recover')
  .description('Run manual crash recovery sweep to restore orphaned processing tasks')
  .option('-t, --timeout <seconds>', 'Stale timeout in seconds', '30')
  .action((options) => {
    try {
      const timeout = parseInt(options.timeout, 10);
      const queue = new QueueManager();
      const recovered = queue.recoverStaleJobs(timeout);
      console.log(`Crash recovery complete. Restored ${recovered} stale job(s) to pending state.`);
    } catch (err) {
      process.stderr.write(`Recovery Error: ${err.message}\n`);
      process.exit(1);
    }
  });

program.parse(process.argv);
