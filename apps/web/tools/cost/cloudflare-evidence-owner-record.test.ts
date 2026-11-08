import { chmod, link, mkdtemp, open, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withEvidenceLockPathGuard } from './cloudflare-evidence-lock-guard';

describe('atomic evidence owner publication', () => {
  it('does not publish a partial owner record during writes', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'baci-evidence-guard-'));
    await chmod(stateDir, 0o700);
    const lockPath = join(stateDir, '.active-run.lock');
    const visibleDuringWrite: string[][] = [];
    await withEvidenceLockPathGuard(lockPath, async () => undefined, {
      open: async (path, flags, mode) => {
        const handle = await open(path, flags, mode);
        return {
          writeFile: async (value) => {
            visibleDuringWrite.push(await readdir(stateDir));
            await handle.writeFile(value);
          },
          sync: () => handle.sync(),
          close: () => handle.close(),
        };
      },
      link,
      remove: (path) => rm(path, { force: true }),
    });
    expect(visibleDuringWrite).toHaveLength(2);
    expect(
      visibleDuringWrite[0].some((name) =>
        name.startsWith('.active-run.lock.reclaim-owner-')
      )
    ).toBe(false);
    await expect(readdir(stateDir)).resolves.toEqual([]);
    await rm(stateDir, { recursive: true, force: true });
  });

  it('serializes competitors while an owner record is still being written', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'baci-evidence-guard-'));
    await chmod(stateDir, 0o700);
    const lockPath = join(stateDir, '.active-run.lock');
    let writing!: () => void;
    let resume!: () => void;
    const writingStarted = new Promise<void>((resolve) => {
      writing = resolve;
    });
    const release = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let firstWrite = true;
    let inside = 0;
    const operation = async () => {
      expect(++inside).toBe(1);
      await new Promise<void>((resolve) => setImmediate(resolve));
      inside--;
    };
    const first = withEvidenceLockPathGuard(lockPath, operation, {
      open: async (path, flags, mode) => {
        const handle = await open(path, flags, mode);
        return {
          writeFile: async (value) => {
            if (firstWrite) {
              firstWrite = false;
              writing();
              await release;
            }
            await handle.writeFile(value);
          },
          sync: () => handle.sync(),
          close: () => handle.close(),
        };
      },
      link,
      remove: (path) => rm(path, { force: true }),
    });
    await writingStarted;
    try {
      await withEvidenceLockPathGuard(lockPath, operation);
    } finally {
      resume();
      await first;
    }
    await expect(readdir(stateDir)).resolves.toEqual([]);
    await rm(stateDir, { recursive: true, force: true });
  });

  it('cleans up when publishing an owner record fails', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'baci-evidence-guard-'));
    await chmod(stateDir, 0o700);
    await expect(
      withEvidenceLockPathGuard(
        join(stateDir, '.active-run.lock'),
        async () => undefined,
        {
          open,
          link: async () => {
            throw new Error('publish failed');
          },
          remove: (path) => rm(path, { force: true }),
        }
      )
    ).rejects.toThrow('publish failed');
    await expect(readdir(stateDir)).resolves.toEqual([]);
    await rm(stateDir, { recursive: true, force: true });
  });

  it('keeps competitors outside while guard owner publication is paused', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'baci-evidence-guard-'));
    await chmod(stateDir, 0o700);
    const lockPath = join(stateDir, '.active-run.lock');
    let paused!: () => void;
    let resume!: () => void;
    const pausedPromise = new Promise<void>((resolve) => {
      paused = resolve;
    });
    const release = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let writeCount = 0;
    let firstEntered = false;
    let secondEntered = false;
    const first = withEvidenceLockPathGuard(
      lockPath,
      async () => {
        firstEntered = true;
      },
      {
        open: async (path, flags, mode) => {
          const handle = await open(path, flags, mode);
          return {
            writeFile: async (value) => {
              if (++writeCount === 2) {
                paused();
                await release;
              }
              await handle.writeFile(value);
            },
            sync: () => handle.sync(),
            close: () => handle.close(),
          };
        },
        link,
        remove: (path) => rm(path, { force: true }),
      }
    );
    await pausedPromise;
    const second = withEvidenceLockPathGuard(lockPath, async () => {
      expect(firstEntered).toBe(true);
      secondEntered = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(secondEntered).toBe(false);
    resume();
    await Promise.all([first, second]);
    expect(secondEntered).toBe(true);
    await expect(readdir(stateDir)).resolves.toEqual([]);
    await rm(stateDir, { recursive: true, force: true });
  });

  it('cleans published and temporary records when temporary removal fails', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'baci-evidence-guard-'));
    await chmod(stateDir, 0o700);
    let failOnce = true;
    let entered = false;
    await expect(
      withEvidenceLockPathGuard(
        join(stateDir, '.active-run.lock'),
        async () => {
          entered = true;
        },
        {
          open,
          link,
          remove: async (path) => {
            if (failOnce && path.includes('.baci-owner-pending-')) {
              failOnce = false;
              throw new Error('remove failed');
            }
            await rm(path, { force: true });
          },
        }
      )
    ).rejects.toThrow('remove failed');
    expect(entered).toBe(false);
    await expect(readdir(stateDir)).resolves.toEqual([]);
    await rm(stateDir, { recursive: true, force: true });
  });
});
