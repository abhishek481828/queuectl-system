import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../');

export const CONFIG = {
  rootDir,
  dataDir: path.join(rootDir, 'data'),
  dbFile: path.join(rootDir, 'data', 'jobs.json'),
  defaultConcurrency: 2,
  maxRetries: 3,
  retryDelayMs: 1000
};
