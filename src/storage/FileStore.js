import fs from 'fs/promises';
import path from 'path';
import { CONFIG } from '../config/index.js';

export class FileStore {
  constructor(filePath = CONFIG.dbFile) {
    this.filePath = filePath;
    this.dataDir = path.dirname(filePath);
  }

  async init() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      try {
        await fs.access(this.filePath);
      } catch {
        await this.saveJobs([]);
      }
    } catch (err) {
      console.error('Failed to initialize storage:', err.message);
    }
  }

  async loadJobs() {
    await this.init();
    try {
      const data = await fs.readFile(this.filePath, 'utf-8');
      return JSON.parse(data || '[]');
    } catch (err) {
      return [];
    }
  }

  async saveJobs(jobs) {
    await fs.mkdir(this.dataDir, { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(jobs, null, 2), 'utf-8');
    await fs.rename(tempPath, this.filePath);
  }
}
