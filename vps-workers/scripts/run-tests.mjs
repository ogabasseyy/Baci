import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function collectTestFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(path));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
      files.push(path);
    }
  }

  return files;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workerRoot = join(scriptDir, '..');
const testFiles = ['bin', 'jobs', 'lib', 'release']
  .flatMap((directory) => collectTestFiles(join(workerRoot, directory)))
  .sort();

if (testFiles.length === 0) {
  console.error('No VPS worker test files found.');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  stdio: 'inherit',
});
if (result.error) {
  console.error('Failed to run VPS worker tests:', result.error.message);
  process.exit(1);
}
if (result.signal) {
  console.error(`VPS worker tests terminated by signal: ${result.signal}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
