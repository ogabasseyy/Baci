import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs, {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { withDrainFileLock } from './drain-file-lock.mjs';

describe('drain file lock', () => {
  it('releases the lock after the critical section succeeds', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-drain-lock-'));
    const lockPath = join(directory, 'vercel-drain.jsonl.lock');

    assert.equal(
      withDrainFileLock(lockPath, () => 'done'),
      'done'
    );
    assert.throws(() => statSync(lockPath), { code: 'ENOENT' });
  });

  it('reclaims an abandoned lock before running the critical section', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-drain-lock-'));
    const lockPath = join(directory, 'vercel-drain.jsonl.lock');
    mkdirSync(directory, { recursive: true });
    writeFileSync(lockPath, '999999\n');
    const oldTime = Date.now() - 120_000;
    utimesSync(lockPath, oldTime / 1_000, oldTime / 1_000);

    assert.equal(
      withDrainFileLock(lockPath, () => 'recovered'),
      'recovered'
    );
    assert.throws(() => statSync(lockPath), { code: 'ENOENT' });
  });

  it('reclaims a fresh lock immediately when its recorded owner is gone', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-drain-lock-'));
    const lockPath = join(directory, 'vercel-drain.jsonl.lock');
    writeFileSync(lockPath, '99999999\n');

    assert.equal(
      withDrainFileLock(lockPath, () => 'recovered'),
      'recovered'
    );
    assert.throws(() => statSync(lockPath), { code: 'ENOENT' });
  });

  it('reclaims an old lock even when its recorded PID was reused', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-drain-lock-'));
    const lockPath = join(directory, 'vercel-drain.jsonl.lock');
    writeFileSync(lockPath, `${process.pid}\n`);
    const oldTime = Date.now() - 120_000;
    utimesSync(lockPath, oldTime / 1_000, oldTime / 1_000);

    assert.equal(
      withDrainFileLock(lockPath, () => 'recovered'),
      'recovered'
    );
    assert.throws(() => statSync(lockPath), { code: 'ENOENT' });
  });

  it('waits for an in-progress stale reclaim before entering the critical section', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-drain-lock-'));
    const lockPath = join(directory, 'vercel-drain.jsonl.lock');
    const markerPath = `${lockPath}.reclaim-${process.pid}-test`;
    writeFileSync(lockPath, '99999999\n');
    const oldTime = Date.now() - 120_000;
    utimesSync(lockPath, oldTime / 1_000, oldTime / 1_000);
    writeFileSync(markerPath, `${process.pid}\n`);

    const markerCleanup = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import { unlinkSync } from 'node:fs'; setTimeout(() => { try { unlinkSync(process.env.BACI_RECLAIM_MARKER); } catch {} }, 150);",
      ],
      {
        env: { ...process.env, BACI_RECLAIM_MARKER: markerPath },
        stdio: 'ignore',
      }
    );
    markerCleanup.unref();

    assert.equal(
      withDrainFileLock(lockPath, () => 'recovered'),
      'recovered'
    );
    assert.throws(() => statSync(lockPath), { code: 'ENOENT' });
  });

  it('removes the owned lock when a reclaim starts during release', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-drain-lock-'));
    const lockPath = join(directory, 'vercel-drain.jsonl.lock');
    const markerPath = `${lockPath}.reclaim-${process.pid}-test`;

    assert.equal(
      withDrainFileLock(lockPath, () => {
        writeFileSync(markerPath, `${process.pid}\n`);
        return 'done';
      }),
      'done'
    );
    assert.throws(() => statSync(lockPath), { code: 'ENOENT' });

    unlinkSync(markerPath);
  });

  it('does not release a replacement lock owned by another generation', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-drain-lock-'));
    const lockPath = join(directory, 'vercel-drain.jsonl.lock');
    const replacementPath = join(directory, 'replacement.lock');

    withDrainFileLock(lockPath, () => {
      writeFileSync(replacementPath, 'replacement\n');
      renameSync(replacementPath, lockPath);
    });

    assert.equal(readFileSync(lockPath, 'utf8'), 'replacement\n');
  });

  it('removes a lock left behind when writing its owner fails', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-drain-lock-'));
    const lockPath = join(directory, 'vercel-drain.jsonl.lock');
    const originalWriteSync = fs.writeSync;
    fs.writeSync = (...args) => {
      if (args[1] === `${process.pid}\n`) {
        const error = new Error('disk full');
        error.code = 'ENOSPC';
        throw error;
      }
      return originalWriteSync(...args);
    };
    syncBuiltinESMExports();

    try {
      assert.throws(() => withDrainFileLock(lockPath, () => 'unreachable'), {
        code: 'ENOSPC',
      });
      assert.throws(() => statSync(lockPath), { code: 'ENOENT' });
    } finally {
      fs.writeSync = originalWriteSync;
      syncBuiltinESMExports();
    }
  });

  it('removes a reclaim marker when marker initialization fails', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-drain-lock-'));
    const lockPath = join(directory, 'vercel-drain.jsonl.lock');
    writeFileSync(lockPath, '99999999\n');
    const oldTime = Date.now() - 120_000;
    utimesSync(lockPath, oldTime / 1_000, oldTime / 1_000);

    const originalWriteSync = fs.writeSync;
    fs.writeSync = (...args) => {
      if (args[1] === `${process.pid}\n`) {
        const error = new Error('disk full');
        error.code = 'ENOSPC';
        throw error;
      }
      return originalWriteSync(...args);
    };
    syncBuiltinESMExports();

    try {
      assert.throws(() => withDrainFileLock(lockPath, () => 'unreachable'), {
        code: 'ENOSPC',
      });
      assert.deepEqual(
        fs
          .readdirSync(directory)
          .filter((name) =>
            name.startsWith('vercel-drain.jsonl.lock.reclaim-')
          ),
        []
      );
    } finally {
      fs.writeSync = originalWriteSync;
      syncBuiltinESMExports();
    }
  });
});
