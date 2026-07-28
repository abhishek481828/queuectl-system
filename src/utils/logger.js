/**
 * Production-grade structured logger for QueueCTL telemetry and diagnostic logging.
 * Supports log levels (DEBUG, INFO, WARN, ERROR), JSON formatting, child metadata bindings,
 * and stderr stream routing.
 */

const LOG_LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export class Logger {
  /**
   * @param {Object} options Configuration options
   * @param {string} [options.level] Minimum log level threshold ('debug'|'info'|'warn'|'error')
   * @param {boolean} [options.json] Force JSON formatted output strings
   * @param {Object} [options.defaultMeta] Permanent contextual metadata bound to this logger instance
   */
  constructor(options = {}) {
    const envLevel = (process.env.QUEUECTL_LOG_LEVEL || 'info').toLowerCase();
    this.level = LOG_LEVELS[options.level || envLevel] || LOG_LEVELS.info;
    this.isJson = options.json !== undefined ? options.json : process.env.NODE_ENV === 'production';
    this.defaultMeta = options.defaultMeta || {};
  }

  /**
   * Creates a child logger instance that inherits current configuration and appends extra contextual metadata.
   * @param {Object} childMeta Contextual metadata (e.g. { jobId, workerId })
   * @returns {Logger} Child Logger instance
   */
  child(childMeta = {}) {
    return new Logger({
      level: Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key] === this.level) || 'info',
      json: this.isJson,
      defaultMeta: { ...this.defaultMeta, ...childMeta }
    });
  }

  /**
   * Dispatches a structured log record.
   * @param {string} levelName Log severity level
   * @param {string} message Primary log description
   * @param {Object} [metadata={}] Dynamic key-value pairs
   */
  log(levelName, message, metadata = {}) {
    const levelVal = LOG_LEVELS[levelName] || LOG_LEVELS.info;
    if (levelVal < this.level) return;

    // Merge default metadata with call-site metadata
    const mergedMeta = { ...this.defaultMeta, ...metadata };

    // Format error objects if passed in metadata
    if (mergedMeta.error instanceof Error) {
      mergedMeta.error = {
        message: mergedMeta.error.message,
        stack: mergedMeta.error.stack
      };
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      level: levelName.toUpperCase(),
      message,
      ...mergedMeta
    };

    if (this.isJson) {
      const output = JSON.stringify(logEntry);
      if (levelVal >= LOG_LEVELS.warn) {
        process.stderr.write(`${output}\n`);
      } else {
        process.stdout.write(`${output}\n`);
      }
    } else {
      const metaStr = Object.keys(mergedMeta).length ? ` ${JSON.stringify(mergedMeta)}` : '';
      const formatted = `[${logEntry.timestamp}] [${logEntry.level}] ${message}${metaStr}\n`;
      if (levelVal >= LOG_LEVELS.warn) {
        process.stderr.write(formatted);
      } else {
        process.stdout.write(formatted);
      }
    }
  }

  debug(msg, meta) { this.log('debug', msg, meta); }
  info(msg, meta) { this.log('info', msg, meta); }
  warn(msg, meta) { this.log('warn', msg, meta); }
  error(msg, meta) { this.log('error', msg, meta); }
}

export const logger = new Logger();
