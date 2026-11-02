import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(here, '..');
const jestConfig = require('../jest.config.js');
const jestRunner = path.join(here, 'run-jest.cjs');

async function runWorkerPidProbe(timeoutMs, workerIdleMemoryLimit) {
  const probeRoot = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), 'mobile-jest-memory-'))
  );
  const pidFile = path.join(probeRoot, 'worker-pids.txt');
  const suites = Array.from({ length: 4 }, (_, index) => {
    const suitePath = path.join(probeRoot, `suite-${index}.test.js`);
    writeFileSync(
      suitePath,
      [
        "const fs = require('node:fs');",
        "test('records the Jest worker process', () => {",
        '  fs.appendFileSync(process.env.JEST_WORKER_PID_FILE, `${process.pid}\\n`);',
        '});',
        '',
      ].join('\n')
    );
    return suitePath;
  });

  try {
    const config = {
      rootDir: probeRoot,
      testEnvironment: 'node',
      testMatch: ['**/suite-*.test.js'],
      maxWorkers: jestConfig.maxWorkers,
      ...(workerIdleMemoryLimit ? { workerIdleMemoryLimit } : {}),
    };
    await new Promise((resolve, reject) => {
      execFile(
        process.execPath,
        [
          '--no-sparkplug',
          jestRunner,
          '--config',
          JSON.stringify(config),
          '--runTestsByPath',
          ...suites,
        ],
        {
          cwd: mobileRoot,
          env: { ...process.env, JEST_WORKER_PID_FILE: pidFile },
          timeout: timeoutMs,
          maxBuffer: 1_000_000,
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(
              new Error(
                [error.message, `stdout:\n${stdout}`, `stderr:\n${stderr}`].join(
                  '\n'
                ),
                { cause: error }
              )
            );
          } else resolve();
        }
      );
    });
    return readFileSync(pidFile, 'utf8').trim().split(/\s+/);
  } finally {
    rmSync(probeRoot, { force: true, recursive: true });
  }
}

test('Jest reuses workers normally and recycles them at the configured idle-memory limit', async () => {
  const probeTimeoutMs = 25_000;
  const withoutLimit = await runWorkerPidProbe(probeTimeoutMs);
  const withLimit = await runWorkerPidProbe(probeTimeoutMs, '1KB');
  const reusedPidCount = new Set(withoutLimit).size;
  const recycledPidCount = new Set(withLimit).size;

  assert.equal(withoutLimit.length, 4);
  assert.ok(reusedPidCount < withoutLimit.length);
  assert.equal(withLimit.length, 4);
  assert.ok(recycledPidCount > reusedPidCount);
  assert.equal(recycledPidCount, withLimit.length);
});
