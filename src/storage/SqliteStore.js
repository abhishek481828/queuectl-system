import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { CONFIG } from '../config/index.js';

export class SqliteStore {
  constructor(dbPath = CONFIG.dbFile) {
    this.dbPath = dbPath.endsWith('.json')
      ? path.join(path.dirname(dbPath), 'queuectl.db')
      : dbPath;
    this.dataDir = path.dirname(this.dbPath);
    this.db = null;
    this.init();
  }

  init() {
    if (this.db) return;
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');

    // Auto-migrate legacy schema if state column is missing
    const existingCols = this.db.pragma('table_info(jobs)').map(c => c.name);
    if (existingCols.length > 0 && !existingCols.includes('state')) {
      this.db.exec('DROP TABLE jobs;');
    }

    this.db.exec(`
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

      CREATE INDEX IF NOT EXISTS idx_jobs_state_run_at ON jobs (state, run_at);
      CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs (created_at);

      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workers (
        id TEXT PRIMARY KEY,
        pid INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        last_heartbeat TEXT NOT NULL,
        stop_requested INTEGER NOT NULL DEFAULT 0
      );
    `);

    // Seed default configuration if not present
    this.db.exec(`
      INSERT OR IGNORE INTO config (key, value) VALUES ('max-retries', '3');
      INSERT OR IGNORE INTO config (key, value) VALUES ('backoff-base', '2');
    `);
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  insertJob(job) {
    const stmt = this.db.prepare(`
      INSERT INTO jobs (id, command, state, attempts, max_retries, error, created_at, updated_at, run_at)
      VALUES (@id, @command, @state, @attempts, @maxRetries, @error, @createdAt, @updatedAt, @runAt)
    `);

    stmt.run({
      id: job.id,
      command: job.command,
      state: job.state || 'pending',
      attempts: job.attempts || 0,
      maxRetries: job.max_retries !== undefined ? job.max_retries : (job.maxRetries || 3),
      error: job.error || null,
      createdAt: job.created_at || job.createdAt,
      updatedAt: job.updated_at || job.updatedAt,
      runAt: job.run_at || job.runAt
    });

    return this.getJobById(job.id);
  }

  getJobById(id) {
    const stmt = this.db.prepare('SELECT * FROM jobs WHERE id = ?');
    const row = stmt.get(id);
    return this._formatRow(row);
  }

  getJobs(stateFilter = null) {
    let stmt;
    if (stateFilter) {
      stmt = this.db.prepare('SELECT * FROM jobs WHERE state = ? ORDER BY created_at ASC');
      return stmt.all(stateFilter.toLowerCase()).map(r => this._formatRow(r));
    }
    stmt = this.db.prepare('SELECT * FROM jobs ORDER BY created_at ASC');
    return stmt.all().map(r => this._formatRow(r));
  }

  /**
   * Atomic Job Claim Reservation across separate OS processes
   */
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

  updateStatus(id, state, error = null, runAt = null) {
    const now = new Date().toISOString();
    const updateStmt = this.db.prepare(`
      UPDATE jobs
      SET state = ?,
          error = ?,
          updated_at = ?,
          run_at = COALESCE(?, run_at)
      WHERE id = ?
    `);

    updateStmt.run(state, error, now, runAt, id);
    return this.getJobById(id);
  }

  purgeCompletedAndDead() {
    const stmt = this.db.prepare(`
      DELETE FROM jobs WHERE state IN ('completed', 'dead')
    `);
    const result = stmt.run();
    return result.changes;
  }

  recoverStaleJobs(timeoutSeconds = 30) {
    const cutoff = new Date(Date.now() - timeoutSeconds * 1000).toISOString();
    const stmt = this.db.prepare(`
      UPDATE jobs
      SET state = 'pending',
          error = 'Recovered after worker crash / execution timeout',
          updated_at = CURRENT_TIMESTAMP
      WHERE state = 'processing' AND updated_at < ?
    `);
    const result = stmt.run(cutoff);
    return result.changes;
  }

  // DLQ operations
  dlqList() {
    const stmt = this.db.prepare("SELECT * FROM jobs WHERE state = 'dead' ORDER BY updated_at DESC");
    return stmt.all().map(r => this._formatRow(r));
  }

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

  // Config operations
  configSet(key, value) {
    const stmt = this.db.prepare(`
      INSERT INTO config (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    stmt.run(key, String(value));
  }

  configGet(key, defaultValue = null) {
    const stmt = this.db.prepare('SELECT value FROM config WHERE key = ?');
    const row = stmt.get(key);
    return row ? row.value : defaultValue;
  }

  // Cross-process Worker Signaling operations
  registerWorker(pid = process.pid) {
    const workerId = `worker_${pid}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO workers (id, pid, status, last_heartbeat, stop_requested)
      VALUES (?, ?, 'active', ?, 0)
    `);
    stmt.run(workerId, pid, now);
    return workerId;
  }

  heartbeatWorker(workerId) {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE workers SET last_heartbeat = ? WHERE id = ?
    `);
    stmt.run(now, workerId);
  }

  unregisterWorker(workerId) {
    const stmt = this.db.prepare('DELETE FROM workers WHERE id = ?');
    stmt.run(workerId);
  }

  requestStopWorkers() {
    const stmt = this.db.prepare("UPDATE workers SET stop_requested = 1 WHERE status = 'active'");
    const result = stmt.run();
    return result.changes;
  }

  isStopRequested(workerId) {
    const stmt = this.db.prepare('SELECT stop_requested FROM workers WHERE id = ?');
    const row = stmt.get(workerId);
    if (!row) {
      // Check if global stop is requested
      const globalStmt = this.db.prepare('SELECT COUNT(*) as count FROM workers WHERE stop_requested = 1');
      return globalStmt.get().count > 0;
    }
    return row.stop_requested === 1;
  }

  getActiveWorkersCount() {
    const cutoff = new Date(Date.now() - 30 * 1000).toISOString();
    const stmt = this.db.prepare("SELECT COUNT(*) as count FROM workers WHERE status = 'active' AND last_heartbeat >= ?");
    return stmt.get(cutoff).count;
  }

  _formatRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      command: row.command,
      state: row.state,
      attempts: row.attempts,
      max_retries: row.max_retries,
      created_at: row.created_at,
      updated_at: row.updated_at,
      run_at: row.run_at,
      error: row.error || null
    };
  }
}
