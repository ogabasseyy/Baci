import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasCurrentRemediationGlobalLock } from './remediation-global-lock.mjs';

describe('remediation global lock ownership', () => {
  it('does not accept an unlocked lock file as the current process capability', (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-remediation-lock-'));
    t.after(() => rmSync(directory, { force: true, recursive: true }));
    const lockPath = join(directory, 'global.lock');
    writeFileSync(lockPath, '');

    assert.equal(hasCurrentRemediationGlobalLock(lockPath), false);
  });

  it('reexecutes under the exact Linux FLOCK owner and releases it when the Node owner dies', {
    skip: process.platform !== 'linux',
  }, async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-remediation-lock-'));
    t.after(() => rmSync(directory, { force: true, recursive: true }));
    const lockPath = join(directory, 'global.lock');
    const moduleUrl = pathToFileURL(
      join(
        dirname(fileURLToPath(import.meta.url)),
        'remediation-global-lock.mjs'
      )
    ).href;
    const jobPath = join(directory, 'job.mjs');
    writeFileSync(
      jobPath,
      `import { hasRemediationGlobalLockCapability, runRemediationJobWithGlobalLock } from '${moduleUrl}';\nconst exitCode = await runRemediationJobWithGlobalLock({ main(lock) { if (!hasRemediationGlobalLockCapability(lock)) process.exitCode = 99; else process.stdout.write('entered\\n'); }, scriptPath: process.argv[1] });\nif (exitCode !== null) process.exitCode = exitCode;`
    );

    const entered = spawnSync(process.execPath, [jobPath], {
      encoding: 'utf8',
      env: { ...process.env, BACI_REMEDIATION_GLOBAL_LOCK_PATH: lockPath },
    });
    assert.equal(entered.status, 0);
    assert.equal(entered.stdout, 'entered\n');
    const failedPath = join(directory, 'failed-job.mjs');
    writeFileSync(
      failedPath,
      `import { runRemediationJobWithGlobalLock } from '${moduleUrl}';\nconst exitCode = await runRemediationJobWithGlobalLock({ main() { process.exitCode = 23; }, scriptPath: process.argv[1] });\nif (exitCode !== null) process.exitCode = exitCode;`
    );
    const failed = spawnSync(process.execPath, [failedPath], {
      encoding: 'utf8',
      env: { ...process.env, BACI_REMEDIATION_GLOBAL_LOCK_PATH: lockPath },
    });
    assert.equal(failed.status, 23);

    const holderPath = join(directory, 'holder.mjs');
    const unrelatedPath = join(directory, 'unrelated.mjs');
    writeFileSync(
      unrelatedPath,
      `import { hasCurrentRemediationGlobalLock } from '${moduleUrl}';\nprocess.stdout.write(String(hasCurrentRemediationGlobalLock(process.argv[2])));`
    );
    writeFileSync(
      holderPath,
      `import { spawn } from 'node:child_process';\nimport { hasCurrentRemediationGlobalLock } from '${moduleUrl}';\nif (!hasCurrentRemediationGlobalLock(process.argv[2])) process.exit(99);\nconst child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], { stdio: 'ignore' });\nprocess.stdout.write(String(child.pid) + '\\n');\nsetInterval(() => {}, 1_000);`
    );
    const holder = spawn(
      'flock',
      [
        '-F',
        '-n',
        '-E',
        '75',
        lockPath,
        process.execPath,
        holderPath,
        lockPath,
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] }
    );
    t.after(() => holder.kill('SIGKILL'));
    const [output] = await once(holder.stdout, 'data');
    const childPid = Number(output.toString().trim());
    assert.ok(Number.isSafeInteger(childPid));
    t.after(() => {
      try {
        process.kill(childPid, 'SIGKILL');
      } catch {
        // The child may already have exited.
      }
    });
    const contender = spawnSync(process.execPath, [jobPath], {
      encoding: 'utf8',
      env: { ...process.env, BACI_REMEDIATION_GLOBAL_LOCK_PATH: lockPath },
    });
    assert.equal(contender.status, 75);
    assert.equal(contender.stdout, '');
    const unrelated = spawnSync(process.execPath, [unrelatedPath, lockPath], {
      encoding: 'utf8',
    });
    assert.equal(unrelated.status, 0);
    assert.equal(unrelated.stdout, 'false');
    holder.kill('SIGKILL');
    await once(holder, 'exit');
    const recovered = spawnSync('flock', ['-n', '-E', '75', lockPath, 'true']);
    assert.equal(recovered.status, 0);
  });

  it('fails closed when the locked inode is replaced before verification', {
    skip: process.platform !== 'linux',
  }, (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-remediation-lock-'));
    t.after(() => rmSync(directory, { force: true, recursive: true }));
    const lockPath = join(directory, 'global.lock');
    const moduleUrl = pathToFileURL(
      join(
        dirname(fileURLToPath(import.meta.url)),
        'remediation-global-lock.mjs'
      )
    ).href;
    const probePath = join(directory, 'replacement.mjs');
    writeFileSync(
      probePath,
      `import { unlinkSync, writeFileSync } from 'node:fs';\nimport { hasCurrentRemediationGlobalLock } from '${moduleUrl}';\nconst path = process.argv[2];\nprocess.stdout.write(String(hasCurrentRemediationGlobalLock(path)) + ' ');\nunlinkSync(path); writeFileSync(path, '');\nprocess.stdout.write(String(hasCurrentRemediationGlobalLock(path)));`
    );
    const result = spawnSync(
      'flock',
      ['-F', '-n', '-E', '75', lockPath, process.execPath, probePath, lockPath],
      { encoding: 'utf8' }
    );

    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'true false');
  });
});
