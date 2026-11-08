import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  tryCreateEvidenceLock,
  withEvidenceLockPathGuard,
} from './cloudflare-evidence-lock-guard';

describe('cloudflare evidence lock guard', () => {
  it('serializes acquisition with reclamation path mutations', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'baci-evidence-guard-'));
    await chmod(stateDir, 0o700);
    const lockPath = join(stateDir, '.active-run.lock');
    let firstEntered!: () => void;
    let releaseFirst!: () => void;
    const firstEnteredPromise = new Promise<void>((resolve) => {
      firstEntered = resolve;
    });
    const firstReleasePromise = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let secondEntered = false;
    const first = withEvidenceLockPathGuard(lockPath, async () => {
      firstEntered();
      await firstReleasePromise;
    });
    await firstEnteredPromise;
    const second = withEvidenceLockPathGuard(lockPath, async () => {
      secondEntered = true;
    });
    await Promise.resolve();
    expect(secondEntered).toBe(false);
    releaseFirst();
    await Promise.all([first, second]);
    expect(secondEntered).toBe(true);
    await expect(tryCreateEvidenceLock(lockPath, 'record\n')).resolves.toBe(
      true
    );
    await rm(stateDir, { recursive: true, force: true });
  });

  it('reclaims a crash-left guard bound to a dead owner', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'baci-evidence-guard-'));
    await chmod(stateDir, 0o700);
    const lockPath = join(stateDir, '.active-run.lock');
    const guardPath = `${lockPath}.reclaim-guard`;
    await mkdir(guardPath, { mode: 0o700 });
    await writeFile(
      `${stateDir}/.active-run.lock.reclaim-owner-0-dead`,
      '{"pid":999999,"processStartTime":"dead","token":"dead"}\n',
      { mode: 0o600 }
    );
    await writeFile(
      `${guardPath}/owner`,
      '{"pid":999999,"processStartTime":"dead","token":"dead"}\n',
      { mode: 0o600 }
    );

    let entered = false;
    await expect(
      withEvidenceLockPathGuard(lockPath, async () => {
        entered = true;
      })
    ).resolves.toBeUndefined();

    expect(entered).toBe(true);
    await expect(readdir(stateDir)).resolves.toEqual([]);
    await rm(stateDir, { recursive: true, force: true });
  });

  it('reclaims a malformed partial owner record after its writer dies', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'baci-evidence-guard-'));
    await chmod(stateDir, 0o700);
    const lockPath = join(stateDir, '.active-run.lock');
    const child = spawn(process.execPath, ['-e', 'process.exit(0)']);
    if (!child.pid) throw new Error('child PID is unavailable');
    const deadPid = child.pid;
    await once(child, 'exit');
    await writeFile(
      `${stateDir}/.active-run.lock.reclaim-owner-${deadPid}-partial`,
      '{"pid":',
      { mode: 0o600 }
    );

    let entered = false;
    await withEvidenceLockPathGuard(lockPath, async () => {
      entered = true;
    });

    expect(entered).toBe(true);
    await expect(readdir(stateDir)).resolves.toEqual([]);
    await rm(stateDir, { recursive: true, force: true });
  });

  it.each([
    'writeFile',
    'sync',
    'close',
  ] as const)('removes a partial owner record when %s fails after open', async (failure) => {
    const stateDir = await mkdtemp(join(tmpdir(), 'baci-evidence-guard-'));
    await chmod(stateDir, 0o700);
    const lockPath = join(stateDir, '.active-run.lock');
    let closed = false;

    await expect(
      withEvidenceLockPathGuard(lockPath, async () => undefined, {
        open: async (path, flags, mode) => {
          const handle = await open(path, flags, mode);
          let closeAttempts = 0;
          return {
            writeFile: async (value) => {
              if (failure === 'writeFile') throw new Error('write failed');
              await handle.writeFile(value);
            },
            sync: async () => {
              if (failure === 'sync') throw new Error('sync failed');
              await handle.sync();
            },
            close: async () => {
              closeAttempts += 1;
              if (!closed) {
                await handle.close();
                closed = true;
              }
              if (failure === 'close' && closeAttempts === 1)
                throw new Error('close failed');
            },
          };
        },
        remove: (path) => rm(path, { force: true }),
      })
    ).rejects.toThrow(`${failure.replace('File', '').toLowerCase()} failed`);

    expect(closed).toBe(true);
    await expect(readdir(stateDir)).resolves.toEqual([]);
    await rm(stateDir, { recursive: true, force: true });
  });

  it('records the owning process inside the guard while the operation runs', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'baci-evidence-guard-'));
    await chmod(stateDir, 0o700);
    const lockPath = join(stateDir, '.active-run.lock');
    let ownerRecord = '';
    await withEvidenceLockPathGuard(lockPath, async () => {
      ownerRecord = await readFile(`${lockPath}.reclaim-guard/owner`, 'utf8');
      expect(JSON.parse(ownerRecord)).toMatchObject({
        pid: process.pid,
        token: expect.any(String),
      });
    });
    expect(ownerRecord).toContain('processStartTime');
    await rm(stateDir, { recursive: true, force: true });
  });

  it('removes the arbitration record even when guard cleanup fails', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'baci-evidence-guard-'));
    await chmod(stateDir, 0o700);
    const lockPath = join(stateDir, '.active-run.lock');

    await expect(
      withEvidenceLockPathGuard(lockPath, async () => {
        await writeFile(
          `${lockPath}.reclaim-guard/owner`,
          '{"pid":1,"processStartTime":"changed","token":"changed"}\n',
          { mode: 0o600 }
        );
      })
    ).rejects.toThrow('owner changed');
    await expect(readdir(stateDir)).resolves.toEqual([
      '.active-run.lock.reclaim-guard',
    ]);
    await rm(stateDir, { recursive: true, force: true });
  });

  it('tolerates owner metadata disappearing during concurrent acquisition', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'baci-evidence-guard-'));
    await chmod(stateDir, 0o700);
    const lockPath = join(stateDir, '.active-run.lock');

    for (let round = 0; round < 2; round++) {
      const acquisitions = Array.from({ length: 4 }, () =>
        withEvidenceLockPathGuard(lockPath, async () => {
          await new Promise<void>((resolve) => setImmediate(resolve));
        })
      );
      await expect(Promise.all(acquisitions)).resolves.toHaveLength(4);
    }

    await expect(readdir(stateDir)).resolves.toEqual([]);
    await rm(stateDir, { recursive: true, force: true });
  });
});
